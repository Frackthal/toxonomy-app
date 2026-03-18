// api/tox-profile/cache.js — GET /api/tox-profile/cache
import { handleCors } from '../_lib/shared.js';
import { getCacheStats } from '../_lib/toxProfile.js';

export default function handler(req, res) {
  if (handleCors(req, res)) return;
  res.json(getCacheStats());
}
