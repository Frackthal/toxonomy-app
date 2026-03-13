import React from 'react';
import { useClassificationSearch } from '../hooks/useSearch';
import SearchPanel from '../components/SearchPanel';
import SubstanceCard from '../components/SubstanceCard';
import AnalyticsPanel from '../components/AnalyticsPanel';
import ClassificationMatrix from '../components/ClassificationMatrix';
import { Beaker, SearchX } from 'lucide-react';

export default function ClassificationsPage() {
  const {
    casList, setCasList,
    selectedTables, selectedTablesArray,
    toggleTable, toggleGroup, selectAll, deselectAll,
    results, filteredResults,
    loading, search, stats,
    dangerFilter, setDangerFilter,
  } = useClassificationSearch();

  const hasResults = Object.keys(results).length > 0;

  return (
    <div className="flex flex-col lg:flex-row h-full">
      {/* Left panel */}
      <div className="w-full lg:w-72 xl:w-80 shrink-0 border-b lg:border-b-0 lg:border-r border-[var(--border-color)] bg-[var(--surface-0)] overflow-y-auto">
        <div className="p-4 space-y-5">
          <SearchPanel
            casList={casList}
            setCasList={setCasList}
            selectedTables={selectedTables}
            selectedTablesArray={selectedTablesArray}
            toggleTable={toggleTable}
            toggleGroup={toggleGroup}
            selectAll={selectAll}
            deselectAll={deselectAll}
            onSearch={search}
            loading={loading}
          />

          {hasResults && (
            <div className="border-t border-[var(--border-color)] pt-4">
              <AnalyticsPanel
                stats={stats}
                dangerFilter={dangerFilter}
                setDangerFilter={setDangerFilter}
              />
            </div>
          )}
        </div>
      </div>

      {/* Results area */}
      <div className="flex-1 overflow-y-auto">
        {!hasResults && !loading ? (
          <div className="flex flex-col items-center justify-center h-full text-center p-8">
            <div className="w-16 h-16 rounded-2xl bg-tox-50 dark:bg-tox-950 flex items-center justify-center mb-4">
              <Beaker size={28} className="text-tox-500" />
            </div>
            <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-1">Classifications toxicologiques</h2>
            <p className="text-sm text-[var(--text-secondary)] max-w-md">
              Saisissez des numéros CAS et sélectionnez les sources de classification pour interroger la base multi-agences.
            </p>
          </div>
        ) : (
          <div className="p-4 lg:p-6 max-w-4xl">
            {/* Results header */}
            {hasResults && (
              <div className="mb-4">
                <div className="flex items-center justify-between mb-1">
                  <h2 className="text-sm font-medium text-[var(--text-secondary)]">
                    {filteredResults.length} résultat{filteredResults.length !== 1 ? 's' : ''}
                    {dangerFilter && (
                      <span className="ml-1 text-tox-600 dark:text-tox-400">
                        (filtrés)
                      </span>
                    )}
                  </h2>
                </div>
              </div>
            )}

            {/* Matrix */}
            {hasResults && !dangerFilter && (
              <div className="mb-5">
                <ClassificationMatrix results={results} />
              </div>
            )}

            {/* Cards */}
            {loading ? (
              <div className="space-y-3">
                {[...Array(3)].map((_, i) => (
                  <div key={i} className="rounded-xl bg-[var(--surface-0)] border border-[var(--border-color)] h-32 animate-pulse">
                    <div className="h-1 bg-[var(--surface-200)] rounded-t-xl" />
                    <div className="p-4 space-y-3">
                      <div className="h-4 w-24 bg-[var(--surface-200)] rounded" />
                      <div className="h-3 w-40 bg-[var(--surface-100)] rounded" />
                      <div className="flex gap-2">
                        <div className="h-5 w-20 bg-[var(--surface-100)] rounded-full" />
                        <div className="h-5 w-16 bg-[var(--surface-100)] rounded-full" />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="space-y-3">
                {filteredResults.length === 0 && hasResults && (
                  <div className="flex flex-col items-center py-12 text-center">
                    <SearchX size={32} className="text-[var(--text-tertiary)] mb-3" />
                    <p className="text-sm text-[var(--text-secondary)]">Aucun résultat ne correspond au filtre sélectionné.</p>
                  </div>
                )}
                {filteredResults.map(([cas, data], idx) => (
                  <SubstanceCard key={cas} cas={cas} data={data} index={idx} />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
