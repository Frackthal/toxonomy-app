/*
toxProfile.js
OpenRouter-based toxicological profile generator
Compatible with the existing ToxProfilePage.jsx frontend.
*/

// Node 18+ has native fetch, no need for node-fetch import

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || "";
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || "openrouter/hunter-alpha";
const OPENROUTER_FALLBACK_MODELS = (process.env.OPENROUTER_FALLBACK_MODELS || "")
  .split(",")
  .map(m => m.trim())
  .filter(Boolean);

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const SITE_URL = process.env.OPENROUTER_SITE_URL || "http://localhost";
const APP_NAME = process.env.OPENROUTER_APP_NAME || "Toxonomy";

/* -----------------------------
   Utility: JSON extraction
------------------------------ */

function extractJSON(text) {
  if (!text) return null;

  const clean = String(text)
    .replace(/^```json/i, "")
    .replace(/^```/, "")
    .replace(/```$/, "")
    .trim();

  const first = clean.indexOf("{");
  const last = clean.lastIndexOf("}");

  if (first === -1 || last === -1 || last <= first) return null;

  try {
    return JSON.parse(clean.slice(first, last + 1));
  } catch {
    return null;
  }
}

function uniqueArray(items) {
  return [...new Set((items || []).filter(Boolean).map(x => String(x).trim()).filter(Boolean))];
}

/* -----------------------------
   OpenRouter call
------------------------------ */

async function callLLM(prompt, modelList = []) {
  const models = uniqueArray([OPENROUTER_MODEL, ...modelList, ...OPENROUTER_FALLBACK_MODELS]);

  for (const model of models) {
    try {
      const res = await fetch(OPENROUTER_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${OPENROUTER_API_KEY}`,
          "Content-Type": "application/json",
          "HTTP-Referer": SITE_URL,
          "X-OpenRouter-Title": APP_NAME
        },
        body: JSON.stringify({
          model,
          temperature: 0.1,
          messages: [{ role: "user", content: prompt }],
          response_format: { type: "json_object" }
        })
      });

      if (!res.ok) {
        const txt = await res.text();
        console.error(`OpenRouter error with ${model}:`, txt.slice(0, 300));
        continue;
      }

      const data = await res.json();
      const text = data?.choices?.[0]?.message?.content;
      const json = extractJSON(text);

      if (json) {
        json._model = model;
        return json;
      }

      console.error(`No valid JSON returned by ${model}`);
    } catch (err) {
      console.error(`LLM error with ${model}:`, err.message);
    }
  }

  throw new Error("All LLM models failed");
}

/* -----------------------------
   HSDB filtering
------------------------------ */

const HSDB_KEYWORDS = [
  "toxic",
  "acute",
  "inhal",
  "oral",
  "dermal",
  "irrit",
  "sensit",
  "mutag",
  "genotox",
  "carcin",
  "tumor",
  "repro",
  "fertil",
  "development",
  "adme",
  "metabol",
  "absorp",
  "human",
  "epidemi",
  "reference value",
  "tdi",
  "adi",
  "dnel",
  "rfc",
  "rfd"
];

function filterHSDB(text) {
  if (!text) return "";

  const paragraphs = String(text).split(/\n\s*\n/);

  const kept = paragraphs.filter((p) => {
    const lower = p.toLowerCase();
    return HSDB_KEYWORDS.some((k) => lower.includes(k));
  });

  return kept.join("\n\n").slice(0, 30000);
}

/* -----------------------------
   Source retrieval
------------------------------ */

async function fetchPubChem(cas) {
  const url = `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/${encodeURIComponent(cas)}/JSON`;
  const res = await fetch(url);
  if (!res.ok) return null;
  return res.text();
}

async function fetchHSDB(cas) {
  const url = `https://pubchem.ncbi.nlm.nih.gov/rest/pug_view/data/compound/${encodeURIComponent(cas)}/JSON?heading=HSDB`;
  const res = await fetch(url);
  if (!res.ok) return null;
  return res.text();
}

/* -----------------------------
   Metadata parsing
------------------------------ */

function parsePubChemMetadata(pubchemRaw, fallbackCas, fallbackName) {
  const meta = {
    substanceName: fallbackName || fallbackCas || "Unknown substance",
    cas: fallbackCas || "",
    cid: null,
    formula: null,
    molecularWeight: null
  };

  if (!pubchemRaw) return meta;

  try {
    const data = JSON.parse(pubchemRaw);
    const compound = data?.PC_Compounds?.[0];

    const cid = compound?.id?.id?.cid;
    if (cid) meta.cid = cid;

    const props = compound?.props || [];

    for (const prop of props) {
      const label = prop?.urn?.label || "";
      const name = prop?.urn?.name || "";
      const sval = prop?.value?.sval;
      const fval = prop?.value?.fval;

      if (!meta.formula && label === "Molecular Formula" && sval) {
        meta.formula = sval;
      }

      if (!meta.molecularWeight && label === "Molecular Weight" && typeof fval === "number") {
        meta.molecularWeight = fval;
      }

      if (!meta.substanceName && label === "IUPAC Name" && sval) {
        meta.substanceName = sval;
      }

      if (!meta.substanceName && label === "Title" && sval) {
        meta.substanceName = sval;
      }

      if (!meta.substanceName && label === "Synonym" && name === "Depositor-Supplied" && sval) {
        meta.substanceName = sval;
      }
    }
  } catch (e) {
    console.error("PubChem metadata parse error:", e.message);
  }

  return meta;
}

