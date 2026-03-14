// server/toxProfile.js — Profil toxicologique via PubChem + HSDB + Gemini
// Architecture : 4 prompts parallèles par groupe thématique ECHA
// Requiert : GEMINI_API_KEY dans les variables d'environnement

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_MODEL = 'gemini-2.5-flash';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

// ─── Cache mémoire ────────────────────────────────────────────────────────────
const profileCache = new Map();
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h

function getCached(cas) {
  const entry = profileCache.get(cas);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CACHE_TTL_MS) { profileCache.delete(cas); return null; }
  return entry.profile;
}

function setCache(cas, profile) {
  profileCache.set(cas, { profile, timestamp: Date.now() });
}

// ─── PubChem fetch helpers ────────────────────────────────────────────────────
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

// ─── Extraction PubChem ───────────────────────────────────────────────────────
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

function extractItems(node, maxItems = 6, maxChars = 800) {
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

// Extrait une section depuis un ou plusieurs documents PubChem
function extractSection(heading, ...docs) {
  for (const doc of docs) {
    const node = findSection(doc?.Record, heading);
    if (node) {
      const items = extractItems(node, 6, 800);
      if (items.length) return items;
    }
  }
  return [];
}

// Sérialise un ensemble de sections en texte pour le LLM
function serializeSections(sections) {
  let text = '';
  for (const [heading, items] of Object.entries(sections)) {
    if (!items.length) continue;
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

// ─── Appel Gemini ─────────────────────────────────────────────────────────────
async function callGemini(prompt) {
  if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY non configurée');

  const res = await fetch(GEMINI_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.1, maxOutputTokens: 16384 },
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

  // Extraction robuste du JSON
  const clean = text
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();

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

// ─── Règles communes pour tous les prompts ────────────────────────────────────
const COMMON_RULES = `RÈGLES :
1. Rédige en français, de manière synthétique et professionnelle
2. Conserve les références entre crochets [Auteur, Année] ou [PMID:xxx] telles quelles
3. Distingue clairement données humaines et données animales
4. Mentionne toujours la voie d'exposition (orale, inhalation, cutanée) et l'espèce animale
5. Si données insuffisantes pour une section : "available": false, "content": "Données non disponibles"
6. Réponds UNIQUEMENT en JSON valide, sans markdown, sans texte avant ou après`;

// ─── Prompt 1 : Toxicocinétique + Toxicité aiguë ─────────────────────────────
function buildPrompt1(substanceName, cas, rawData) {
  return `Tu es un toxicologue expert rédigeant un profil ECHA/REACH.
${COMMON_RULES}

Substance : ${substanceName} | CAS : ${cas}

Génère ce JSON :
{
  "toxicokinetics": {
    "title": "Toxicocinétique et métabolisme",
    "content": "Absorption (voies et taux), distribution, métabolisme (principaux métabolites, enzymes impliquées), excrétion. Données humaines et animales.",
    "available": true
  },
  "acuteToxicity": {
    "title": "Toxicité aiguë",
    "content": "Valeurs LD50/LC50 par voie (orale, inhalation, cutanée) et par espèce. Signes cliniques aigus chez l'animal et chez l'homme. Concentrations létales humaines si connues.",
    "available": true
  }
}

DONNÉES :
${rawData}`;
}

// ─── Prompt 2 : Irritation + Sensibilisation + Doses répétées ────────────────
function buildPrompt2(substanceName, cas, rawData) {
  return `Tu es un toxicologue expert rédigeant un profil ECHA/REACH.
${COMMON_RULES}

Substance : ${substanceName} | CAS : ${cas}

Génère ce JSON :
{
  "irritationCorrosion": {
    "title": "Irritation / Corrosion",
    "content": "Effets irritants ou corrosifs sur la peau, les yeux et les voies respiratoires. Données humaines et animales.",
    "available": true
  },
  "sensitization": {
    "title": "Sensibilisation",
    "content": "Potentiel de sensibilisation cutanée ou respiratoire. Résultats des tests (LLNA, Buehler, GPT, etc.).",
    "available": true
  },
  "repeatedDoseToxicity": {
    "title": "Toxicité à doses répétées",
    "content": "Effets subchroniques et chroniques. NOAEL/LOAEL avec espèce, voie d'exposition et durée. Organes cibles identifiés.",
    "available": true
  }
}

DONNÉES :
${rawData}`;
}

// ─── Prompt 3 : Génotoxicité + Cancérogénicité + Reproduction ────────────────
function buildPrompt3(substanceName, cas, rawData) {
  return `Tu es un toxicologue expert rédigeant un profil ECHA/REACH.
${COMMON_RULES}

Substance : ${substanceName} | CAS : ${cas}

Génère ce JSON :
{
  "genotoxicity": {
    "title": "Mutagénicité / Génotoxicité",
    "content": "Résultats in vitro (test d'Ames, aberrations chromosomiques, échanges de chromatides sœurs) et in vivo (micronoyaux, etc.). Données humaines si disponibles.",
    "available": true
  },
  "carcinogenicity": {
    "title": "Cancérogénicité",
    "content": "Classifications : IARC (groupe), EPA (catégorie), NTP, ACGIH. Données épidémiologiques humaines (type de cancer, exposition). Données animales (espèces, voies, organes cibles).",
    "available": true
  },
  "reproductiveToxicity": {
    "title": "Toxicité pour la reproduction et le développement",
    "content": "Effets sur la fertilité masculine et féminine. Effets sur le développement embryonnaire/fœtal (tératogénicité, embryotoxicité). Données humaines et animales.",
    "available": true
  }
}

DONNÉES :
${rawData}`;
}

// ─── Prompt 4 : Données humaines + VTR ───────────────────────────────────────
function buildPrompt4(substanceName, cas, rawData) {
  return `Tu es un toxicologue expert rédigeant un profil ECHA/REACH.
${COMMON_RULES}

Substance : ${substanceName} | CAS : ${cas}

Génère ce JSON :
{
  "humanData": {
    "title": "Données humaines",
    "content": "Études épidémiologiques (cohortes, cas-témoins), cas cliniques, données d'exposition professionnelle. Effets observés, niveaux d'exposition associés, populations étudiées.",
    "available": true
  },
  "referenceValues": {
    "title": "Valeurs toxicologiques de référence",
    "content": "MRL ATSDR (inhalation aiguë, intermédiaire, chronique ; orale chronique). RfC et RfD EPA IRIS. Slope factor cancérogène (SF oral, IUR inhalation) si disponible. TLV-TWA ACGIH si mentionné.",
    "available": true
  }
}

DONNÉES :
${rawData}`;
}

// ─── Fonction principale ──────────────────────────────────────────────────────
export async function generateToxProfile(cas) {
  const normalizedCas = cas.trim();

  const cached = getCached(normalizedCas);
  if (cached) return { ...cached, fromCache: true };

  // 1. CID PubChem
  const cid = await getCID(normalizedCas);
  if (!cid) throw new Error(`Substance non trouvée dans PubChem pour CAS ${normalizedCas}`);

  console.log(`[ToxProfile] CAS ${normalizedCas} → CID ${cid}. Fetching PubChem data…`);

  // 2. Fetch toutes les sources en parallèle
  const [props, toxData, ghsData, hsdbData] = await Promise.all([
    getPubchemProps(cid),
    fetchPugView(cid, 'Toxicity'),
    fetchPugView(cid, 'GHS Classification'),
    fetchPugView(cid, 'Hazardous Substances Data Bank (HSDB)'),
  ]);

  const substanceName = props.IUPACName || normalizedCas;
  console.log(`[ToxProfile] Data fetched. Building section groups…`);

  // 3. Construire les 4 blocs de données thématiques

  // Groupe 1 — Toxicocinétique + Toxicité aiguë
  const group1Sections = {
    'Metabolism/Pharmacokinetics': extractSection('Metabolism/Pharmacokinetics', hsdbData, toxData),
    'Toxicokinetics':              extractSection('Toxicokinetics', hsdbData, toxData),
    'Toxicity Summary':            extractSection('Toxicity Summary', toxData, hsdbData),
    'Acute Effects':               extractSection('Acute Effects', toxData),
    'Acute Toxicity':              extractSection('Acute Toxicity', toxData),
    'Non-Human Toxicity Values':   extractSection('Non-Human Toxicity Values', toxData),
    'Human Toxicity Values':       extractSection('Human Toxicity Values', toxData),
    'Reported Fatal Dose':         extractSection('Reported Fatal Dose', hsdbData),
  };

  // Groupe 2 — Irritation + Sensibilisation + Doses répétées
  const group2Sections = {
    'Skin, Eye, and Respiratory Irritations': extractSection('Skin, Eye, and Respiratory Irritations', hsdbData, toxData),
    'Skin/Eye Irritation':                    extractSection('Skin/Eye Irritation', toxData),
    'Sensitization':                          extractSection('Sensitization', hsdbData, toxData),
    'Immunotoxicity':                         extractSection('Immunotoxicity', hsdbData),
    'Subchronic/Chronic Effects':             extractSection('Subchronic/Chronic Effects', toxData),
    'Non-Human Toxicity Excerpts':            extractSection('Non-Human Toxicity Excerpts', toxData),
    'Target Organs':                          extractSection('Target Organs', toxData),
    'Neurotoxicity':                          extractSection('Neurotoxicity', hsdbData),
    'GHS Classification':                     extractSection('GHS Classification', ghsData),
  };

  // Groupe 3 — Génotoxicité + Cancérogénicité + Reproduction
  const group3Sections = {
    'Mutagenicity':               extractSection('Mutagenicity', toxData, hsdbData),
    'Evidence for Carcinogenicity': extractSection('Evidence for Carcinogenicity', toxData, hsdbData),
    'Carcinogen Classification':  extractSection('Carcinogen Classification', toxData),
    'Carcinogenicity':            extractSection('Carcinogenicity', hsdbData),
    'Reproductive/Developmental': extractSection('Reproductive/Developmental', toxData),
    'Reproductive Hazard':        extractSection('Reproductive Hazard', hsdbData),
  };

  // Groupe 4 — Données humaines + VTR
  const group4Sections = {
    'Human Toxicity Excerpts':    extractSection('Human Toxicity Excerpts', toxData, hsdbData),
    'Human Health Effects':       extractSection('Human Health Effects', hsdbData),
    'Exposure Routes':            extractSection('Exposure Routes', toxData),
    'Populations at Special Risk': extractSection('Populations at Special Risk', hsdbData),
    'Minimum Risk Level':         extractSection('Minimum Risk Level', toxData),
    'EPA IRIS Information':       extractSection('EPA IRIS Information', toxData),
    'Health Effects':             extractSection('Health Effects', toxData),
  };

  const raw1 = serializeSections(group1Sections);
  const raw2 = serializeSections(group2Sections);
  const raw3 = serializeSections(group3Sections);
  const raw4 = serializeSections(group4Sections);

  console.log(`[ToxProfile] Sending 4 parallel prompts to Gemini…`);
  console.log(`  Group sizes: ${raw1.length} / ${raw2.length} / ${raw3.length} / ${raw4.length} chars`);

  // 4. Appels Gemini en parallèle
  const [result1, result2, result3, result4] = await Promise.all([
    callGemini(buildPrompt1(substanceName, normalizedCas, raw1)),
    callGemini(buildPrompt2(substanceName, normalizedCas, raw2)),
    callGemini(buildPrompt3(substanceName, normalizedCas, raw3)),
    callGemini(buildPrompt4(substanceName, normalizedCas, raw4)),
  ]);

  // 5. Assembler le profil final
  const profile = {
    substanceName,
    cas: normalizedCas,
    formula: props.MolecularFormula || '',
    molecularWeight: props.MolecularWeight || '',
    cid,
    generatedAt: new Date().toISOString(),
    fromCache: false,
    sections: {
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
    },
  };

  // Validation — s'assurer que toutes les sections sont présentes
  const sectionOrder = [
    'toxicokinetics', 'acuteToxicity', 'irritationCorrosion', 'sensitization',
    'repeatedDoseToxicity', 'genotoxicity', 'carcinogenicity',
    'reproductiveToxicity', 'humanData', 'referenceValues',
  ];
  for (const key of sectionOrder) {
    if (!profile.sections[key]) {
      profile.sections[key] = {
        title: key,
        content: 'Données non disponibles.',
        available: false,
      };
    }
  }

  const availableCount = sectionOrder.filter(k => profile.sections[k]?.available).length;
  console.log(`[ToxProfile] Profile complete: ${availableCount}/10 sections available.`);

  setCache(normalizedCas, profile);
  return profile;
}

export function getCacheStats() {
  return { size: profileCache.size, keys: [...profileCache.keys()] };
}
