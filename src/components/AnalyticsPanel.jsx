import React from 'react';
import { DANGER_LABELS, DANGER_BAR_COLORS } from '../utils/api';

export default function AnalyticsPanel({ stats, dangerFilter, setDangerFilter }) {
  if (!stats || stats.total === 0) return null;

  const maxCount = Math.max(1, ...Object.values(stats.dangers));

  return (
    <div className="space-y-4 animate-fade-in">
      {/* Counters */}
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-lg bg-[var(--surface-50)] p-3">
          <div className="text-[11px] text-[var(--text-tertiary)] mb-0.5">Substances</div>
          <div className="text-2xl font-semibold text-[var(--text-primary)]">{stats.total}</div>
        </div>
        <div className="rounded-lg bg-[var(--surface-50)] p-3">
          <div className="text-[11px] text-[var(--text-tertiary)] mb-0.5">Trouvées</div>
          <div className="text-2xl font-semibold text-tox-600 dark:text-tox-400">{stats.found}</div>
        </div>
      </div>

      {/* Danger bars */}
      <div>
        <h4 className="text-xs font-medium text-[var(--text-secondary)] mb-2">Dangers identifiés</h4>
        <div className="space-y-2">
          {Object.entries(stats.dangers).map(([key, count]) => {
            const info = DANGER_LABELS[key];
            const barColor = DANGER_BAR_COLORS[key];
            const isActive = dangerFilter === key;
            const width = maxCount > 0 ? Math.max(2, (count / maxCount) * 100) : 0;

            return (
              <button
                key={key}
                onClick={() => setDangerFilter(isActive ? null : key)}
                className={`w-full text-left rounded-lg p-2 transition-all ${
                  isActive
                    ? 'bg-[var(--surface-100)] ring-1 ring-[var(--border-color)]'
                    : 'hover:bg-[var(--surface-50)]'
                }`}
              >
                <div className="flex justify-between items-center mb-1">
                  <span className="text-xs text-[var(--text-secondary)]">{info?.label || key}</span>
                  <span className="text-xs font-semibold text-[var(--text-primary)] tabular-nums">{count}</span>
                </div>
                <div className="h-1.5 rounded-full bg-[var(--surface-200)] overflow-hidden">
                  <div
                    className={`h-full rounded-full ${barColor} transition-all duration-500`}
                    style={{ width: `${width}%` }}
                  />
                </div>
              </button>
            );
          })}
        </div>
        {dangerFilter && (
          <button
            onClick={() => setDangerFilter(null)}
            className="mt-2 text-xs text-tox-600 dark:text-tox-400 hover:underline"
          >
            Effacer le filtre
          </button>
        )}
      </div>
    </div>
  );
}
