// server/index.js — Toxonomy Backend (Node.js + Express + Turso)
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';
import ExcelJS from 'exceljs';
import { createClient } from '@libsql/client';
import { generateToxProfile, getCacheStats } from './toxProfile.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 5000;

// ─── Turso clients ────────────────────────────────────────────────────────────
const classDb = createClient({
  url: process.env.TURSO_CLASSIFICATIONS_URL,
  authToken: process.env.TURSO_CLASSIFICATIONS_TOKEN,
});
const vtrDb = createClient({
  url: process.env.TURSO_VTR_URL,
  authToken: process.env.TURSO_VTR_TOKEN,
});

// ─── CAS normalization ────────────────────────────────────────────────────────
function normalizeCas(raw) {
  if (!raw) return '';
  let s = String(raw).trim().replace(/\s/g, '').replace(/CAS|cas|№|No\./g, '');
  const m = s.match(/(\d{2,7}-\d{2}-\d)/);
  return m ? m[1] : s;
}

function extractCasList(raw) {
  if (!raw) return [];
  let text = String(raw).replace(/CAS[: ]*/gi, '');
  return text.split(/[;,/]|\\n/).map(normalizeCas).filter(Boolean);
}

function isClassified(val) {
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
const FLAT_OPTIONS = [
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

const VALID_TABLES = new Set(FLAT_OPTIONS.map(o => o.value));

const CMR_COLUMNS = { 'Carcinogenicity': 'carcinogen', 'Germ cell mutagenicity': 'mutagen', 'Reproductive toxicity': 'reprotoxic' };

const EXCLUDED_COLUMNS = {
  BKH_DHI: ['Substance Name'], DEDuCT: ['Substance name'], IARC: ['Agent'],
  MAK_Allergens: ['Substance name'], MAK_Carcinogens: ['Substance name'],
  NTP_Carcinogens: ['NAME OR SYNONYM'], SINList: ['EC Number', 'Name', 'Synonyms'],
  TEDX: ['Chemical name'], USEPA_Carcinogens: ['CAS RN', 'Substance name'],
  EU_EDlists: ['Substance Name'], USEPA_PE: ['Chemical Name'],
  ACGIH: ['Substance'], OEHHA: ['Name'], AOEC_Asthmagens: ['Primary Name'],
  CLP_Notifications: ['EC'],
};

const SPECIAL_CARCINOGENICITY = {
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

// ─── Load indexes from Turso lookup tables into memory at startup ─────────────
async function loadCasIndex() {
  console.log('Loading CAS index from Turso…');
  const index = new Map(); // cas → { table → [rowid, …] }
  let offset = 0;
  const batchSize = 5000;
  while (true) {
    const r = await classDb.execute({
      sql: 'SELECT cas, table_name, row_id FROM cas_lookup LIMIT ? OFFSET ?',
      args: [batchSize, offset],
    });
    if (r.rows.length === 0) break;
    for (const row of r.rows) {
      if (!index.has(row.cas)) index.set(row.cas, {});
      const entry = index.get(row.cas);
      if (!entry[row.table_name]) entry[row.table_name] = [];
      entry[row.table_name].push(row.row_id);
    }
    offset += batchSize;
  }
  console.log(`CAS index loaded: ${index.size} unique CAS numbers`);
  return index;
}

async function loadNameIndex() {
  console.log('Loading name index from Turso…');
  const index = new Map();
  let offset = 0;
  const batchSize = 5000;
  while (true) {
    const r = await classDb.execute({
      sql: 'SELECT cas, name FROM name_lookup LIMIT ? OFFSET ?',
      args: [batchSize, offset],
    });
    if (r.rows.length === 0) break;
    for (const row of r.rows) {
      index.set(row.cas, row.name);
    }
    offset += batchSize;
  }
  console.log(`Name index loaded: ${index.size} entries`);
  return index;
}

async function loadVtrIndex() {
  console.log('Loading VTR index from Turso…');
  const index = new Map();
  let offset = 0;
  const batchSize = 5000;
  while (true) {
    const r = await vtrDb.execute({
      sql: 'SELECT cas, row_id FROM vtr_cas_lookup LIMIT ? OFFSET ?',
      args: [batchSize, offset],
    });
    if (r.rows.length === 0) break;
    for (const row of r.rows) {
      if (!index.has(row.cas)) index.set(row.cas, []);
      index.get(row.cas).push(row.row_id);
    }
    offset += batchSize;
  }
  console.log(`VTR index loaded: ${index.size} unique CAS numbers`);
  return index;
}

async function loadVtrColumns() {
  try {
    const r = await vtrDb.execute('SELECT * FROM vtr_all LIMIT 1');
    if (r.rows.length > 0) return Object.keys(r.rows[0]);
  } catch (e) {}
  return [];
}

// ─── Turso row fetch helper ───────────────────────────────────────────────────
async function fetchRow(db, table, rowid) {
  if (!VALID_TABLES.has(table)) return null;
  try {
    const r = await db.execute({
      sql: `SELECT * FROM "${table}" WHERE rowid = ?`,
      args: [rowid],
    });
    return r.rows[0] || null;
  } catch (e) {
    return null;
  }
}

async function fetchRows(db, table, rowids) {
  if (!VALID_TABLES.has(table) || !rowids.length) return [];
  try {
    const placeholders = rowids.map(() => '?').join(',');
    const r = await db.execute({
      sql: `SELECT * FROM "${table}" WHERE rowid IN (${placeholders})`,
      args: rowids,
    });
    return r.rows;
  } catch (e) {
    return [];
  }
}

async function fetchVtrRows(rowids) {
  if (!rowids.length) return [];
  try {
    const placeholders = rowids.map(() => '?').join(',');
    const r = await vtrDb.execute({
      sql: `SELECT * FROM vtr_all WHERE rowid IN (${placeholders})`,
      args: rowids,
    });
    return r.rows;
  } catch (e) {
    return [];
  }
}

// ─── Server startup ───────────────────────────────────────────────────────────
async function main() {
  // Load indexes from Turso lookup tables into memory
  const casIndex = await loadCasIndex();
  const nameIndex = await loadNameIndex();
  const vtrIndex = await loadVtrIndex();
  const vtrAllColumns = await loadVtrColumns();
  const vtrVisibleColumns = vtrAllColumns.filter(c => !['id', 'source_system', 'raw_source'].includes(c));

  // Name search array (for substring matching)
  const nameSearchArr = [];
  for (const [cas, name] of nameIndex.entries()) {
    nameSearchArr.push({ cas, name, nameLower: name.toLowerCase() });
  }

  const app = express();
  app.use(cors({ origin: '*' }));
  app.use(express.json({ limit: '1mb' }));

  // ─── API: Sources list ────────────────────────────────────────────────────
  app.get('/api/sources', (req, res) => {
    res.json(FLAT_OPTIONS);
  });

  // ─── API: Search by name ──────────────────────────────────────────────────
  app.get('/api/search-name', (req, res) => {
    const q = String(req.query.q || '').toLowerCase().trim();
    if (q.length < 2) return res.json([]);
    const results = [];
    for (const item of nameSearchArr) {
      if (item.nameLower.includes(q)) {
        results.push({ cas: item.cas, name: item.name });
        if (results.length >= 20) break;
      }
    }
    res.json(results);
  });

  // ─── API: Main search ─────────────────────────────────────────────────────
  app.post('/api/search', async (req, res) => {
    const { cas_numbers = [], classifications = [] } = req.body;
    const casList = cas_numbers.map(normalizeCas).filter(Boolean);
    const selectedTables = new Set(classifications);
    if (!casList.length || !selectedTables.size) return res.json({});

    const result = {};

    for (const cas of casList) {
      const entry = {
        CAS: cas,
        substanceName: nameIndex.get(cas) || null,
        CMR: {},
        PE_Sens: {},
        sources: [],
        details: {},
      };

      const tableMap = casIndex.get(cas);
      if (!tableMap) {
        entry.sources = ['Introuvable'];
        result[cas] = entry;
        continue;
      }

      for (const table of selectedTables) {
        const rowids = tableMap[table];
        if (!rowids || !rowids.length) continue;

        const excluded = new Set(EXCLUDED_COLUMNS[table] || []);
        const prettyTable = table.replace(/_/g, ' ');
        if (!entry.sources.includes(prettyTable)) entry.sources.push(prettyTable);

        const row = await fetchRow(classDb, table, rowids[0]);
        if (!row) continue;

        for (const [col, key] of Object.entries(CMR_COLUMNS)) {
          if (row[col] !== undefined && isClassified(row[col])) {
            entry.CMR[key] = true;
          }
        }

        if (SPECIAL_CARCINOGENICITY[table]) {
          try { if (SPECIAL_CARCINOGENICITY[table](row)) entry.CMR.carcinogen = true; } catch (e) {}
        }

        if (table === 'BKH_DHI' && ['CAT1', 'CAT2'].includes(row.Category)) entry.PE_Sens.ed = true;
        if (table === 'DEDuCT' && ['I', 'II', 'III', 'IV'].includes(row.Category)) entry.PE_Sens.ed = true;
        if (table === 'EU_EDlists' && ['List I', 'List II', 'List III'].includes(row.List)) entry.PE_Sens.ed = true;
        if (table === 'SINList' && String(row['Health and environmental concern'] || '').toLowerCase().includes('endocrine disruptor')) entry.PE_Sens.ed = true;
        if (table === 'TEDX') entry.PE_Sens.ed = true;
        if (table === 'USEPA_ED') {
          const l = String(row.Liste || '').trim();
          if (!['Liste 1 (No evidence)', 'Liste 2'].includes(l)) entry.PE_Sens.ed = true;
        }

        const ghsTables = ['CLP', 'GHS_Japan', 'GHS_Korea', 'GHS_Australia', 'GHS_China'];
        if (ghsTables.includes(table)) {
          if (isClassified(row['Respiratory sensitization'])) entry.PE_Sens.resp_sens = true;
          if (isClassified(row['Skin sensitization'])) entry.PE_Sens.skin_sens = true;
        }
        if (table === 'MAK_Allergens') {
          if (['(Sah)', '(Sa)'].includes(row.Designation)) entry.PE_Sens.resp_sens = true;
          if (['(Sah)', '(Sh)'].includes(row.Designation)) entry.PE_Sens.skin_sens = true;
        }

        entry.details[table] = {};
        for (const col of Object.keys(row)) {
          if (col === 'CAS' || col === 'Substance Name' || excluded.has(col)) continue;
          if (isClassified(row[col])) {
            entry.details[table][col] = row[col];
          }
        }
      }

      if (!entry.sources.length) entry.sources = ['Introuvable'];
      result[cas] = entry;
    }

    res.json(result);
  });

  // ─── API: VTR search ──────────────────────────────────────────────────────
  app.post('/api/vtr', async (req, res) => {
    const { cas_numbers = [] } = req.body;
    const casList = cas_numbers.map(normalizeCas).filter(Boolean);
    const result = {};

    for (const cas of casList) {
      const entry = {
        substanceName: nameIndex.get(cas) || null,
        sources: [],
        details: {},
      };

      const rowids = vtrIndex.get(cas);
      if (!rowids?.length) {
        entry.sources = ['Introuvable'];
        result[cas] = entry;
        continue;
      }

      const matching = await fetchVtrRows(rowids);
      const authorities = new Set();
      for (const row of matching) {
        if (row.authority) authorities.add(String(row.authority));
      }

      entry.sources = [...authorities].sort();
      entry.details = {
        vtr_all: {
          columns: vtrVisibleColumns,
          rows: matching.map(r => {
            const obj = {};
            for (const c of vtrVisibleColumns) obj[c] = r[c];
            return obj;
          }),
        },
      };

      result[cas] = entry;
    }

    res.json(result);
  });

  // ─── API: Export ──────────────────────────────────────────────────────────
  app.post('/api/export', async (req, res) => {
    const { cas_numbers = [], classifications = [], format = 'xlsx' } = req.body;
    const casList = cas_numbers.map(normalizeCas).filter(Boolean);
    const selectedTables = new Set(classifications);

    const rows = [];
    for (const cas of casList) {
      const name = nameIndex.get(cas) || '';
      const tableMap = casIndex.get(cas);
      if (!tableMap) {
        rows.push({ CAS: cas, 'Substance Name': name, Source: 'Introuvable', Details: '' });
        continue;
      }

      let found = false;
      for (const table of selectedTables) {
        const rowids = tableMap[table];
        if (!rowids?.length) continue;
        found = true;
        const row = await fetchRow(classDb, table, rowids[0]);
        if (!row) continue;

        const cols = Object.keys(row).filter(c => !['CAS', 'Substance Name', 'cid'].includes(c));
        const details = cols
          .filter(c => { const v = String(row[c] || '').trim().toLowerCase(); return v && !['not classified', '-', 'not applicable'].includes(v); })
          .map(c => `${c}: ${row[c]}`)
          .join(' | ');

        rows.push({ CAS: cas, 'Substance Name': name, Source: table.replace(/_/g, ' '), Details: details });
      }
      if (!found) rows.push({ CAS: cas, 'Substance Name': name, Source: 'Introuvable', Details: '' });
    }

    if (format === 'csv') {
      const header = 'CAS,Substance Name,Source,Details\n';
      const csv = rows.map(r => `"${r.CAS}","${r['Substance Name']}","${r.Source}","${(r.Details || '').replace(/"/g, '""')}"`).join('\n');
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename=export_classifications.csv');
      return res.send(header + csv);
    }

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Classifications');
    ws.columns = [
      { header: 'CAS', key: 'CAS', width: 15 },
      { header: 'Substance Name', key: 'Substance Name', width: 30 },
      { header: 'Source', key: 'Source', width: 20 },
      { header: 'Details', key: 'Details', width: 60 },
    ];
    for (const r of rows) ws.addRow(r);
    ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1B4F72' } };
    ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=export_classifications.xlsx');
    await wb.xlsx.write(res);
    res.end();
  });

  // ─── API: Export Multiple (one sheet per source) ─────────────────────────
  app.post('/api/export/multiple', async (req, res) => {
    const { cas_numbers = [], classifications = [] } = req.body;
    const casList = cas_numbers.map(normalizeCas).filter(Boolean);
    const selectedTables = classifications;
    if (!casList.length || !selectedTables.length) return res.status(400).json({ error: 'Missing params' });

    const wb = new ExcelJS.Workbook();
    const HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1B4F72' } };
    const HEADER_FONT = { bold: true, color: { argb: 'FFFFFFFF' } };

    for (const table of selectedTables) {
      const sheetRows = [];
      let allColumns = null;

      for (const cas of casList) {
        const tableMap = casIndex.get(cas);
        if (!tableMap) continue;
        const rowids = tableMap[table];
        if (!rowids?.length) continue;

        const rows = await fetchRows(classDb, table, rowids);
        for (const row of rows) {
          if (!allColumns) allColumns = Object.keys(row).filter(c => c !== 'rowid');
          const enriched = { CAS: cas, 'Substance Name': nameIndex.get(cas) || row['Substance Name'] || '', ...row };
          sheetRows.push(enriched);
        }
      }

      if (!sheetRows.length) continue;

      const sheetName = table.replace(/_/g, ' ').substring(0, 31);
      const ws = wb.addWorksheet(sheetName);
      const baseCols = ['CAS', 'Substance Name'];
      const extraCols = (allColumns || []).filter(c => !['CAS', 'Substance Name'].includes(c));
      const cols = [...baseCols, ...extraCols];
      ws.columns = cols.map(c => ({ header: c, key: c, width: Math.min(40, Math.max(12, c.length + 4)) }));
      for (const r of sheetRows) {
        const obj = {};
        for (const c of cols) obj[c] = r[c] ?? '';
        ws.addRow(obj);
      }
      const hrow = ws.getRow(1);
      hrow.font = HEADER_FONT;
      hrow.fill = HEADER_FILL;
      hrow.alignment = { wrapText: false };
    }

    if (wb.worksheets.length === 0) {
      wb.addWorksheet('Aucun résultat');
    }

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=export_multiple.xlsx');
    await wb.xlsx.write(res);
    res.end();
  });

  // ─── API: Export Combined (one sheet, all sources merged) ────────────────
  app.post('/api/export/combined', async (req, res) => {
    const { cas_numbers = [], classifications = [] } = req.body;
    const casList = cas_numbers.map(normalizeCas).filter(Boolean);
    const selectedTables = classifications;
    if (!casList.length || !selectedTables.length) return res.status(400).json({ error: 'Missing params' });

    const tableColMap = {};
    for (const cas of casList) {
      const tableMap = casIndex.get(cas);
      if (!tableMap) continue;
      for (const table of selectedTables) {
        const rowids = tableMap[table];
        if (!rowids?.length) continue;
        const row = await fetchRow(classDb, table, rowids[0]);
        if (!row) continue;
        if (!tableColMap[table]) tableColMap[table] = new Set();
        const excluded = new Set(['CAS', 'Substance Name', ...(EXCLUDED_COLUMNS[table] || [])]);
        for (const col of Object.keys(row)) {
          if (excluded.has(col)) continue;
          if (isClassified(row[col])) tableColMap[table].add(col);
        }
      }
    }

    const colKeys = [];
    colKeys.push({ key: 'CAS', header: 'CAS' });
    colKeys.push({ key: 'SubstanceName', header: 'Substance Name' });
    for (const table of selectedTables) {
      const cols = tableColMap[table];
      if (!cols || !cols.size) continue;
      const tableShort = table.replace(/_/g, ' ');
      for (const col of cols) {
        colKeys.push({ key: `${table}||${col}`, header: `${tableShort} — ${col}` });
      }
    }

    const rows = [];
    for (const cas of casList) {
      const rowObj = { CAS: cas, SubstanceName: nameIndex.get(cas) || '' };
      const tableMap = casIndex.get(cas);
      if (tableMap) {
        for (const table of selectedTables) {
          const rowids = tableMap[table];
          if (!rowids?.length) continue;
          const row = await fetchRow(classDb, table, rowids[0]);
          if (!row) continue;
          const cols = tableColMap[table];
          if (!cols) continue;
          for (const col of cols) {
            rowObj[`${table}||${col}`] = row[col] ?? '';
          }
        }
      }
      rows.push(rowObj);
    }

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Classifications combinées');
    ws.columns = colKeys.map(ck => ({ header: ck.header, key: ck.key, width: Math.min(40, Math.max(12, ck.header.length + 2)) }));
    for (const r of rows) ws.addRow(r);
    const hrow = ws.getRow(1);
    hrow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    hrow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0A5C2D' } };
    hrow.alignment = { wrapText: true };
    ws.views = [{ state: 'frozen', xSplit: 2, ySplit: 1 }];

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=export_combine.xlsx');
    await wb.xlsx.write(res);
    res.end();
  });

  // ─── API: VTR Export ──────────────────────────────────────────────────────
  app.post('/api/vtr_export/xlsx', async (req, res) => {
    const { cas_numbers = [] } = req.body;
    const casList = new Set(cas_numbers.map(normalizeCas).filter(Boolean));

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('VTR');
    let headerSet = false;

    for (const cas of casList) {
      const rowids = vtrIndex.get(cas);
      if (!rowids?.length) continue;
      const rows = await fetchVtrRows(rowids);
      for (const row of rows) {
        if (!headerSet) {
          const cols = Object.keys(row).filter(c => !['id', 'source_system', 'raw_source'].includes(c));
          ws.columns = cols.map(c => ({ header: c, key: c, width: 20 }));
          ws.getRow(1).font = { bold: true };
          headerSet = true;
        }
        const obj = {};
        for (const c of vtrVisibleColumns) obj[c] = row[c];
        ws.addRow(obj);
      }
    }

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=export_vtr.xlsx');
    await wb.xlsx.write(res);
    res.end();
  });

  // ─── API: Tox Profile ─────────────────────────────────────────────────────
  app.post('/api/tox-profile', async (req, res) => {
    const { cas } = req.body;
    if (!cas) return res.status(400).json({ error: 'CAS requis' });
    try {
      const profile = await generateToxProfile(cas);
      res.json(profile);
    } catch (e) {
      console.error('Tox profile error:', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/tox-profile/cache', (req, res) => {
    res.json(getCacheStats());
  });

  // ─── Static file serving (production) ─────────────────────────────────────
  const distPath = path.join(__dirname, '..', 'dist');
  if (existsSync(distPath)) {
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found' });
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Toxonomy server running on port ${PORT}`);
  });
}

main().catch(console.error);
