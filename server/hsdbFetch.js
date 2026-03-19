// server/hsdbFetch.js
// Récupère les données HSDB complètes via l'API Annotations PubChem
// 
// L'API renvoie ~1000 annotations/page = 50-100MB de JSON.
// On ne peut pas charger ça en mémoire sur Render 512MB.
//
// Stratégie: streaming chunk par chunk via ReadableStream.
// On accumule un buffer glissant, on détecte notre CID,
// on extrait UNIQUEMENT le bloc JSON de notre annotation (~50KB),
// puis on arrête de lire et on libère tout.

const HSDB_SOURCE = 'Hazardous Substances Data Bank (HSDB)';
const BASE_URL = 'https://pubchem.ncbi.nlm.nih.gov/rest/pug_view/annotations/heading/JSON';

/**
 * Stream the response body and extract the annotation block for a specific CID.
 * Never loads the full response in memory — uses a sliding buffer.
 */
async function streamFindAnnotation(url, cidStr) {
  let res;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(90000) });
    if (!res.ok) {
      if (res.status === 404) return { data: null, totalPages: 0 };
      console.warn(`[HSDB] HTTP ${res.status}`);
      return { data: null, totalPages: 0 };
    }
  } catch (e) {
    console.warn(`[HSDB] Fetch failed: ${e.message}`);
    return { data: null, totalPages: 0 };
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();

  let buffer = '';
  let totalPages = 0;
  let foundAnnotation = null;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Extract TotalPages early (appears near start of JSON)
      if (totalPages === 0) {
        const tpMatch = buffer.match(/"TotalPages"\s*:\s*(\d+)/);
        if (tpMatch) totalPages = parseInt(tpMatch[1]);
      }

      // Check if our CID appears in the current buffer
      if (!buffer.includes(cidStr)) {
        // Keep only last 10KB as overlap for boundary cases
        if (buffer.length > 50000) {
          buffer = buffer.substring(buffer.length - 10000);
        }
        continue;
      }

      // CID found. Keep accumulating until we have enough context around it.
      const cidPos = buffer.indexOf(cidStr);
      const remainingAfterCid = buffer.length - cidPos;
      if (remainingAfterCid < 200000 && !done) {
        continue;
      }

      // Try to extract the annotation
      const extracted = tryExtractAnnotation(buffer, cidStr);
      if (extracted) {
        foundAnnotation = extracted;
        break;
      }

      // Trim buffer but keep context around CID
      if (buffer.length > 500000) {
        const keepFrom = Math.max(0, cidPos - 10000);
        buffer = buffer.substring(keepFrom);
      }
    }
  } catch (e) {
    if (e.name !== 'AbortError') {
      console.warn(`[HSDB] Stream error: ${e.message}`);
    }
  } finally {
    try { reader.cancel(); } catch {}
  }

  buffer = '';
  return { data: foundAnnotation, totalPages };
}

/**
 * Try to extract the annotation JSON object for our CID from a text buffer.
 */
function tryExtractAnnotation(text, cidStr) {
  const cidPattern = new RegExp(`"CID"\\s*:\\s*\\[([^\\]]{0,1000})\\]`, 'g');
  let match;

  while ((match = cidPattern.exec(text)) !== null) {
    const cids = match[1].split(',').map(s => s.trim());
    if (!cids.includes(cidStr)) continue;

    // Walk backwards to find the { that starts with "SourceName"
    const matchPos = match.index;
    let annotStart = -1;

    for (let i = matchPos; i >= Math.max(0, matchPos - 200000); i--) {
      if (text[i] === '{') {
        const ahead = text.substring(i, i + 50);
        if (ahead.includes('"SourceName"')) {
          annotStart = i;
          break;
        }
      }
    }

    if (annotStart === -1) continue;

    // Count braces to find the end
    let depth = 0;
    let annotEnd = -1;
    for (let i = annotStart; i < text.length; i++) {
      if (text[i] === '{') depth++;
      else if (text[i] === '}') {
        depth--;
        if (depth === 0) { annotEnd = i + 1; break; }
      }
    }

    if (annotEnd === -1) return null; // Need more data

    try {
      const annotation = JSON.parse(text.substring(annotStart, annotEnd));
      const linkedCids = annotation.LinkedRecords?.CID || [];
      if (linkedCids.includes(parseInt(cidStr)) || linkedCids.includes(cidStr)) {
        return annotation.Data || [];
      }
    } catch (e) {
      console.warn(`[HSDB] Parse failed: ${e.message}`);
    }
  }

  return null;
}

/**
 * Find HSDB annotation for a CID, scanning pages sequentially.
 */
async function findAnnotationForCid(heading, cid, maxPages = 6) {
  const cidStr = String(cid);

  for (let page = 1; page <= maxPages; page++) {
    const url = `${BASE_URL}?source=${encodeURIComponent(HSDB_SOURCE)}&heading_type=Compound&heading=${encodeURIComponent(heading)}&page=${page}`;

    console.log(`[HSDB] Scanning "${heading}" page ${page}...`);
    const { data, totalPages } = await streamFindAnnotation(url, cidStr);

    if (data) {
      console.log(`[HSDB] Found "${heading}" for CID ${cid} on page ${page} (${data.length} items)`);
      return data;
    }

    if (page >= totalPages && totalPages > 0) break;
  }

  console.log(`[HSDB] "${heading}" not found for CID ${cid}`);
  return null;
}

