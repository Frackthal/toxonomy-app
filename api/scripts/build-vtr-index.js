#!/usr/bin/env node
// scripts/build-vtr-index.js
// Run once to create vtr_cas_lookup table on Turso VTR database.
// Usage: TURSO_VTR_URL=... TURSO_VTR_TOKEN=... node scripts/build-vtr-index.js

import { createClient } from '@libsql/client';

const db = createClient({
  url: process.env.TURSO_VTR_URL,
  authToken: process.env.TURSO_VTR_TOKEN,
});

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
  console.log('Creating vtr_cas_lookup table...');

  await db.execute('DROP TABLE IF EXISTS vtr_cas_lookup');
  await db.execute(`
    CREATE TABLE vtr_cas_lookup (
      cas TEXT NOT NULL,
      row_id INTEGER NOT NULL
    )
  `);

  let offset = 0;
  const batchSize = 500;
  let total = 0;
  let hasMore = true;

  while (hasMore) {
    const result = await db.execute({
      sql: 'SELECT rowid, cas FROM vtr_all LIMIT ? OFFSET ?',
      args: [batchSize, offset],
    });

    if (result.rows.length === 0) break;

    const inserts = [];
    for (const row of result.rows) {
      const allCas = extractCasList(String(row.cas || ''));
      for (const cas of allCas) {
        if (!cas) continue;
        inserts.push({ cas, row_id: row.rowid });
      }
    }

    for (let i = 0; i < inserts.length; i += 50) {
      const chunk = inserts.slice(i, i + 50);
      await db.batch(
        chunk.map(e => ({
          sql: 'INSERT INTO vtr_cas_lookup (cas, row_id) VALUES (?, ?)',
          args: [e.cas, e.row_id],
        }))
      );
    }

    total += inserts.length;
    offset += batchSize;
    if (result.rows.length < batchSize) hasMore = false;
  }

  await db.execute('CREATE INDEX IF NOT EXISTS idx_vtr_cas_lookup ON vtr_cas_lookup (cas)');

  console.log(`Done! vtr_cas_lookup: ${total} entries`);
}

main().catch(e => { console.error(e); process.exit(1); });