/* -----------------------------
   Prompt builders
------------------------------ */

function buildExtractionPrompt(substance, pubchem, hsdb) {
  return `
You are a toxicologist.

Extract structured toxicological notes for the substance ${substance}.

Use the source text below.
Do not invent information.
If no relevant information is found for a section, return an empty array.

Return ONLY a JSON object with this exact structure:

{
  "toxicokinetics": [],
  "acute_toxicity": [],
  "irritation": [],
  "sensitization": [],
  "repeated_dose": [],
  "genotoxicity": [],
  "carcinogenicity": [],
  "reproductive_toxicity": [],
  "human_data": [],
  "reference_values": [],
  "sources": [],
  "data_quality": ""
}

Rules:
- Each endpoint array must contain short bullet-like strings, not paragraphs.
- "sources" must contain short source labels only, for example "PubChem", "HSDB", "PubChem HSDB".
- "data_quality" must be one concise sentence in French about the overall completeness of the available data.

Sources:

PUBCHEM
${pubchem || ""}

HSDB
${hsdb || ""}
`;
}

function buildSynthesisPrompt(substance, notes) {
  return `
You are a regulatory toxicologist.

Using the structured notes below, generate a concise toxicological profile similar to an ECHA-style summary.

Substance: ${substance}

Return ONLY a JSON object with this exact structure:

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

Rules:
- Write in French.
- Be factual and conservative.
- Do not invent data.
- If information is missing for a section, return an empty string for that section.
- "sources" should be a deduplicated list of short source labels.
- "data_quality" should be one concise sentence in French.

Structured notes:
${JSON.stringify(notes)}
`;
}

/* -----------------------------
   Front compatibility mapping
------------------------------ */

function formatSections(llmProfile) {
  const make = (title, content) => {
    const text = typeof content === "string" ? content.trim() : "";
    return {
      title,
      content: text,
      available: text.length > 20
    };
  };

  return {
    toxicokinetics: make("Toxicocinétique (ADME)", llmProfile?.toxicokinetics),
    acuteToxicity: make("Toxicité aiguë", llmProfile?.acute_toxicity),
    irritationCorrosion: make("Irritation / corrosion", llmProfile?.irritation),
    sensitization: make("Sensibilisation", llmProfile?.sensitization),
    repeatedDoseToxicity: make("Toxicité à doses répétées", llmProfile?.repeated_dose),
    genotoxicity: make("Génotoxicité", llmProfile?.genotoxicity),
    carcinogenicity: make("Cancérogénicité", llmProfile?.carcinogenicity),
    reproductiveToxicity: make("Toxicité pour la reproduction", llmProfile?.reproductive_toxicity),
    humanData: make("Données humaines / épidémiologie", llmProfile?.human_data),
    referenceValues: make("Valeurs toxicologiques de référence", llmProfile?.reference_values)
  };
}

/* -----------------------------
   Main pipeline
------------------------------ */

export async function generateToxProfile(substance, cas) {
  if (!OPENROUTER_API_KEY) {
    throw new Error("OPENROUTER_API_KEY missing");
  }

  console.log("Fetching sources...");

  const [pubchemRaw, hsdbRaw] = await Promise.all([
    fetchPubChem(cas),
    fetchHSDB(cas)
  ]);

  const metadata = parsePubChemMetadata(pubchemRaw, cas, substance || cas);
  const hsdbFiltered = filterHSDB(hsdbRaw);

  console.log("Step 1: extracting structured notes...");

  const notes = await callLLM(
    buildExtractionPrompt(metadata.substanceName || substance || cas, pubchemRaw || "", hsdbFiltered || "")
  );

  console.log("Step 2: generating final profile...");

  const llmProfile = await callLLM(
    buildSynthesisPrompt(metadata.substanceName || substance || cas, notes),
    []
  );

  const sections = formatSections(llmProfile);
  const availableCount = Object.values(sections).filter(s => s.available).length;
  const sources = uniqueArray([...(notes?.sources || []), ...(llmProfile?.sources || [])]);

  return {
    substanceName: metadata.substanceName || substance || cas,
    cas: metadata.cas || cas,
    formula: metadata.formula || null,
    molecularWeight: metadata.molecularWeight || null,
    cid: metadata.cid || null,
    generatedAt: new Date().toISOString(),
    fromCache: false,
    dataQuality: llmProfile?.data_quality || notes?.data_quality || `Profil généré automatiquement. ${availableCount}/10 sections contiennent des informations exploitables.`,
    sources,
    modelUsed: llmProfile?._model || notes?._model || OPENROUTER_MODEL,
    sections
  };
}

/* -----------------------------
   Cache stats (compatibility)
------------------------------ */

export function getCacheStats() {
  return {
    enabled: false,
    entries: 0
  };
}

/* -----------------------------
   CLI test
------------------------------ */

if (import.meta.url === `file://${process.argv[1]}`) {
  const substance = process.argv[2] || "Benzene";
  const cas = process.argv[3] || "71-43-2";

  generateToxProfile(substance, cas)
    .then((r) => console.log(JSON.stringify(r, null, 2)))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
