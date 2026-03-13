import { useState, useEffect, useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { apiPost, apiGet } from '../utils/api';
import { getAllSourceValues, SOURCES } from '../utils/sources';

// ─── Dark mode ──────────────────────────────────────────────────────────────
export function useDarkMode() {
  const [dark, setDark] = useState(() => {
    if (typeof window === 'undefined') return false;
    const stored = localStorage.getItem('toxonomy-dark');
    if (stored !== null) return stored === 'true';
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  });

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    localStorage.setItem('toxonomy-dark', String(dark));
  }, [dark]);

  return [dark, setDark];
}

// ─── Classification search with URL sync ────────────────────────────────────
export function useClassificationSearch() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [casList, setCasList] = useState(() => searchParams.get('cas') || '');

  // Selected tables: individual source values (e.g. 'CLP', 'IARC', etc.)
  const [selectedTables, setSelectedTables] = useState(() => {
    const t = searchParams.get('tables');
    if (t) return new Set(t.split(','));
    // Default: all sources selected
    return new Set(SOURCES.map(s => s.value));
  });

  const [results, setResults] = useState({});
  const [loading, setLoading] = useState(false);
  const [dangerFilter, setDangerFilter] = useState(null);

  // Toggle a single table
  const toggleTable = useCallback((value) => {
    setSelectedTables(prev => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
  }, []);

  // Toggle an entire group
  const toggleGroup = useCallback((group) => {
    const groupValues = SOURCES.filter(s => s.group === group).map(s => s.value);
    setSelectedTables(prev => {
      const next = new Set(prev);
      const allSelected = groupValues.every(v => next.has(v));
      if (allSelected) {
        groupValues.forEach(v => next.delete(v));
      } else {
        groupValues.forEach(v => next.add(v));
      }
      return next;
    });
  }, []);

  // Select all / deselect all
  const selectAll = useCallback(() => {
    setSelectedTables(new Set(SOURCES.map(s => s.value)));
  }, []);
  const deselectAll = useCallback(() => {
    setSelectedTables(new Set());
  }, []);

  const selectedTablesArray = useMemo(() => [...selectedTables], [selectedTables]);

  const search = useCallback(async (casText, tables) => {
    const casNumbers = (casText || casList).split(/[\n,;]/).map(c => c.trim()).filter(Boolean);
    const tbls = tables || selectedTablesArray;
    if (!casNumbers.length || !tbls.length) return;

    setLoading(true);
    try {
      const data = await apiPost('/search', { cas_numbers: casNumbers, classifications: tbls });
      setResults(data);
      setSearchParams({
        cas: casNumbers.join(','),
        tables: tbls.join(','),
      }, { replace: true });
    } catch (e) {
      console.error('Search failed:', e);
    } finally {
      setLoading(false);
    }
  }, [casList, selectedTablesArray, setSearchParams]);

  // Auto-search from URL on mount
  useEffect(() => {
    const urlCas = searchParams.get('cas');
    if (urlCas && Object.keys(results).length === 0) {
      setCasList(urlCas.replace(/,/g, '\n'));
      search(urlCas.replace(/,/g, '\n'));
    }
  }, []);

  // Stats
  const stats = useMemo(() => {
    const entries = Object.values(results);
    const total = entries.length;
    const found = entries.filter(e => !e.sources?.includes('Introuvable')).length;
    const dangers = { carcinogen: 0, mutagen: 0, reprotoxic: 0, ed: 0, resp_sens: 0, skin_sens: 0 };
    for (const e of entries) {
      if (e.CMR?.carcinogen) dangers.carcinogen++;
      if (e.CMR?.mutagen) dangers.mutagen++;
      if (e.CMR?.reprotoxic) dangers.reprotoxic++;
      if (e.PE_Sens?.ed) dangers.ed++;
      if (e.PE_Sens?.resp_sens) dangers.resp_sens++;
      if (e.PE_Sens?.skin_sens) dangers.skin_sens++;
    }
    return { total, found, dangers };
  }, [results]);

  // Filtered results
  const filteredResults = useMemo(() => {
    const entries = Object.entries(results);
    if (!dangerFilter) return entries;
    return entries.filter(([, data]) => {
      if (['carcinogen', 'mutagen', 'reprotoxic'].includes(dangerFilter)) return data.CMR?.[dangerFilter];
      return data.PE_Sens?.[dangerFilter];
    });
  }, [results, dangerFilter]);

  return {
    casList, setCasList,
    selectedTables, selectedTablesArray,
    toggleTable, toggleGroup, selectAll, deselectAll,
    results, filteredResults,
    loading, search, stats,
    dangerFilter, setDangerFilter,
  };
}

// ─── VTR search ─────────────────────────────────────────────────────────────
export function useVTRSearch() {
  const [casList, setCasList] = useState('');
  const [results, setResults] = useState({});
  const [loading, setLoading] = useState(false);

  const search = useCallback(async (casText) => {
    const casNumbers = (casText || casList).split(/[\n,;]/).map(c => c.trim()).filter(Boolean);
    if (!casNumbers.length) return;
    setLoading(true);
    try {
      const data = await apiPost('/vtr', { cas_numbers: casNumbers });
      setResults(data);
    } catch (e) {
      console.error('VTR search failed:', e);
    } finally {
      setLoading(false);
    }
  }, [casList]);

  return { casList, setCasList, results, loading, search };
}

// ─── Name search ────────────────────────────────────────────────────────────
export function useNameSearch() {
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (query.length < 2) { setSuggestions([]); return; }
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const data = await apiGet(`/search-name?q=${encodeURIComponent(query)}`);
        setSuggestions(data);
      } catch { setSuggestions([]); }
      finally { setLoading(false); }
    }, 250);
    return () => clearTimeout(timer);
  }, [query]);

  return { query, setQuery, suggestions, loading };
}
