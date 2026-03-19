// server/hsdbFetch.js
// Récupère les données HSDB complètes via l'API Annotations PubChem
// L'endpoint per-compound tronque à 5 items par section.
// L'API Annotations renvoie TOUTES les données, paginées par 1000 annotations.
// Chaque annotation = 1 substance. On filtre par CID (LinkedRecords.CID).
//
// Usage: import { fetchHsdbComplete } from './hsdbFetch.js';
//        const data = await fetchHsdbComplete(cid);

const HSDB_SOURCE = 'Hazardous Substances Data Bank (HSDB)';
const BASE_URL = 'https://pubchem.ncbi.nlm.nih.gov/rest/pug_view/annotations/heading/JSON';

// Headings HSDB qu'on veut récupérer en version complète
// Ce sont les headings qui existent dans l'API annotations HSDB
const HSDB_COMPLETE_HEADINGS = [
  'Human Toxicity Excerpts (Complete)',
  'Non-Human Toxicity Excerpts (Complete)',
  'Non-Human Toxicity Values (Complete)',
  'Absorption, Distribution and Excretion (Complete)',
  'Metabolism/Metabolites (Complete)',
  'Evidence for Carcinogenicity (Complete)',
  'Medical Surveillance (Complete)',
  'Preventive Measures (Complete)',
  'NIOSH Recommendations (Complete)',
  'Reported Fatal Dose (Complete)',
  'Populations at Special Risk (Complete)',
  'TSCA Test Submissions (Complete)',
  'Interactions (Complete)',
];

