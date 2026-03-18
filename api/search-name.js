// api/search-name.js — GET /api/search-name?q=benzene
import { getClassDb, handleCors } from './_lib/shared.js';

export default async function handler(req, res) {
  if (handleCors(req, res)) return;

  const q = String(req.query.q || '').trim();
  if (q.length < 2) return res.json([]);

  const db = getClassDb();

  try {
    const result = await db.execute({
      sql: `SELECT cas, name FROM name_lookup WHERE name LIKE ? LIMIT 20`,
      args: [`%${q}%`],
    });
    res.json(result.rows.map(r => ({ cas: r.cas, name: r.name })));
  } catch (e) {
    res.json([]);
  }
}
