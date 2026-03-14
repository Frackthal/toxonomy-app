// server/toxProfile.js — Profil toxicologique via PubChem + HSDB + Gemini
// Architecture : 4 prompts parallèles
//   - Chaque prompt reçoit TOUT PubChem Toxicity (commun)
//   - + sections HSDB ciblées par groupe thématique
//   - Filtrage par tags (/GENOTOXICITY/, /MUTAGENICITY/, etc.) pour les grandes sections HSDB
// Requiert : GEMINI_API_KEY dans les variables d'environnement

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_MODEL = 'gemini-2.5-flash';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

// ─── Cache mémoire ────────────────────────────────────────────────────────────
const profileCache = new Map();
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

function getCached(cas) {
  const entry = profileCache.get(cas);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CACHE_TTL_MS) { profileCache.delete(cas); return null; }
  return entry.profile;
}
function setCache(cas, profile) {
  profileCache.set(cas, { profile, timestamp: Date.now() });
}

// ─── PubChem fetch ────────────────────────────────────────────────────────────
async function pubchemGet(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
    if (!res.ok) return null;
    return res.json();
  } catch (e) {
    console.warn(`PubChem fetch failed: ${e.message}`);
    return null;
  }
}

async function getCID(cas) {
  const data = await pubchemGet(
    `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/${encodeURIComponent(cas)}/cids/JSON`
  );
  return data?.IdentifierList?.CID?.[0] || null;
}

async function getPubchemProps(cid) {
  const data = await pubchemGet(
    `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/${cid}/property/IUPACName,MolecularFormula,MolecularWeight/JSON`
  );
  return data?.PropertyTable?.Properties?.[0] || {};
}

async function fetchPugView(cid, heading) {
  return pubchemGet(
    `https://pubchem.ncbi.nlm.nih.gov/rest/pug_view/data/compound/${cid}/JSON?heading=${encodeURIComponent(heading)}`
  );
}

// ─── Helpers d'extraction ─────────────────────────────────────────────────────
function findSection(node, heading) {
  if (!node) return null;
  if (node.TOCHeading === heading) return node;
  if (node.Section) {
    for (const s of node.Section) {
      const found = findSection(s, heading);
      if (found) return found;
    }
  }
  return null;
}

function formatRef(raw) {
  if (!raw) return '';
  if (raw.startsWith('PMID:')) return raw;
  const yearMatch = raw.match(/\((\d{4})\)/);
  const year = yearMatch ? yearMatch[1] : '';
  const authorMatch = raw.match(/^([^;.,\n]{2,40})/);
  const author = authorMatch ? authorMatch[1].trim() : raw.substring(0, 30);
  return year ? `${author}, ${year}` : author.substring(0, 50);
}

// tagFilter : tableau de strings — si défini, ne garde que les items dont le texte
// commence par l'un de ces tags (ex: ['/GENOTOXICITY/', '/MUTAGENICITY/'])
function extractItems(node, maxItems = 5, maxChars = 800, tagFilter = null) {
  const items = [];
  function walk(n) {
    if (!n || items.length >= maxItems) return;
    if (n.Information) {
      for (const inf of n.Information) {
        if (items.length >= maxItems) break;
        const strings = inf.Value?.StringWithMarkup
          ?.map(s => s.String)
          .filter(s => s && s.length > 10) || [];
        const ref = formatRef(inf.Reference?.[0] || '');
        for (const str of strings.slice(0, 2)) {
          if (items.length >= maxItems) break;
          if (tagFilter && !tagFilter.some(tag => str.startsWith(tag))) continue;
          const text = str.length > maxChars ? str.substring(0, maxChars) + '…' : str;
          items.push({ text: text.trim(), ref });
        }
      }
    }
    if (n.Section) n.Section.forEach(walk);
  }
  walk(node);
  return items;
}

