// server/index.js — Toxonomy Backend (Node.js + Express + better-sqlite3)
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { createWriteStream, existsSync, mkdirSync } from 'fs';
import { pipeline } from 'stream/promises';
import ExcelJS from 'exceljs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..');
const PORT = process.env.PORT || 5000;

// ─── DB download from Backblaze ───────────────────────────────────────────────
async function downloadDB(name) {
  const local = path.join(DATA_DIR, name);
  if (existsSync(local)) { console.log(`${name} already present.`); return local; }
  console.log(`Downloading ${name} from Backblaze…`);
  const s3 = new S3Client({
    endpoint: process.env.B2_ENDPOINT,
    region: 'auto',
    credentials: { accessKeyId: process.env.B2_KEY_ID_RO, secretAccessKey: process.env.B2_APP_KEY_RO },
  });
  const prefix = process.env.B2_PREFIX || 'db/';
  const resp = await s3.send(new GetObjectCommand({ Bucket: process.env.B2_BUCKET, Key: `${prefix}${name}` }));
  await pipeline(resp.Body, createWriteStream(local));
  console.log(`${name} downloaded.`);
  return local;
}

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

// ─── Index building ───────────────────────────────────────────────────────────
function buildCasIndex(db) {
  console.log('Building CAS index…');
  const tables = FLAT_OPTIONS.map(o => o.value);
  // Map: normalized CAS → { tableName → rowid (first match only) }
  const index = new Map();
  const nameIndex = new Map();

  const nameTables = new Set(['CLP', 'GHS_Australia', 'GHS_Japan', 'GHS_Korea', 'GHS_China']);

  for (const table of tables) {
    try {
      // Use .iterate() to stream rows instead of loading all into memory
      const stmt = db.prepare(`SELECT rowid, * FROM "${table}"`);
      for (const row of stmt.iterate()) {
        const allCas = extractCasList(row.CAS);
        for (const cas of allCas) {
          const n = normalizeCas(cas);
          if (!n) continue;
          if (!index.has(n)) index.set(n, {});
          const entry = index.get(n);
          // Only store first rowid per table (that's all we ever use)
          if (!entry[table]) entry[table] = row.rowid;

          // Name index
          if (nameTables.has(table) && !nameIndex.has(n)) {
            const name = row['Substance Name'];
            if (name) nameIndex.set(n, String(name).trim());
          }
        }
      }
    } catch (e) {
      // Table might not exist
    }
  }

  console.log(`CAS index built: ${index.size} unique CAS numbers across ${tables.length} tables`);
  return { index, nameIndex };
}

function buildNameSearchIndex(nameIndex) {
  // Array of { cas, nameLower } for substring search
  const arr = [];
  for (const [cas, name] of nameIndex.entries()) {
    arr.push({ cas, name, nameLower: name.toLowerCase() });
  }
  return arr;
}

