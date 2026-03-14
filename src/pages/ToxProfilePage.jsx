import React, { useState } from 'react';
import { Search, Loader2, FlaskConical, AlertCircle, CheckCircle2, ChevronDown, ChevronRight, Database, Sparkles, RefreshCw } from 'lucide-react';

// ─── Couleurs par section ─────────────────────────────────────────────────────
const SECTION_META = {
  toxicokinetics:        { color: 'bg-violet-500',  light: 'bg-violet-50 dark:bg-violet-950/30',  border: 'border-violet-200 dark:border-violet-800' },
  acuteToxicity:         { color: 'bg-red-500',     light: 'bg-red-50 dark:bg-red-950/30',        border: 'border-red-200 dark:border-red-800' },
  irritationCorrosion:   { color: 'bg-orange-500',  light: 'bg-orange-50 dark:bg-orange-950/30',  border: 'border-orange-200 dark:border-orange-800' },
  sensitization:         { color: 'bg-amber-500',   light: 'bg-amber-50 dark:bg-amber-950/30',    border: 'border-amber-200 dark:border-amber-800' },
  repeatedDoseToxicity:  { color: 'bg-yellow-600',  light: 'bg-yellow-50 dark:bg-yellow-950/30',  border: 'border-yellow-200 dark:border-yellow-800' },
  genotoxicity:          { color: 'bg-pink-500',    light: 'bg-pink-50 dark:bg-pink-950/30',      border: 'border-pink-200 dark:border-pink-800' },
  carcinogenicity:       { color: 'bg-rose-700',    light: 'bg-rose-50 dark:bg-rose-950/30',      border: 'border-rose-200 dark:border-rose-800' },
  reproductiveToxicity:  { color: 'bg-fuchsia-500', light: 'bg-fuchsia-50 dark:bg-fuchsia-950/30',border: 'border-fuchsia-200 dark:border-fuchsia-800' },
  humanData:             { color: 'bg-sky-500',     light: 'bg-sky-50 dark:bg-sky-950/30',        border: 'border-sky-200 dark:border-sky-800' },
  referenceValues:       { color: 'bg-teal-600',    light: 'bg-teal-50 dark:bg-teal-950/30',      border: 'border-teal-200 dark:border-teal-800' },
};

