// api/search.js — POST /api/search (optimized with batch lookups)
import {
  getClassDb, normalizeCas, handleCors,
  VALID_TABLES, batchGetCasLookup, getSubstanceNames, processRow,
} from '../lib/shared.js';

export default async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { cas_numbers = [], classifications = [] } = req.body || {};
  const casList = [...new Set(cas_numbers.map(normalizeCas).filter(Boolean))];
  const selectedTables = new Set(classifications.filter(t => VALID_TABLES.has(t)));
  if (!casList.length || !selectedTables.size) return res.json({});

  const db = getClassDb();

  // Batch: get all lookup entries + all names in 2 queries
  const [lookupMap, nameMap] = await Promise.all([
    batchGetCasLookup(db, casList),
    getSubstanceNames(db, casList),
  ]);

  const result = {};

  for (const cas of casList) {
    const entry = {
      CAS: cas,
      substanceName: nameMap.get(cas) || null,
      CMR: {},
      PE_Sens: {},
      sources: [],
      details: {},
    };

    const lookupEntries = lookupMap.get(cas) || [];
    if (lookupEntries.length === 0) {
      entry.sources = ['Introuvable'];
      result[cas] = entry;
      continue;
    }

    // Group lookup entries by table, keep only selected tables
    const tableRowids = {};
    for (const { table_name, row_id } of lookupEntries) {
      if (!selectedTables.has(table_name)) continue;
      if (!tableRowids[table_name]) tableRowids[table_name] = [];
      tableRowids[table_name].push(row_id);
    }

    // Fetch rows per table (parallel)
    const fetchPromises = Object.entries(tableRowids).map(async ([table, rowids]) => {
      const placeholders = rowids.map(() => '?').join(',');
      try {
        const r = await db.execute({
          sql: `SELECT rowid, * FROM "${table}" WHERE rowid IN (${placeholders})`,
          args: rowids,
        });
        return { table, rows: r.rows };
      } catch (e) {
        return { table, rows: [] };
      }
    });

    const tableResults = await Promise.all(fetchPromises);

    for (const { table, rows } of tableResults) {
      if (!rows.length) continue;

      const prettyTable = table.replace(/_/g, ' ');
      if (!entry.sources.includes(prettyTable)) entry.sources.push(prettyTable);

      // Use first row for classification
      const row = rows[0];
      const { cmr, peSens, details } = processRow(table, row);

      for (const [k, v] of Object.entries(cmr)) { if (v) entry.CMR[k] = true; }
      for (const [k, v] of Object.entries(peSens)) { if (v) entry.PE_Sens[k] = true; }
      if (Object.keys(details).length > 0) entry.details[table] = details;
    }

    if (!entry.sources.length) entry.sources = ['Introuvable'];
    result[cas] = entry;
  }

  res.json(result);
}
