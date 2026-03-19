#!/usr/bin/env node
// scripts/build-vtr-index.js — FAST version with debug logging

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

  // Debug: check what columns vtr_all has
  console.log('Probing vtr_all schema...');
  const probe = await db.execute('SELECT * FROM vtr_all LIMIT 1');
  if (probe.rows.length > 0) {
    console.log('Columns:', Object.keys(probe.rows[0]).join(', '));
    console.log('Sample row cas:', probe.rows[0].cas);
  } else {
    console.log('WARNING: vtr_all is empty!');
    return;
  }

  // Check if rowid works
  console.log('Testing rowid access...');
  try {
    const test = await db.execute('SELECT rowid, cas FROM vtr_all LIMIT 3');
    for (const r of test.rows) {
      console.log(`  rowid=${r.rowid} (type=${typeof r.rowid}), cas=${r.cas}`);
    }
  } catch (e) {
    console.error('rowid access failed:', e.message);
    console.log('Trying with _rowid_ instead...');
    const test2 = await db.execute('SELECT _rowid_, cas FROM vtr_all LIMIT 3');
    for (const r of test2.rows) {
      console.log(`  _rowid_=${r['_rowid_']} (type=${typeof r['_rowid_']}), cas=${r.cas}`);
    }
  }

  await db.execute('DROP TABLE IF EXISTS vtr_cas_lookup');
  await db.execute('CREATE TABLE vtr_cas_lookup (cas TEXT NOT NULL, row_id INTEGER NOT NULL)');

  let offset = 0;
  const batchSize = 2000;
  let total = 0;

  while (true) {
    let result;
    try {
      result = await db.execute({
        sql: 'SELECT rowid, cas FROM vtr_all LIMIT ? OFFSET ?',
        args: [batchSize, offset],
      });
    } catch (e) {
      console.error(`Error reading vtr_all at offset ${offset}:`, e.message);
      break;
    }

    if (result.rows.length === 0) break;

    const inserts = [];
    for (const row of result.rows) {
      const allCas = extractCasList(String(row.cas || ''));
      const rowid = Number(row.rowid);
      if (isNaN(rowid)) {
        console.warn(`  Skipping row with invalid rowid: ${row.rowid}`);
        continue;
      }
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
      try {
        await db.execute({ sql: `INSERT INTO vtr_cas_lookup (cas,row_id) VALUES ${placeholders}`, args });
      } catch (e) {
        console.error(`Insert error at offset ${offset}, chunk ${i}:`, e.message);
        throw e;
      }
    }

    total += inserts.length;
    offset += batchSize;
    if (offset % 10000 === 0) console.log(`  Progress: ${total} entries so far...`);
    if (result.rows.length < batchSize) break;
  }

  console.log('Creating index...');
  await db.execute('CREATE INDEX IF NOT EXISTS idx_vtr_cas_lookup ON vtr_cas_lookup (cas)');

  console.timeEnd('Total');
  console.log(`Done! vtr_cas_lookup: ${total} entries`);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
