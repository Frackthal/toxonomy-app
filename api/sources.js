// api/sources.js — GET /api/sources
import { FLAT_OPTIONS, handleCors } from './_lib/shared.js';

export default function handler(req, res) {
  if (handleCors(req, res)) return;
  res.json(FLAT_OPTIONS);
}