// Extraction standard sans filtre de tag
function extractSection(heading, ...docs) {
  for (const doc of docs) {
    if (!doc) continue;
    const node = findSection(doc?.Record, heading);
    if (node) {
      const items = extractItems(node, 5, 800, null);
      if (items.length) return items;
    }
  }
  return [];
}

// Extraction avec filtre de tag — pour les grandes sections HSDB
function extractSectionFiltered(heading, tagFilter, ...docs) {
  for (const doc of docs) {
    if (!doc) continue;
    const node = findSection(doc?.Record, heading);
    if (node) {
      const items = extractItems(node, 6, 800, tagFilter);
      if (items.length) return items;
    }
  }
  return [];
}

function serializeSections(sections) {
  let text = '';
  for (const [heading, items] of Object.entries(sections)) {
    if (!items?.length) continue;
    text += `### ${heading}\n`;
    for (const item of items) {
      text += `- ${item.text}`;
      if (item.ref) text += ` [${item.ref}]`;
      text += '\n';
    }
    text += '\n';
  }
  return text;
}

// ─── Texte PubChem commun (envoyé à tous les prompts) ────────────────────────
const PUBCHEM_TOX_HEADINGS = [
  'Toxicity Summary',
  'Acute Effects',
  'Toxicity Data',
  'Signs and Symptoms',
  'Health Effects',
  'Target Organs',
  'Exposure Routes',
  'Human Toxicity Excerpts',
  'Non-Human Toxicity Excerpts',
  'Human Toxicity Values',
  'Non-Human Toxicity Values',
  'Evidence for Carcinogenicity',
  'Carcinogen Classification',
  'National Toxicology Program Studies',
  'Minimum Risk Level',
  'EPA IRIS Information',
  'EPA Provisional Peer-Reviewed Toxicity Values',
  'NIOSH Toxicity Data',
  'Populations at Special Risk',
  'EFSA Genotoxicity',
  'GHS Classification',
];

function buildPubchemText(toxData, ghsData) {
  const sections = {};
  for (const heading of PUBCHEM_TOX_HEADINGS) {
    const items = extractSection(heading, toxData, ghsData);
    if (items.length) sections[heading] = items;
  }
  return serializeSections(sections);
}

// ─── Textes HSDB par groupe thématique ───────────────────────────────────────

// Groupe 1 — Toxicocinétique / Toxicité aiguë
function buildHsdbGroup1(hsdbData) {
  if (!hsdbData) return '';
  const sections = {};
  for (const h of ['Metabolism/Pharmacokinetics', 'Toxicokinetics',
                    'Absorption, Distribution and Excretion']) {
    const items = extractSection(h, hsdbData);
    if (items.length) sections[h] = items;
  }
  // Toxicité aiguë dans Human Health Effects
  const acute = extractSectionFiltered('Human Health Effects',
    ['/ACUTE HAZARD', '/ACUTE TOXICITY', '/SIGNS AND SYMPTOMS/'], hsdbData);
  if (acute.length) sections['Acute toxicity (HSDB Human Health Effects)'] = acute;

  const acuteAnimal = extractSectionFiltered('Animal Toxicity Studies',
    ['/ACUTE TOXICITY/', '/LABORATORY ANIMALS: ACUTE EXPOSURE/'], hsdbData);
  if (acuteAnimal.length) sections['Acute toxicity (HSDB Animal Studies)'] = acuteAnimal;

  return serializeSections(sections);
}

