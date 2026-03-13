import React, { useState } from 'react';
import { ChevronDown, ChevronRight, ExternalLink } from 'lucide-react';
import { DANGER_LABELS } from '../utils/api';

function DangerBadge({ type }) {
  const info = DANGER_LABELS[type];
  if (!info) return null;
  return (
    <span className={`badge ${info.class}`}>
      {info.label}
    </span>
  );
}

function DetailAccordion({ table, details }) {
  const [open, setOpen] = useState(false);
  const entries = Object.entries(details);
  if (!entries.length) return null;

  const prettyName = table.replace(/_/g, ' ');

  return (
    <div className="border-t border-[var(--border-subtle)]">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between py-2.5 px-1 text-sm hover:bg-[var(--surface-50)] rounded transition-colors"
      >
        <div className="flex items-center gap-2">
          {open ? <ChevronDown size={14} className="text-[var(--text-tertiary)]" /> : <ChevronRight size={14} className="text-[var(--text-tertiary)]" />}
          <span className="font-medium text-[var(--text-primary)]">{prettyName}</span>
        </div>
        <span className="text-[11px] text-[var(--text-tertiary)]">{entries.length} item{entries.length > 1 ? 's' : ''}</span>
      </button>

      {open && (
        <div className="pb-2 px-1 animate-slide-up">
          <div className="rounded-lg bg-[var(--surface-50)] divide-y divide-[var(--border-subtle)]">
            {entries.map(([key, val]) => (
              <div key={key} className="flex justify-between items-start px-3 py-2 text-sm gap-4">
                <span className="text-[var(--text-secondary)] text-xs shrink-0">{key}</span>
                <span className="text-[var(--text-primary)] text-xs font-medium text-right">{String(val)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function SubstanceCard({ cas, data, index = 0 }) {
  const notFound = data.sources?.includes('Introuvable');
  const allDangers = [];
  if (data.CMR) {
    for (const k of Object.keys(data.CMR)) if (data.CMR[k]) allDangers.push(k);
  }
  if (data.PE_Sens) {
    for (const k of Object.keys(data.PE_Sens)) if (data.PE_Sens[k]) allDangers.push(k);
  }

  return (
    <div
      className={`
        rounded-xl bg-[var(--surface-0)] border border-[var(--border-color)] overflow-hidden
        animate-slide-up
        ${notFound ? 'opacity-50' : ''}
      `}
      style={{ animationDelay: `${index * 50}ms`, animationFillMode: 'backwards' }}
    >
      {/* Color accent bar */}
      <div className={`h-1 ${notFound ? 'bg-red-500' : allDangers.length ? 'bg-amber-500' : 'bg-tox-500'}`} />

      <div className="p-4">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 mb-1">
          <div>
            <h3 className="font-mono text-base font-semibold text-[var(--text-primary)]">{cas}</h3>
            {data.substanceName && (
              <p className="text-sm italic text-[var(--text-secondary)] mt-0.5">{data.substanceName}</p>
            )}
          </div>
          {notFound && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 font-medium whitespace-nowrap">
              Non trouvé
            </span>
          )}
        </div>

        {/* Danger badges */}
        {allDangers.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {allDangers.map(d => <DangerBadge key={d} type={d} />)}
          </div>
        )}

        {/* Sources summary */}
        {!notFound && (
          <p className="text-xs text-[var(--text-tertiary)] mt-2">
            {data.sources?.join(' · ')}
          </p>
        )}

        {/* Detail accordions */}
        {data.details && Object.keys(data.details).length > 0 && (
          <div className="mt-3">
            {Object.entries(data.details).map(([table, details]) => (
              <DetailAccordion key={table} table={table} details={details} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