// ─── Server startup ───────────────────────────────────────────────────────────
async function main() {
  // Download DBs
  await downloadDB('Classifications.db');
  await downloadDB('VTR.db');

  const classDbPath = path.join(DATA_DIR, 'Classifications.db');
  const vtrDbPath = path.join(DATA_DIR, 'VTR.db');

  // Step 1: Open writable to create indexes, then close
  const writeDb = new Database(classDbPath);
  writeDb.pragma('journal_mode = WAL');
  const tables = FLAT_OPTIONS.map(o => o.value);
  for (const t of tables) {
    try {
      writeDb.exec(`CREATE INDEX IF NOT EXISTS "idx_${t}_cas" ON "${t}" (CAS)`);
    } catch (e) { /* table might not exist */ }
  }
  writeDb.close();
  console.log('Indexes created.');

  // Step 2: Open readonly for serving
  const classDb = new Database(classDbPath, { readonly: true });
  classDb.pragma('cache_size = -16000'); // 16MB read cache
  const vtrDb = new Database(vtrDbPath, { readonly: true });

  // Build in-memory CAS index
  const { index: casIndex, nameIndex } = buildCasIndex(classDb);
  const nameSearchArr = buildNameSearchIndex(nameIndex);

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
  app.post('/api/search', (req, res) => {
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
        const rowid = tableMap[table];
        if (rowid == null) continue;

        const excluded = new Set(EXCLUDED_COLUMNS[table] || []);
        const prettyTable = table.replace(/_/g, ' ');
        if (!entry.sources.includes(prettyTable)) entry.sources.push(prettyTable);
        let row;
        try {
          row = classDb.prepare(`SELECT * FROM "${table}" WHERE rowid = ?`).get(rowid);
        } catch (e) { continue; }
        if (!row) continue;

        // CMR from CLP columns
        for (const [col, key] of Object.entries(CMR_COLUMNS)) {
          if (row[col] !== undefined && isClassified(row[col])) {
            entry.CMR[key] = true;
          }
        }

        // Special carcinogenicity
        if (SPECIAL_CARCINOGENICITY[table]) {
          try { if (SPECIAL_CARCINOGENICITY[table](row)) entry.CMR.carcinogen = true; } catch (e) {}
        }

        // PE
        if (table === 'BKH_DHI' && ['CAT1', 'CAT2'].includes(row.Category)) entry.PE_Sens.ed = true;
        if (table === 'DEDuCT' && ['I', 'II', 'III', 'IV'].includes(row.Category)) entry.PE_Sens.ed = true;
        if (table === 'EU_EDlists' && ['List I', 'List II', 'List III'].includes(row.List)) entry.PE_Sens.ed = true;
        if (table === 'SINList' && String(row['Health and environmental concern'] || '').toLowerCase().includes('endocrine disruptor')) entry.PE_Sens.ed = true;
        if (table === 'TEDX') entry.PE_Sens.ed = true;
        if (table === 'USEPA_ED') {
          const l = String(row.Liste || '').trim();
          if (!['Liste 1 (No evidence)', 'Liste 2'].includes(l)) entry.PE_Sens.ed = true;
        }

        // Sensitization
        const ghsTables = ['CLP', 'GHS_Japan', 'GHS_Korea', 'GHS_Australia', 'GHS_China'];
        if (ghsTables.includes(table)) {
          if (isClassified(row['Respiratory sensitization'])) entry.PE_Sens.resp_sens = true;
          if (isClassified(row['Skin sensitization'])) entry.PE_Sens.skin_sens = true;
        }
        if (table === 'MAK_Allergens') {
          if (['(Sah)', '(Sa)'].includes(row.Designation)) entry.PE_Sens.resp_sens = true;
          if (['(Sah)', '(Sh)'].includes(row.Designation)) entry.PE_Sens.skin_sens = true;
        }

        // Details
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
  app.post('/api/vtr', (req, res) => {
    const { cas_numbers = [] } = req.body;
    const casList = cas_numbers.map(normalizeCas).filter(Boolean);
    const result = {};

    let allRows, columns;
    try {
      const stmt = vtrDb.prepare('SELECT * FROM vtr_all');
      allRows = stmt.all();
      columns = stmt.columns().map(c => c.name);
    } catch (e) {
      return res.status(500).json({ error: 'Cannot read vtr_all' });
    }

    const visibleColumns = columns.filter(c => !['id', 'source_system', 'raw_source'].includes(c));

    for (const cas of casList) {
      const entry = {
        substanceName: nameIndex.get(cas) || null,
        sources: [],
        details: {},
      };

      const matching = [];
      const authorities = new Set();

      for (const row of allRows) {
        const rawCas = String(row.cas || '');
        const allCas = extractCasList(rawCas);
        if (allCas.some(c => normalizeCas(c) === cas)) {
          matching.push(row);
          if (row.authority) authorities.add(String(row.authority));
        }
      }

      if (matching.length) {
        entry.sources = [...authorities].sort();
        entry.details = {
          vtr_all: {
            columns: visibleColumns,
            rows: matching.map(r => {
              const obj = {};
              for (const c of visibleColumns) obj[c] = r[c];
              return obj;
            }),
          },
        };
      } else {
        entry.sources = ['Introuvable'];
      }

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
        const rowid = tableMap[table];
        if (rowid == null) continue;
        found = true;
        let row;
        try { row = classDb.prepare(`SELECT * FROM "${table}" WHERE rowid = ?`).get(rowid); } catch { continue; }
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

    // XLSX
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Classifications');
    ws.columns = [
      { header: 'CAS', key: 'CAS', width: 15 },
      { header: 'Substance Name', key: 'Substance Name', width: 30 },
      { header: 'Source', key: 'Source', width: 20 },
      { header: 'Details', key: 'Details', width: 60 },
    ];
    for (const r of rows) ws.addRow(r);
    // Style header
    ws.getRow(1).font = { bold: true };
    ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1B4F72' } };
    ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=export_classifications.xlsx');
    await wb.xlsx.write(res);
    res.end();
  });

  // ─── API: VTR Export ──────────────────────────────────────────────────────
  app.post('/api/vtr_export/xlsx', async (req, res) => {
    const { cas_numbers = [] } = req.body;
    const casList = new Set(cas_numbers.map(normalizeCas).filter(Boolean));

    const allRows = vtrDb.prepare('SELECT * FROM vtr_all').all();
    const filtered = allRows.filter(r => {
      const allCas = extractCasList(r.cas);
      return allCas.some(c => casList.has(normalizeCas(c)));
    });

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('VTR');
    if (filtered.length) {
      const cols = Object.keys(filtered[0]).filter(c => !['id', 'source_system', 'raw_source'].includes(c));
      ws.columns = cols.map(c => ({ header: c, key: c, width: 20 }));
      for (const r of filtered) {
        const obj = {};
        for (const c of cols) obj[c] = r[c];
        ws.addRow(obj);
      }
      ws.getRow(1).font = { bold: true };
    }

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=export_vtr.xlsx');
    await wb.xlsx.write(res);
    res.end();
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
