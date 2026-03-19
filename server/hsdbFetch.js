// server/hsdbFetch.js
// Récupère les données HSDB complètes via l'API Annotations PubChem
// 
// IMPORTANT: L'API renvoie ~1000 annotations par page (toutes substances confondues).
// Le JSON complet fait 50-100MB — impossible à parser entièrement sur Render 512MB.
// 
// Stratégie: lire le body en texte, chercher l'annotation qui matche notre CID
// par recherche textuelle, puis parser UNIQUEMENT ce bloc JSON.

const HSDB_SOURCE = 'Hazardous Substances Data Bank (HSDB)';
const BASE_URL = 'https://pubchem.ncbi.nlm.nih.gov/rest/pug_view/annotations/heading/JSON';

/**
 * Fetch an annotations page as raw text, find the annotation block for our CID,
 * and parse only that block. Avoids parsing the full 50MB+ JSON.
 */
async function findAnnotationForCid(heading, cid, maxPages = 6) {
  const cidStr = String(cid);

  for (let page = 1; page <= maxPages; page++) {
    const url = `${BASE_URL}?source=${encodeURIComponent(HSDB_SOURCE)}&heading_type=Compound&heading=${encodeURIComponent(heading)}&page=${page}`;

    let text;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(60000) });
      if (!res.ok) {
        if (res.status === 404) return null;
        console.warn(`[HSDB] HTTP ${res.status} for "${heading}" page ${page}`);
        return null;
      }
      text = await res.text();
    } catch (e) {
      console.warn(`[HSDB] Fetch failed for "${heading}" page ${page}: ${e.message}`);
      return null;
    }

    // Quick check: is our CID mentioned at all on this page?
    if (!text.includes(cidStr)) {
      const totalMatch = text.match(/"TotalPages"\s*:\s*(\d+)/);
      const totalPages = totalMatch ? parseInt(totalMatch[1]) : 0;
      if (page >= totalPages) break;
      // Free the large string before next iteration
      text = null;
      continue;
    }

    // CID is on this page. Extract the annotation block for it.
    // Each annotation starts with {"SourceName":"Hazardous Substances Data Bank (HSDB)"
    const marker = `"SourceName":"${HSDB_SOURCE}"`;
    const altMarker = `"SourceName": "${HSDB_SOURCE}"`;

    let searchFrom = 0;
    while (true) {
      let blockStart = text.indexOf(marker, searchFrom);
      if (blockStart === -1) blockStart = text.indexOf(altMarker, searchFrom);
      if (blockStart === -1) break;

      // Go back to the opening { of this annotation
      let bracePos = text.lastIndexOf('{', blockStart);
      if (bracePos === -1) { searchFrom = blockStart + 1; continue; }

      // Find next annotation to bound our search
      let nextStart = text.indexOf(marker, blockStart + marker.length);
      if (nextStart === -1) nextStart = text.indexOf(altMarker, blockStart + altMarker.length);
      const searchEnd = nextStart !== -1 ? nextStart : Math.min(bracePos + 500000, text.length);

      // Check if this block contains our CID in LinkedRecords
      const block = text.substring(bracePos, searchEnd);
      const cidPattern = new RegExp(`"CID"\\s*:\\s*\\[([^\\]]{0,500})\\]`);
      const cidMatch = block.match(cidPattern);
      if (!cidMatch || !cidMatch[1].split(',').map(s => s.trim()).includes(cidStr)) {
        searchFrom = nextStart !== -1 ? nextStart : searchEnd;
        continue;
      }

      // Found it! Count braces to extract the complete JSON object.
      let depth = 0;
      let endPos = -1;
      for (let i = bracePos; i < text.length && i < bracePos + 1000000; i++) {
        if (text[i] === '{') depth++;
        else if (text[i] === '}') {
          depth--;
          if (depth === 0) { endPos = i + 1; break; }
        }
      }

      if (endPos === -1) {
        console.warn(`[HSDB] Could not find end of annotation block for CID ${cid}`);
        searchFrom = searchEnd;
        continue;
      }

      const annotationJson = text.substring(bracePos, endPos);
      text = null; // Free the large string

      try {
        const annotation = JSON.parse(annotationJson);
        console.log(`[HSDB] Found "${heading}" for CID ${cid} on page ${page} (${annotation.Data?.length || 0} data items)`);
        return annotation.Data || [];
      } catch (e) {
        console.warn(`[HSDB] JSON parse failed for annotation block: ${e.message}`);
        return null;
      }
    }

    // CID string was found but we couldn't extract the annotation
    const totalMatch = text.match(/"TotalPages"\s*:\s*(\d+)/);
    const totalPages = totalMatch ? parseInt(totalMatch[1]) : 0;
    text = null;
    if (page >= totalPages) break;
  }

  return null;
}

/**
 * Extract text items from HSDB annotation data items.
 */