// ─── Composant section ────────────────────────────────────────────────────────
function ProfileSection({ sectionKey, section }) {
  const [open, setOpen] = useState(true);
  const meta = SECTION_META[sectionKey] || { color: 'bg-stone-400', light: 'bg-stone-50', border: 'border-stone-200' };

  return (
    <div className={`rounded-xl border ${meta.border} overflow-hidden`}>
      <button
        onClick={() => setOpen(!open)}
        className={`w-full flex items-center gap-3 px-4 py-3 text-left ${meta.light} hover:opacity-90 transition-opacity`}
      >
        <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${meta.color}`} />
        <span className="flex-1 text-sm font-semibold text-[var(--text-primary)]">{section.title}</span>
        {!section.available && (
          <span className="text-[11px] px-2 py-0.5 rounded-full bg-[var(--surface-200)] text-[var(--text-tertiary)] font-medium">
            Non disponible
          </span>
        )}
        {open
          ? <ChevronDown size={14} className="text-[var(--text-tertiary)] shrink-0" />
          : <ChevronRight size={14} className="text-[var(--text-tertiary)] shrink-0" />
        }
      </button>

      {open && (
        <div className="px-4 py-4 bg-[var(--surface-0)]">
          {section.available
            ? <p className="text-sm text-[var(--text-primary)] leading-relaxed whitespace-pre-wrap">{section.content}</p>
            : <p className="text-sm text-[var(--text-tertiary)] italic">Données non disponibles dans les sources consultées.</p>
          }
        </div>
      )}
    </div>
  );
}

// ─── Composant profil complet ─────────────────────────────────────────────────
function ToxProfile({ profile, onReset }) {
  const sectionOrder = [
    'toxicokinetics', 'acuteToxicity', 'irritationCorrosion', 'sensitization',
    'repeatedDoseToxicity', 'genotoxicity', 'carcinogenicity',
    'reproductiveToxicity', 'humanData', 'referenceValues',
  ];

  const availableCount = sectionOrder.filter(k => profile.sections?.[k]?.available).length;

  return (
    <div className="max-w-3xl animate-fade-in">
      {/* En-tête substance */}
      <div className="rounded-xl bg-[var(--surface-0)] border border-[var(--border-color)] p-5 mb-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-display italic text-[var(--text-primary)]">
              {profile.substanceName}
            </h2>
            <div className="flex items-center gap-3 mt-1.5 flex-wrap">
              <span className="font-mono text-sm text-[var(--text-secondary)]">CAS {profile.cas}</span>
              {profile.formula && (
                <span className="font-mono text-sm text-[var(--text-secondary)]">{profile.formula}</span>
              )}
              {profile.cid && (
                <a
                  href={`https://pubchem.ncbi.nlm.nih.gov/compound/${profile.cid}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-tox-600 dark:text-tox-400 hover:underline flex items-center gap-1"
                >
                  <Database size={11} /> PubChem CID {profile.cid}
                </a>
              )}
            </div>
          </div>
          <button
            onClick={onReset}
            className="p-2 rounded-lg hover:bg-[var(--surface-100)] text-[var(--text-tertiary)] shrink-0"
            title="Nouvelle recherche"
          >
            <RefreshCw size={15} />
          </button>
        </div>

        {/* Indicateurs */}
        <div className="flex items-center gap-4 mt-3 pt-3 border-t border-[var(--border-color)]">
          <div className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)]">
            <Sparkles size={13} className="text-tox-500" />
            Généré par Gemini Flash
            {profile.fromCache && <span className="text-[var(--text-tertiary)]">(cache)</span>}
          </div>
          <div className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)]">
            <CheckCircle2 size={13} className="text-emerald-500" />
            {availableCount}/{sectionOrder.length} sections disponibles
          </div>
        </div>

        {/* Qualité des données */}
        {profile.dataQuality && (
          <div className="mt-3 text-xs text-[var(--text-secondary)] italic bg-[var(--surface-50)] rounded-lg px-3 py-2">
            {profile.dataQuality}
          </div>
        )}
      </div>

      {/* Avertissement */}
      <div className="flex items-start gap-2.5 rounded-xl bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 px-4 py-3 mb-5">
        <AlertCircle size={15} className="text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
        <p className="text-xs text-amber-800 dark:text-amber-300 leading-relaxed">
          Ce profil est généré automatiquement à partir de données PubChem synthétisées par IA. Il ne se substitue pas à une évaluation toxicologique complète par un expert. Vérifier les sources primaires avant tout usage réglementaire.
        </p>
      </div>

      {/* Sections */}
      <div className="space-y-3">
        {sectionOrder.map(key => {
          const section = profile.sections?.[key];
          if (!section) return null;
          return <ProfileSection key={key} sectionKey={key} section={section} />;
        })}
      </div>

      {/* Sources */}
      {profile.sources?.length > 0 && (
        <div className="mt-5 rounded-xl bg-[var(--surface-0)] border border-[var(--border-color)] p-4">
          <h4 className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider mb-3">
            Sources primaires citées
          </h4>
          <ul className="space-y-1">
            {profile.sources.map((src, i) => (
              <li key={i} className="text-xs text-[var(--text-secondary)] flex items-start gap-2">
                <span className="text-[var(--text-tertiary)] shrink-0 font-mono">{i + 1}.</span>
                {src}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ─── Page principale ──────────────────────────────────────────────────────────
export default function ToxProfilePage() {
  const [cas, setCas] = useState('');
  const [loading, setLoading] = useState(false);
  const [profile, setProfile] = useState(null);
  const [error, setError] = useState(null);

  const API_BASE = import.meta.env.PROD ? '/api' : 'http://localhost:5000/api';

  const handleSearch = async () => {
    const trimmed = cas.trim();
    if (!trimmed) return;
    setLoading(true);
    setError(null);
    setProfile(null);
    try {
      const res = await fetch(`${API_BASE}/tox-profile`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cas: trimmed }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Erreur ${res.status}`);
      setProfile(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e) => { if (e.key === 'Enter') handleSearch(); };

  return (
    <div className="flex flex-col lg:flex-row h-full">
      {/* Panneau gauche */}
      <div className="w-full lg:w-72 xl:w-80 shrink-0 border-b lg:border-b-0 lg:border-r border-[var(--border-color)] bg-[var(--surface-0)] overflow-y-auto">
        <div className="p-4 space-y-4">
          <div>
            <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
              Numéro CAS
            </label>
            <input
              type="text"
              value={cas}
              onChange={e => setCas(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="ex: 71-43-2"
              className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-[var(--border-color)] bg-[var(--surface-0)] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:ring-2 focus:ring-tox-500/30 focus:border-tox-500"
            />
          </div>

          <button
            onClick={handleSearch}
            disabled={loading || !cas.trim()}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-tox-600 hover:bg-tox-700 text-white text-sm font-medium transition-colors disabled:opacity-60"
          >
            {loading
              ? <><Loader2 size={16} className="animate-spin" /> Génération en cours…</>
              : <><Sparkles size={16} /> Générer le profil</>
            }
          </button>

          {/* Info */}
          <div className="rounded-lg bg-[var(--surface-50)] border border-[var(--border-color)] p-3 text-xs text-[var(--text-secondary)] space-y-1.5 leading-relaxed">
            <p className="font-medium text-[var(--text-primary)]">Sources utilisées</p>
            <p>• PubChem (NLM) — données tox brutes</p>
            <p>• Gemini Flash 2.0 — synthèse structurée</p>
            <p className="text-[var(--text-tertiary)]">Grille ECHA/REACH. Résultats mis en cache 24h.</p>
          </div>
        </div>
      </div>

      {/* Zone résultats */}
      <div className="flex-1 overflow-y-auto">
        {error && (
          <div className="p-4 lg:p-6">
            <div className="flex items-start gap-3 rounded-xl bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 p-4">
              <AlertCircle size={18} className="text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-red-800 dark:text-red-300 mb-1">Erreur de génération</p>
                <p className="text-xs text-red-700 dark:text-red-400">{error}</p>
                {error.includes('GEMINI_API_KEY') && (
                  <p className="text-xs text-red-600 dark:text-red-500 mt-2">
                    Ajoute la variable d'environnement <code className="font-mono bg-red-100 dark:bg-red-900/40 px-1 rounded">GEMINI_API_KEY</code> sur ton serveur.
                  </p>
                )}
              </div>
            </div>
          </div>
        )}

        {!profile && !loading && !error && (
          <div className="flex flex-col items-center justify-center h-full text-center p-8">
            <div className="w-16 h-16 rounded-2xl bg-tox-50 dark:bg-tox-950 flex items-center justify-center mb-4">
              <FlaskConical size={28} className="text-tox-500" />
            </div>
            <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-1">Profils toxicologiques</h2>
            <p className="text-sm text-[var(--text-secondary)] max-w-sm">
              Saisissez un numéro CAS pour générer un profil structuré selon la grille ECHA — toxicocinétique, toxicité aiguë, doses répétées, cancérogénicité, reproduction et plus.
            </p>
          </div>
        )}

        {loading && (
          <div className="flex flex-col items-center justify-center h-full text-center p-8">
            <Loader2 size={32} className="text-tox-500 animate-spin mb-4" />
            <p className="text-sm font-medium text-[var(--text-primary)] mb-1">Génération du profil…</p>
            <p className="text-xs text-[var(--text-secondary)]">
              Récupération des données PubChem puis synthèse par Gemini. 15–30 secondes.
            </p>
          </div>
        )}

        {profile && !loading && (
          <div className="p-4 lg:p-6">
            <ToxProfile profile={profile} onReset={() => { setProfile(null); setCas(''); }} />
          </div>
        )}
      </div>
    </div>
  );
}
