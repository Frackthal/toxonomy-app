import React, { useState } from 'react';
import { Grid3X3, X } from 'lucide-react';
import { DANGER_LABELS } from '../utils/api';

export default function ClassificationMatrix({ results }) {
  const [open, setOpen] = useState(false);
  const entries = Object.entries(results).filter(([, d]) => !d.sources?.includes('Introuvable'));

  if (entries.length < 2) return null;

  // Collect all source tables that have data
  const allTables = new Set();
  for (const [, data] of entries) {
    if (data.details) {
      for (const table of Object.keys(data.details)) {
        if (Object.keys(data.details[table]).length > 0) allTables.add(table);
      }
    }
  }
  const tables = [...allTables].sort();
  if (tables.length === 0) return null;

  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 text-sm font-medium text-tox-600 dark:text-tox-400 hover:underline mb-3"
      >
        <Grid3X3 size={15} />
        {open ? 'Masquer la matrice' : 'Matrice de classification'}
      </button>

      {open && (
        <div className="rounded-xl bg-[var(--surface-0)] border border-[var(--border-color)] overflow-hidden animate-slide-up">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-[var(--border-color)]">
                  <th className="sticky left-0 z-10 bg-[var(--surface-50)] px-3 py-2.5 text-left font-medium text-[var(--text-secondary)] min-w-[140px]">
                    Substance
                  </th>
                  {/* Danger summary columns */}
                  {Object.entries(DANGER_LABELS).map(([key, info]) => (
                    <th key={key} className="px-2 py-2.5 text-center font-medium text-[var(--text-secondary)] min-w-[40px]" title={info.label}>
                      {info.short}
                    </th>
                  ))}
                  {/* Source columns */}
                  {tables.map(t => (
                    <th key={t} className="px-2 py-2.5 text-center font-medium text-[var(--text-secondary)] whitespace-nowrap min-w-[70px]">
                      <span className="writing-mode-vertical" title={t.replace(/_/g, ' ')}>
                        {t.replace(/_/g, ' ')}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {entries.map(([cas, data], idx) => (
                  <tr key={cas} className={`border-b border-[var(--border-subtle)] ${idx % 2 === 0 ? '' : 'bg-[var(--surface-50)]'}`}>
                    <td className="sticky left-0 z-10 bg-inherit px-3 py-2 font-mono font-medium text-[var(--text-primary)]">
                      <div>{cas}</div>
                      {data.substanceName && (
                        <div className="text-[10px] text-[var(--text-tertiary)] truncate max-w-[130px]" title={data.substanceName}>
                          {data.substanceName}
                        </div>
                      )}
                    </td>
                    {/* Danger cells */}
                    {Object.keys(DANGER_LABELS).map(key => {
                      const hasDanger = key in (data.CMR || {}) || key in (data.PE_Sens || {});
                      return (
                        <td key={key} className="px-2 py-2 text-center">
                          {hasDanger ? (
                            <span className={`inline-block w-5 h-5 rounded-md ${DANGER_LABELS[key].class} text-[10px] font-bold leading-5`}>
                              {DANGER_LABELS[key].short}
                            </span>
                          ) : (
                            <span className="text-[var(--text-tertiary)]">—</span>
                          )}
                        </td>
                      );
                    })}
                    {/* Source cells */}
                    {tables.map(t => {
                      const hasData = data.details?.[t] && Object.keys(data.details[t]).length > 0;
                      return (
                        <td key={t} className="px-2 py-2 text-center">
                          {hasData ? (
                            <span className="inline-block w-3 h-3 rounded-full bg-tox-500" title="Classifié" />
                          ) : (
                            <span className="inline-block w-3 h-3 rounded-full bg-[var(--surface-200)]" title="Pas de données" />
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-3 py-2 border-t border-[var(--border-subtle)] flex gap-4 text-[10px] text-[var(--text-tertiary)]">
            <span className="flex items-center gap-1">
              <span className="inline-block w-2.5 h-2.5 rounded-full bg-tox-500" /> Classifié
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block w-2.5 h-2.5 rounded-full bg-[var(--surface-200)]" /> Pas de données
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
