// server/toxProfile.js
// Profil toxicologique via PubChem + full PUG-View + OpenRouter
// Version enrichie : extraction ciblée des paragraphes HSDB par préfixes utiles
// Signature conservée : generateToxProfile(cas)

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || '';
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || '';
const OPENROUTER_FALLBACK_MODELS = (process.env.OPENROUTER_FALLBACK_MODELS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const OPENROUTER_SITE_URL = process.env.OPENROUTER_SITE_URL || 'http://localhost';
const OPENROUTER_APP_NAME = process.env.OPENROUTER_APP_NAME || 'Toxonomy';

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

async function pubchemGet(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
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

async function fetchFullPugView(cid) {
  return pubchemGet(
    `https://pubchem.ncbi.nlm.nih.gov/rest/pug_view/data/compound/${cid}/JSON`
  );
}

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

function findSections(node, heading, out = []) {
  if (!node) return out;
  if (node.TOCHeading === heading) out.push(node);
  if (node.Section) {
    for (const s of node.Section) findSections(s, heading, out);
  }
  return out;
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

function sectionLooksHsdb(section) {
  const s = JSON.stringify(section || {});
  return s.includes('/source/hsdb/') || s.includes('/source/11933') || s.includes('HSDB record page');
}

function extractItems(node, maxItems = 6, maxChars = 1000) {
  const items = [];
  function walk(n) {
    if (!n || items.length >= maxItems) return;
    if (n.Information) {
      for (const inf of n.Information) {
        if (items.length >= maxItems) break;
        const strings = inf.Value?.StringWithMarkup?.map(s => s.String).filter(s => s && s.length > 10) || [];
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

function extractPrefixedItems(node, prefixes, maxItems = 10, maxChars = 1400) {
  const items = [];
  const normPrefixes = prefixes.map(p => p.toLowerCase());

  function walk(n) {
    if (!n || items.length >= maxItems) return;

    if (n.Information) {
      for (const inf of n.Information) {
        if (items.length >= maxItems) break;
        const strings = inf.Value?.StringWithMarkup?.map(s => s.String).filter(s => s && s.length > 10) || [];
        const ref = formatRef(inf.Reference?.[0] || '');
        for (const str of strings) {
          if (items.length >= maxItems) break;
          const lower = str.trim().toLowerCase();
          if (!normPrefixes.some(p => lower.startsWith(p))) continue;
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

// Like extractPrefixedItems but matches keywords ANYWHERE in text (not just prefix)
function extractKeywordItems(node, keywords, maxItems = 10, maxChars = 1400) {
  const items = [];
  const normKeywords = keywords.map(k => k.toLowerCase());

  function walk(n) {
    if (!n || items.length >= maxItems) return;

    if (n.Information) {
      for (const inf of n.Information) {
        if (items.length >= maxItems) break;
        const strings = inf.Value?.StringWithMarkup?.map(s => s.String).filter(s => s && s.length > 10) || [];
        const ref = formatRef(inf.Reference?.[0] || '');
        for (const str of strings) {
          if (items.length >= maxItems) break;
          const lower = str.trim().toLowerCase();
          if (!normKeywords.some(k => lower.includes(k))) continue;
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

// Find ALL sections (anywhere in tree) whose TOCHeading matches keywords, optionally HSDB-only
function findSectionsByKeywords(root, keywords, hsdbOnly = false) {
  const results = [];
  const normKeywords = keywords.map(k => k.toLowerCase());
  
  function walk(node) {
    if (!node) return;
    if (node.TOCHeading) {
      const lower = node.TOCHeading.toLowerCase();
      if (normKeywords.some(k => lower.includes(k))) {
        if (!hsdbOnly || sectionLooksHsdb(node)) {
          results.push(node);
        }
      }
    }
    if (node.Section) node.Section.forEach(walk);
  }
  walk(root);
  return results;
}

function extractTableLikeSection(node, maxRows = 25) {
  const rows = [];
  if (!node?.Information) return rows;

  for (const inf of node.Information) {
    const name = inf.Name ? String(inf.Name).trim() : '';
    const values = inf.Value?.StringWithMarkup?.map(s => s.String).filter(Boolean) || [];
    if (!name || !values.length) continue;
    rows.push({
      text: `${name}: ${values.join(' ; ')}`,
      ref: formatRef(inf.Reference?.[0] || ''),
    });
    if (rows.length >= maxRows) break;
  }

  return rows;
}

function serializeSections(sections) {
  const entries = Object.entries(sections).filter(([, items]) => Array.isArray(items) && items.length);
  if (!entries.length) return '';
  return entries.map(([heading, items]) => {
    const lines = items.map(it => `- ${it.text}${it.ref ? ` [${it.ref}]` : ''}`);
    return `## ${heading}\n${lines.join('\n')}`;
  }).join('\n\n');
}

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
  'Reproductive Effects',
  'EPA IRIS Information',
  'EPA Provisional Peer-Reviewed Toxicity Values',
  'RAIS Toxicity Values'
];

// Headings where we want more data extracted (complex tox sections)
const ENHANCED_HEADINGS = new Set([
  'Genotoxicity', 'Reproductive Effects', 'Carcinogenicity',
  'Skin, Eye, and Respiratory Irritations'
]);

function buildPubchemText(toxRoot, ghsRoot, fullRoot) {
  const sections = {};
  for (const heading of PUBCHEM_TOX_HEADINGS) {
    const items = [];
    const maxItems = ENHANCED_HEADINGS.has(heading) ? 12 : 6;
    const maxChars = ENHANCED_HEADINGS.has(heading) ? 1400 : 1000;

    const a = findSection(toxRoot, heading);
    const b = findSection(ghsRoot, heading);
    const c = findSection(fullRoot, heading);

    if (a) items.push(...extractItems(a, maxItems, maxChars));
    if (b) items.push(...extractItems(b, maxItems - items.length, maxChars));

    if (c && items.length < maxItems) {
      if (
        heading === 'EPA IRIS Information' ||
        heading === 'EPA Provisional Peer-Reviewed Toxicity Values' ||
        heading === 'RAIS Toxicity Values'
      ) {
        items.push(...extractTableLikeSection(c));
      } else {
        items.push(...extractItems(c, maxItems - items.length, maxChars));
      }
    }

    if (items.length) sections[heading] = items;
  }
  
  // Debug: log which headings produced data
  const foundHeadings = Object.keys(sections);
  const missingHeadings = PUBCHEM_TOX_HEADINGS.filter(h => !sections[h]);
  console.log(`[ToxProfile] PubChem headings with data: ${foundHeadings.join(', ')}`);
  if (missingHeadings.length) {
    console.log(`[ToxProfile] PubChem headings WITHOUT data: ${missingHeadings.join(', ')}`);
  }
  
  return serializeSections(sections);
}

function collectHsdbHeadings(fullRoot) {
  const wanted = new Set([
    'Human Toxicity Excerpts',
    'Human Toxicity Excerpts (Complete)',
    'Non-Human Toxicity Excerpts',
    'Non-Human Toxicity Excerpts (Complete)',
    'Non-Human Toxicity Values',
    'Non-Human Toxicity Values (Complete)',
    'Absorption, Distribution and Excretion',
    'Absorption, Distribution and Excretion (Complete)',
    'Metabolism/Metabolites',
    'Metabolism/Metabolites (Complete)',
    'Pharmacology',
    'Pharmacology (Complete)',
    'Medical Surveillance',
    'Medical Surveillance (Complete)',
    'Reported Fatal Dose',
    'Reported Fatal Dose (Complete)',
    'Evidence for Carcinogenicity',
    'Evidence for Carcinogenicity (Complete)',
    'Occupational Exposure Standards',
    'Occupational Exposure Standards (Complete)',
    'NIOSH Recommendations',
    'NIOSH Recommendations (Complete)',
    'Preventive Measures',
    'Preventive Measures (Complete)',
    'Animal Toxicity Studies',
    'Genotoxicity',
    'Genotoxicity (Complete)',
    'Reproductive Effects',
    'Reproductive Effects (Complete)',
    'Developmental Toxicity/Teratogenicity',
    'Developmental Toxicity/Teratogenicity (Complete)',
  ]);

  const found = {};
  function walk(node) {
    if (!node) return;
    if (node.TOCHeading && wanted.has(node.TOCHeading) && sectionLooksHsdb(node)) {
      found[node.TOCHeading] = node;
    }
    if (node.Section) node.Section.forEach(walk);
  }
  walk(fullRoot);
  return found;
}

function mergeSections(...entries) {
  const out = {};
  for (const [title, items] of entries) {
    if (items?.length) out[title] = items;
  }
  return serializeSections(out);
}

function extractSubSectionItems(parentNode, subHeadings, maxItems = 10, maxChars = 1400) {
  // Navigate into sub-sections by TOCHeading (instead of prefix-matching text content)
  const items = [];
  if (!parentNode) return items;
  const normalizedHeadings = subHeadings.map(h => h.toLowerCase());

  function walk(n) {
    if (!n || items.length >= maxItems) return;
    if (n.TOCHeading) {
      const lower = n.TOCHeading.toLowerCase();
      if (normalizedHeadings.some(h => lower.includes(h))) {
        items.push(...extractItems(n, maxItems - items.length, maxChars));
        return; // Don't recurse deeper once we matched
      }
    }
    if (n.Section) n.Section.forEach(walk);
  }
  walk(parentNode);
  return items;
}

function buildHsdbGroupsFromFullRecord(fullRoot) {
  const found = collectHsdbHeadings(fullRoot);

  const get = (name) => found[name] || null;
  const getItems = (name, maxItems = 8, maxChars = 1200) => {
    const node = get(name);
    if (!node) return [];
    return extractItems(node, maxItems, maxChars);
  };

  const humanComplete = get('Human Toxicity Excerpts (Complete)');
  const nonHumanComplete = get('Non-Human Toxicity Excerpts (Complete)');
  const animalStudies = get('Animal Toxicity Studies');

  // --- Helper: multi-strategy extraction for a topic ---
  // Strategy 1: prefix match on text (original approach)
  // Strategy 2: sub-section heading match  
  // Strategy 3: keyword-anywhere-in-text match
  // Strategy 4: find ANY section in full tree with matching heading
  // Returns first non-empty result
  function extractTopic(parentNodes, prefixes, subHeadingKeywords, textKeywords, treeKeywords) {
    // Strategy 1: prefix
    for (const node of parentNodes) {
      if (!node) continue;
      const items = extractPrefixedItems(node, prefixes, 10, 1400);
      if (items.length) return items;
    }
    // Strategy 2: sub-section headings
    for (const node of parentNodes) {
      if (!node) continue;
      const items = extractSubSectionItems(node, subHeadingKeywords, 10, 1400);
      if (items.length) return items;
    }
    // Strategy 3: keyword in text content
    for (const node of parentNodes) {
      if (!node) continue;
      const items = extractKeywordItems(node, textKeywords, 8, 1400);
      if (items.length) return items;
    }
    // Strategy 4: find sections anywhere in full PUG-View tree
    if (treeKeywords && fullRoot) {
      const sections = findSectionsByKeywords(fullRoot, treeKeywords, false);
      for (const sec of sections) {
        const items = extractItems(sec, 8, 1400);
        if (items.length) return items;
      }
    }
    return [];
  }

  const hsdb1 = mergeSections(
    ['Absorption, Distribution and Excretion', getItems('Absorption, Distribution and Excretion')],
    ['Absorption, Distribution and Excretion (Complete)', getItems('Absorption, Distribution and Excretion (Complete)')],
    ['Metabolism/Metabolites', getItems('Metabolism/Metabolites')],
    ['Metabolism/Metabolites (Complete)', getItems('Metabolism/Metabolites (Complete)')],
    ['Human Toxicity Excerpts (Complete)', humanComplete ? extractPrefixedItems(humanComplete, [
      '/acute hazard',
      '/acute toxicity',
      '/signs and symptoms'
    ]) : []],
    ['Non-Human Toxicity Excerpts (Complete)', nonHumanComplete ? extractPrefixedItems(nonHumanComplete, [
      '/laboratory animals: acute exposure',
      '/acute toxicity'
    ]) : []],
    ['Non-Human Toxicity Values', getItems('Non-Human Toxicity Values')],
    ['Non-Human Toxicity Values (Complete)', getItems('Non-Human Toxicity Values (Complete)')]
  );

  // --- hsdb2: Irritation / Sensitization / Repeated dose ---
  const irritSensItems = extractTopic(
    [humanComplete],
    ['/irritation', '/skin irritation', '/eye irritation', '/sensitization', '/allergic reactions', '/asthma'],
    ['irritation', 'sensitization', 'allergic', 'skin sensitization', 'respiratory sensitization'],
    ['sensitization', 'sensitisation', 'allergic contact', 'dermatitis', 'asthma', 'skin irritation'],
    ['Skin Sensitization', 'Respiratory Sensitization', 'Sensitization']
  );
  const repeatedDoseAnimal = extractTopic(
    [animalStudies, nonHumanComplete],
    ['/laboratory animals: subchronic or prechronic exposure', '/laboratory animals: chronic exposure or carcinogenicity'],
    ['subchronic', 'chronic exposure', 'prechronic'],
    ['subchronic', 'repeated dose', 'chronic exposure', '90-day', '28-day', 'noael', 'loael'],
    null
  );

  const hsdb2 = mergeSections(
    ['Irritation / Sensitization data', irritSensItems],
    ['Animal Studies - repeated dose', repeatedDoseAnimal],
    ['Medical Surveillance', getItems('Medical Surveillance')],
    ['Medical Surveillance (Complete)', getItems('Medical Surveillance (Complete)')]
  );

  // --- hsdb3: Genotoxicity / Carcinogenicity / Reprotox ---
  const genotoxItems = extractTopic(
    [humanComplete, nonHumanComplete],
    ['/genotoxicity'],
    ['genotoxicity', 'mutagenicity', 'genetic toxicology'],
    ['genotoxic', 'mutagenic', 'ames test', 'chromosom', 'micronuclei', 'micronucleus', 'sister chromatid', 'dna damage', 'clastogen'],
    ['Genotoxicity']
  );
  const reprotoxItems = extractTopic(
    [humanComplete, nonHumanComplete, animalStudies],
    ['/laboratory animals: developmental or reproductive toxicity'],
    ['reproductive', 'developmental', 'teratogenicity', 'fertility', 'teratogenic'],
    ['reproductive', 'teratogenic', 'fertility', 'embryo', 'fetal', 'foetal', 'developmental toxicity', 'birth defect', 'malformation'],
    ['Reproductive Effects', 'Developmental Toxicity']
  );

  const hsdb3 = mergeSections(
    // Direct HSDB genotoxicity sections
    ['Genotoxicity', getItems('Genotoxicity')],
    ['Genotoxicity (Complete)', getItems('Genotoxicity (Complete)')],
    // Extracted genotox data from excerpts/tree
    ['Genotoxicity data', genotoxItems],
    // Carcinogenicity
    ['Evidence for Carcinogenicity', getItems('Evidence for Carcinogenicity')],
    ['Evidence for Carcinogenicity (Complete)', getItems('Evidence for Carcinogenicity (Complete)')],
    // Direct HSDB reprotox sections
    ['Reproductive Effects', getItems('Reproductive Effects')],
    ['Reproductive Effects (Complete)', getItems('Reproductive Effects (Complete)')],
    ['Developmental Toxicity/Teratogenicity', getItems('Developmental Toxicity/Teratogenicity')],
    ['Developmental Toxicity/Teratogenicity (Complete)', getItems('Developmental Toxicity/Teratogenicity (Complete)')],
    // Extracted reprotox data from excerpts/tree
    ['Reproductive/Developmental data', reprotoxItems]
  );

  const hsdb4 = mergeSections(
    ['Occupational Exposure Standards', getItems('Occupational Exposure Standards')],
    ['Occupational Exposure Standards (Complete)', getItems('Occupational Exposure Standards (Complete)')],
    ['NIOSH Recommendations', getItems('NIOSH Recommendations')],
    ['NIOSH Recommendations (Complete)', getItems('NIOSH Recommendations (Complete)')],
    ['Reported Fatal Dose', getItems('Reported Fatal Dose')],
    ['Reported Fatal Dose (Complete)', getItems('Reported Fatal Dose (Complete)')]
  );

  return {
    hsdb1,
    hsdb2,
    hsdb3,
    hsdb4,
    foundHeadings: Object.keys(found).sort()
  };
}

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
        lastError = new Error(`OpenRouter API error ${res.status} (${model}): ${err.substring(0, 400)}`);
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
        lastError = new Error(`Pas de JSON dans la réponse OpenRouter (${model})`);
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
=== DONNÉES HSDB / PUBCHEM (Données humaines / Standards / VTR) ===
${hsdbText || 'Non disponible'}`;
}

export async function generateToxProfile(cas) {
  const normalizedCas = String(cas || '').trim();
  if (!normalizedCas) throw new Error('CAS manquant');

  const cached = getCached(normalizedCas);
  if (cached) return { ...cached, fromCache: true };

  const cid = await getCID(normalizedCas);
  if (!cid) throw new Error(`Substance non trouvée dans PubChem pour CAS ${normalizedCas}`);

  console.log(`[ToxProfile] CAS ${normalizedCas} → CID ${cid}. Fetching data…`);

  const [props, toxData, ghsData, fullData] = await Promise.all([
    getPubchemProps(cid),
    fetchPugView(cid, 'Toxicity'),
    fetchPugView(cid, 'GHS Classification'),
    fetchFullPugView(cid),
  ]);

  const substanceName = props.IUPACName || normalizedCas;
  const toxRoot = toxData?.Record || null;
  const ghsRoot = ghsData?.Record || null;
  const fullRoot = fullData?.Record || null;

  const pubchemText = buildPubchemText(toxRoot, ghsRoot, fullRoot);
  const { hsdb1, hsdb2, hsdb3, hsdb4, foundHeadings } = buildHsdbGroupsFromFullRecord(fullRoot);

  console.log(`[ToxProfile] PubChem: ${pubchemText.length} chars | HSDB groups: ${hsdb1.length}/${hsdb2.length}/${hsdb3.length}/${hsdb4.length} chars`);
  console.log(`[ToxProfile] HSDB headings found: ${foundHeadings.join(', ') || '(none)'}`);
  console.log('[ToxProfile] Sending 4 parallel prompts to OpenRouter…');

  const [result1, result2, result3, result4] = await Promise.all([
    callOpenRouter(buildPrompt1(substanceName, normalizedCas, pubchemText, hsdb1)),
    callOpenRouter(buildPrompt2(substanceName, normalizedCas, pubchemText, hsdb2)),
    callOpenRouter(buildPrompt3(substanceName, normalizedCas, pubchemText, hsdb3)),
    callOpenRouter(buildPrompt4(substanceName, normalizedCas, pubchemText, hsdb4 + '\n\n' + serializeSections({
      'EPA IRIS Information': findSection(fullRoot, 'EPA IRIS Information') ? extractTableLikeSection(findSection(fullRoot, 'EPA IRIS Information')) : [],
      'EPA Provisional Peer-Reviewed Toxicity Values': findSection(fullRoot, 'EPA Provisional Peer-Reviewed Toxicity Values') ? extractTableLikeSection(findSection(fullRoot, 'EPA Provisional Peer-Reviewed Toxicity Values')) : [],
      'RAIS Toxicity Values': findSection(fullRoot, 'RAIS Toxicity Values') ? extractTableLikeSection(findSection(fullRoot, 'RAIS Toxicity Values')) : [],
    }))),
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
      sections[key] = { title: key, content: 'Données non disponibles dans les sources consultées.', available: false };
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
