#!/usr/bin/env node
// scripts/build-vtr-index.js — FAST version

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
  console.time('Total');

  await db.execute('DROP TABLE IF EXISTS vtr_cas_lookup');
  await db.execute('CREATE TABLE vtr_cas_lookup (cas TEXT NOT NULL, row_id INTEGER NOT NULL)');

  let offset = 0;
  const batchSize = 2000;
  let total = 0;

  while (true) {
    const result = await db.execute({
      sql: 'SELECT rowid, cas FROM vtr_all LIMIT ? OFFSET ?',
      args: [batchSize, offset],
    });
    if (result.rows.length === 0) break;

    const inserts = [];
    for (const row of result.rows) {
      const allCas = extractCasList(String(row.cas || ''));
      const rowid = Number(row.rowid);
      for (const cas of allCas) {
        if (!cas) continue;
        inserts.push({ cas, row_id: rowid });
      }
    }

    // Multi-row INSERT in chunks of 500
    const CHUNK = 500;
    for (let i = 0; i < inserts.length; i += CHUNK) {
      const chunk = inserts.slice(i, i + CHUNK);
      const placeholders = chunk.map(() => '(?,?)').join(',');
      const args = [];
      for (const r of chunk) { args.push(r.cas, r.row_id); }
      await db.execute({ sql: `INSERT INTO vtr_cas_lookup (cas,row_id) VALUES ${placeholders}`, args });
    }

    total += inserts.length;
    offset += batchSize;
    if (result.rows.length < batchSize) break;
  }

  await db.execute('CREATE INDEX IF NOT EXISTS idx_vtr_cas_lookup ON vtr_cas_lookup (cas)');

  console.timeEnd('Total');
  console.log(`Done! vtr_cas_lookup: ${total} entries`);
}

main().catch(e => { console.error(e); process.exit(1); });