// Groupe 2 — Irritation / Sensibilisation / Doses répétées
function buildHsdbGroup2(hsdbData) {
  if (!hsdbData) return '';
  const sections = {};
  for (const h of ['Skin, Eye, and Respiratory Irritations', 'Sensitization', 'Immunotoxicity']) {
    const items = extractSection(h, hsdbData);
    if (items.length) sections[h] = items;
  }
  // Irritation dans Human Health Effects
  const irrit = extractSectionFiltered('Human Health Effects',
    ['/IRRITATION/', '/SKIN IRRITATION/', '/EYE IRRITATION/'], hsdbData);
  if (irrit.length) sections['Irritation (HSDB Human Health Effects)'] = irrit;

  // Sensibilisation dans Human Health Effects
  const sens = extractSectionFiltered('Human Health Effects',
    ['/SENSITIZATION/', '/ALLERGIC REACTIONS/', '/ASTHMA/'], hsdbData);
  if (sens.length) sections['Sensitization (HSDB Human Health Effects)'] = sens;

  // Doses répétées dans Animal Studies
  const chronic = extractSectionFiltered('Animal Toxicity Studies',
    ['/LABORATORY ANIMALS: SUBCHRONIC OR PRECHRONIC EXPOSURE/',
     '/LABORATORY ANIMALS: CHRONIC EXPOSURE AND CARCINOGENICITY/',
     '/SUBCHRONIC/', '/CHRONIC/'], hsdbData);
  if (chronic.length) sections['Subchronic/Chronic (HSDB Animal Studies)'] = chronic;

  return serializeSections(sections);
}

// Groupe 3 — Génotoxicité / Cancérogénicité / Reproduction
function buildHsdbGroup3(hsdbData) {
  if (!hsdbData) return '';
  const sections = {};

  // Sections dédiées si elles existent
  for (const h of ['Mutagenicity', 'Genotoxicity', 'Carcinogenicity',
                    'Reproductive Hazard', 'Developmental Toxicity']) {
    const items = extractSection(h, hsdbData);
    if (items.length) sections[h] = items;
  }

  // Génotoxicité depuis Human Health Effects (tags /GENOTOXICITY/, /MUTAGENICITY/, in vitro)
  const genoHuman = extractSectionFiltered('Human Health Effects',
    ['/GENOTOXICITY/', '/MUTAGENICITY/', '/ALTERNATIVE and IN VITRO TESTS/'], hsdbData);
  if (genoHuman.length) sections['Genotoxicity (HSDB Human Health Effects)'] = genoHuman;

  // Génotoxicité depuis Animal Toxicity Studies
  const genoAnimal = extractSectionFiltered('Animal Toxicity Studies',
    ['/GENOTOXICITY/', '/MUTAGENICITY/',
     '/LABORATORY ANIMALS: GENOTOXICITY OR GENETIC TOXICOLOGY/'], hsdbData);
  if (genoAnimal.length) sections['Genotoxicity (HSDB Animal Studies)'] = genoAnimal;

  // Cancérogénicité épidémiologique
  const carciHuman = extractSectionFiltered('Human Health Effects',
    ['/CARCINOGENICITY/', '/EPIDEMIOLOGY STUDIES/', '/SURVEILLANCE/'], hsdbData);
  if (carciHuman.length) sections['Carcinogenicity epidemiology (HSDB)'] = carciHuman;

  // Cancérogénicité animale
  const carciAnimal = extractSectionFiltered('Animal Toxicity Studies',
    ['/LABORATORY ANIMALS: CHRONIC EXPOSURE AND CARCINOGENICITY/',
     '/CARCINOGENICITY/'], hsdbData);
  if (carciAnimal.length) sections['Carcinogenicity animal (HSDB)'] = carciAnimal;

  // Reproduction
  const reproHuman = extractSectionFiltered('Human Health Effects',
    ['/REPRODUCTIVE HAZARD/', '/REPRODUCTIVE EFFECTS/', '/TERATOGENICITY/'], hsdbData);
  if (reproHuman.length) sections['Reproductive effects (HSDB Human)'] = reproHuman;

  const reproAnimal = extractSectionFiltered('Animal Toxicity Studies',
    ['/REPRODUCTIVE AND DEVELOPMENTAL STUDIES/',
     '/LABORATORY ANIMALS: DEVELOPMENTAL OR REPRODUCTIVE TOXICOLOGY/',
     '/TERATOGENICITY/'], hsdbData);
  if (reproAnimal.length) sections['Reproductive effects (HSDB Animal)'] = reproAnimal;

  return serializeSections(sections);
}

