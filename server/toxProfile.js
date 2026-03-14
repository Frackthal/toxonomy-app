
/*
toxProfile.js
Optimized toxicological profile generator

Key improvements:
1. Uses OpenRouter (single API endpoint for multiple models)
2. 2‑step LLM pipeline:
      - Step 1: extract structured notes from sources
      - Step 2: generate final toxicological profile
3. HSDB filtering to reduce prompt size
4. Parallel source retrieval
5. Robust JSON parsing + retry logic

Environment variables:
OPENROUTER_API_KEY=...
OPENROUTER_MODEL=openrouter/hunter-alpha
OPENROUTER_FALLBACK_MODELS=google/gemini-3-flash-preview,openrouter/free
OPENROUTER_SITE_URL=http://localhost:3000
OPENROUTER_APP_NAME=Toxonomy
*/

import fetch from "node-fetch";

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
------------------------------*/

function extractJSON(text) {
  if (!text) return null;

  const clean = text
    .replace(/^```json/i, "")
    .replace(/^```/, "")
    .replace(/```$/, "")
    .trim();

  const first = clean.indexOf("{");
  const last = clean.lastIndexOf("}");

  if (first === -1 || last === -1) return null;

  try {
    return JSON.parse(clean.slice(first, last + 1));
  } catch {
    return null;
  }
}


/* -----------------------------
   OpenRouter call
------------------------------*/

async function callLLM(prompt, modelList = []) {

  const models = [OPENROUTER_MODEL, ...modelList, ...OPENROUTER_FALLBACK_MODELS];

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
          messages: [
            {
              role: "user",
              content: prompt
            }
          ],
          response_format: { type: "json_object" }
        })
      });

      if (!res.ok) {
        const txt = await res.text();
        console.error("OpenRouter error:", txt.slice(0,200));
        continue;
      }

      const data = await res.json();
      const text = data?.choices?.[0]?.message?.content;

      const json = extractJSON(text);

      if (json) {
        json._model = model;
        return json;
      }

    } catch (err) {
      console.error("LLM error:", err.message);
    }
  }

  throw new Error("All LLM models failed");
}



/* -----------------------------
   HSDB filtering
------------------------------*/

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
  "human"
];

function filterHSDB(text) {

  if (!text) return "";

  const paragraphs = text.split(/\n\s*\n/);

  const kept = paragraphs.filter(p => {

    const lower = p.toLowerCase();

    return HSDB_KEYWORDS.some(k => lower.includes(k));
  });

  return kept.join("\n\n").slice(0, 20000); // safety cap
}



/* -----------------------------
   Source retrieval
------------------------------*/

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
   Prompt builders
------------------------------*/

function buildExtractionPrompt(substance, pubchem, hsdb) {

return `
You are a toxicologist.

Extract structured toxicological notes for the substance ${substance}.

Use the sources below.

Return JSON with concise bullet notes.

{
"toxicokinetics":[],
"acute_toxicity":[],
"irritation":[],
"sensitization":[],
"repeated_dose":[],
"genotoxicity":[],
"carcinogenicity":[],
"reproductive_toxicity":[],
"human_data":[],
"reference_values":[]
}

Sources:

PUBCHEM
${pubchem}

HSDB
${hsdb}
`;

}


function buildSynthesisPrompt(substance, notes) {

return `
You are a regulatory toxicologist.

Using the structured notes below, generate a toxicological profile similar to an ECHA toxicological summary.

Substance: ${substance}

Return JSON with structured paragraphs.

{
"toxicokinetics":"",
"acute_toxicity":"",
"irritation_corrosion":"",
"sensitization":"",
"repeated_dose_toxicity":"",
"genotoxicity":"",
"carcinogenicity":"",
"reproductive_toxicity":"",
"human_data":"",
"reference_values":""
}

Notes:
${JSON.stringify(notes)}
`;

}



/* -----------------------------
   Main pipeline
------------------------------*/

export async function generateToxicologicalProfile(substance, cas) {

  if (!OPENROUTER_API_KEY) {
    throw new Error("OPENROUTER_API_KEY missing");
  }

  console.log("Fetching sources...");

  const [pubchemRaw, hsdbRaw] = await Promise.all([
    fetchPubChem(cas),
    fetchHSDB(cas)
  ]);

  const hsdbFiltered = filterHSDB(hsdbRaw);

  console.log("Step 1: extracting structured notes...");

  const notes = await callLLM(
    buildExtractionPrompt(substance, pubchemRaw, hsdbFiltered)
  );

  console.log("Step 2: generating final profile...");

  const profile = await callLLM(
    buildSynthesisPrompt(substance, notes)
  );

  return {
    substance,
    cas,
    model: profile._model,
    generated_at: new Date().toISOString(),
    profile
  };
}



/* -----------------------------
   CLI test
------------------------------*/

if (import.meta.url === `file://${process.argv[1]}`) {

  const substance = process.argv[2] || "Benzene";
  const cas = process.argv[3] || "71-43-2";

  generateToxicologicalProfile(substance, cas)
    .then(r => console.log(JSON.stringify(r,null,2)))
    .catch(e => console.error(e));

}
