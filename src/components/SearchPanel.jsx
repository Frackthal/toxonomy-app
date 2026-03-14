import React, { useState, useRef, useEffect } from 'react';
import { Search, Download, Loader2, ChevronDown, ChevronRight, Check } from 'lucide-react';
import { CLASSIFICATION_GROUPS, apiDownload } from '../utils/api';
import { SOURCES, GROUPS, getSourcesByGroup } from '../utils/sources';
import { useNameSearch } from '../hooks/useSearch';

const GROUP_CHIP_STYLES = {
  'GHS': { active: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300', ring: 'ring-blue-300/40' },
  'Cancérogénicité': { active: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300', ring: 'ring-red-300/40' },
  'Perturbateurs endocriniens': { active: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300', ring: 'ring-amber-300/40' },
  'Autres': { active: 'bg-stone-100 text-stone-700 dark:bg-stone-700/40 dark:text-stone-300', ring: 'ring-stone-300/40' },
};

const GROUP_SHORT_LABELS = {
  'GHS': 'GHS',
  'Cancérogénicité': 'CMR',
  'Perturbateurs endocriniens': 'PE',
  'Autres': 'Autres',
};

function SourceGroupAccordion({ group, selectedTables, toggleTable, toggleGroup }) {
  const [open, setOpen] = useState(false);
  const sources = getSourcesByGroup(group);
  const selectedCount = sources.filter(s => selectedTables.has(s.value)).length;
  const allSelected = selectedCount === sources.length;
  const noneSelected = selectedCount === 0;
  const style = GROUP_CHIP_STYLES[group] || GROUP_CHIP_STYLES['Autres'];

  return (
    <div className="rounded-lg border border-[var(--border-color)] overflow-hidden">
      {/* Group header — click to expand, checkbox to toggle group */}
      <div className="flex items-center gap-1.5 bg-[var(--surface-50)]">
        <button
          onClick={() => toggleGroup(group)}
          className={`
            w-7 h-7 ml-1.5 rounded flex items-center justify-center shrink-0 transition-colors
            ${allSelected
              ? 'bg-tox-600 text-white'
              : noneSelected
                ? 'border border-[var(--border-color)] bg-[var(--surface-0)]'
                : 'bg-tox-200 dark:bg-tox-900 text-tox-700 dark:text-tox-300'
            }
          `}
          title={allSelected ? 'Tout désélectionner' : 'Tout sélectionner'}
        >
          {allSelected && <Check size={13} strokeWidth={3} />}
          {!allSelected && !noneSelected && <span className="block w-2 h-0.5 bg-current rounded" />}
        </button>

        <button
          onClick={() => setOpen(!open)}
          className="flex-1 flex items-center justify-between py-2 pr-2 text-left"
        >
          <span className="text-xs font-medium text-[var(--text-primary)]">
            {GROUP_SHORT_LABELS[group] || group}
            <span className="ml-1.5 text-[var(--text-tertiary)] font-normal">
              {selectedCount}/{sources.length}
            </span>
          </span>
          {open
            ? <ChevronDown size={13} className="text-[var(--text-tertiary)]" />
            : <ChevronRight size={13} className="text-[var(--text-tertiary)]" />
          }
        </button>
      </div>

      {/* Individual sources */}
      {open && (
        <div className="border-t border-[var(--border-color)] bg-[var(--surface-0)]">
          {sources.map(source => {
            const isSelected = selectedTables.has(source.value);
            return (
              <button
                key={source.value}
                onClick={() => toggleTable(source.value)}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-[var(--surface-50)] transition-colors"
              >
                <span className={`
                  w-4 h-4 rounded flex items-center justify-center shrink-0 transition-colors
                  ${isSelected
                    ? 'bg-tox-600 text-white'
                    : 'border border-[var(--border-color)] bg-[var(--surface-0)]'
                  }
                `}>
                  {isSelected && <Check size={10} strokeWidth={3} />}
                </span>
                <span className={`text-xs ${isSelected ? 'text-[var(--text-primary)]' : 'text-[var(--text-tertiary)]'}`}>
                  {source.label}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function SearchPanel({
  casList, setCasList,
  selectedTables, toggleTable, toggleGroup, selectAll, deselectAll,
  selectedTablesArray,
  onSearch, loading,
  showExport = true,
}) {
  const { query, setQuery, suggestions } = useNameSearch();
  const [showSuggestions, setShowSuggestions] = useState(false);
  const suggestRef = useRef(null);

  useEffect(() => {
    const handler = (e) => {
      if (suggestRef.current && !suggestRef.current.contains(e.target)) setShowSuggestions(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const addCasFromSuggestion = (cas) => {
    const current = casList.split('\n').map(c => c.trim()).filter(Boolean);
    if (!current.includes(cas)) {
      setCasList([...current, cas].join('\n'));
    }
    setQuery('');
    setShowSuggestions(false);
  };

  const handleExport = (type) => {
    const casNumbers = casList.split(/[\n,;]/).map(c => c.trim()).filter(Boolean);
    if (type === 'multiple') {
      apiDownload('/export/multiple', { cas_numbers: casNumbers, classifications: selectedTablesArray }, 'export_multiple.xlsx');
    } else {
      apiDownload('/export/combined', { cas_numbers: casNumbers, classifications: selectedTablesArray }, 'export_combine.xlsx');
    }
  };

  const totalSources = SOURCES.length;
  const selectedCount = selectedTables.size;

  return (
    <div className="space-y-4">
      {/* Name search */}
      <div className="relative" ref={suggestRef}>
        <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
          Recherche par nom
        </label>
        <input
          type="text"
          value={query}
          onChange={e => { setQuery(e.target.value); setShowSuggestions(true); }}
          onFocus={() => suggestions.length && setShowSuggestions(true)}
          placeholder="ex: Benzene, Formaldehyde…"
          className="w-full px-3 py-2 text-sm rounded-lg border border-[var(--border-color)] bg-[var(--surface-0)] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:ring-2 focus:ring-tox-500/30 focus:border-tox-500"
        />
        {showSuggestions && suggestions.length > 0 && (
          <div className="absolute z-20 mt-1 w-full bg-[var(--surface-0)] border border-[var(--border-color)] rounded-lg shadow-lg max-h-48 overflow-y-auto">
            {suggestions.map(s => (
              <button
                key={s.cas}
                onClick={() => addCasFromSuggestion(s.cas)}
                className="w-full text-left px-3 py-2 text-sm hover:bg-[var(--surface-100)] flex justify-between items-center"
              >
                <span className="truncate text-[var(--text-primary)]">{s.name}</span>
                <span className="text-xs font-mono text-[var(--text-tertiary)] ml-2 shrink-0">{s.cas}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* CAS textarea */}
      <div>
        <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
          Numéros CAS
        </label>
        <textarea
          rows={5}
          value={casList}
          onChange={e => setCasList(e.target.value)}
          placeholder="Un par ligne, ex:&#10;71-43-2&#10;50-00-0&#10;75-01-4"
          className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-[var(--border-color)] bg-[var(--surface-0)] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] resize-y focus:outline-none focus:ring-2 focus:ring-tox-500/30 focus:border-tox-500"
        />
      </div>

      {/* Source selection — accordion groups */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-xs font-medium text-[var(--text-secondary)]">
            Sources
            <span className="ml-1 text-[var(--text-tertiary)] font-normal">{selectedCount}/{totalSources}</span>
          </label>
          <div className="flex gap-2">
            <button onClick={selectAll} className="text-[11px] text-tox-600 dark:text-tox-400 hover:underline">Tout</button>
            <button onClick={deselectAll} className="text-[11px] text-[var(--text-tertiary)] hover:underline">Aucun</button>
          </div>
        </div>
        <div className="space-y-1.5">
          {GROUPS.map(group => (
            <SourceGroupAccordion
              key={group}
              group={group}
              selectedTables={selectedTables}
              toggleTable={toggleTable}
              toggleGroup={toggleGroup}
            />
          ))}
        </div>
      </div>

      {/* Search button */}
      <button
        onClick={() => onSearch()}
        disabled={loading || selectedCount === 0}
        className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-tox-600 hover:bg-tox-700 text-white text-sm font-medium transition-colors disabled:opacity-60"
      >
        {loading ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />}
        Rechercher
      </button>

      {/* Export buttons */}
      {showExport && (
        <div className="space-y-1.5">
          <p className="text-[11px] text-[var(--text-tertiary)] font-medium uppercase tracking-wide">Export XLSX</p>
          <button
            onClick={() => handleExport('multiple')}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg border border-[var(--border-color)] text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--surface-100)] transition-colors"
          >
            <Download size={13} className="shrink-0 text-tox-600 dark:text-tox-400" />
            <span className="text-left">
              <span className="block text-[var(--text-primary)]">Export Multiple</span>
              <span className="text-[var(--text-tertiary)] font-normal">1 feuille par source</span>
            </span>
          </button>
          <button
            onClick={() => handleExport('combined')}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg border border-[var(--border-color)] text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--surface-100)] transition-colors"
          >
            <Download size={13} className="shrink-0 text-indigo-500" />
            <span className="text-left">
              <span className="block text-[var(--text-primary)]">Export Combiné</span>
              <span className="text-[var(--text-tertiary)] font-normal">Synthèse multi-sources</span>
            </span>
          </button>
        </div>
      )}
    </div>
  );
}