// Groupe 4 — Données humaines / VTR
function buildHsdbGroup4(hsdbData) {
  if (!hsdbData) return '';
  const sections = {};
  for (const h of ['Populations at Special Risk', 'Standards and Regulations',
                    'Medical Surveillance', 'Body Burden', 'Average Daily Intake']) {
    const items = extractSection(h, hsdbData);
    if (items.length) sections[h] = items;
  }
  // Excerpts humains généraux
  const humanExcerpts = extractSectionFiltered('Human Health Effects',
    ['/SIGNS AND SYMPTOMS/', '/CASE REPORTS/', '/EPIDEMIOLOGY STUDIES/',
     '/SURVEILLANCE/', '/OTHER TOXICITY INFORMATION/'], hsdbData);
  if (humanExcerpts.length) sections['Human Health Effects excerpts (HSDB)'] = humanExcerpts;

  return serializeSections(sections);
}

// ─── Appel Gemini ─────────────────────────────────────────────────────────────
async function callGemini(prompt) {
  if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY non configurée');

  const res = await fetch(GEMINI_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.1, maxOutputTokens: 8192 },
    }),
    signal: AbortSignal.timeout(120000),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini API error ${res.status}: ${err.substring(0, 200)}`);
  }

  const data = await res.json();
  const finishReason = data?.candidates?.[0]?.finishReason;
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';

  if (!text) {
    const blockReason = data?.promptFeedback?.blockReason;
    throw new Error(blockReason
      ? `Requête bloquée par Gemini : ${blockReason}`
      : `Réponse Gemini vide (finishReason: ${finishReason})`
    );
  }

  const clean = text
    .replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```\s*$/i, '').trim();
  const firstBrace = clean.indexOf('{');
  const lastBrace = clean.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace <= firstBrace) {
    throw new Error(`Pas de JSON dans la réponse Gemini : ${clean.substring(0, 200)}`);
  }
  try {
    return JSON.parse(clean.slice(firstBrace, lastBrace + 1));
  } catch (e) {
    throw new Error(`JSON non parseable : ${clean.slice(firstBrace, firstBrace + 400)}`);
  }
}

// ─── Règles communes ──────────────────────────────────────────────────────────
const COMMON_RULES = `RÈGLES :
1. Rédige en français, synthétique et professionnel
2. Conserve les références [Auteur, Année] ou [PMID:xxx] telles quelles dans le texte
3. Distingue clairement données humaines et données animales
4. Précise toujours la voie d'exposition (orale, inhalation, cutanée) et l'espèce animale
5. Si données insuffisantes : "available": false, "content": "Données non disponibles"
6. Réponds UNIQUEMENT en JSON valide, sans markdown, sans texte avant ou après`;

// ─── Prompts ──────────────────────────────────────────────────────────────────
function buildPrompt1(substanceName, cas, pubchemText, hsdbText) {
  return `Tu es toxicologue expert. Rédige deux sections d'un profil ECHA/REACH.
${COMMON_RULES}
Substance : ${substanceName} | CAS : ${cas}

JSON attendu :
{
  "toxicokinetics": {
    "title": "Toxicocinétique et métabolisme",
    "content": "Absorption par voie orale/inhalation/cutanée. Distribution. Métabolisme : enzymes impliquées, principaux métabolites et leur réactivité. Excrétion.",
    "available": true
  },
  "acuteToxicity": {
    "title": "Toxicité aiguë",
    "content": "LD50/LC50 par voie et espèce. Signes cliniques aigus chez l'animal. Données humaines : concentrations/doses létales, IDLH, symptômes.",
    "available": true
  }
}

=== DONNÉES PUBCHEM ===
${pubchemText}
=== DONNÉES HSDB (Métabolisme / Toxicité aiguë) ===
${hsdbText || 'Non disponible'}`;
}