// ─── Data processing ──────────────────────────────────────────────────────────

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

function groupByTopic(items) {
  const g = {
    adme: [], acuteToxicity: [], irritation: [], sensitization: [],
    repeatedDose: [], genotoxicity: [], carcinogenicity: [],
    reprotox: [], humanData: [], other: [],
  };

  for (const item of items) {
    const t = item.tag.toLowerCase();
    const x = item.text.substring(0, 300).toLowerCase();

    if (t.includes('genotoxicity') || t.includes('mutagenicity') || t.includes('alternative and in vitro')) {
      g.genotoxicity.push(item);
    } else if (t.includes('developmental or reproductive') || t.includes('reproductive') || t.includes('teratogen')) {
      g.reprotox.push(item);
    } else if (t.includes('sensitization') || t.includes('immunotoxicity') || t.includes('allergic')) {
      g.sensitization.push(item);
    } else if (t.includes('irritation')) {
      g.irritation.push(item);
    } else if (t.includes('subchronic') || t.includes('prechronic') || t.includes('chronic exposure')) {
      g.repeatedDose.push(item);
    } else if (t.includes('acute exposure') || t.includes('acute hazard') || t.includes('signs and symptoms')) {
      g.acuteToxicity.push(item);
    } else if (t.includes('carcinogenicity') || t.includes('oncogenicity')) {
      g.carcinogenicity.push(item);
    } else if (t.includes('human exposure') || t.includes('epidemiolog')) {
      g.humanData.push(item);
    } else if (t.includes('absorption') || t.includes('metabolism') || t.includes('pharmacokinetic')) {
      g.adme.push(item);
    } else {
      if (x.includes('genotox') || x.includes('mutagen') || x.includes('ames test') || x.includes('micronucle') || x.includes('chromosom')) {
        g.genotoxicity.push(item);
      } else if (x.includes('reproduct') || x.includes('teratogen') || x.includes('fertility') || x.includes('embryo') || x.includes('fetal')) {
        g.reprotox.push(item);
      } else if (x.includes('sensitiz') || x.includes('allergic contact') || x.includes('asthma')) {
        g.sensitization.push(item);
      } else {
        g.other.push(item);
      }
    }
  }
  return g;
}

function serializeGroup(items, maxItems = 8, maxChars = 800) {
  return items.slice(0, maxItems).map(item => {
    const text = item.text.length > maxChars ? item.text.substring(0, maxChars) + '…' : item.text;
    return `- ${text}`;
  }).join('\n');
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function fetchHsdbComplete(cid) {
  console.log(`[HSDB] Fetching complete HSDB data for CID ${cid}...`);

  // Sequential to limit peak memory (NOT parallel)
  const humanData = await findAnnotationForCid('Human Toxicity Excerpts (Complete)', cid);
  const nonHumanData = await findAnnotationForCid('Non-Human Toxicity Excerpts (Complete)', cid);

  const humanItems = extractHsdbItems(humanData);
  const nonHumanItems = extractHsdbItems(nonHumanData);

  console.log(`[HSDB] Human: ${humanItems.length} items, Non-human: ${nonHumanItems.length} items`);

  const hg = groupByTopic(humanItems);
  const ag = groupByTopic(nonHumanItems);

  const tc = {};
  for (const k of Object.keys(hg)) tc[k] = (hg[k]?.length || 0) + (ag[k]?.length || 0);
  console.log(`[HSDB] Topics: ${Object.entries(tc).filter(([,v]) => v > 0).map(([k,v]) => `${k}=${v}`).join(', ')}`);

  const mk = (label, items) => items.length ? `## HSDB — ${label}\n${serializeGroup(items)}` : '';

  const hsdb1 = [mk('ADME (human)', hg.adme), mk('ADME (animal)', ag.adme), mk('Acute Toxicity (human)', hg.acuteToxicity), mk('Acute Toxicity (animal)', ag.acuteToxicity)].filter(Boolean).join('\n\n');
  const hsdb2 = [mk('Irritation', [...hg.irritation, ...ag.irritation]), mk('Sensitization', [...hg.sensitization, ...ag.sensitization]), mk('Repeated Dose / Chronic', [...hg.repeatedDose, ...ag.repeatedDose])].filter(Boolean).join('\n\n');
  const hsdb3 = [mk('Genotoxicity / Mutagenicity', [...hg.genotoxicity, ...ag.genotoxicity]), mk('Carcinogenicity', [...hg.carcinogenicity, ...ag.carcinogenicity]), mk('Reproductive / Developmental', [...hg.reprotox, ...ag.reprotox])].filter(Boolean).join('\n\n');
  const otherRel = [...hg.other, ...ag.other].filter(it => { const l = it.text.substring(0, 200).toLowerCase(); return l.includes('exposure') || l.includes('occupational') || l.includes('worker') || l.includes('epidemiolog'); });
  const hsdb4 = [mk('Human Exposure Data', hg.humanData), otherRel.length ? `## HSDB — Other Data\n${serializeGroup(otherRel, 5)}` : ''].filter(Boolean).join('\n\n');

  return { hsdb1, hsdb2, hsdb3, hsdb4, stats: { humanExcerpts: humanItems.length, nonHumanExcerpts: nonHumanItems.length, ...tc } };
}
