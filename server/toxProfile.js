// server/toxProfile.js — Profil toxicologique via PubChem + HSDB + OpenRouter
// Architecture conservée : 4 prompts parallèles
// Signature conservée : generateToxProfile(cas)

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || '';
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || 'openrouter/hunter-alpha';
const OPENROUTER_FALLBACK_MODELS = (process.env.OPENROUTER_FALLBACK_MODELS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const OPENROUTER_SITE_URL = process.env.OPENROUTER_SITE_URL || 'http://localhost';
const OPENROUTER_APP_NAME = process.env.OPENROUTER_APP_NAME || 'Toxonomy';

// ─── Cache mémoire ────────────────────────────────────────────────────────────
const profileCache = new Map();
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

function getCached(cas) {
  const entry = profileCache.get(cas);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
    profileCache.delete(cas);
    return null;
  }
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
  const tried = [
    `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/${encodeURIComponent(cas)}/cids/JSON`,
    `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/xref/RN/${encodeURIComponent(cas)}/cids/JSON`,
  ];
  for (const url of tried) {
    const data = await pubchemGet(url);
    const cid = data?.IdentifierList?.CID?.[0];
    if (cid) return cid;
  }
  return null;
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

function extractSection(heading, ...roots) {
  const out = [];
  for (const root of roots) {
    if (!root) continue;
    const section = findSection(root, heading);
    if (section) out.push(...extractItems(section));
  }
  return out;
}

function extractSectionFiltered(heading, tagFilter, root) {
  if (!root) return [];
  const section = findSection(root, heading);
  if (!section) return [];
  return extractItems(section, 8, 1000, tagFilter);
}

function serializeSections(sections) {
  const entries = Object.entries(sections).filter(([, items]) => Array.isArray(items) && items.length);
  if (!entries.length) return '';

  return entries.map(([heading, items]) => {
    const lines = items.map((it, i) => `- ${it.text}${it.ref ? ` [${it.ref}]` : ''}`);
    return `## ${heading}\n${lines.join('\n')}`;
  }).join('\n\n');
}

// ─── Texte PubChem commun ─────────────────────────────────────────────────────
const PUBCHEM_TOX_HEADINGS = [
  'Acute Effects',
  'Non-Human Toxicity Values',
  'Exposure Routes',
  'Symptoms',
  'Human Toxicity Excerpts',
  'Health Effects',
  'First Aid',
  'Medical Treatment',
  'Inhalation First Aid',
  'Skin First Aid',
  'Eye First Aid',
  'Ingestion First Aid',
  'Top Hazards',
  'Classes and Categories',
  'Hazards Summary',
  'NFPA Hazard Classification',
  'Skin, Eye, and Respiratory Irritations',
  'Carcinogenicity',
  'Genotoxicity',
  'Reproductive Effects'
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
  const irrit = extractSectionFiltered('Human Health Effects',
    ['/IRRITATION/', '/SKIN IRRITATION/', '/EYE IRRITATION/'], hsdbData);
  if (irrit.length) sections['Irritation (HSDB Human Health Effects)'] = irrit;

  const sens = extractSectionFiltered('Human Health Effects',
    ['/SENSITIZATION/', '/ALLERGIC REACTIONS/', '/ASTHMA/'], hsdbData);
  if (sens.length) sections['Sensitization (HSDB Human Health Effects)'] = sens;

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

  const genoAnimal = extractSectionFiltered('Animal Toxicity Studies',
    ['/GENOTOXICITY/', '/MUTAGENICITY/',
     '/LABORATORY ANIMALS: GENOTOXICITY OR GENETIC TOXICOLOGY/'], hsdbData);
  if (genoAnimal.length) sections['Genotoxicity (HSDB Animal Studies)'] = genoAnimal;

  const carciHuman = extractSectionFiltered('Human Health Effects',
    ['/CARCINOGENICITY/', '/EPIDEMIOLOGY STUDIES/', '/SURVEILLANCE/'], hsdbData);
  if (carciHuman.length) sections['Carcinogenicity epidemiology (HSDB)'] = carciHuman;

  const carciAnimal = extractSectionFiltered('Animal Toxicity Studies',
    ['/LABORATORY ANIMALS: CHRONIC EXPOSURE AND CARCINOGENICITY/',
     '/CARCINOGENICITY/'], hsdbData);
  if (carciAnimal.length) sections['Carcinogenicity animal (HSDB)'] = carciAnimal;

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
  const humanExcerpts = extractSectionFiltered('Human Health Effects',
    ['/SIGNS AND SYMPTOMS/', '/CASE REPORTS/', '/EPIDEMIOLOGY STUDIES/',
     '/SURVEILLANCE/', '/OTHER TOXICITY INFORMATION/'], hsdbData);
  if (humanExcerpts.length) sections['Human Health Effects excerpts (HSDB)'] = humanExcerpts;

  return serializeSections(sections);
}

// ─── Appel OpenRouter ─────────────────────────────────────────────────────────
async function callOpenRouter(prompt) {
  if (!OPENROUTER_API_KEY) throw new Error('OPENROUTER_API_KEY non configurée');

  const models = [OPENROUTER_MODEL, ...OPENROUTER_FALLBACK_MODELS]
    .filter(Boolean)
    .filter((m, i, arr) => arr.indexOf(m) === i);

  let lastError = null;

  for (const model of models) {
    try {
      const res = await fetch(OPENROUTER_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': OPENROUTER_SITE_URL,
          'X-OpenRouter-Title': OPENROUTER_APP_NAME,
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.1,
          max_tokens: 8192,
          response_format: { type: 'json_object' },
        }),
        signal: AbortSignal.timeout(120000),
      });

      if (!res.ok) {
        const err = await res.text();
        lastError = new Error(`OpenRouter API error ${res.status} (${model}): ${err.substring(0, 300)}`);
        continue;
      }

      const data = await res.json();
      const text = data?.choices?.[0]?.message?.content || '';

      if (!text) {
        lastError = new Error(`Réponse OpenRouter vide (${model})`);
        continue;
      }

      const clean = text
        .replace(/^```json\s*/i, '')
        .replace(/^```\s*/i, '')
        .replace(/\s*```\s*$/i, '')
        .trim();

      const firstBrace = clean.indexOf('{');
      const lastBrace = clean.lastIndexOf('}');
      if (firstBrace === -1 || lastBrace <= firstBrace) {
        lastError = new Error(`Pas de JSON dans la réponse OpenRouter (${model}) : ${clean.substring(0, 200)}`);
        continue;
      }

      const parsed = JSON.parse(clean.slice(firstBrace, lastBrace + 1));
      parsed._model = model;
      return parsed;
    } catch (e) {
      lastError = e;
    }
  }

  throw lastError || new Error('Tous les modèles OpenRouter ont échoué');
}

// ─── Prompts ──────────────────────────────────────────────────────────────────
const COMMON_RULES = `Règles impératives :
- Réponds uniquement en JSON valide.
- N'invente aucune donnée.
- Si les données sont insuffisantes pour une section, renvoie available=false et content="Données non disponibles dans les sources consultées."
- Sois synthétique mais précis.
- Rédige en français.
- Conserve exactement les clés JSON demandées.`;

function buildPrompt1(substanceName, cas, pubchemText, hsdbText) {
  return `Tu es toxicologue expert. Rédige deux sections d'un profil ECHA/REACH.
${COMMON_RULES}
Substance : ${substanceName} | CAS : ${cas}

JSON attendu :
{
  "toxicokinetics": {
    "title": "Toxicocinétique (ADME)",
    "content": "Absorption, distribution, métabolisme et élimination. Mentionner les voies et les principaux métabolites si disponibles.",
    "available": true
  },
  "acuteToxicity": {
    "title": "Toxicité aiguë",
    "content": "Données orales, cutanées, inhalation, signes cliniques, valeurs DL50/CL50 si disponibles. Privilégier les données humaines puis animales.",
    "available": true
  }
}

=== DONNÉES PUBCHEM ===
${pubchemText}
=== DONNÉES HSDB (ADME / Toxicité aiguë) ===
${hsdbText || 'Non disponible'}`;
}

function buildPrompt2(substanceName, cas, pubchemText, hsdbText) {
  return `Tu es toxicologue expert. Rédige trois sections d'un profil ECHA/REACH.
${COMMON_RULES}
Substance : ${substanceName} | CAS : ${cas}

JSON attendu :
{
  "irritationCorrosion": {
    "title": "Irritation / corrosion",
    "content": "Effets peau, yeux, voies respiratoires. Préciser si irritation légère, sévère, corrosion, ou absence d'effet.",
    "available": true
  },
  "sensitization": {
    "title": "Sensibilisation",
    "content": "Données de sensibilisation cutanée ou respiratoire, humaines ou animales, y compris cas professionnels documentés.",
    "available": true
  },
  "repeatedDoseToxicity": {
    "title": "Toxicité à doses répétées",
    "content": "Études subchroniques/chroniques, organes cibles, effets principaux, NOAEL/LOAEL si disponibles.",
    "available": true
  }
}

=== DONNÉES PUBCHEM ===
${pubchemText}
=== DONNÉES HSDB (Irritation / Sensibilisation / Doses répétées) ===
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
    "content": "Tests in vitro (Ames, aberrations chromosomiques, SCE, micronoyaux) et in vivo. Résultats positifs/négatifs. Données humaines si disponibles.",
    "available": true
  },
  "carcinogenicity": {
    "title": "Cancérogénicité",
    "content": "Classifications IARC/EPA/NTP/ACGIH. Données épidémiologiques humaines et données animales. Organes cibles si disponibles.",
    "available": true
  },
  "reproductiveToxicity": {
    "title": "Toxicité pour la reproduction et le développement",
    "content": "Effets sur la fertilité, embryotoxicité, fœtotoxicité, tératogénicité. Données humaines et animales avec voies et niveaux d'exposition.",
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
    "content": "Études épidémiologiques, cas cliniques, expositions professionnelles documentées. Effets observés, populations étudiées, niveaux d'exposition.",
    "available": true
  },
  "referenceValues": {
    "title": "Valeurs toxicologiques de référence",
    "content": "MRL ATSDR, RfC/RfD EPA IRIS, slope factor oral, IUR inhalation, TLV-TWA ACGIH ou autres valeurs repérées dans les sources.",
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
  const normalizedCas = String(cas || '').trim();
  if (!normalizedCas) throw new Error('CAS manquant');

  const cached = getCached(normalizedCas);
  if (cached) return { ...cached, fromCache: true };

  const cid = await getCID(normalizedCas);
  if (!cid) throw new Error(`Substance non trouvée dans PubChem pour CAS ${normalizedCas}`);

  console.log(`[ToxProfile] CAS ${normalizedCas} → CID ${cid}. Fetching data…`);

  const [props, toxData, ghsData, hsdbData] = await Promise.all([
    getPubchemProps(cid),
    fetchPugView(cid, 'Toxicity'),
    fetchPugView(cid, 'GHS Classification'),
    fetchPugView(cid, 'Hazardous Substances Data Bank (HSDB)'),
  ]);

  const substanceName = props.IUPACName || normalizedCas;

  const pubchemText = buildPubchemText(toxData, ghsData);

  const hsdb1 = buildHsdbGroup1(hsdbData);
  const hsdb2 = buildHsdbGroup2(hsdbData);
  const hsdb3 = buildHsdbGroup3(hsdbData);
  const hsdb4 = buildHsdbGroup4(hsdbData);

  console.log(`[ToxProfile] PubChem: ${pubchemText.length} chars | HSDB groups: ${hsdb1.length}/${hsdb2.length}/${hsdb3.length}/${hsdb4.length} chars`);
  console.log(`[ToxProfile] Sending 4 parallel prompts to OpenRouter…`);

  const [result1, result2, result3, result4] = await Promise.all([
    callOpenRouter(buildPrompt1(substanceName, normalizedCas, pubchemText, hsdb1)),
    callOpenRouter(buildPrompt2(substanceName, normalizedCas, pubchemText, hsdb2)),
    callOpenRouter(buildPrompt3(substanceName, normalizedCas, pubchemText, hsdb3)),
    callOpenRouter(buildPrompt4(substanceName, normalizedCas, pubchemText, hsdb4)),
  ]);

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
    modelUsed: [result1._model, result2._model, result3._model, result4._model].filter(Boolean).join(', '),
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
