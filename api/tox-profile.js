// api/tox-profile.js — POST /api/tox-profile
// NOTE: This is a placeholder. You'll need to adapt your toxProfile.js module
// to work without filesystem dependencies (Vercel serverless = no persistent disk).
// The cache should use an in-memory Map (resets on cold starts) or Turso/KV.
import { handleCors } from './_lib/shared.js';

// TODO: Import your adapted generateToxProfile
// import { generateToxProfile } from './_lib/toxProfile.js';

export default async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { cas } = req.body || {};
  if (!cas) return res.status(400).json({ error: 'CAS requis' });

  // TODO: Uncomment when toxProfile.js is adapted
  // try {
  //   const profile = await generateToxProfile(cas);
  //   res.json(profile);
  // } catch (e) {
  //   console.error('Tox profile error:', e.message);
  //   res.status(500).json({ error: e.message });
  // }

  res.status(501).json({ error: 'Tox profile not yet migrated to Vercel. Coming soon.' });
}
