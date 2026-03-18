// src/utils/api.js — Frontend API utilities (Vercel edition)
// On Vercel, API routes are at /api/* in both dev and prod

export async function apiPost(endpoint, body) {
  const res = await fetch(`/api${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export async function apiGet(endpoint) {
  const res = await fetch(`/api${endpoint}`);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export async function apiDownload(endpoint, body, filename) {
  const res = await fetch(`/api${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export const CLASSIFICATION_GROUPS = [
  { key: 'GHS', label: 'GHS', color: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300' },
  { key: 'Cancérogénicité', label: 'CMR', color: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300' },
  { key: 'Perturbateurs endocriniens', label: 'PE', color: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300' },
  { key: 'Autres', label: 'Autres', color: 'bg-stone-100 text-stone-700 dark:bg-stone-800 dark:text-stone-300' },
];

export const DANGER_LABELS = {
  carcinogen: { label: 'Cancérogène', short: 'C', class: 'bg-red-600 text-white' },
  mutagen:    { label: 'Mutagène',    short: 'M', class: 'bg-orange-600 text-white' },
  reprotoxic: { label: 'Reprotoxique', short: 'R', class: 'bg-pink-600 text-white' },
  ed:         { label: 'PE',          short: 'PE', class: 'bg-amber-500 text-white' },
  resp_sens:  { label: 'Sens. resp.', short: 'SR', class: 'bg-sky-500 text-white' },
  skin_sens:  { label: 'Sens. cut.',  short: 'SC', class: 'bg-emerald-500 text-white' },
};

export const DANGER_BAR_COLORS = {
  carcinogen: 'bg-red-500',
  mutagen:    'bg-orange-500',
  reprotoxic: 'bg-pink-500',
  ed:         'bg-amber-500',
  resp_sens:  'bg-sky-400',
  skin_sens:  'bg-emerald-400',
};