function extractHsdbItems(dataItems) {
  if (!dataItems) return [];
  const items = [];
  for (const d of dataItems) {
    const strings = d.Value?.StringWithMarkup?.map(s => s.String).filter(s => s && s.length > 10) || [];
    for (const str of strings) {
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
    adme: [], acuteToxicity: [], irritation: [], sensitization: [],
    repeatedDose: [], genotoxicity: [], carcinogenicity: [],
    reprotox: [], humanData: [], other: [],
  };

  for (const item of items) {
    const t = item.tag.toLowerCase();
    const x = item.text.substring(0, 300).toLowerCase();

    if (t.includes('genotoxicity') || t.includes('mutagenicity') || t.includes('alternative and in vitro')) {
      groups.genotoxicity.push(item);
    } else if (t.includes('developmental or reproductive') || t.includes('reproductive') || t.includes('teratogen')) {
      groups.reprotox.push(item);
    } else if (t.includes('sensitization') || t.includes('immunotoxicity') || t.includes('allergic')) {
      groups.sensitization.push(item);
    } else if (t.includes('irritation')) {
      groups.irritation.push(item);
    } else if (t.includes('subchronic') || t.includes('prechronic') || t.includes('chronic exposure')) {
      groups.repeatedDose.push(item);
    } else if (t.includes('acute exposure') || t.includes('acute hazard') || t.includes('signs and symptoms')) {
      groups.acuteToxicity.push(item);
    } else if (t.includes('carcinogenicity') || t.includes('oncogenicity')) {
      groups.carcinogenicity.push(item);
    } else if (t.includes('human exposure') || t.includes('epidemiolog')) {
      groups.humanData.push(item);
    } else if (t.includes('absorption') || t.includes('metabolism') || t.includes('pharmacokinetic')) {
      groups.adme.push(item);
    } else {
      // Fallback: classify by text content
      if (x.includes('genotox') || x.includes('mutagen') || x.includes('ames test') || x.includes('micronucle') || x.includes('chromosom')) {
        groups.genotoxicity.push(item);
      } else if (x.includes('reproduct') || x.includes('teratogen') || x.includes('fertility') || x.includes('embryo') || x.includes('fetal')) {
        groups.reprotox.push(item);
      } else if (x.includes('sensitiz') || x.includes('allergic contact') || x.includes('asthma')) {
        groups.sensitization.push(item);
      } else {
        groups.other.push(item);
      }
    }
  }
  return groups;
}

function serializeGroup(items, maxItems = 8, maxChars = 800) {
  return items.slice(0, maxItems).map(item => {
    const text = item.text.length > maxChars ? item.text.substring(0, maxChars) + '…' : item.text;
    return `- ${text}`;
  }).join('\n');
}

/**
 * Main: fetch complete HSDB data for a CID, grouped by topic for LLM prompts.
 */
export async function fetchHsdbComplete(cid) {
  console.log(`[HSDB] Fetching complete HSDB data for CID ${cid}...`);

  const [humanData, nonHumanData] = await Promise.all([
    findAnnotationForCid('Human Toxicity Excerpts (Complete)', cid),
    findAnnotationForCid('Non-Human Toxicity Excerpts (Complete)', cid),
  ]);

  const humanItems = extractHsdbItems(humanData);
  const nonHumanItems = extractHsdbItems(nonHumanData);

  console.log(`[HSDB] Human excerpts: ${humanItems.length} items, Non-human: ${nonHumanItems.length} items`);

  const hg = groupByTopic(humanItems);
  const ag = groupByTopic(nonHumanItems);

  const topicCounts = {};
  for (const key of Object.keys(hg)) {
    topicCounts[key] = (hg[key]?.length || 0) + (ag[key]?.length || 0);
  }
  console.log(`[HSDB] Topics: ${Object.entries(topicCounts).filter(([,v]) => v > 0).map(([k,v]) => `${k}=${v}`).join(', ')}`);

  const mk = (label, items) => items.length ? `## HSDB — ${label}\n${serializeGroup(items)}` : '';

  const hsdb1 = [
    mk('ADME (human)', hg.adme), mk('ADME (animal)', ag.adme),
    mk('Acute Toxicity (human)', hg.acuteToxicity), mk('Acute Toxicity (animal)', ag.acuteToxicity),
  ].filter(Boolean).join('\n\n');

  const hsdb2 = [
    mk('Irritation', [...hg.irritation, ...ag.irritation]),
    mk('Sensitization', [...hg.sensitization, ...ag.sensitization]),
    mk('Repeated Dose / Chronic', [...hg.repeatedDose, ...ag.repeatedDose]),
  ].filter(Boolean).join('\n\n');

  const hsdb3 = [
    mk('Genotoxicity / Mutagenicity', [...hg.genotoxicity, ...ag.genotoxicity]),
    mk('Carcinogenicity', [...hg.carcinogenicity, ...ag.carcinogenicity]),
    mk('Reproductive / Developmental', [...hg.reprotox, ...ag.reprotox]),
  ].filter(Boolean).join('\n\n');

  const otherRelevant = [...hg.other, ...ag.other].filter(it => {
    const l = it.text.substring(0, 200).toLowerCase();
    return l.includes('exposure') || l.includes('occupational') || l.includes('worker') || l.includes('epidemiolog');
  });
  const hsdb4 = [
    mk('Human Exposure Data', hg.humanData),
    otherRelevant.length ? `## HSDB — Other Occupational Data\n${serializeGroup(otherRelevant, 5)}` : '',
  ].filter(Boolean).join('\n\n');

  return { hsdb1, hsdb2, hsdb3, hsdb4, stats: { humanExcerpts: humanItems.length, nonHumanExcerpts: nonHumanItems.length, ...topicCounts } };
}
