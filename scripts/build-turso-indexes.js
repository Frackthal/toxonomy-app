#!/usr/bin/env node
// scripts/build-turso-indexes.js — FAST version
// Uses multi-row INSERT for massive speedup over individual inserts.

import { createClient } from '@libsql/client';

const db = createClient({
  url: process.env.TURSO_CLASSIFICATIONS_URL,
  authToken: process.env.TURSO_CLASSIFICATIONS_TOKEN,
});

const TABLES = [
  'CLP', 'CLP_Notifications', 'GHS_Japan', 'GHS_Australia', 'GHS_Korea',
  'GHS_China', 'SIMDUT_2015', 'GHS_Taiwan', 'GHS_Malaysia',
  'IARC', 'ACGIH', 'USEPA_Carcinogens', 'MAK_Carcinogens', 'NTP_Carcinogens', 'OEHHA',
  'BKH_DHI', 'DEDuCT', 'EU_EDlists', 'USEPA_ED', 'SINList', 'TEDX',
  'AOEC_Asthmagens', 'FEMA', 'HAZMAP', 'MAK_Allergens', 'HPHC', 'ATSDR_Hazards',
];

const NAME_TABLES = new Set(['CLP', 'GHS_Australia', 'GHS_Japan', 'GHS_Korea', 'GHS_China']);

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

// Multi-row INSERT: INSERT INTO t (a,b,c) VALUES (?,?,?),(?,?,?),(?,?,?)...
// Turso/libSQL max ~100KB per request, so we chunk at ~500 rows
async function bulkInsertCas(rows) {
  if (!rows.length) return;
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const placeholders = chunk.map(() => '(?,?,?)').join(',');
    const args = [];
    for (const r of chunk) { args.push(r.cas, r.table_name, r.row_id); }
    await db.execute({ sql: `INSERT INTO cas_lookup (cas,table_name,row_id) VALUES ${placeholders}`, args });
  }
}

async function bulkInsertNames(rows) {
  if (!rows.length) return;
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const placeholders = chunk.map(() => '(?,?)').join(',');
    const args = [];
    for (const r of chunk) { args.push(r.cas, r.name); }
    await db.execute({ sql: `INSERT OR IGNORE INTO name_lookup (cas,name) VALUES ${placeholders}`, args });
  }
}

async function main() {
  console.log('Creating lookup tables...');
  console.time('Total');

  await db.execute('DROP TABLE IF EXISTS cas_lookup');
  await db.execute('CREATE TABLE cas_lookup (cas TEXT NOT NULL, table_name TEXT NOT NULL, row_id INTEGER NOT NULL)');
  await db.execute('DROP TABLE IF EXISTS name_lookup');
  await db.execute('CREATE TABLE name_lookup (cas TEXT PRIMARY KEY, name TEXT NOT NULL)');

  let totalCas = 0;
  let totalNames = 0;
  const namesSeen = new Set();

  for (const table of TABLES) {
    const t0 = Date.now();
    let offset = 0;
    const batchSize = 2000; // Read more rows per query
    let tableCount = 0;

    // Detect "Substance Name" column
    let hasNameCol = false;
    try {
      await db.execute({ sql: `SELECT "Substance Name" FROM "${table}" LIMIT 1`, args: [] });
      hasNameCol = true;
    } catch (e) { hasNameCol = false; }

    const selectSql = hasNameCol
      ? `SELECT rowid, CAS, "Substance Name" FROM "${table}" LIMIT ? OFFSET ?`
      : `SELECT rowid, CAS FROM "${table}" LIMIT ? OFFSET ?`;

    while (true) {
      let rows;
      try {
        const result = await db.execute({ sql: selectSql, args: [batchSize, offset] });
        rows = result.rows;
      } catch (e) {
        console.warn(`  Skipping ${table}: ${e.message}`);
        break;
      }
      if (rows.length === 0) break;

      const casRows = [];
      const nameRows = [];

      for (const row of rows) {
        const allCas = extractCasList(String(row.CAS || ''));
        const rowid = Number(row.rowid);
        for (const cas of allCas) {
          if (!cas) continue;
          casRows.push({ cas, table_name: table, row_id: rowid });

          if (hasNameCol && NAME_TABLES.has(table) && !namesSeen.has(cas)) {
            const name = row['Substance Name'];
            if (name && String(name).trim()) {
              namesSeen.add(cas);
              nameRows.push({ cas, name: String(name).trim() });
            }
          }
        }
      }

      await bulkInsertCas(casRows);
      await bulkInsertNames(nameRows);

      tableCount += casRows.length;
      totalCas += casRows.length;
      totalNames += nameRows.length;
      offset += batchSize;
      if (rows.length < batchSize) break;
    }

    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`  ${table}: ${tableCount} entries (${elapsed}s)`);
  }

  console.log('Creating indexes...');
  await db.execute('CREATE INDEX IF NOT EXISTS idx_cas_lookup_cas ON cas_lookup (cas)');
  await db.execute('CREATE INDEX IF NOT EXISTS idx_cas_lookup_table ON cas_lookup (cas, table_name)');
  await db.execute('CREATE INDEX IF NOT EXISTS idx_name_lookup_name ON name_lookup (name COLLATE NOCASE)');

  console.timeEnd('Total');
  console.log(`Done! cas_lookup: ${totalCas} entries, name_lookup: ${totalNames} entries`);
}

main().catch(e => { console.error(e); process.exit(1); });