function buildPrompt2(substanceName, cas, pubchemText, hsdbText) {
  return `Tu es toxicologue expert. Rédige trois sections d'un profil ECHA/REACH.
${COMMON_RULES}
Substance : ${substanceName} | CAS : ${cas}

JSON attendu :
{
  "irritationCorrosion": {
    "title": "Irritation / Corrosion",
    "content": "Effets sur la peau, les yeux, les voies respiratoires. Données animales (tests in vivo) et humaines (exposition professionnelle).",
    "available": true
  },
  "sensitization": {
    "title": "Sensibilisation",
    "content": "Sensibilisation cutanée (LLNA, Buehler, GPT) et respiratoire. Données humaines (asthme professionnel, dermatite de contact allergique).",
    "available": true
  },
  "repeatedDoseToxicity": {
    "title": "Toxicité à doses répétées",
    "content": "Effets subchroniques et chroniques. NOAEL/LOAEL avec espèce, voie et durée. Organes cibles. Données humaines d'exposition prolongée.",
    "available": true
  }
}

=== DONNÉES PUBCHEM ===
${pubchemText}
=== DONNÉES HSDB (Irritation / Sensibilisation / Effets chroniques) ===
${hsdbText || 'Non disponible'}`;
}

function buildPrompt3(substanceName, cas, pubchemText, hsdbText) {
  return `Tu es toxicologue expert. Rédige trois sections d'un profil ECHA/REACH.
${COMMON_RULES}
Substance : ${substanceName} | CAS : ${cas}

JSON attendu :
{
  "genotoxicity": {
    "title": "Mutagénicité / Génotoxicité",
    "content": "Tests in vitro (Ames, aberrations chromosomiques, SCE, micronoyaux) et in vivo. Résultats positifs/négatifs. Données humaines (aberrations lymphocytaires, cassures ADN, expositions professionnelles).",
    "available": true
  },
  "carcinogenicity": {
    "title": "Cancérogénicité",
    "content": "Classifications IARC/EPA/NTP/ACGIH. Données épidémiologiques humaines : type de cancer, niveau d'exposition associé. Données animales : espèces, voies, organes cibles.",
    "available": true
  },
  "reproductiveToxicity": {
    "title": "Toxicité pour la reproduction et le développement",
    "content": "Effets sur la fertilité (M/F). Embryotoxicité, fœtotoxicité, tératogénicité. Données humaines et animales avec voies et niveaux d'exposition.",
    "available": true
  }
}

=== DONNÉES PUBCHEM ===
${pubchemText}
=== DONNÉES HSDB (Génotoxicité / Cancérogénicité / Reproduction) ===
${hsdbText || 'Non disponible'}`;
}

function buildPrompt4(substanceName, cas, pubchemText, hsdbText) {
  return `Tu es toxicologue expert. Rédige deux sections d'un profil ECHA/REACH.
${COMMON_RULES}
Substance : ${substanceName} | CAS : ${cas}

JSON attendu :
{
  "humanData": {
    "title": "Données humaines",
    "content": "Études épidémiologiques (cohortes, cas-témoins), cas cliniques, expositions professionnelles documentées. Effets observés, populations étudiées, niveaux d'exposition.",
    "available": true
  },
  "referenceValues": {
    "title": "Valeurs toxicologiques de référence",
    "content": "MRL ATSDR (inhalation aiguë/intermédiaire/chronique ; orale). RfC et RfD EPA IRIS. Slope factor oral et IUR inhalation si disponibles. TLV-TWA ACGIH si mentionné.",
    "available": true
  }
}

=== DONNÉES PUBCHEM ===
${pubchemText}
=== DONNÉES HSDB (Données humaines / Standards réglementaires) ===
${hsdbText || 'Non disponible'}`;
}

