// api/export.js — POST /api/export (basic CSV/XLSX export)
import ExcelJS from 'exceljs';
import {
  getClassDb, normalizeCas, handleCors,
  VALID_TABLES, findRowsByCas, getSubstanceName, isClassified,
} from './_lib/shared.js';

export default async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { cas_numbers = [], classifications = [], format = 'xlsx' } = req.body || {};
  const casList = cas_numbers.map(normalizeCas).filter(Boolean);
  const selectedTables = classifications.filter(t => VALID_TABLES.has(t));

  const db = getClassDb();
  const rows = [];

  for (const cas of casList) {
    const name = await getSubstanceName(db, cas) || '';

    let found = false;
    for (const table of selectedTables) {
      const dbRows = await findRowsByCas(db, table, cas);
      if (!dbRows.length) continue;
      found = true;
      const row = dbRows[0];

      const cols = Object.keys(row).filter(c => !['CAS', 'Substance Name', 'cid', 'rowid'].includes(c));
      const details = cols
        .filter(c => { const v = String(row[c] || '').trim().toLowerCase(); return v && !['not classified', '-', 'not applicable'].includes(v); })
        .map(c => `${c}: ${row[c]}`)
        .join(' | ');

      rows.push({ CAS: cas, 'Substance Name': name, Source: table.replace(/_/g, ' '), Details: details });
    }
    if (!found) rows.push({ CAS: cas, 'Substance Name': name, Source: 'Introuvable', Details: '' });
  }

  if (format === 'csv') {
    const header = 'CAS,Substance Name,Source,Details\n';
    const csv = rows.map(r => `"${r.CAS}","${r['Substance Name']}","${r.Source}","${(r.Details || '').replace(/"/g, '""')}"`).join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=export_classifications.csv');
    return res.send(header + csv);
  }

  // XLSX
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Classifications');
  ws.columns = [
    { header: 'CAS', key: 'CAS', width: 15 },
    { header: 'Substance Name', key: 'Substance Name', width: 30 },
    { header: 'Source', key: 'Source', width: 20 },
    { header: 'Details', key: 'Details', width: 60 },
  ];
  for (const r of rows) ws.addRow(r);
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1B4F72' } };
  ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename=export_classifications.xlsx');

  const buffer = await wb.xlsx.writeBuffer();
  res.send(Buffer.from(buffer));
}
