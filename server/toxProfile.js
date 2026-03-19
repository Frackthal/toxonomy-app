// server/toxProfile.js
// Profil toxicologique via PubChem + HSDB (Complete) + OpenRouter
// v9 — Utilise l'API Annotations HSDB pour les données complètes (pas tronquées)
// Signature conservée : generateToxProfile(cas)

import { fetchHsdbComplete } from './hsdbFetch.js';

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

// ─── PubChem API helpers ──────────────────────────────────────────────────────

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

// ─── Tree traversal helpers ───────────────────────────────────────────────────

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

function findAllSections(node, heading, out = []) {
  if (!node) return out;
  if (node.TOCHeading === heading) out.push(node);
  if (node.Section) {
    for (const s of node.Section) findAllSections(s, heading, out);
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

// ─── HSDB detection ───────────────────────────────────────────────────────────
// HSDB data in PubChem PUG-View is identified by:
// 1. Reference entries containing "/source/hsdb/" URL
// 2. Reference entries with SourceName "Hazardous Substances Data Bank (HSDB)"
// 3. Reference entries with source IDs containing "11933" (HSDB's PubChem source ID)
// We check at the Information level (each data item), not the section level,
// because sections often mix HSDB + non-HSDB data.

function isHsdbReference(refNumber, references) {
  if (!references || !refNumber) return false;
  const ref = references.find(r => r.ReferenceNumber === refNumber);
  if (!ref) return false;
  const url = ref.URL || '';
  const source = ref.SourceName || '';
  return url.includes('/source/hsdb/') || 
         source.includes('Hazardous Substances Data Bank') ||
         source.includes('HSDB');
}

function sectionHasHsdbData(section, references) {
  if (!section) return false;
  // Quick check: stringify a small sample
  const sample = JSON.stringify(section).substring(0, 10000);
  return sample.includes('/source/hsdb/') || 
         sample.includes('source/11933') || 
         sample.includes('HSDB record page') ||
         sample.includes('Hazardous Substances Data Bank');
}

// ─── Data extraction ──────────────────────────────────────────────────────────

/**
 * Extract text items from a PUG-View section node.
 * Each item = { text, ref, name }
 * - name is the Information.Name field (e.g. "LD50", "LC50", etc.)
 */
function extractItems(node, maxItems = 8, maxChars = 1200) {
  const items = [];
  function walk(n) {
    if (!n || items.length >= maxItems) return;
    if (n.Information) {
      for (const inf of n.Information) {
        if (items.length >= maxItems) break;
        const name = inf.Name ? String(inf.Name).trim() : '';
        const strings = inf.Value?.StringWithMarkup?.map(s => s.String).filter(s => s && s.length > 10) || [];
        const ref = formatRef(inf.Reference?.[0] || '');
        for (const str of strings.slice(0, 2)) {
          if (items.length >= maxItems) break;
          const text = str.length > maxChars ? str.substring(0, maxChars) + '…' : str;
          items.push({ text: text.trim(), ref, name });
        }
      }
    }
    if (n.Section) n.Section.forEach(walk);
  }
  walk(node);
  return items;
}

/**
 * Extract items from a section where the Information.Name field matches given keywords.
 * This is more reliable than prefix-matching on text content because HSDB data
 * in PubChem uses structured Name fields.
 */
function extractByInfoName(node, nameKeywords, maxItems = 10, maxChars = 1400) {
  const items = [];
  const normKeywords = nameKeywords.map(k => k.toLowerCase());

  function walk(n) {
    if (!n || items.length >= maxItems) return;
    if (n.Information) {
      for (const inf of n.Information) {
        if (items.length >= maxItems) break;
        const name = String(inf.Name || '').toLowerCase();
        if (!name) continue;
        if (!normKeywords.some(k => name.includes(k))) continue;
        const strings = inf.Value?.StringWithMarkup?.map(s => s.String).filter(s => s && s.length > 10) || [];
        const ref = formatRef(inf.Reference?.[0] || '');
        for (const str of strings) {
          if (items.length >= maxItems) break;
          const text = str.length > maxChars ? str.substring(0, maxChars) + '…' : str;
          items.push({ text: text.trim(), ref, name: inf.Name || '' });
        }
      }
    }
    if (n.Section) n.Section.forEach(walk);
  }
  walk(node);
  return items;
}

/**
 * Extract items where text content OR Information.Name matches prefixes.
 * HSDB text paragraphs in "Human Health Effects" and "Non-Human Toxicity Excerpts"
 * sections use tag prefixes in TWO ways:
 *   A) Text starts with tag: "/GENOTOXICITY/ Formaldehyde is genotoxic..."
 *   B) Information.Name field IS the tag: Name="/GENOTOXICITY/" with text in StringWithMarkup
 * We check both.
 */
function extractPrefixedItems(node, prefixes, maxItems = 10, maxChars = 1400) {
  const items = [];
  const normPrefixes = prefixes.map(p => p.toLowerCase().replace(/^\//, '').replace(/\/$/, ''));

  function matchesPrefix(text) {
    const lower = text.trim().toLowerCase().replace(/^\//, '');
    return normPrefixes.some(p => lower.startsWith(p));
  }

  function walk(n) {
    if (!n || items.length >= maxItems) return;
    if (n.Information) {
      for (const inf of n.Information) {
        if (items.length >= maxItems) break;
        const name = String(inf.Name || '').trim();
        const nameMatches = name && matchesPrefix(name);
        const strings = inf.Value?.StringWithMarkup?.map(s => s.String).filter(s => s && s.length > 10) || [];
        const ref = formatRef(inf.Reference?.[0] || '');
        
        for (const str of strings) {
          if (items.length >= maxItems) break;
          // Match if text starts with prefix OR if Name field matches
          if (!nameMatches && !matchesPrefix(str)) continue;
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

/**
 * Extract items where text content contains any of the given keywords anywhere.
 */
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

/**
 * Find ALL sections anywhere in the tree whose TOCHeading matches any keyword.
 * Optionally filter to HSDB-sourced sections only.
 */
function findSectionsByKeywords(root, keywords, hsdbOnly = false) {
  const results = [];
  const normKeywords = keywords.map(k => k.toLowerCase());

  function walk(node) {
    if (!node) return;
    if (node.TOCHeading) {
      const lower = node.TOCHeading.toLowerCase();
      if (normKeywords.some(k => lower.includes(k))) {
        if (!hsdbOnly || sectionHasHsdbData(node)) {
          results.push(node);
        }
      }
    }
    if (node.Section) node.Section.forEach(walk);
  }
  walk(root);
  return results;
}

/**
 * Extract table-like data from sections that use Name/Value pairs in Information.
 * Good for sections like EPA IRIS, RAIS Toxicity Values, Occupational Exposure Standards.
 */
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

// ─── Build PubChem Toxicity text ──────────────────────────────────────────────

const PUBCHEM_TOX_HEADINGS = [
  // Core tox sections
  'Acute Effects',
  'Non-Human Toxicity Values',
  'Exposure Routes',
  'Symptoms',
  'Human Toxicity Excerpts',
  'Non-Human Toxicity Excerpts',
  'Health Effects',
  'First Aid',
  'Hazards Summary',
  'Skin, Eye, and Respiratory Irritations',
  'Carcinogenicity',
  'Genotoxicity',
  'Reproductive Effects',
  // VTR sections
  'EPA IRIS Information',
  'EPA Provisional Peer-Reviewed Toxicity Values',
  'RAIS Toxicity Values',
  // NEW: sections where genotox/reprotox/sensitization data ACTUALLY lives
  // (PubChem truncates HSDB excerpts to 5 items, so these sections are crucial)
  'GHS Classification',
  'Hazard Classes and Categories',
  'Mechanism of Action',
  'Evidence for Carcinogenicity',
  'Carcinogen Classification',
  'Signs and Symptoms',
  'Target Organs',
  'Cancer Sites',
  'Adverse Effects',
  'Toxicity Summary',
  'Effects of Short Term Exposure',
  'Effects of Long Term Exposure',
  'Populations at Special Risk',
  'TSCA Test Submissions',
  'Reported Fatal Dose',
  'Threshold Limit Values (TLV)',
  'Medical Surveillance',
  'NIOSH Recommendations',
];

// Headings where we want more data extracted (complex tox sections)
const ENHANCED_HEADINGS = new Set([
  'Genotoxicity', 'Reproductive Effects', 'Carcinogenicity',
  'Skin, Eye, and Respiratory Irritations', 'Human Toxicity Excerpts',
  'Non-Human Toxicity Excerpts',
  // NEW: these sections contain rich tox data
  'GHS Classification', 'Hazard Classes and Categories',
  'Mechanism of Action', 'Evidence for Carcinogenicity',
  'Signs and Symptoms', 'Adverse Effects', 'Toxicity Summary',
  'Effects of Long Term Exposure', 'TSCA Test Submissions',
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
    if (b && items.length < maxItems) items.push(...extractItems(b, maxItems - items.length, maxChars));

    if (c && items.length < maxItems) {
      if (
        heading === 'EPA IRIS Information' ||
        heading === 'EPA Provisional Peer-Reviewed Toxicity Values' ||
        heading === 'RAIS Toxicity Values' ||
        heading === 'Threshold Limit Values (TLV)'
      ) {
        items.push(...extractTableLikeSection(c));
      } else {
        items.push(...extractItems(c, maxItems - items.length, maxChars));
      }
    }

    if (items.length) sections[heading] = items;
  }

  const foundHeadings = Object.keys(sections);
  const missingHeadings = PUBCHEM_TOX_HEADINGS.filter(h => !sections[h]);
  console.log(`[ToxProfile] PubChem headings with data: ${foundHeadings.join(', ')}`);
  if (missingHeadings.length) {
    console.log(`[ToxProfile] PubChem headings WITHOUT data: ${missingHeadings.join(', ')}`);
  }

  return serializeSections(sections);
}

// ─── Improved HSDB extraction ─────────────────────────────────────────────────
// 
// Key insight: HSDB data in PubChem PUG-View lives under specific TOCHeadings
// in the full compound record. The main HSDB-contributed sections are:
//
// Under "Toxicological Information" (or "Toxicity"):
//   - "Human Health Effects" → contains sub-paragraphs tagged with prefixes
//     like /SIGNS AND SYMPTOMS/, /GENOTOXICITY/, /IMMUNOTOXICITY/ etc.
//     These are in the Information[].Value.StringWithMarkup[].String
//   - "Non-Human Toxicity Excerpts" (and Complete variant)
//     Same prefix-tag structure: /LABORATORY ANIMALS: Acute exposure/ etc.
//   - "Non-Human Toxicity Values" (and Complete) — LD50/LC50 values
//   - "Absorption, Distribution and Excretion" (and Complete)
//   - "Metabolism/Metabolites" (and Complete) 
//   - "Evidence for Carcinogenicity" (and Complete)
//   - "Reported Fatal Dose" (and Complete)
//   - "Animal Toxicity Studies" — broad section with sub-sections
//
// Under "Safety and Hazards":
//   - "Occupational Exposure Standards" (and Complete)
//   - "NIOSH Recommendations" (and Complete)
//   - "Medical Surveillance" (and Complete)
//   - "Preventive Measures" (and Complete)
//
// The HSDB "Human Health Effects" section text items often use prefix tags:
//   /SIGNS AND SYMPTOMS/ — acute symptoms
//   /ACUTE HAZARDS/ — acute hazard summary
//   /LABORATORY ANIMALS: Acute exposure/ — acute animal data
//   /LABORATORY ANIMALS: Subchronic or prechronic exposure/ — repeated dose
//   /LABORATORY ANIMALS: Chronic exposure or carcinogenicity/ — chronic
//   /LABORATORY ANIMALS: Developmental or reproductive toxicity/ — reprotox
//   /GENOTOXICITY/ — genotoxicity data
//   /MUTAGENICITY/ — mutagenicity data
//   /ALTERNATIVE and IN VITRO TESTS/ — in vitro genotox
//   /IMMUNOTOXICITY/ — immune effects
//   /SKIN, EYE AND RESPIRATORY IRRITATION/ — irritation data
//   /SENSITIZATION/ — sensitization data
//
// IMPORTANT: Some substances don't have these as separate TOCHeading sections.
// Instead, the data is embedded as tagged paragraphs within "Human Health Effects"
// or "Non-Human Toxicity Excerpts (Complete)". Our extraction must handle both:
//   1. Direct TOCHeading match (e.g., a section literally called "Genotoxicity")
//   2. Prefix-tagged paragraphs within parent sections
//   3. Keyword matching in text when neither of the above works
//   4. Global tree search as last resort

// All HSDB headings we want to look for in the full PUG-View record
const HSDB_WANTED_HEADINGS = [
  // ADME
  'Absorption, Distribution and Excretion',
  'Absorption, Distribution and Excretion (Complete)',
  'Metabolism/Metabolites',
  'Metabolism/Metabolites (Complete)',
  'Pharmacology',
  'Pharmacology (Complete)',
  // Acute / general tox
  'Human Toxicity Excerpts',
  'Human Toxicity Excerpts (Complete)',
  'Human Health Effects',
  'Non-Human Toxicity Excerpts',
  'Non-Human Toxicity Excerpts (Complete)',
  'Non-Human Toxicity Values',
  'Non-Human Toxicity Values (Complete)',
  'Animal Toxicity Studies',
  'Reported Fatal Dose',
  'Reported Fatal Dose (Complete)',
  // Carcinogenicity
  'Evidence for Carcinogenicity',
  'Evidence for Carcinogenicity (Complete)',
  // Reprotox
  'Reproductive Effects',
  'Reproductive Effects (Complete)',
  'Developmental Toxicity/Teratogenicity',
  'Developmental Toxicity/Teratogenicity (Complete)',
  // Genotox (may exist as a direct heading in some records)
  'Genotoxicity',
  'Genotoxicity (Complete)',
  // Occupational / standards
  'Occupational Exposure Standards',
  'Occupational Exposure Standards (Complete)',
  'NIOSH Recommendations',
  'NIOSH Recommendations (Complete)',
  'Medical Surveillance',
  'Medical Surveillance (Complete)',
  'Preventive Measures',
  'Preventive Measures (Complete)',
];

/**
 * Collect all HSDB-sourced sections from the full PUG-View record.
 * Returns a Map of heading → section node.
 * We look for HSDB data at ANY level: some records have it under "Toxicological Information",
 * others under "Safety and Hazards", etc.
 */
function collectHsdbSections(fullRoot) {
  const wanted = new Set(HSDB_WANTED_HEADINGS);
  const found = new Map();

  function walk(node) {
    if (!node) return;
    if (node.TOCHeading && wanted.has(node.TOCHeading)) {
      // Accept the section even without strict HSDB check — PubChem sometimes
      // doesn't embed HSDB URLs at the section level. We'll filter at data level if needed.
      // But prefer HSDB-sourced ones if found.
      const existing = found.get(node.TOCHeading);
      if (!existing) {
        found.set(node.TOCHeading, node);
      } else if (sectionHasHsdbData(node) && !sectionHasHsdbData(existing)) {
        // Replace with the HSDB-sourced version
        found.set(node.TOCHeading, node);
      }
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

/**
 * Deduplicate items by text content (first 100 chars).
 */
function deduplicateItems(items) {
  const seen = new Set();
  return items.filter(item => {
    const key = item.text.substring(0, 100).toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Multi-strategy topic extractor.
 * Tries in order:
 *   1. Prefix-matched text in parent nodes (HSDB tagged paragraphs)
 *   2. Sub-section heading match within parent nodes
 *   3. Keyword-anywhere-in-text match in parent nodes
 *   4. Information.Name field match in parent nodes
 *   5. Global tree search for sections matching keywords
 * Returns the first non-empty result.
 */
function extractTopic(fullRoot, parentNodes, {
  prefixes = [],
  subHeadingKeywords = [],
  textKeywords = [],
  infoNameKeywords = [],
  treeKeywords = null,
  maxItems = 10,
  maxChars = 1400,
} = {}) {
  // Strategy 1: prefix tags in text content
  if (prefixes.length) {
    for (const node of parentNodes) {
      if (!node) continue;
      const items = extractPrefixedItems(node, prefixes, maxItems, maxChars);
      if (items.length) return items;
    }
  }

  // Strategy 2: sub-section headings
  if (subHeadingKeywords.length) {
    for (const node of parentNodes) {
      if (!node) continue;
      const items = extractSubSectionItems(node, subHeadingKeywords, maxItems, maxChars);
      if (items.length) return items;
    }
  }

  // Strategy 3: keyword in text content
  if (textKeywords.length) {
    for (const node of parentNodes) {
      if (!node) continue;
      const items = extractKeywordItems(node, textKeywords, maxItems, maxChars);
      if (items.length) return items;
    }
  }

  // Strategy 4: Information.Name field match
  if (infoNameKeywords.length) {
    for (const node of parentNodes) {
      if (!node) continue;
      const items = extractByInfoName(node, infoNameKeywords, maxItems, maxChars);
      if (items.length) return items;
    }
  }

  // Strategy 5: global tree search
  if (treeKeywords && fullRoot) {
    const sections = findSectionsByKeywords(fullRoot, treeKeywords, false);
    for (const sec of sections) {
      const items = extractItems(sec, maxItems, maxChars);
      if (items.length) return items;
    }
  }

  return [];
}

/**
 * Navigate into sub-sections by TOCHeading keywords.
 */
function extractSubSectionItems(parentNode, subHeadings, maxItems = 10, maxChars = 1400) {
  const items = [];
  if (!parentNode) return items;
  const normalizedHeadings = subHeadings.map(h => h.toLowerCase());

  function walk(n) {
    if (!n || items.length >= maxItems) return;
    if (n.TOCHeading) {
      const lower = n.TOCHeading.toLowerCase();
      if (normalizedHeadings.some(h => lower.includes(h))) {
        items.push(...extractItems(n, maxItems - items.length, maxChars));
        return;
      }
    }
    if (n.Section) n.Section.forEach(walk);
  }
  walk(parentNode);
  return items;
}

// ─── Build HSDB data groups for the 4 prompts ────────────────────────────────

function buildHsdbGroups(fullRoot) {
  const hsdb = collectHsdbSections(fullRoot);

  const get = (name) => hsdb.get(name) || null;
  const getItems = (name, maxItems = 8, maxChars = 1200) => {
    const node = get(name);
    if (!node) return [];
    return extractItems(node, maxItems, maxChars);
  };

  // Main data-rich sections
  const humanExcerpts = get('Human Toxicity Excerpts (Complete)') || get('Human Toxicity Excerpts');
  const humanHealth = get('Human Health Effects');
  const nonHumanExcerpts = get('Non-Human Toxicity Excerpts (Complete)') || get('Non-Human Toxicity Excerpts');
  const animalStudies = get('Animal Toxicity Studies');

  // Parent nodes pool for multi-strategy extraction
  const allHumanSources = [humanExcerpts, humanHealth].filter(Boolean);
  const allAnimalSources = [animalStudies, nonHumanExcerpts].filter(Boolean);
  const allSources = [...allHumanSources, ...allAnimalSources];

  console.log(`[ToxProfile] HSDB parent nodes: humanExcerpts=${!!humanExcerpts}, humanHealth=${!!humanHealth}, nonHumanExcerpts=${!!nonHumanExcerpts}, animalStudies=${!!animalStudies}`);

  // ── Group 1: Toxicokinetics (ADME) + Acute Toxicity ──
  const hsdb1 = mergeSections(
    ['Absorption, Distribution and Excretion', getItems('Absorption, Distribution and Excretion')],
    ['Absorption, Distribution and Excretion (Complete)', getItems('Absorption, Distribution and Excretion (Complete)')],
    ['Metabolism/Metabolites', getItems('Metabolism/Metabolites')],
    ['Metabolism/Metabolites (Complete)', getItems('Metabolism/Metabolites (Complete)')],
    ['Pharmacology', getItems('Pharmacology')],
    ['Pharmacology (Complete)', getItems('Pharmacology (Complete)')],
    // Acute toxicity from human excerpts
    ['Acute toxicity (human)', extractTopic(fullRoot, allHumanSources, {
      prefixes: [
        '/acute hazard', '/acute toxicity', '/signs and symptoms',
        '/poisoning', '/acute exposure',
      ],
      textKeywords: ['acute exposure', 'acute toxicity', 'signs and symptoms', 'lethal dose', 'fatal'],
      infoNameKeywords: ['acute', 'signs', 'symptoms', 'fatal', 'poisoning'],
    })],
    // Acute toxicity from animal excerpts
    ['Acute toxicity (animal)', extractTopic(fullRoot, allAnimalSources, {
      prefixes: [
        '/laboratory animals: acute exposure',
        '/acute toxicity',
      ],
      subHeadingKeywords: ['acute exposure', 'acute toxicity'],
      textKeywords: ['ld50', 'lc50', 'acute oral', 'acute inhal', 'acute dermal'],
      infoNameKeywords: ['ld50', 'lc50', 'acute'],
    })],
    ['Non-Human Toxicity Values', getItems('Non-Human Toxicity Values')],
    ['Non-Human Toxicity Values (Complete)', getItems('Non-Human Toxicity Values (Complete)')],
    ['Reported Fatal Dose', getItems('Reported Fatal Dose')],
    ['Reported Fatal Dose (Complete)', getItems('Reported Fatal Dose (Complete)')],
  );

  // ── Group 2: Irritation / Sensitization / Repeated dose ──
  const irritItems = extractTopic(fullRoot, allSources, {
    prefixes: [
      '/skin, eye and respiratory irritation',
      '/irritation', '/skin irritation', '/eye irritation',
    ],
    subHeadingKeywords: ['irritation', 'corrosion'],
    textKeywords: [
      'skin irritation', 'eye irritation', 'respiratory irritation',
      'corrosive', 'draize',
    ],
    infoNameKeywords: ['irritation', 'corros'],
    treeKeywords: ['Skin, Eye, and Respiratory Irritations', 'Irritation'],
  });

  // Sensitization: search broadly — HSDB tagged paragraphs + full tree
  const sensItems = extractTopic(fullRoot, allSources, {
    prefixes: [
      '/sensitization', '/allergic reactions', '/allergic contact',
      '/immunotoxicity', '/skin sensitization', '/respiratory sensitization',
    ],
    subHeadingKeywords: [
      'sensitization', 'sensitisation', 'allergic',
      'skin sensitization', 'respiratory sensitization', 'immunotoxicity',
    ],
    textKeywords: [
      'sensitization', 'sensitisation', 'allergic contact', 'dermatitis',
      'asthma', 'immunotoxic', 'contact allergy', 'skin allergy',
      'respiratory allergy', 'occupational asthma', 'LLNA', 'guinea pig maximization',
      'patch test',
    ],
    infoNameKeywords: ['sensitiz', 'allerg', 'immunotox', 'asthma'],
    treeKeywords: ['Skin Sensitization', 'Respiratory Sensitization', 'Sensitization'],
  });

  const repeatedDoseItems = extractTopic(fullRoot, allAnimalSources, {
    prefixes: [
      '/laboratory animals: subchronic or prechronic exposure',
      '/laboratory animals: chronic exposure or carcinogenicity',
      '/laboratory animals: chronic exposure',
    ],
    subHeadingKeywords: ['subchronic', 'chronic exposure', 'prechronic', 'repeated dose'],
    textKeywords: [
      'subchronic', 'repeated dose', 'chronic exposure', '90-day', '28-day',
      'noael', 'loael', 'noel', 'loel', 'subacute',
    ],
    infoNameKeywords: ['subchronic', 'chronic', 'repeated', 'noael', 'loael'],
  });

  console.log(`[ToxProfile] HSDB Group 2 extraction: irrit=${irritItems.length}, sens=${sensItems.length}, repeated=${repeatedDoseItems.length} items`);

  const hsdb2 = mergeSections(
    ['Irritation data', irritItems],
    ['Sensitization data', sensItems],
    ['Animal Studies - repeated dose', repeatedDoseItems],
    ['Medical Surveillance', getItems('Medical Surveillance')],
    ['Medical Surveillance (Complete)', getItems('Medical Surveillance (Complete)')],
    ['Preventive Measures', getItems('Preventive Measures')],
    ['Preventive Measures (Complete)', getItems('Preventive Measures (Complete)')],
  );

  // ── Group 3: Genotoxicity / Carcinogenicity / Reprotox ──
  
  // Genotoxicity: combine direct HSDB sections + tagged paragraphs + full tree
  const directGenotox = [
    ...getItems('Genotoxicity'),
    ...getItems('Genotoxicity (Complete)'),
  ];
  // Always try extraction from human/animal excerpts (not just as fallback)
  const extractedGenotox = extractTopic(fullRoot, allSources, {
    prefixes: ['/genotoxicity', '/mutagenicity', '/alternative and in vitro tests'],
    subHeadingKeywords: ['genotoxicity', 'mutagenicity', 'genetic toxicology'],
    textKeywords: [
      'genotoxic', 'mutagenic', 'ames test', 'chromosom', 'micronuclei',
      'micronucleus', 'sister chromatid', 'dna damage', 'clastogen',
      'umu test', 'comet assay', 'gene mutation',
    ],
    infoNameKeywords: ['genotox', 'mutagen', 'ames', 'chromosome', 'micronucleus'],
    treeKeywords: ['Genotoxicity', 'Mutagenicity'],
  });

  // Reprotox: combine direct sections + tagged paragraphs + full tree
  const directReprotox = [
    ...getItems('Reproductive Effects'),
    ...getItems('Reproductive Effects (Complete)'),
    ...getItems('Developmental Toxicity/Teratogenicity'),
    ...getItems('Developmental Toxicity/Teratogenicity (Complete)'),
  ];
  const extractedReprotox = extractTopic(fullRoot, allSources, {
    prefixes: [
      '/laboratory animals: developmental or reproductive toxicity',
      '/reproductive', '/developmental',
    ],
    subHeadingKeywords: ['reproductive', 'developmental', 'teratogenicity', 'fertility'],
    textKeywords: [
      'reproductive', 'teratogenic', 'fertility', 'embryo', 'fetal', 'foetal',
      'developmental toxicity', 'birth defect', 'malformation', 'spermatogenesis',
      'menstrual', 'ovarian', 'testicular',
    ],
    infoNameKeywords: ['reproduct', 'teratogen', 'developmental', 'fertility', 'embryo'],
    treeKeywords: ['Reproductive Effects', 'Developmental Toxicity'],
  });

  // Deduplicate: if direct and extracted overlap, keep unique texts
  const allGenotox = deduplicateItems([...directGenotox, ...extractedGenotox]);
  const allReprotox = deduplicateItems([...directReprotox, ...extractedReprotox]);

  console.log(`[ToxProfile] HSDB Group 3 extraction: genotox=${allGenotox.length} items, reprotox=${allReprotox.length} items`);

  const hsdb3 = mergeSections(
    // Combined genotoxicity data
    ['Genotoxicity data', allGenotox],
    // Carcinogenicity
    ['Evidence for Carcinogenicity', getItems('Evidence for Carcinogenicity')],
    ['Evidence for Carcinogenicity (Complete)', getItems('Evidence for Carcinogenicity (Complete)')],
    // Combined reprotox data
    ['Reproductive/Developmental data', allReprotox],
  );

  // ── Group 4: Human data / Occupational standards / Reference values ──
  const hsdb4 = mergeSections(
    ['Occupational Exposure Standards', getItems('Occupational Exposure Standards')],
    ['Occupational Exposure Standards (Complete)', getItems('Occupational Exposure Standards (Complete)')],
    ['NIOSH Recommendations', getItems('NIOSH Recommendations')],
    ['NIOSH Recommendations (Complete)', getItems('NIOSH Recommendations (Complete)')],
    ['Reported Fatal Dose', getItems('Reported Fatal Dose')],
    ['Reported Fatal Dose (Complete)', getItems('Reported Fatal Dose (Complete)')],
  );

  const foundHeadings = [...hsdb.keys()].sort();

  return { hsdb1, hsdb2, hsdb3, hsdb4, foundHeadings };
}

// ─── OpenRouter LLM call ──────────────────────────────────────────────────────

async function callOpenRouter(prompt) {
  if (!OPENROUTER_API_KEY) throw new Error('OPENROUTER_API_KEY non configurée');

  const models = [OPENROUTER_MODEL, ...OPENROUTER_FALLBACK_MODELS]
    .filter(Boolean)
    .filter((m, i, arr) => arr.indexOf(m) === i);

  let lastError = null;
  for (const model of models) {
    try {
      console.log(`[ToxProfile] Trying model: ${model}`);
      const res = await fetch(OPENROUTER_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': OPENROUTER_SITE_URL,
          'X-Title': OPENROUTER_APP_NAME,
        },
        body: JSON.stringify({
          model,
          messages: [
            {
              role: 'system',
              content: 'Tu es un toxicologue expert. Tu réponds uniquement en JSON valide, sans backticks ni commentaires. Tu rédiges en français.',
            },
            { role: 'user', content: prompt },
          ],
          temperature: 0.1,
          max_tokens: 8192,
          response_format: { type: 'json_object' },
        }),
        signal: AbortSignal.timeout(120000),
      });

      if (!res.ok) {
        const err = await res.text();
        lastError = new Error(`OpenRouter API error ${res.status} (${model}): ${err.substring(0, 400)}`);
        console.warn(`[ToxProfile] ${lastError.message}`);
        continue;
      }

      const data = await res.json();
      const text = data?.choices?.[0]?.message?.content || '';
      if (!text) {
        lastError = new Error(`Réponse OpenRouter vide (${model})`);
        console.warn(`[ToxProfile] ${lastError.message}`);
        continue;
      }

      // Parse JSON from response (handle potential markdown wrapping)
      const clean = text
        .replace(/^```json\s*/i, '')
        .replace(/^```\s*/i, '')
        .replace(/\s*```\s*$/i, '')
        .trim();

      const firstBrace = clean.indexOf('{');
      const lastBrace = clean.lastIndexOf('}');
      if (firstBrace === -1 || lastBrace <= firstBrace) {
        lastError = new Error(`Pas de JSON dans la réponse OpenRouter (${model})`);
        console.warn(`[ToxProfile] ${lastError.message} — raw: ${clean.substring(0, 200)}`);
        continue;
      }

      const parsed = JSON.parse(clean.slice(firstBrace, lastBrace + 1));
      parsed._model = model;
      console.log(`[ToxProfile] Model ${model} succeeded.`);
      return parsed;
    } catch (e) {
      lastError = e;
      console.warn(`[ToxProfile] Model ${model} failed: ${e.message}`);
    }
  }

  throw lastError || new Error('Tous les modèles OpenRouter ont échoué');
}

// ─── Prompts ──────────────────────────────────────────────────────────────────

const COMMON_RULES = `Règles impératives :
- Réponds uniquement en JSON valide, sans backticks ni texte autour.
- N'invente aucune donnée. Utilise les données fournies dans TOUTES les sections ci-dessous (PubChem ET HSDB).
- Cherche les informations pertinentes dans l'ENSEMBLE des données, même si elles apparaissent dans une section inattendue.
- Si AUCUNE donnée pertinente n'est trouvée dans aucune des sources fournies, renvoie available=false et content="Données non disponibles dans les sources consultées."
- Sois synthétique mais précis (5-15 phrases par section quand les données le permettent).
- Rédige en français.
- Conserve exactement les clés JSON demandées.`;

function buildPrompt1(substanceName, cas, pubchemText, hsdbText) {
  return `Rédige deux sections d'un profil toxicologique ECHA/REACH.
${COMMON_RULES}
Substance : ${substanceName} | CAS : ${cas}

JSON attendu :
{
  "toxicokinetics": {
    "title": "Toxicocinétique (ADME)",
    "content": "Absorption (voie orale, inhalation, cutanée), distribution tissulaire, métabolisme (métabolites principaux, enzymes impliquées), élimination (demi-vie, voies d'excrétion).",
    "available": true
  },
  "acuteToxicity": {
    "title": "Toxicité aiguë",
    "content": "Données orales, cutanées, inhalation. Signes cliniques, valeurs DL50/CL50. Privilégier données humaines puis animales.",
    "available": true
  }
}

=== DONNÉES PUBCHEM (toutes données toxicologiques disponibles) ===
${pubchemText}
=== DONNÉES HSDB COMPLÉMENTAIRES (ADME, pharmacologie, toxicité aiguë, DL50/CL50) ===
${hsdbText || 'Non disponible'}`;
}

function buildPrompt2(substanceName, cas, pubchemText, hsdbText) {
  return `Rédige trois sections d'un profil toxicologique ECHA/REACH.
${COMMON_RULES}
Substance : ${substanceName} | CAS : ${cas}

JSON attendu :
{
  "irritationCorrosion": {
    "title": "Irritation / corrosion",
    "content": "Effets peau, yeux, voies respiratoires. Préciser si irritation légère, sévère, corrosion, ou absence d'effet. Citer les tests (Draize, etc.) si disponibles.",
    "available": true
  },
  "sensitization": {
    "title": "Sensibilisation",
    "content": "Données de sensibilisation cutanée ou respiratoire, humaines ou animales, y compris cas professionnels documentés. Mentionner les tests utilisés (LLNA, Guinea pig, patch test).",
    "available": true
  },
  "repeatedDoseToxicity": {
    "title": "Toxicité à doses répétées",
    "content": "Études subchroniques/chroniques, organes cibles, effets principaux, NOAEL/LOAEL si disponibles, voies d'exposition et durées.",
    "available": true
  }
}

=== DONNÉES PUBCHEM (toutes données toxicologiques disponibles) ===
${pubchemText}
=== DONNÉES HSDB COMPLÉMENTAIRES (irritation, sensibilisation, doses répétées si disponibles) ===
${hsdbText || 'Non disponible'}
=== IMPORTANT : Chercher les données de sensibilisation dans TOUTES les sections ci-dessus, y compris dans les excerpts de toxicité humaine et les données GHS. ===`;
}

function buildPrompt3(substanceName, cas, pubchemText, hsdbText) {
  return `Rédige trois sections d'un profil toxicologique ECHA/REACH.
${COMMON_RULES}
Substance : ${substanceName} | CAS : ${cas}

JSON attendu :
{
  "genotoxicity": {
    "title": "Mutagénicité / Génotoxicité",
    "content": "Tests in vitro (Ames, aberrations chromosomiques, SCE, micronoyaux, mutation génique) et in vivo (micronoyaux moelle osseuse, test comète, etc.). Résultats positifs/négatifs avec et sans activation métabolique (S9). Données humaines si disponibles.",
    "available": true
  },
  "carcinogenicity": {
    "title": "Cancérogénicité",
    "content": "Classifications IARC/EPA/NTP/ACGIH/MAK. Données épidémiologiques humaines et études animales à long terme. Organes cibles, types de tumeurs si disponibles.",
    "available": true
  },
  "reproductiveToxicity": {
    "title": "Toxicité pour la reproduction et le développement",
    "content": "Effets sur la fertilité (mâle/femelle), embryotoxicité, fœtotoxicité, tératogénicité. Données humaines et animales avec voies et niveaux d'exposition. NOAEL reprotox si disponible.",
    "available": true
  }
}

=== DONNÉES PUBCHEM (toutes données toxicologiques disponibles) ===
${pubchemText}
=== DONNÉES HSDB COMPLÉMENTAIRES (génotoxicité, cancérogénicité, reproduction si disponibles) ===
${hsdbText || 'Non disponible'}
=== IMPORTANT : Chercher les données de génotoxicité et de toxicité reproductive dans TOUTES les sections ci-dessus, y compris dans les excerpts de toxicité humaine et animale. ===`;
}

function buildPrompt4(substanceName, cas, pubchemText, hsdbText) {
  return `Rédige deux sections d'un profil toxicologique ECHA/REACH.
${COMMON_RULES}
Substance : ${substanceName} | CAS : ${cas}

JSON attendu :
{
  "humanData": {
    "title": "Données humaines",
    "content": "Études épidémiologiques, cas cliniques, expositions professionnelles documentées. Effets observés, populations étudiées, niveaux d'exposition quand disponibles.",
    "available": true
  },
  "referenceValues": {
    "title": "Valeurs toxicologiques de référence",
    "content": "Citer toutes les VTR trouvées : MRL ATSDR (aiguë, intermédiaire, chronique), RfC/RfD EPA IRIS, slope factor oral, IUR inhalation, TLV-TWA ACGIH, OEL, DNEL, ou autres. Indiquer voie, durée, valeur numérique et source.",
    "available": true
  }
}

=== DONNÉES PUBCHEM (toutes données toxicologiques disponibles) ===
${pubchemText}
=== DONNÉES HSDB COMPLÉMENTAIRES (standards professionnels, NIOSH, VTR) ===
${hsdbText || 'Non disponible'}`;
}

// ─── Main entry point ─────────────────────────────────────────────────────────

export async function generateToxProfile(cas) {
  const normalizedCas = String(cas || '').trim();
  if (!normalizedCas) throw new Error('CAS manquant');

  const cached = getCached(normalizedCas);
  if (cached) return { ...cached, fromCache: true };

  const cid = await getCID(normalizedCas);
  if (!cid) throw new Error(`Substance non trouvée dans PubChem pour CAS ${normalizedCas}`);

  console.log(`[ToxProfile] CAS ${normalizedCas} → CID ${cid}. Fetching data…`);

  // Fetch PubChem data (PUG-View) and HSDB complete data (Annotations API) in parallel
  const [props, toxData, ghsData, fullData, hsdbComplete] = await Promise.all([
    getPubchemProps(cid),
    fetchPugView(cid, 'Toxicity'),
    fetchPugView(cid, 'GHS Classification'),
    fetchFullPugView(cid),
    fetchHsdbComplete(cid),
  ]);

  const substanceName = props.IUPACName || normalizedCas;
  const toxRoot = toxData?.Record || null;
  const ghsRoot = ghsData?.Record || null;
  const fullRoot = fullData?.Record || null;

  // Build PubChem text from PUG-View (GHS, Mechanism of Action, etc.)
  const pubchemText = buildPubchemText(toxRoot, ghsRoot, fullRoot);
  
  // Use HSDB complete data (from Annotations API, not truncated)
  const { hsdb1, hsdb2, hsdb3, hsdb4, stats: hsdbStats } = hsdbComplete;

  console.log(`[ToxProfile] PubChem text: ${pubchemText.length} chars`);
  console.log(`[ToxProfile] HSDB complete: ${hsdb1.length}/${hsdb2.length}/${hsdb3.length}/${hsdb4.length} chars`);
  console.log(`[ToxProfile] HSDB stats: ${JSON.stringify(hsdbStats)}`);

  console.log('[ToxProfile] Sending 4 parallel prompts to OpenRouter…');

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
