// toxProfile.js
// génération de profils toxicologiques via PubChem + OpenRouter

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
      messages: [{ role: "user", content: prompt }]
    })
  });

  const data = await res.json();

  return data.choices?.[0]?.message?.content || "";
}

function extractJSON(text) {

  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");

  if (start === -1 || end === -1) return null;

  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

async function casToCID(cas) {

  const url =
    `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/${encodeURIComponent(cas)}/cids/JSON`;

  const r = await fetch(url);
  if (!r.ok) return null;

  const j = await r.json();
  return j?.IdentifierList?.CID?.[0] || null;
}

async function fetchCompound(cid) {

  const url =
    `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/${cid}/JSON`;

  const r = await fetch(url);
  if (!r.ok) return null;

  return r.text();
}

async function fetchHSDB(cid) {

  const url =
    `https://pubchem.ncbi.nlm.nih.gov/rest/pug_view/data/compound/${cid}/JSON`;

  const r = await fetch(url);
  if (!r.ok) return null;

  return r.text();
}

function makeSection(title, text) {

  const content = text?.trim() || "";

  return {
    title,
    content,
    available: content.length > 30
  };
}

function formatSections(p) {

  return {

    toxicokinetics: makeSection(
      "Toxicocinétique (ADME)",
      p.toxicokinetics
    ),

    acuteToxicity: makeSection(
      "Toxicité aiguë",
      p.acute_toxicity
    ),

    irritationCorrosion: makeSection(
      "Irritation / corrosion",
      p.irritation
    ),

    sensitization: makeSection(
      "Sensibilisation",
      p.sensitization
    ),

    repeatedDoseToxicity: makeSection(
      "Toxicité à doses répétées",
      p.repeated_dose
    ),

    genotoxicity: makeSection(
      "Génotoxicité",
      p.genotoxicity
    ),

    carcinogenicity: makeSection(
      "Cancérogénicité",
      p.carcinogenicity
    ),

    reproductiveToxicity: makeSection(
      "Toxicité pour la reproduction",
      p.reproductive_toxicity
    ),

    humanData: makeSection(
      "Données humaines / épidémiologie",
      p.human_data
    ),

    referenceValues: makeSection(
      "Valeurs toxicologiques de référence",
      p.reference_values
    )

  };
}

export async function generateToxProfile(substance, cas) {

  console.log("Fetching sources...");

  const cid = await casToCID(cas);

  if (!cid) {
    throw new Error("CID PubChem introuvable");
  }

  const [compoundRaw, hsdbRaw] = await Promise.all([
    fetchCompound(cid),
    fetchHSDB(cid)
  ]);

  console.log("Step 1: generating toxicological synthesis...");

  const prompt = `
Tu es un toxicologue.

Substance : ${substance}
CAS : ${cas}

À partir des données suivantes issues de PubChem/HSDB,
rédige un profil toxicologique synthétique.

Ne pas inventer d'information.

Retourner uniquement ce JSON :

{
"toxicokinetics":"",
"acute_toxicity":"",
"irritation":"",
"sensitization":"",
"repeated_dose":"",
"genotoxicity":"",
"carcinogenicity":"",
"reproductive_toxicity":"",
"human_data":"",
"reference_values":"",
"sources":[]
}

Sources :

PUBCHEM
${compoundRaw}

HSDB
${hsdbRaw}
`;

  const text = await callLLM(prompt);

  const json = extractJSON(text);

  if (!json) {
    throw new Error("Réponse LLM invalide");
  }

  const sections = formatSections(json);

  return {

    substanceName: substance,
    cas,
    cid,

    generatedAt: new Date().toISOString(),
    fromCache: false,

    sources: json.sources || [],

    dataQuality:
      "Profil généré automatiquement à partir de PubChem / HSDB.",

    sections
  };
}

export function getCacheStats() {

  return {
    enabled: false
  };
}
