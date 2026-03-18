#!/usr/bin/env node
// scripts/build-turso-indexes.js
// Run once after uploading DBs to Turso to create lookup tables.
// Usage: TURSO_CLASSIFICATIONS_URL=... TURSO_CLASSIFICATIONS_TOKEN=... node scripts/build-turso-indexes.js

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

const NAME_TABLES = ['CLP', 'GHS_Australia', 'GHS_Japan', 'GHS_Korea', 'GHS_China'];

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

async function main() {
  console.log('Creating lookup tables...');

  // ─── cas_lookup: normalized_cas → table_name, rowid ───────────────────────
  await db.execute('DROP TABLE IF EXISTS cas_lookup');
  await db.execute(`
    CREATE TABLE cas_lookup (
      cas TEXT NOT NULL,
      table_name TEXT NOT NULL,
      row_id INTEGER NOT NULL
    )
  `);

  // ─── name_lookup: normalized_cas → substance_name ─────────────────────────
  await db.execute('DROP TABLE IF EXISTS name_lookup');
  await db.execute(`
    CREATE TABLE name_lookup (
      cas TEXT PRIMARY KEY,
      name TEXT NOT NULL
    )
  `);

  let totalCasEntries = 0;
  let totalNameEntries = 0;
  const namesSeen = new Set();

  for (const table of TABLES) {
    console.log(`Processing ${table}...`);
    let offset = 0;
    const batchSize = 500;
    let hasMore = true;

    while (hasMore) {
      let rows;
      try {
        const result = await db.execute({
          sql: `SELECT rowid, CAS, "Substance Name" FROM "${table}" LIMIT ? OFFSET ?`,
          args: [batchSize, offset],
        });
        rows = result.rows;
      } catch (e) {
        console.warn(`  Skipping ${table}: ${e.message}`);
        break;
      }

      if (rows.length === 0) {
        hasMore = false;
        break;
      }

      // Batch insert cas_lookup entries
      const casInserts = [];
      const nameInserts = [];

      for (const row of rows) {
        const allCas = extractCasList(String(row.CAS || ''));
        for (const cas of allCas) {
          if (!cas) continue;
          casInserts.push({ cas, table_name: table, row_id: row.rowid });

          // Name index — first occurrence wins
          if (NAME_TABLES.includes(table) && !namesSeen.has(cas)) {
            const name = row['Substance Name'];
            if (name && String(name).trim()) {
              namesSeen.add(cas);
              nameInserts.push({ cas, name: String(name).trim() });
            }
          }
        }
      }

      // Insert in batches of 50 (Turso batch limit is ~100 statements)
      for (let i = 0; i < casInserts.length; i += 50) {
        const chunk = casInserts.slice(i, i + 50);
        await db.batch(
          chunk.map(e => ({
            sql: 'INSERT INTO cas_lookup (cas, table_name, row_id) VALUES (?, ?, ?)',
            args: [e.cas, e.table_name, e.row_id],
          }))
        );
      }

      for (let i = 0; i < nameInserts.length; i += 50) {
        const chunk = nameInserts.slice(i, i + 50);
        await db.batch(
          chunk.map(e => ({
            sql: 'INSERT OR IGNORE INTO name_lookup (cas, name) VALUES (?, ?)',
            args: [e.cas, e.name],
          }))
        );
      }

      totalCasEntries += casInserts.length;
      totalNameEntries += nameInserts.length;
      offset += batchSize;

      if (rows.length < batchSize) hasMore = false;
    }
  }

  // Create indexes
  console.log('Creating indexes...');
  await db.execute('CREATE INDEX IF NOT EXISTS idx_cas_lookup_cas ON cas_lookup (cas)');
  await db.execute('CREATE INDEX IF NOT EXISTS idx_cas_lookup_table ON cas_lookup (cas, table_name)');
  await db.execute('CREATE INDEX IF NOT EXISTS idx_name_lookup_name ON name_lookup (name COLLATE NOCASE)');

  console.log(`Done! cas_lookup: ${totalCasEntries} entries, name_lookup: ${totalNameEntries} entries`);
}

main().catch(e => { console.error(e); process.exit(1); });
