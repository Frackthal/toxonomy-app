// api/export/combined.js — POST /api/export/combined (single merged sheet)
import ExcelJS from 'exceljs';
import {
  getClassDb, normalizeCas, handleCors,
  VALID_TABLES, EXCLUDED_COLUMNS, findRowsByCas, getSubstanceName, isClassified,
} from from '../../lib/shared.js';

export default async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { cas_numbers = [], classifications = [] } = req.body || {};
  const casList = cas_numbers.map(normalizeCas).filter(Boolean);
  const selectedTables = classifications.filter(t => VALID_TABLES.has(t));
  if (!casList.length || !selectedTables.length) return res.status(400).json({ error: 'Missing params' });

  const db = getClassDb();

  // First pass: discover columns per table
  const tableColMap = {};
  for (const cas of casList) {
    for (const table of selectedTables) {
      const rows = await findRowsByCas(db, table, cas);
      if (!rows.length) continue;
      const row = rows[0];
      if (!tableColMap[table]) tableColMap[table] = new Set();
      const excluded = new Set(['CAS', 'Substance Name', 'rowid', ...(EXCLUDED_COLUMNS[table] || [])]);
      for (const col of Object.keys(row)) {
        if (excluded.has(col)) continue;
        if (isClassified(row[col])) tableColMap[table].add(col);
      }
    }
  }

  // Build column keys
  const colKeys = [
    { key: 'CAS', header: 'CAS' },
    { key: 'SubstanceName', header: 'Substance Name' },
  ];
  for (const table of selectedTables) {
    const cols = tableColMap[table];
    if (!cols || !cols.size) continue;
    const tableShort = table.replace(/_/g, ' ');
    for (const col of cols) {
      colKeys.push({ key: `${table}||${col}`, header: `${tableShort} — ${col}` });
    }
  }

  // Second pass: build rows
  const rows = [];
  for (const cas of casList) {
    const rowObj = { CAS: cas, SubstanceName: await getSubstanceName(db, cas) || '' };
    for (const table of selectedTables) {
      const dbRows = await findRowsByCas(db, table, cas);
      if (!dbRows.length) continue;
      const row = dbRows[0];
      const cols = tableColMap[table];
      if (!cols) continue;
      for (const col of cols) {
        rowObj[`${table}||${col}`] = row[col] ?? '';
      }
    }
    rows.push(rowObj);
  }

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Classifications combinées');
  ws.columns = colKeys.map(ck => ({ header: ck.header, key: ck.key, width: Math.min(40, Math.max(12, ck.header.length + 2)) }));
  for (const r of rows) ws.addRow(r);
  const hrow = ws.getRow(1);
  hrow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  hrow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0A5C2D' } };
  hrow.alignment = { wrapText: true };
  ws.views = [{ state: 'frozen', xSplit: 2, ySplit: 1 }];

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename=export_combine.xlsx');
  const buffer = await wb.xlsx.writeBuffer();
  res.send(Buffer.from(buffer));
}
