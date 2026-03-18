// api/_lib/shared.js — Shared utilities for all Vercel API routes
import { createClient } from '@libsql/client';

// ─── Turso clients (singleton per cold start) ─────────────────────────────────
let _classDb = null;
let _vtrDb = null;

export function getClassDb() {
  if (!_classDb) {
    _classDb = createClient({
      url: process.env.TURSO_CLASSIFICATIONS_URL,
      authToken: process.env.TURSO_CLASSIFICATIONS_TOKEN,
    });
  }
  return _classDb;
}

export function getVtrDb() {
  if (!_vtrDb) {
    _vtrDb = createClient({
      url: process.env.TURSO_VTR_URL,
      authToken: process.env.TURSO_VTR_TOKEN,
    });
  }
  return _vtrDb;
}

// ─── CAS normalization ────────────────────────────────────────────────────────
export function normalizeCas(raw) {
  if (!raw) return '';
  let s = String(raw).trim().replace(/\s/g, '').replace(/CAS|cas|№|No\./g, '');
  const m = s.match(/(\d{2,7}-\d{2}-\d)/);
  return m ? m[1] : s;
}

export function extractCasList(raw) {
  if (!raw) return [];
  let text = String(raw).replace(/CAS[: ]*/gi, '');
  return text.split(/[;,/]|\\n/).map(normalizeCas).filter(Boolean);
}

export function isClassified(val) {
  if (val == null) return false;
  if (typeof val === 'number') return true;
  const s = String(val).trim().toLowerCase();
  if (!s || s === '-' || s === 'nc') return false;
  const neg = ['not classified', 'not applicable', 'classification not possible', 'no data available'];
  for (const n of neg) { if (s.startsWith(n)) return false; }
  if (s.startsWith('no ')) return false;
  return true;
}

// ─── Classification source config ─────────────────────────────────────────────
export const FLAT_OPTIONS = [
  { label: 'CLP', value: 'CLP', group: 'GHS' },
  { label: 'CLP Notifications', value: 'CLP_Notifications', group: 'GHS' },
  { label: 'GHS Japan', value: 'GHS_Japan', group: 'GHS' },
  { label: 'GHS Australia', value: 'GHS_Australia', group: 'GHS' },
  { label: 'GHS Korea', value: 'GHS_Korea', group: 'GHS' },
  { label: 'GHS China', value: 'GHS_China', group: 'GHS' },
  { label: 'SIMDUT 2015', value: 'SIMDUT_2015', group: 'GHS' },
  { label: 'GHS Taiwan', value: 'GHS_Taiwan', group: 'GHS' },
  { label: 'GHS Malaysia', value: 'GHS_Malaysia', group: 'GHS' },
  { label: 'IARC/CIRC', value: 'IARC', group: 'Cancérogénicité' },
  { label: 'ACGIH', value: 'ACGIH', group: 'Cancérogénicité' },
  { label: 'USEPA Carcinogens', value: 'USEPA_Carcinogens', group: 'Cancérogénicité' },
  { label: 'MAK Carcinogens', value: 'MAK_Carcinogens', group: 'Cancérogénicité' },
  { label: 'NTP Carcinogens', value: 'NTP_Carcinogens', group: 'Cancérogénicité' },
  { label: 'OEHHA', value: 'OEHHA', group: 'Cancérogénicité' },
  { label: 'BKH-DHI', value: 'BKH_DHI', group: 'Perturbateurs endocriniens' },
  { label: 'DEDuCT', value: 'DEDuCT', group: 'Perturbateurs endocriniens' },
  { label: 'EU EDlists', value: 'EU_EDlists', group: 'Perturbateurs endocriniens' },
  { label: 'USEPA ED', value: 'USEPA_ED', group: 'Perturbateurs endocriniens' },
  { label: 'SINList', value: 'SINList', group: 'Perturbateurs endocriniens' },
  { label: 'TEDX', value: 'TEDX', group: 'Perturbateurs endocriniens' },
  { label: 'AOEC Asthmagens', value: 'AOEC_Asthmagens', group: 'Autres' },
  { label: 'FEMA', value: 'FEMA', group: 'Autres' },
  { label: 'HAZMAP', value: 'HAZMAP', group: 'Autres' },
  { label: 'MAK Allergens', value: 'MAK_Allergens', group: 'Autres' },
  { label: 'HPHC', value: 'HPHC', group: 'Autres' },
  { label: 'ATSDR Hazards', value: 'ATSDR_Hazards', group: 'Autres' },
];

export const VALID_TABLES = new Set(FLAT_OPTIONS.map(o => o.value));

export const CMR_COLUMNS = {
  'Carcinogenicity': 'carcinogen',
  'Germ cell mutagenicity': 'mutagen',
  'Reproductive toxicity': 'reprotoxic',
};

export const EXCLUDED_COLUMNS = {
  BKH_DHI: ['Substance Name'], DEDuCT: ['Substance name'], IARC: ['Agent'],
  MAK_Allergens: ['Substance name'], MAK_Carcinogens: ['Substance name'],
  NTP_Carcinogens: ['NAME OR SYNONYM'], SINList: ['EC Number', 'Name', 'Synonyms'],
  TEDX: ['Chemical name'], USEPA_Carcinogens: ['CAS RN', 'Substance name'],
  EU_EDlists: ['Substance Name'], USEPA_PE: ['Chemical Name'],
  ACGIH: ['Substance'], OEHHA: ['Name'], AOEC_Asthmagens: ['Primary Name'],
  CLP_Notifications: ['EC'],
};