async function fetchAnnotationPage(heading, page) {
  const url = `${BASE_URL}?source=${encodeURIComponent(HSDB_SOURCE)}&heading_type=Compound&heading=${encodeURIComponent(heading)}&page=${page}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
    if (!res.ok) return null;
    return res.json();
  } catch (e) {
    console.warn(`[HSDB] Fetch failed for "${heading}" page ${page}: ${e.message}`);
    return null;
  }
}

/**
 * Search through annotations pages to find the one matching our CID.
 * Annotations are sorted, so we scan pages sequentially until found or exhausted.
 * 
 * Optimization: each page contains ~1000 annotations.
 * Each annotation has LinkedRecords.CID array. We check if our CID is in there.
 * 
 * Returns the annotation data items (array) or null if not found.
 */
async function findAnnotationForCid(heading, cid, maxPages = 10) {
  for (let page = 1; page <= maxPages; page++) {
    const data = await fetchAnnotationPage(heading, page);
    if (!data) return null;

    const totalPages = data.Annotations?.TotalPages || 0;
    const annotations = data.Annotations?.Annotation || [];

    for (const ann of annotations) {
      const linkedCids = ann.LinkedRecords?.CID || [];
      if (linkedCids.includes(cid)) {
        // Found it! Return the data items
        return ann.Data || [];
      }
    }

    // If we've gone through all pages, stop
    if (page >= totalPages) break;
  }

  return null;
}

/**
 * Extract text items from HSDB annotation data items.
 * Each data item has: { Value: { StringWithMarkup: [{ String }] } }
 * Returns array of { text, tag } where tag is the HSDB prefix like /GENOTOXICITY/
 */
function extractHsdbItems(dataItems) {
  if (!dataItems) return [];
  const items = [];

  for (const d of dataItems) {
    const strings = d.Value?.StringWithMarkup?.map(s => s.String).filter(s => s && s.length > 10) || [];
    for (const str of strings) {
      // Extract tag prefix if present (e.g., "/GENOTOXICITY/ ...")
      const tagMatch = str.match(/^\/([^/]+)\//);
      const tag = tagMatch ? tagMatch[1].trim() : '';
      items.push({ text: str, tag });
    }
  }

  return items;
}

/**
 * Group HSDB items by their tag prefix into topic-specific buckets.
 */
function groupByTopic(items) {
  const groups = {
    adme: [],           // absorption, distribution, excretion, metabolism
    acuteToxicity: [],  // acute exposure, signs and symptoms, poisoning
    irritation: [],     // skin/eye/respiratory irritation
    sensitization: [],  // sensitization, allergic, immunotoxicity
    repeatedDose: [],   // subchronic, chronic exposure
    genotoxicity: [],   // genotoxicity, mutagenicity, alternative in vitro tests
    carcinogenicity: [], // carcinogenicity
    reprotox: [],       // developmental or reproductive toxicity
    humanData: [],      // human exposure studies, epidemiological
    other: [],          // everything else
  };

  for (const item of items) {
    const tagLower = item.tag.toLowerCase();
    const textLower = item.text.substring(0, 300).toLowerCase();

    if (tagLower.includes('genotoxicity') || tagLower.includes('mutagenicity') ||
        tagLower.includes('alternative and in vitro')) {
      groups.genotoxicity.push(item);
    } else if (tagLower.includes('developmental or reproductive') || 
               tagLower.includes('reproductive') || tagLower.includes('teratogen')) {
      groups.reprotox.push(item);
    } else if (tagLower.includes('sensitization') || tagLower.includes('immunotoxicity') ||
               tagLower.includes('allergic')) {
      groups.sensitization.push(item);
    } else if (tagLower.includes('irritation')) {
      groups.irritation.push(item);
    } else if (tagLower.includes('subchronic') || tagLower.includes('prechronic') ||
               tagLower.includes('chronic exposure or carcinogenicity') ||
               tagLower.includes('chronic exposure')) {
      groups.repeatedDose.push(item);
    } else if (tagLower.includes('acute exposure') || tagLower.includes('acute hazard') ||
               tagLower.includes('signs and symptoms') || tagLower.includes('acute toxicity')) {
      groups.acuteToxicity.push(item);
    } else if (tagLower.includes('carcinogenicity') || tagLower.includes('oncogenicity')) {
      groups.carcinogenicity.push(item);
    } else if (tagLower.includes('human exposure') || tagLower.includes('epidemiolog')) {
      groups.humanData.push(item);
    } else if (tagLower.includes('absorption') || tagLower.includes('metabolism') ||
               tagLower.includes('pharmacokinetic')) {
      groups.adme.push(item);
    } else {
      // Fallback: try to classify by text content keywords
      if (textLower.includes('genotox') || textLower.includes('mutagen') || textLower.includes('ames test') ||
          textLower.includes('micronucle') || textLower.includes('chromosom')) {
        groups.genotoxicity.push(item);
      } else if (textLower.includes('reproduct') || textLower.includes('teratogen') || textLower.includes('fertility') ||
                 textLower.includes('embryo') || textLower.includes('fetal') || textLower.includes('developmental')) {
        groups.reprotox.push(item);
      } else if (textLower.includes('sensitiz') || textLower.includes('allergic contact') || textLower.includes('asthma')) {
        groups.sensitization.push(item);
      } else {
        groups.other.push(item);
      }
    }
  }

  return groups;
}

/**
 * Serialize a group of HSDB items into text for LLM prompt.
 * Limits to maxItems and maxChars per item.
 */
function serializeGroup(items, maxItems = 15, maxChars = 1500) {
  return items.slice(0, maxItems).map(item => {
    const text = item.text.length > maxChars ? item.text.substring(0, maxChars) + '…' : item.text;
    return `- ${text}`;
  }).join('\n');
}

/**
 * Main function: fetch complete HSDB data for a given CID and return
 * pre-grouped text ready for LLM prompts.
 * 
 * Returns {
 *   hsdb1: string,  // ADME + Acute Toxicity
 *   hsdb2: string,  // Irritation + Sensitization + Repeated Dose
 *   hsdb3: string,  // Genotoxicity + Carcinogenicity + Reprotox
 *   hsdb4: string,  // Human Data + Reference Values (OEL, NIOSH, etc.)
 *   stats: { humanExcerpts, nonHumanExcerpts, ... }
 * }
 */
export async function fetchHsdbComplete(cid) {
  console.log(`[HSDB] Fetching complete HSDB data for CID ${cid}...`);

  // Fetch the two main complete excerpts in parallel
  const [humanData, nonHumanData] = await Promise.all([
    findAnnotationForCid('Human Toxicity Excerpts (Complete)', cid),
    findAnnotationForCid('Non-Human Toxicity Excerpts (Complete)', cid),
  ]);

  const humanItems = extractHsdbItems(humanData);
  const nonHumanItems = extractHsdbItems(nonHumanData);
  const allItems = [...humanItems, ...nonHumanItems];

  console.log(`[HSDB] Human excerpts: ${humanItems.length} items, Non-human: ${nonHumanItems.length} items`);

  // Group by topic
  const humanGroups = groupByTopic(humanItems);
  const animalGroups = groupByTopic(nonHumanItems);

  // Log what we found
  const topicCounts = {};
  for (const key of Object.keys(humanGroups)) {
    topicCounts[key] = (humanGroups[key]?.length || 0) + (animalGroups[key]?.length || 0);
  }
  console.log(`[HSDB] Topic distribution: ${Object.entries(topicCounts).filter(([,v]) => v > 0).map(([k,v]) => `${k}=${v}`).join(', ')}`);

  // Build the 4 prompt groups
  const hsdb1Parts = [];
  if (humanGroups.adme.length) hsdb1Parts.push(`## HSDB — ADME (human)\n${serializeGroup(humanGroups.adme)}`);
  if (animalGroups.adme.length) hsdb1Parts.push(`## HSDB — ADME (animal)\n${serializeGroup(animalGroups.adme)}`);
  if (humanGroups.acuteToxicity.length) hsdb1Parts.push(`## HSDB — Acute Toxicity (human)\n${serializeGroup(humanGroups.acuteToxicity)}`);
  if (animalGroups.acuteToxicity.length) hsdb1Parts.push(`## HSDB — Acute Toxicity (animal)\n${serializeGroup(animalGroups.acuteToxicity)}`);
  const hsdb1 = hsdb1Parts.join('\n\n');

  const hsdb2Parts = [];
  if (humanGroups.irritation.length || animalGroups.irritation.length) {
    hsdb2Parts.push(`## HSDB — Irritation\n${serializeGroup([...humanGroups.irritation, ...animalGroups.irritation])}`);
  }
  if (humanGroups.sensitization.length || animalGroups.sensitization.length) {
    hsdb2Parts.push(`## HSDB — Sensitization\n${serializeGroup([...humanGroups.sensitization, ...animalGroups.sensitization])}`);
  }
  if (humanGroups.repeatedDose.length || animalGroups.repeatedDose.length) {
    hsdb2Parts.push(`## HSDB — Repeated Dose / Chronic\n${serializeGroup([...humanGroups.repeatedDose, ...animalGroups.repeatedDose])}`);
  }
  const hsdb2 = hsdb2Parts.join('\n\n');

  const hsdb3Parts = [];
  if (humanGroups.genotoxicity.length || animalGroups.genotoxicity.length) {
    hsdb3Parts.push(`## HSDB — Genotoxicity / Mutagenicity\n${serializeGroup([...humanGroups.genotoxicity, ...animalGroups.genotoxicity])}`);
  }
  if (humanGroups.carcinogenicity.length || animalGroups.carcinogenicity.length) {
    hsdb3Parts.push(`## HSDB — Carcinogenicity\n${serializeGroup([...humanGroups.carcinogenicity, ...animalGroups.carcinogenicity])}`);
  }
  if (humanGroups.reprotox.length || animalGroups.reprotox.length) {
    hsdb3Parts.push(`## HSDB — Reproductive / Developmental Toxicity\n${serializeGroup([...humanGroups.reprotox, ...animalGroups.reprotox])}`);
  }
  const hsdb3 = hsdb3Parts.join('\n\n');

  const hsdb4Parts = [];
  if (humanGroups.humanData.length) {
    hsdb4Parts.push(`## HSDB — Human Exposure Data\n${serializeGroup(humanGroups.humanData)}`);
  }
  // Also include "other" items that might contain useful info
  const otherRelevant = [...humanGroups.other, ...animalGroups.other].filter(item => {
    const lower = item.text.substring(0, 200).toLowerCase();
    return lower.includes('exposure') || lower.includes('occupational') || lower.includes('worker') ||
           lower.includes('epidemiolog') || lower.includes('clinical');
  });
  if (otherRelevant.length) {
    hsdb4Parts.push(`## HSDB — Other Human/Occupational Data\n${serializeGroup(otherRelevant, 10)}`);
  }
  const hsdb4 = hsdb4Parts.join('\n\n');

  return {
    hsdb1,
    hsdb2,
    hsdb3,
    hsdb4,
    stats: {
      humanExcerpts: humanItems.length,
      nonHumanExcerpts: nonHumanItems.length,
      ...topicCounts,
    },
  };
}
