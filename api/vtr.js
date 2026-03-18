// api/vtr.js — POST /api/vtr
import { getVtrDb, getClassDb, normalizeCas, getSubstanceNames, handleCors } from '../lib/shared.js';

const VTR_HIDDEN = new Set(['id', 'source_system', 'raw_source']);

export default async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { cas_numbers = [] } = req.body || {};
  const casList = [...new Set(cas_numbers.map(normalizeCas).filter(Boolean))];
  if (!casList.length) return res.json({});

  const vtrDb = getVtrDb();
  const classDb = getClassDb();

  // Batch get names
  const nameMap = await getSubstanceNames(classDb, casList);

  const result = {};

  for (const cas of casList) {
    const entry = {
      substanceName: nameMap.get(cas) || null,
      sources: [],
      details: {},
    };

    try {
      // Get rowids from lookup
      const lookup = await vtrDb.execute({
        sql: 'SELECT row_id FROM vtr_cas_lookup WHERE cas = ?',
        args: [cas],
      });

      if (lookup.rows.length === 0) {
        entry.sources = ['Introuvable'];
        result[cas] = entry;
        continue;
      }

      const rowids = lookup.rows.map(r => r.row_id);
      const placeholders = rowids.map(() => '?').join(',');
      const r = await vtrDb.execute({
        sql: `SELECT * FROM vtr_all WHERE rowid IN (${placeholders})`,
        args: rowids,
      });

      if (r.rows.length === 0) {
        entry.sources = ['Introuvable'];
        result[cas] = entry;
        continue;
      }

      const authorities = new Set();
      for (const row of r.rows) {
        if (row.authority) authorities.add(String(row.authority));
      }

      const allColumns = Object.keys(r.rows[0]);
      const visibleColumns = allColumns.filter(c => !VTR_HIDDEN.has(c));

      entry.sources = [...authorities].sort();
      entry.details = {
        vtr_all: {
          columns: visibleColumns,
          rows: r.rows.map(row => {
            const obj = {};
            for (const c of visibleColumns) obj[c] = row[c];
            return obj;
          }),
        },
      };
    } catch (e) {
      entry.sources = ['Introuvable'];
    }

    result[cas] = entry;
  }

  res.json(result);
}
