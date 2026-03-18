// api/tox-profile/cache.js — GET /api/tox-profile/cache
import { handleCors } from '../_lib/shared.js';

export default function handler(req, res) {
  if (handleCors(req, res)) return;
  // In serverless, in-memory cache resets on cold starts
  // TODO: Implement with Turso or Vercel KV if needed
  res.json({ entries: 0, note: 'Cache is per-instance in serverless mode' });
}
