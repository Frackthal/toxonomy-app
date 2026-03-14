// toxProfile.js
// génération de profils toxicologiques via PubChem + OpenRouter
// version corrigée : résolution CAS -> CID plus robuste

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const MODEL = process.env.OPENROUTER_MODEL || "openrouter/hunter-alpha";
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

async function callLLM(prompt) {
  const res = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0.2,
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" }
    })
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`OpenRouter error ${res.status}: ${txt.slice(0, 300)}`);
  }

  const data = await res.json();
  return data?.choices?.[0]?.message?.content || "";
}

function extractJSON(text) {
  const clean = String(text || "")
    .replace(/^```json/i, "")
    .replace(/^```/, "")
    .replace(/```$/, "")
    .trim();

  const start = clean.indexOf("{");
  const end = clean.lastIndexOf("}");

  if (start === -1 || end === -1 || end <= start) return null;

  try {
    return JSON.parse(clean.slice(start, end + 1));
  } catch {
    return null;
  }
}

async function casToCID(cas) {
  const urls = [
    `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/xref/RN/${encodeURIComponent(cas)}/cids/JSON`,
    `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/${encodeURIComponent(cas)}/cids/JSON`
  ];

  for (const url of urls) {
    try {
      const r = await fetch(url);
      if (!r.ok) continue;

      const j = await r.json();
      const cid = j?.IdentifierList?.CID?.[0];

      if (cid) return cid;
    } catch (e) {
      console.error("casToCID error:", e.message);
    }
  }

  throw new Error(`CID PubChem introuvable pour ${cas}`);
}

async function fetchCompound(cid) {
  const url = `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/${cid}/JSON`;
  const r = await fetch(url);
  if (!r.ok) return null;
  return r.text();
}

async function fetchHSDB(cid) {
  const urls = [
    `https://pubchem.ncbi.nlm.nih.gov/rest/pug_view/data/compound/${cid}/JSON?heading=${encodeURIComponent("Hazardous Substances Data Bank (HSDB)")}`,
    `https://pubchem.ncbi.nlm.nih.gov/rest/pug_view/data/compound/${cid}/JSON?heading=HSDB`,
    `https://pubchem.ncbi.nlm.nih.gov/rest/pug_view/data/compound/${cid}/JSON`
  ];

  for (const url of urls) {
    try {
      const r = await fetch(url);
      if (!r.ok) continue;
      return await r.text();
    } catch (e) {
      console.error("fetchHSDB error:", e.message);
    }
  }

  return null;
}

function parseCompoundMetadata(compoundRaw, fallbackName, fallbackCas, cid) {
  const meta = {
    substanceName: fallbackName || fallbackCas || "Substance inconnue",
    cas: fallbackCas || "",
    cid: cid || null,
    formula: null,
    molecularWeight: null
  };

  if (!compoundRaw) return meta;

  try {
    const data = JSON.parse(compoundRaw);
    const compound = data?.PC_Compounds?.[0];
    const props = compound?.props || [];

    for (const prop of props) {
      const label = prop?.urn?.label || "";
      const sval = prop?.value?.sval;
      const fval = prop?.value?.fval;

      if (!meta.formula && label === "Molecular Formula" && sval) {
        meta.formula = sval;
      }

      if (!meta.molecularWeight && label === "Molecular Weight" && typeof fval === "number") {
        meta.molecularWeight = fval;
      }
    }
  } catch (e) {
    console.error("parseCompoundMetadata error:", e.message);
  }

  return meta;
}

function makeSection(title, text) {
  const content = typeof text === "string" ? text.trim() : "";
  return {
    title,
    content,
    available: content.length > 30
  };
}

function formatSections(p) {
  return {
    toxicokinetics: makeSection("Toxicocinétique (ADME)", p?.toxicokinetics),
    acuteToxicity: makeSection("Toxicité aiguë", p?.acute_toxicity),
    irritationCorrosion: makeSection("Irritation / corrosion", p?.irritation),
    sensitization: makeSection("Sensibilisation", p?.sensitization),
    repeatedDoseToxicity: makeSection("Toxicité à doses répétées", p?.repeated_dose),
    genotoxicity: makeSection("Génotoxicité", p?.genotoxicity),
    carcinogenicity: makeSection("Cancérogénicité", p?.carcinogenicity),
    reproductiveToxicity: makeSection("Toxicité pour la reproduction", p?.reproductive_toxicity),
    humanData: makeSection("Données humaines / épidémiologie", p?.human_data),
    referenceValues: makeSection("Valeurs toxicologiques de référence", p?.reference_values)
  };
}

function dedupeArray(arr) {
  return [...new Set((arr || []).filter(Boolean).map(x => String(x).trim()).filter(Boolean))];
}

export async function generateToxProfile(substance, cas) {
  if (!OPENROUTER_API_KEY) {
    throw new Error("OPENROUTER_API_KEY manquante");
  }

  console.log("Fetching sources...");

  const cid = await casToCID(cas);
  console.log("Resolved CID:", cid);

  const [compoundRaw, hsdbRaw] = await Promise.all([
    fetchCompound(cid),
    fetchHSDB(cid)
  ]);

  const meta = parseCompoundMetadata(compoundRaw, substance, cas, cid);

  console.log("Step 1: generating toxicological synthesis...");

  const prompt = `
Tu es un toxicologue réglementaire.

Substance : ${meta.substanceName}
CAS : ${meta.cas}
CID PubChem : ${meta.cid}

À partir des données suivantes issues de PubChem et HSDB, rédige un profil toxicologique synthétique en français.
N'invente aucune information. Si une section n'est pas documentée, laisse une chaîne vide.
Sois factuel et prudent.

Retourne uniquement un objet JSON avec cette structure exacte :

{
  "toxicokinetics": "",
  "acute_toxicity": "",
  "irritation": "",
  "sensitization": "",
  "repeated_dose": "",
  "genotoxicity": "",
  "carcinogenicity": "",
  "reproductive_toxicity": "",
  "human_data": "",
  "reference_values": "",
  "sources": [],
  "data_quality": ""
}

Règles :
- "sources" doit contenir une courte liste de labels de sources, par exemple ["PubChem", "HSDB"].
- "data_quality" doit être une phrase courte en français sur la complétude globale des données.

Sources :

PUBCHEM
${compoundRaw || ""}

HSDB
${hsdbRaw || ""}
`;

  const text = await callLLM(prompt);
  const json = extractJSON(text);

  if (!json) {
    throw new Error("Réponse LLM invalide");
  }

  const sections = formatSections(json);

  return {
    substanceName: meta.substanceName,
    cas: meta.cas,
    formula: meta.formula,
    molecularWeight: meta.molecularWeight,
    cid: meta.cid,
    generatedAt: new Date().toISOString(),
    fromCache: false,
    sources: dedupeArray(json.sources),
    dataQuality: json.data_quality || "Profil généré automatiquement à partir de PubChem / HSDB.",
    modelUsed: MODEL,
    sections
  };
}

export function getCacheStats() {
  return {
    enabled: false,
    entries: 0
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const substance = process.argv[2] || "Formaldehyde";
  const cas = process.argv[3] || "50-00-0";

  generateToxProfile(substance, cas)
    .then((r) => console.log(JSON.stringify(r, null, 2)))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
