// api/tox-profile.js — POST /api/tox-profile
import { handleCors } from '../lib/shared.js';
import { generateToxProfile } from '../lib/toxProfile.js';

export default async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { cas } = req.body || {};
  if (!cas) return res.status(400).json({ error: 'CAS requis' });

  try {
    const profile = await generateToxProfile(cas);
    res.json(profile);
  } catch (e) {
    console.error('Tox profile error:', e.message);
    res.status(500).json({ error: e.message });
  }
}
