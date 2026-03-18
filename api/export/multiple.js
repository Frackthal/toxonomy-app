// api/export/multiple.js — POST /api/export/multiple (one sheet per source)
import ExcelJS from 'exceljs';
import {
  getClassDb, normalizeCas, handleCors,
  VALID_TABLES, findRowsByCas, getSubstanceName,
} from '../_lib/shared.js';

export default async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { cas_numbers = [], classifications = [] } = req.body || {};
  const casList = cas_numbers.map(normalizeCas).filter(Boolean);
  const selectedTables = classifications.filter(t => VALID_TABLES.has(t));
  if (!casList.length || !selectedTables.length) return res.status(400).json({ error: 'Missing params' });

  const db = getClassDb();
  const wb = new ExcelJS.Workbook();
  const HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1B4F72' } };
  const HEADER_FONT = { bold: true, color: { argb: 'FFFFFFFF' } };

  for (const table of selectedTables) {
    const sheetRows = [];
    let allColumns = null;

    for (const cas of casList) {
      const rows = await findRowsByCas(db, table, cas);
      if (!rows.length) continue;
      const name = await getSubstanceName(db, cas) || '';

      for (const row of rows) {
        if (!allColumns) {
          allColumns = Object.keys(row).filter(c => c !== 'rowid');
        }
        const enriched = { CAS: cas, 'Substance Name': name, ...row };
        delete enriched.rowid;
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
  const buffer = await wb.xlsx.writeBuffer();
  res.send(Buffer.from(buffer));
}
