// server/toxProfile.js — Profil toxicologique via PubChem + Gemini Flash
// Ajouter GEMINI_API_KEY dans les variables d'environnement

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_MODEL = 'gemini-2.5-flash';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

// ─── Cache mémoire simple ─────────────────────────────────────────────────────
const profileCache = new Map(); // cas → { profile, timestamp }
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

// ─── PubChem helpers ──────────────────────────────────────────────────────────
async function pubchemGet(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) return null;
  return res.json();
}

async function getCID(cas) {
  const data = await pubchemGet(
    `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/${encodeURIComponent(cas)}/cids/JSON`
  );
  return data?.IdentifierList?.CID?.[0] || null;
}

async function getPubchemProps(cid) {
  const data = await pubchemGet(
    `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/${cid}/property/IUPACName,MolecularFormula,MolecularWeight,CanonicalSMILES/JSON`
  );
  return data?.PropertyTable?.Properties?.[0] || {};
}

// Sections PubChem pug_view à récupérer — mappées sur la grille ECHA
const TOX_HEADINGS = [
  'Toxicity Summary',
  'Toxicological Information',
  'Acute Effects',
  'Acute Toxicity',
  'Human Toxicity Excerpts',
  'Non-Human Toxicity Excerpts',
  'Human Toxicity Values',
  'Non-Human Toxicity Values',
  'Evidence for Carcinogenicity',
  'Carcinogen Classification',
  'Reproductive/Developmental',
  'Mutagenicity',
  'Subchronic/Chronic Effects',
  'Health Effects',
  'Target Organs',
  'Exposure Routes',
  'Minimum Risk Level',
  'EPA IRIS Information',
  'GHS Classification',
  'Skin/Eye Irritation',
];

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

// Extrait les entrées texte + références d'une section
function extractItems(node, maxPerSection = 8) {
  const items = [];
  function walk(n) {
    if (!n) return;
    if (n.Information) {
      for (const inf of n.Information) {
        const strings = inf.Value?.StringWithMarkup?.map(s => s.String).filter(s => s && s.length > 4) || [];
        const ref = inf.Reference?.[0] || '';
        // Formater la référence au style "Auteur et al., Année"
        const refFormatted = formatRef(ref);
        for (const str of strings.slice(0, 2)) {
          if (items.length >= maxPerSection) return;
          items.push({ text: str.trim(), ref: refFormatted });
        }
      }
    }
    if (n.Section) n.Section.forEach(walk);
  }
  walk(node);
  return items;
}

// Transforme une référence brute PubChem en format court "Auteur et al., Année"
function formatRef(raw) {
  if (!raw) return '';
  // Exemples de refs PubChem :
  // "WHO; Environmental Health Criteria 150: Benzene p.46 (1993)"
  // "IARC. Monographs... (1982)"
  // "PMID:5644044"
  // "CDC; Emergency Preparedness..."
  if (raw.startsWith('PMID:')) return raw;

  // Extraire l'année entre parenthèses
  const yearMatch = raw.match(/\((\d{4})\)/);
  const year = yearMatch ? yearMatch[1] : '';

  // Extraire l'organisme/auteur principal (avant le premier ; ou . ou ,)
  const authorMatch = raw.match(/^([^;.,\n]{2,40})/);
  const author = authorMatch ? authorMatch[1].trim() : raw.substring(0, 30);

  if (year) return `${author}, ${year}`;
  return author.substring(0, 50);
}

async function fetchToxData(cid) {
  const data = await pubchemGet(
    `https://pubchem.ncbi.nlm.nih.gov/rest/pug_view/data/compound/${cid}/JSON?heading=Toxicity`
  );
  return data;
}

async function fetchGHSData(cid) {
  const data = await pubchemGet(
    `https://pubchem.ncbi.nlm.nih.gov/rest/pug_view/data/compound/${cid}/JSON?heading=GHS+Classification`
  );
  return data;
}

// Assemble un bloc de texte structuré à envoyer au LLM
function assembleRawData(props, toxData, ghsData, cas) {
  const sections = {};

  // Extraire chaque section pertinente
  for (const heading of TOX_HEADINGS) {
    const node = findSection(toxData?.Record, heading) || findSection(ghsData?.Record, heading);
    if (node) {
      const items = extractItems(node, 10);
      if (items.length) sections[heading] = items;
    }
  }

  // Sérialiser en texte brut structuré pour le LLM
  let text = `SUBSTANCE: ${props.IUPACName || cas} | CAS: ${cas} | Formule: ${props.MolecularFormula || '?'}\n\n`;

  for (const [heading, items] of Object.entries(sections)) {
    text += `### ${heading}\n`;
    for (const item of items) {
      text += `- ${item.text}`;
      if (item.ref) text += ` [${item.ref}]`;
      text += '\n';
    }
    text += '\n';
  }

  return { text, sections };
}