export const SPECIAL_CARCINOGENICITY = {
  IARC: (r) => r.Group && !['', '3'].includes(String(r.Group).trim()),
  USEPA_Carcinogens: (r) => {
    const w = String(r['WOE DESCRIPTION'] || '').trim();
    const neg = ['D (Not classifiable', 'Carcinogenic potential cannot', 'Data are inadequate', 'Not likely', ''];
    return w && !neg.some(n => w.startsWith(n));
  },
  NTP_Carcinogens: (r) => {
    const c = String(r['Rationale and comments'] || '');
    return ['known to be a human carcinogen', 'reasonably be anticipated', 'carcinogenicity'].some(p => c.includes(p));
  },
  MAK_Carcinogens: (r) => r['Carc.'] && !['', '5'].includes(String(r['Carc.']).trim()),
};

// ─── Query helpers using cas_lookup + name_lookup tables ──────────────────────
// These tables are pre-built by scripts/build-turso-indexes.js
// cas_lookup: (cas TEXT, table_name TEXT, row_id INTEGER) — indexed on cas
// name_lookup: (cas TEXT PK, name TEXT) — indexed on name

/**
 * Find rows in a specific table for a CAS number.
 * Uses cas_lookup for O(1) indexed lookup, then fetches by rowid.
 */
export async function findRowsByCas(db, table, cas) {
  if (!VALID_TABLES.has(table)) return [];
  try {
    const lookup = await db.execute({
      sql: 'SELECT row_id FROM cas_lookup WHERE cas = ? AND table_name = ?',
      args: [cas, table],
    });
    if (lookup.rows.length === 0) return [];

    const rowids = lookup.rows.map(r => r.row_id);
    const placeholders = rowids.map(() => '?').join(',');
    const result = await db.execute({
      sql: `SELECT rowid, * FROM "${table}" WHERE rowid IN (${placeholders})`,
      args: rowids,
    });
    return result.rows;
  } catch (e) {
    return [];
  }
}

/**
 * Get substance name — single CAS, exact match on name_lookup.
 */
export async function getSubstanceName(db, cas) {
  try {
    const result = await db.execute({
      sql: 'SELECT name FROM name_lookup WHERE cas = ?',
      args: [cas],
    });
    if (result.rows.length > 0) return result.rows[0].name;
  } catch (e) {}
  return null;
}

/**
 * Batch get substance names for multiple CAS numbers in one query.
 */
export async function getSubstanceNames(db, casList) {
  if (!casList.length) return new Map();
  try {
    const placeholders = casList.map(() => '?').join(',');
    const result = await db.execute({
      sql: `SELECT cas, name FROM name_lookup WHERE cas IN (${placeholders})`,
      args: casList,
    });
    const map = new Map();
    for (const row of result.rows) map.set(row.cas, row.name);
    return map;
  } catch (e) {
    return new Map();
  }
}

/**
 * Batch get all cas_lookup entries for multiple CAS numbers.
 * Returns Map<cas, [{ table_name, row_id }, ...]>
 */
export async function batchGetCasLookup(db, casList) {
  if (!casList.length) return new Map();
  try {
    const placeholders = casList.map(() => '?').join(',');
    const result = await db.execute({
      sql: `SELECT cas, table_name, row_id FROM cas_lookup WHERE cas IN (${placeholders})`,
      args: casList,
    });
    const map = new Map();
    for (const row of result.rows) {
      if (!map.has(row.cas)) map.set(row.cas, []);
      map.get(row.cas).push({ table_name: row.table_name, row_id: row.row_id });
    }
    return map;
  } catch (e) {
    return new Map();
  }
}

/**
 * Process a row to extract CMR, PE_Sens, and details for a given table.
 */
export function processRow(table, row) {
  const cmr = {};
  const peSens = {};
  const details = {};
  const excluded = new Set(EXCLUDED_COLUMNS[table] || []);

  for (const [col, key] of Object.entries(CMR_COLUMNS)) {
    if (row[col] !== undefined && isClassified(row[col])) cmr[key] = true;
  }

  if (SPECIAL_CARCINOGENICITY[table]) {
    try { if (SPECIAL_CARCINOGENICITY[table](row)) cmr.carcinogen = true; } catch (e) {}
  }

  if (table === 'BKH_DHI' && ['CAT1', 'CAT2'].includes(row.Category)) peSens.ed = true;
  if (table === 'DEDuCT' && ['I', 'II', 'III', 'IV'].includes(row.Category)) peSens.ed = true;
  if (table === 'EU_EDlists' && ['List I', 'List II', 'List III'].includes(row.List)) peSens.ed = true;
  if (table === 'SINList' && String(row['Health and environmental concern'] || '').toLowerCase().includes('endocrine disruptor')) peSens.ed = true;
  if (table === 'TEDX') peSens.ed = true;
  if (table === 'USEPA_ED') {
    const l = String(row.Liste || '').trim();
    if (!['Liste 1 (No evidence)', 'Liste 2'].includes(l)) peSens.ed = true;
  }

  const ghsTables = ['CLP', 'GHS_Japan', 'GHS_Korea', 'GHS_Australia', 'GHS_China'];
  if (ghsTables.includes(table)) {
    if (isClassified(row['Respiratory sensitization'])) peSens.resp_sens = true;
    if (isClassified(row['Skin sensitization'])) peSens.skin_sens = true;
  }
  if (table === 'MAK_Allergens') {
    if (['(Sah)', '(Sa)'].includes(row.Designation)) peSens.resp_sens = true;
    if (['(Sah)', '(Sh)'].includes(row.Designation)) peSens.skin_sens = true;
  }

  for (const col of Object.keys(row)) {
    if (col === 'CAS' || col === 'Substance Name' || col === 'rowid' || excluded.has(col)) continue;
    if (isClassified(row[col])) details[col] = row[col];
  }

  return { cmr, peSens, details };
}

// ─── CORS helper ──────────────────────────────────────────────────────────────
export function handleCors(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return true;
  }
  return false;
}
