import React, { useState } from 'react';
import { useVTRSearch } from '../hooks/useSearch';
import { Search, Download, Loader2, ChevronDown, ChevronRight, BookOpen } from 'lucide-react';
import { apiDownload } from '../utils/api';

function VTRCard({ cas, data, index }) {
  const [expanded, setExpanded] = useState(false);
  const notFound = data.sources?.includes('Introuvable');
  const vtrData = data.details?.vtr_all;

  return (
    <div
      className={`rounded-xl bg-[var(--surface-0)] border border-[var(--border-color)] overflow-hidden animate-slide-up ${notFound ? 'opacity-50' : ''}`}
      style={{ animationDelay: `${index * 50}ms`, animationFillMode: 'backwards' }}
    >
      <div className={`h-1 ${notFound ? 'bg-red-500' : 'bg-indigo-500'}`} />
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="font-mono text-base font-semibold text-[var(--text-primary)]">{cas}</h3>
            {data.substanceName && (
              <p className="text-sm italic text-[var(--text-secondary)] mt-0.5">{data.substanceName}</p>
            )}
          </div>
          {notFound && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 font-medium">
              Non trouvé
            </span>
          )}
        </div>

        {!notFound && data.sources?.length > 0 && (
          <p className="text-xs text-[var(--text-tertiary)] mt-1.5">
            {data.sources.join(' · ')}
          </p>
        )}

        {vtrData && vtrData.rows?.length > 0 && (
          <>
            <button
              onClick={() => setExpanded(!expanded)}
              className="mt-3 flex items-center gap-1.5 text-sm font-medium text-indigo-600 dark:text-indigo-400 hover:underline"
            >
              {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              {vtrData.rows.length} valeur{vtrData.rows.length > 1 ? 's' : ''} de référence
            </button>

            {expanded && (
              <div className="mt-3 animate-slide-up">
                {/* Mobile: card view */}
                <div className="lg:hidden space-y-2">
                  {vtrData.rows.map((row, i) => (
                    <div key={i} className="rounded-lg bg-[var(--surface-50)] p-3 text-xs space-y-1.5">
                      {vtrData.columns.filter(c => row[c] != null && String(row[c]).trim()).map(col => (
                        <div key={col} className="flex justify-between gap-3">
                          <span className="text-[var(--text-tertiary)] shrink-0">{col}</span>
                          <span className="text-[var(--text-primary)] font-medium text-right break-words">{String(row[col])}</span>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>

                {/* Desktop: table view */}
                <div className="hidden lg:block overflow-x-auto">
                  <table className="w-full text-xs border-collapse">
                    <thead>
                      <tr className="border-b border-[var(--border-color)]">
                        {vtrData.columns.map(col => (
                          <th key={col} className="px-2 py-2 text-left font-medium text-[var(--text-secondary)] whitespace-nowrap bg-[var(--surface-50)]">
                            {col}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {vtrData.rows.map((row, i) => (
                        <tr key={i} className="border-b border-[var(--border-subtle)] hover:bg-[var(--surface-50)]">
                          {vtrData.columns.map(col => (
                            <td key={col} className="px-2 py-1.5 text-[var(--text-primary)] whitespace-nowrap max-w-[200px] truncate" title={String(row[col] ?? '')}>
                              {row[col] != null ? String(row[col]) : '—'}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default function VTRPage() {
  const { casList, setCasList, results, loading, search } = useVTRSearch();
  const hasResults = Object.keys(results).length > 0;

  const handleExport = () => {
    const casNumbers = casList.split(/[\n,;]/).map(c => c.trim()).filter(Boolean);
    apiDownload('/vtr_export/xlsx', { cas_numbers: casNumbers }, 'export_vtr.xlsx');
  };

  return (
    <div className="flex flex-col lg:flex-row h-full">
      {/* Left panel */}
      <div className="w-full lg:w-72 xl:w-80 shrink-0 border-b lg:border-b-0 lg:border-r border-[var(--border-color)] bg-[var(--surface-0)] overflow-y-auto">
        <div className="p-4 space-y-4">
          <div>
            <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
              Numéros CAS
            </label>
            <textarea
              rows={5}
              value={casList}
              onChange={e => setCasList(e.target.value)}
              placeholder="Un par ligne, ex:&#10;71-43-2&#10;50-00-0"
              className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-[var(--border-color)] bg-[var(--surface-0)] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] resize-y focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500"
            />
          </div>

          <button
            onClick={() => search()}
            disabled={loading}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium transition-colors disabled:opacity-60"
          >
            {loading ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />}
            Rechercher les VTR
          </button>

          {hasResults && (
            <button
              onClick={handleExport}
              className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg border border-[var(--border-color)] text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--surface-100)] transition-colors"
            >
              <Download size={13} /> Exporter en XLSX
            </button>
          )}
        </div>
      </div>

      {/* Results */}
      <div className="flex-1 overflow-y-auto">
        {!hasResults && !loading ? (
          <div className="flex flex-col items-center justify-center h-full text-center p-8">
            <div className="w-16 h-16 rounded-2xl bg-indigo-50 dark:bg-indigo-950 flex items-center justify-center mb-4">
              <BookOpen size={28} className="text-indigo-500" />
            </div>
            <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-1">Valeurs Toxicologiques de Référence</h2>
            <p className="text-sm text-[var(--text-secondary)] max-w-md">
              Interrogez la base VTR pour retrouver les valeurs de référence associées à vos substances.
            </p>
          </div>
        ) : (
          <div className="p-4 lg:p-6 max-w-4xl space-y-3">
            {loading ? (
              [...Array(3)].map((_, i) => (
                <div key={i} className="rounded-xl bg-[var(--surface-0)] border border-[var(--border-color)] h-28 animate-pulse">
                  <div className="h-1 bg-[var(--surface-200)] rounded-t-xl" />
                  <div className="p-4 space-y-3">
                    <div className="h-4 w-24 bg-[var(--surface-200)] rounded" />
                    <div className="h-3 w-40 bg-[var(--surface-100)] rounded" />
                  </div>
                </div>
              ))
            ) : (
              Object.entries(results).map(([cas, data], idx) => (
                <VTRCard key={cas} cas={cas} data={data} index={idx} />
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
