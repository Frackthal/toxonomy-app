// api/vtr_export/xlsx.js — POST /api/vtr_export/xlsx
import ExcelJS from 'exceljs';
import { getVtrDb, normalizeCas, handleCors } from '../_lib/shared.js';

const VTR_HIDDEN = new Set(['id', 'source_system', 'raw_source']);

export default async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { cas_numbers = [] } = req.body || {};
  const casSet = new Set(cas_numbers.map(normalizeCas).filter(Boolean));
  if (!casSet.size) return res.status(400).json({ error: 'No CAS numbers' });

  const vtrDb = getVtrDb();
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('VTR');
  let headerSet = false;
  let colKeys = [];

  for (const cas of casSet) {
    try {
      const lookup = await vtrDb.execute({
        sql: 'SELECT row_id FROM vtr_cas_lookup WHERE cas = ?',
        args: [cas],
      });
      if (lookup.rows.length === 0) continue;

      const rowids = lookup.rows.map(r => r.row_id);
      const placeholders = rowids.map(() => '?').join(',');
      const r = await vtrDb.execute({
        sql: `SELECT * FROM vtr_all WHERE rowid IN (${placeholders})`,
        args: rowids,
      });

      for (const row of r.rows) {
        if (!headerSet) {
          colKeys = Object.keys(row).filter(c => !VTR_HIDDEN.has(c));
          ws.columns = colKeys.map(c => ({ header: c, key: c, width: 20 }));
          ws.getRow(1).font = { bold: true };
          headerSet = true;
        }
        const obj = {};
        for (const c of colKeys) obj[c] = row[c];
        ws.addRow(obj);
      }
    } catch (e) {
      // Skip
    }
  }

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename=export_vtr.xlsx');
  const buffer = await wb.xlsx.writeBuffer();
  res.send(Buffer.from(buffer));
}