// ─── Prompt Gemini ────────────────────────────────────────────────────────────
function buildPrompt(rawText, substanceName, cas) {
  return `Tu es un toxicologue expert. À partir des données brutes PubChem ci-dessous, rédige un profil toxicologique structuré selon la grille ECHA/REACH.

RÈGLES IMPORTANTES :
1. Rédige en français, de manière synthétique et professionnelle
2. Quand une source est mentionnée entre crochets [Auteur, Année] ou [PMID:xxx], conserve-la telle quelle dans le texte
3. Si une section n'a pas de données disponibles, écris simplement "Données non disponibles"
4. Ne pas inventer de données — utilise uniquement ce qui est fourni ci-dessous
5. Réponds UNIQUEMENT en JSON valide, sans balises markdown, sans texte avant ou après

Structure JSON attendue :
{
  "substanceName": "nom de la substance",
  "cas": "${cas}",
  "formula": "formule chimique",
  "generatedAt": "date ISO",
  "sections": {
    "toxicokinetics": {
      "title": "Toxicocinétique et métabolisme",
      "content": "texte rédigé avec sources",
      "available": true|false
    },
    "acuteToxicity": {
      "title": "Toxicité aiguë",
      "content": "texte rédigé. Inclure les valeurs LD50/LC50 par voie (orale, cutanée, inhalation) chez l'animal et les données humaines si disponibles",
      "available": true|false
    },
    "irritationCorrosion": {
      "title": "Irritation / Corrosion",
      "content": "texte rédigé",
      "available": true|false
    },
    "sensitization": {
      "title": "Sensibilisation",
      "content": "texte rédigé",
      "available": true|false
    },
    "repeatedDoseToxicity": {
      "title": "Toxicité à doses répétées",
      "content": "texte rédigé. Inclure NOAEL/LOAEL si disponibles, voie et espèce",
      "available": true|false
    },
    "genotoxicity": {
      "title": "Mutagénicité / Génotoxicité",
      "content": "texte rédigé",
      "available": true|false
    },
    "carcinogenicity": {
      "title": "Cancérogénicité",
      "content": "texte rédigé. Inclure les classifications IARC, EPA, NTP si disponibles",
      "available": true|false
    },
    "reproductiveToxicity": {
      "title": "Toxicité pour la reproduction et le développement",
      "content": "texte rédigé",
      "available": true|false
    },
    "humanData": {
      "title": "Données humaines",
      "content": "texte rédigé — études épidémiologiques, cas cliniques, données d'exposition professionnelle",
      "available": true|false
    },
    "referenceValues": {
      "title": "Valeurs toxicologiques de référence",
      "content": "texte rédigé. Lister MRL ATSDR, RfC/RfD EPA IRIS, valeurs ACGIH si disponibles",
      "available": true|false
    }
  },
  "dataQuality": "évaluation courte de la qualité et complétude des données (1-2 phrases)",
  "sources": ["liste des sources primaires citées dans le profil"]
}

DONNÉES BRUTES PUBCHEM :
${rawText}`;
}

// ─── Appel Gemini ─────────────────────────────────────────────────────────────
async function callGemini(prompt) {
  if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY non configurée');

  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 4096,
    },
  };

  const res = await fetch(GEMINI_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60000),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini API error ${res.status}: ${err.substring(0, 200)}`);
  }

  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';

  // Extraction robuste du JSON — cherche la première { et la dernière }
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  
  if (firstBrace === -1 || lastBrace === -1) {
    throw new Error(`Réponse Gemini sans JSON détectable : ${text.substring(0, 200)}`);
  }

  const jsonStr = text.slice(firstBrace, lastBrace + 1);

  try {
    return JSON.parse(jsonStr);
  } catch (e) {
    throw new Error(`Réponse Gemini non parseable : ${jsonStr.substring(0, 300)}`);
  }
}

// ─── Fonction principale exportée ─────────────────────────────────────────────
export async function generateToxProfile(cas) {
  const normalizedCas = cas.trim();

  // Vérifier le cache
  const cached = getCached(normalizedCas);
  if (cached) return { ...cached, fromCache: true };

  // 1. Obtenir le CID PubChem
  const cid = await getCID(normalizedCas);
  if (!cid) throw new Error(`Substance non trouvée dans PubChem pour CAS ${normalizedCas}`);

  // 2. Fetch en parallèle
  const [props, toxData, ghsData] = await Promise.all([
    getPubchemProps(cid),
    fetchToxData(cid),
    fetchGHSData(cid),
  ]);

  // 3. Assembler les données brutes
  const { text: rawText } = assembleRawData(props, toxData, ghsData, normalizedCas);

  // 4. Appel Gemini
  const substanceName = props.IUPACName || normalizedCas;
  const prompt = buildPrompt(rawText, substanceName, normalizedCas);
  const profile = await callGemini(prompt);

  // Ajouter métadonnées
  profile.cid = cid;
  profile.generatedAt = new Date().toISOString();
  profile.fromCache = false;

  // 5. Mettre en cache
  setCache(normalizedCas, profile);

  return profile;
}

export function getCacheStats() {
  return { size: profileCache.size, keys: [...profileCache.keys()] };
}