// ─── Fonction principale ──────────────────────────────────────────────────────
export async function generateToxProfile(cas) {
  const normalizedCas = cas.trim();

  const cached = getCached(normalizedCas);
  if (cached) return { ...cached, fromCache: true };

  // 1. CID PubChem
  const cid = await getCID(normalizedCas);
  if (!cid) throw new Error(`Substance non trouvée dans PubChem pour CAS ${normalizedCas}`);

  console.log(`[ToxProfile] CAS ${normalizedCas} → CID ${cid}. Fetching data…`);

  // 2. Fetch en parallèle
  const [props, toxData, ghsData, hsdbData] = await Promise.all([
    getPubchemProps(cid),
    fetchPugView(cid, 'Toxicity'),
    fetchPugView(cid, 'GHS Classification'),
    fetchPugView(cid, 'Hazardous Substances Data Bank (HSDB)'),
  ]);

  const substanceName = props.IUPACName || normalizedCas;

  // 3. Texte PubChem commun
  const pubchemText = buildPubchemText(toxData, ghsData);

  // 4. Textes HSDB par groupe
  const hsdb1 = buildHsdbGroup1(hsdbData);
  const hsdb2 = buildHsdbGroup2(hsdbData);
  const hsdb3 = buildHsdbGroup3(hsdbData);
  const hsdb4 = buildHsdbGroup4(hsdbData);

  console.log(`[ToxProfile] PubChem: ${pubchemText.length} chars | HSDB groups: ${hsdb1.length}/${hsdb2.length}/${hsdb3.length}/${hsdb4.length} chars`);
  console.log(`[ToxProfile] Sending 4 parallel prompts to Gemini…`);

  // 5. Appels Gemini en parallèle
  const [result1, result2, result3, result4] = await Promise.all([
    callGemini(buildPrompt1(substanceName, normalizedCas, pubchemText, hsdb1)),
    callGemini(buildPrompt2(substanceName, normalizedCas, pubchemText, hsdb2)),
    callGemini(buildPrompt3(substanceName, normalizedCas, pubchemText, hsdb3)),
    callGemini(buildPrompt4(substanceName, normalizedCas, pubchemText, hsdb4)),
  ]);

  // 6. Assembler le profil
  const sectionOrder = [
    'toxicokinetics', 'acuteToxicity', 'irritationCorrosion', 'sensitization',
    'repeatedDoseToxicity', 'genotoxicity', 'carcinogenicity',
    'reproductiveToxicity', 'humanData', 'referenceValues',
  ];

  const sections = {
    toxicokinetics:       result1.toxicokinetics,
    acuteToxicity:        result1.acuteToxicity,
    irritationCorrosion:  result2.irritationCorrosion,
    sensitization:        result2.sensitization,
    repeatedDoseToxicity: result2.repeatedDoseToxicity,
    genotoxicity:         result3.genotoxicity,
    carcinogenicity:      result3.carcinogenicity,
    reproductiveToxicity: result3.reproductiveToxicity,
    humanData:            result4.humanData,
    referenceValues:      result4.referenceValues,
  };

  // Fallback pour les sections manquantes
  for (const key of sectionOrder) {
    if (!sections[key]) {
      sections[key] = { title: key, content: 'Données non disponibles.', available: false };
    }
  }

  const profile = {
    substanceName,
    cas: normalizedCas,
    formula: props.MolecularFormula || '',
    molecularWeight: props.MolecularWeight || '',
    cid,
    generatedAt: new Date().toISOString(),
    fromCache: false,
    sections,
  };

  const availableCount = sectionOrder.filter(k => sections[k]?.available).length;
  console.log(`[ToxProfile] Done: ${availableCount}/10 sections available.`);

  setCache(normalizedCas, profile);
  return profile;
}

export function getCacheStats() {
  return { size: profileCache.size, keys: [...profileCache.keys()] };
}
