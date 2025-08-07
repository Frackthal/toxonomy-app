import React, { useState } from 'react';
import './index.css';
import Select from 'react-select';
import { Menu, ChevronLeft, Home, HelpCircle, Download, Sun, Moon, Search, FileDown, BookOpen, ListTree, FileText, BookText } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import Documentation from './Documentation';

const API_BASE = import.meta.env.PROD
  ? 'https://toxonomy-app.onrender.com/api'
  : 'http://localhost:5000/api';


const flatOptions = [
  { label: 'CLP', value: 'CLP', group: 'GHS' },
  { label: 'GHS Japan', value: 'GHS_Japan', group: 'GHS' },
  { label: 'GHS Australia', value: 'GHS_Australia', group: 'GHS' },
  { label: 'GHS Korea', value: 'GHS_Korea', group: 'GHS' },
  { label: 'GHS China', value: 'GHS_China', group: 'GHS' },
  { label: 'IARC/CIRC', value: 'IARC', group: 'Cancérogénicité' },
  { label: 'ACGIH', value: 'ACGIH', group: 'Cancérogénicité' },
  { label: 'USEPA Carcinogens', value: 'USEPA_Carcinogens', group: 'Cancérogénicité' },
  { label: 'MAK Carcinogens', value: 'MAK_Carcinogens', group: 'Cancérogénicité' },
  { label: 'NTP Carcinogens', value: 'NTP_Carcinogens', group: 'Cancérogénicité' },
  { label: 'BKH-DHI', value: 'BKH_DHI', group: 'Perturbateurs endocriniens' },
  { label: 'DEDuCT', value: 'DEDuCT', group: 'Perturbateurs endocriniens' },
  { label: 'EU EDlists', value: 'EU_EDlists', group: 'Perturbateurs endocriniens' },
  { label: 'USEPA ED', value: 'USEPA_ED', group: 'Perturbateurs endocriniens' },
  { label: 'SINList', value: 'SINList', group: 'Perturbateurs endocriniens' },
  { label: 'TEDX', value: 'TEDX', group: 'Perturbateurs endocriniens' },
  { label: 'FEMA', value: 'FEMA', group: 'Autres' },
  { label: 'MAK Allergens', value: 'MAK_Allergens', group: 'Autres' },
  { label: 'HPHC', value: 'HPHC', group: 'Autres' }
];

const GROUPS = [...new Set(flatOptions.map(o => o.group))];
const CLASSIFICATION_OPTIONS = GROUPS.map(group => ({
  label: group,
  options: flatOptions.filter(o => o.group === group)
}));

function App() {
  const [page, setPage] = useState('home');
  const [casList, setCasList] = useState('');
  const [classifications, setClassifications] = useState([]);
  const [results, setResults] = useState({});
  const [menuOpen, setMenuOpen] = useState(true);
  const [darkMode, setDarkMode] = useState(false);
  const [activeTabs, setActiveTabs] = useState({});
  const [expandedCards, setExpandedCards] = useState({});

  const handleGroupSelect = (group) => {
    const groupOptions = flatOptions.filter(opt => opt.group === group);
    const groupValues = groupOptions.map(o => o.value);
    const selectedValues = classifications.map(c => c.value);
    const newSelections = [...new Set([...selectedValues, ...groupValues])];
    const newSelectedOptions = flatOptions.filter(o => newSelections.includes(o.value));
    setClassifications(newSelectedOptions);
  };

  const handleSearch = async () => {
    const casNumbers = casList.split('\n').map(c => c.trim()).filter(Boolean);
    const selectedTables = classifications.map(c => c.value);
    const response = await fetch(`${API_BASE}/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cas_numbers: casNumbers, classifications: selectedTables })
    });
    const data = await response.json();
    setResults(data);
    const initialTabs = Object.fromEntries(Object.keys(data).map(cas => [cas, Object.keys(data[cas]?.details || {})[0] || '']));
    setActiveTabs(initialTabs);
    setExpandedCards({});
  };

  const handleExport = async (format) => {
    const casNumbers = casList.split('\n').map(c => c.trim()).filter(Boolean);
    const selectedTables = classifications.map(c => c.value);
    const response = await fetch(`${API_BASE}/export/${format}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cas_numbers: casNumbers, classifications: selectedTables })
    });
    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = format === 'xlsx' ? 'export.xlsx' : 'export.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const logoSrc = darkMode ? '/logo-fiole-dark.svg' : '/logo-fiole.svg';
  const isValidValue = (val) => val && !['not classified', '-', 'not applicable', 'classification not possible'].includes(String(val).toLowerCase());

  const countCMR = { 'Cancérogène': 0, 'Mutagène': 0, 'Reprotox.': 0 };
  const countPE = { 'PE': 0, 'Sens. Resp.': 0, 'Sens. Cut.': 0 };
  Object.values(results).forEach(entry => {
    if (entry.CMR) {
      Object.keys(entry.CMR).forEach(cmr => {
        if (countCMR.hasOwnProperty(cmr)) countCMR[cmr]++;
      });
    }
    if (entry.PE_Sens) {
      Object.keys(entry.PE_Sens).forEach(pe => {
        if (countPE.hasOwnProperty(pe)) countPE[pe]++;
      });
    }
  });

  const CMR_DATA = [
    { name: 'Cancérogène', value: countCMR['Cancérogène'], fill: '#dc2626' },
    { name: 'Mutagène', value: countCMR['Mutagène'], fill: '#f97316' },
    { name: 'Reprotoxique', value: countCMR['Reprotox.'], fill: '#8b5cf6' },
    { name: 'PE', value: countPE['PE'], fill: '#eab308' },
    { name: 'Sens. Resp.', value: countPE['Sens. Resp.'], fill: '#facc15' },
    { name: 'Sens. Cut.', value: countPE['Sens. Cut.'], fill: '#fde047' }
  ];

  return (
    <div className={darkMode ? 'dark' : ''}>
      <div className="relative flex h-screen bg-white dark:bg-dm-bg dark:text-white">
        <aside className={"z-40 inset-y-0 left-0 bg-white dark:bg-dm-sidebar border-r dark:border-gray-700 shadow-xl transition-all ${menuOpen ? 'w-64 md:flex' : 'w-12 md:flex'} md:relative md:flex-col hidden md:flex"}>
          <div className="flex items-center justify-between p-4 h-16 border-b dark:border-gray-700 shadow-sm">
            <div className="flex items-center text-sm font-medium cursor-pointer" onClick={() => setMenuOpen(true)}>
              <Menu size={18} className="mr-2" />
              {menuOpen && 'Menu'}
            </div>
            {menuOpen && (
              <button onClick={() => setMenuOpen(false)} className="text-gray-500 hover:text-gray-700 dark:text-gray-300">
                <ChevronLeft size={20} />
              </button>
            )}
          </div>
          {menuOpen && (
            <nav className="flex-1 px-4 py-4 space-y-2 text-sm">
              <button onClick={() => setPage('home')} className="flex items-center hover:bg-gray-100 dark:hover:bg-gray-700 px-2 py-1 rounded w-full text-left">
                <ListTree size={16} className="mr-2" /> Classifications
              </button>
              
              <button onClick={() => setPage('vtr')} className="flex items-center hover:bg-gray-100 dark:hover:bg-gray-700 px-2 py-1 rounded w-full text-left">
                <BookOpen size={16} className="mr-2" /> Valeurs de référence
              </button>
			{/*
			<button onClick={() => setPage('toxicology')} className="flex items-center hover:bg-gray-100 dark:hover:bg-gray-700 px-2 py-1 rounded w-full text-left">
			  <FileText size={16} className="mr-2" /> Profil toxicologiques (Bêta)
			</button>
			*/}
              <button onClick={() => setPage('documentation')} className="flex items-center hover:bg-gray-100 dark:hover:bg-gray-700 px-2 py-1 rounded w-full text-left">
                <HelpCircle size={16} className="mr-2" /> Documentation
              </button>
            </nav>
          )}
        </aside>

        <div className="flex-1 flex flex-col overflow-auto md:ml-0">
          <header className="flex items-center justify-between px-6 h-16 min-h-16 bg-white/80 dark:bg-dm-sidebar/80 border-b dark:border-dm-border backdrop-blur-sm shadow-sm">
            <div className="flex items-center gap-3">
              <img src={logoSrc} alt="Toxonomy logo" className="h-[2.4rem] drop-shadow-md" />
              <span className="text-xl font-semibold text-gray-800 dark:text-white translate-y-[1px] inline-block">TOXONOMY</span>
            </div>
            <button onClick={() => setDarkMode(!darkMode)} className="p-2 rounded-full bg-gray-200 hover:bg-gray-300 dark:bg-gray-600 dark:hover:bg-gray-500">
              {darkMode ? <Sun size={18} className="text-white" /> : <Moon size={18} className="text-gray-800" />}
            </button>
          </header>
          {page === 'toxicology' ? (
  <main className="p-4 md:p-8 w-full flex flex-col md:flex-row gap-6 items-start">
    <div className="w-full md:w-[420px] shrink-0 space-y-4 bg-gray-100 dark:bg-[#5e6770] p-6 rounded shadow">
      <textarea
        rows={6}
        className="w-full border border-gray-300 dark:border-dm-border rounded p-2 bg-white dark:bg-[#bfc7d2] dark:text-dm-text"
        placeholder="Collez ici les numéros CAS (un par ligne)"
        value={casList}
        onChange={e => setCasList(e.target.value)}
      />
      <button
        className="w-full bg-teal-600 text-white px-4 py-2 rounded hover:bg-teal-700 flex items-center justify-center gap-2"
        onClick={async () => {
          const casNumbers = casList.split('\n').map(c => c.trim()).filter(Boolean);
          const response = await fetch(`${API_BASE}/toxicology`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ cas_numbers: casNumbers })
          });
          const data = await response.json();
          setResults(data);
          const initialTabs = Object.fromEntries(Object.keys(data).map(cas => [cas, Object.keys(data[cas]?.details || {})[0] || '']));
          setActiveTabs(initialTabs);
          setExpandedCards({});
        }}
      >
        <Search size={16} /> Rechercher
      </button>
    </div>
    <div className="flex-1 space-y-4">
      {Object.entries(results).map(([cas, data]) => {
        const currentTab = activeTabs[cas];
        const details = data.details || {};
        const isExpanded = expandedCards[cas] || false;
        return (
          <div key={cas} className={"bg-white dark:bg-[#bfc7d2] p-4 rounded shadow border-l-4 " + (data.sources.includes('Introuvable') ? 'border-red-600' : 'border-teal-600') + " dark:text-dm-text"}>
            <div className="font-semibold text-blue-900 mb-2 text-lg">CAS {cas}</div>
            <div className="text-sm text-blue-700 mb-2">{data.sources.join(', ')}</div>
            {Object.keys(details).length > 0 && (
              <>
                <button
                  onClick={() => setExpandedCards(prev => ({ ...prev, [cas]: !prev[cas] }))}
                  className="mt-2 px-3 py-1 bg-blue-900 text-white text-sm rounded hover:bg-blue-800 transition"
                >
                  {isExpanded ? 'Masquer les détails' : 'Voir les détails'}
                </button>
                {isExpanded && (
                  <div className="flex border-t pt-4 gap-4">
                    <div className="w-1/4">
                      {Object.keys(details).map((table) => (
                        <div
                          key={table}
                          onClick={() => setActiveTabs(prev => ({ ...prev, [cas]: table }))}
                          className={`cursor-pointer px-2 py-1 rounded mb-1 text-sm ${currentTab === table ? 'bg-teal-600 text-white' : 'hover:bg-gray-100 dark:hover:bg-gray-600'}`}
                        >
                          {table.replaceAll('_', ' ')}
                        </div>
                      ))}
                    </div>
                    <div className="w-3/4 text-sm space-y-2">
                      {details[currentTab] && (
                        <div className="bg-gray-50 dark:bg-gray-700 p-2 rounded">
                          <div className="flex items-center gap-2 text-lg font-bold">
                            <BookText size={18} /> {currentTab.replace('_', ' ')}
                          </div>
                          <div className="mt-2 whitespace-pre-line">{details[currentTab]}</div>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        );
      })}
    </div>
  </main>
) : page === 'documentation' ? (
  <main className="p-4 md:p-8 w-full">
    <Documentation />
  </main>

 ) : page === 'vtr' ? (
  <main className="p-4 md:p-8 w-full flex flex-col md:flex-row gap-6 items-start">
    <div className="w-full md:w-[420px] shrink-0 space-y-4 bg-gray-100 dark:bg-[#5e6770] p-6 rounded shadow">
      <textarea
        rows={6}
        className="w-full border border-gray-300 dark:border-dm-border rounded p-2 bg-white dark:bg-[#bfc7d2] dark:text-dm-text"
        placeholder="Collez ici les numéros CAS (un par ligne)"
        value={casList}
        onChange={e => setCasList(e.target.value)}
      />
      <button
        className="w-full bg-teal-600 text-white px-4 py-2 rounded hover:bg-teal-700 flex items-center justify-center gap-2"
        onClick={async () => {
          const casNumbers = casList.split('\n').map(c => c.trim()).filter(Boolean);
          const response = await fetch(`${API_BASE}/vtr`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ cas_numbers: casNumbers })
          });
          const data = await response.json();
          setResults(data);
          const initialTabs = Object.fromEntries(Object.keys(data).map(cas => [cas, Object.keys(data[cas]?.details || {})[0] || '']));
          setActiveTabs(initialTabs);
          setExpandedCards({});
        }}
      >
        <Search size={16} /> Rechercher
      </button>
	  <button
	  className="w-full bg-blue-900 text-white px-4 py-2 rounded hover:bg-blue-800 flex items-center justify-center gap-2"
	  onClick={async () => {
		const casNumbers = casList.split('\n').map(c => c.trim()).filter(Boolean);
		const response = await fetch(`${API_BASE}/vtr_export/xlsx`, {
		  method: 'POST',
		  headers: { 'Content-Type': 'application/json' },
		  body: JSON.stringify({ cas_numbers: casNumbers })
		});
		const blob = await response.blob();
		const url = window.URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = 'export_vtr.xlsx';
		document.body.appendChild(a);
		a.click();
		a.remove();
	  }}
	>
	  <FileDown size={16} /> Télécharger .XLSX
	</button>
    </div>
    <div className="flex-1 space-y-4">
      {Object.entries(results).map(([cas, data]) => {
        const currentTab = activeTabs[cas];
        const details = data.details || {};
        const isExpanded = expandedCards[cas] || false;

        return (
          <div key={cas} className={"bg-white dark:bg-[#bfc7d2] p-4 rounded shadow border-l-4 " + (data.sources.includes('Introuvable') ? 'border-red-600' : 'border-teal-600') + " dark:text-dm-text"}>
            <div className="font-semibold text-blue-900 mb-2 text-lg">CAS {cas}</div>
            {data.substanceName && (
              <div className="text-sm italic text-gray-600 dark:text-gray-200 mb-2">
                {data.substanceName}
              </div>
            )}
            <div className="text-sm text-blue-700 mb-2">{data.sources.join(', ')}</div>
            {Object.keys(details).length > 0 && (
              <>
                <button
                  onClick={() => setExpandedCards(prev => ({ ...prev, [cas]: !prev[cas] }))}
                  className="mt-2 px-3 py-1 bg-blue-900 text-white text-sm rounded hover:bg-blue-800 transition"
                >
                  {isExpanded ? 'Masquer les détails' : 'Voir les détails'}
                </button>
                {isExpanded && (
					<div className="w-full border-t pt-4">
					  {/* Onglets horizontaux */}
					  <div className="flex border-b overflow-x-auto mb-4">
						{Object.keys(details).map((table) => (
						  <button
							key={table}
							onClick={() => setActiveTabs(prev => ({ ...prev, [cas]: table }))}
							className={`px-4 py-2 whitespace-nowrap ${
							  currentTab === table
								? 'bg-teal-600 text-white'
								: 'hover:bg-gray-100 dark:hover:bg-gray-600'
							}`}
						  >
							{table.replaceAll('_', ' ')}
						  </button>
						))}
					  </div>

					  {/* Tableau */}
					  <div className="overflow-x-auto mt-4 max-w-full">
						  {(() => {
						    const tabData = details[currentTab];
						    return tabData && tabData.columns && tabData.rows && (
						      <table className="w-full min-w-[600px] text-sm text-left border-collapse border border-gray-300 dark:border-gray-600">
						        <thead>
						          <tr>
						            {tabData.columns.map((col) => (
						              <th key={col} className="border px-2 py-1 bg-gray-100 dark:bg-gray-700">
						                {col}
						              </th>
						            ))}
						          </tr>
						        </thead>
						        <tbody>
						          {tabData.rows.map((row, idx) => (
						            <tr key={idx}>
						              {tabData.columns.map((col) => (
						                <td key={col} className="border px-2 py-1">
						                  {row[col]}
						                </td>
						              ))}
						            </tr>
						          ))}
						        </tbody>
						      </table>
						    );
						  })()}
						</div>
					</div>
                )}
              </>
            )}
          </div>
        );
      })}
    </div>
  </main>
) : (
<main className="p-4 md:p-8 w-full flex flex-col md:flex-row gap-6 items-start">
            <div className="w-full md:w-[420px] shrink-0 space-y-4 bg-gray-100 dark:bg-[#5e6770] p-6 rounded shadow">
              <textarea
                rows={6}
                className="w-full border border-gray-300 dark:border-dm-border rounded p-2 bg-white dark:bg-[#bfc7d2] dark:text-dm-text"
                placeholder="Collez ici les numéros CAS (un par ligne)"
                value={casList}
                onChange={e => setCasList(e.target.value)}
              />
              <div>
                <p className="font-semibold mb-2">Classifications</p>
                <div className="mb-2 space-x-2">
                  <button onClick={() => setClassifications(flatOptions)} className="bg-gray-200 dark:bg-gray-700 text-black dark:text-white px-2 py-1 rounded text-sm">Tout sélectionner</button>
                  {GROUPS.map(group => (
                    <button
                      key={group}
                      onClick={() => handleGroupSelect(group)}
                      className="bg-gray-200 dark:bg-gray-700 text-black dark:text-white px-2 py-1 rounded text-sm"
                    >
                      {group}
                    </button>
                  ))}
                </div>
				<Select
				  isMulti
				  closeMenuOnSelect={false}
				  options={CLASSIFICATION_OPTIONS}
				  value={classifications}
				  onChange={setClassifications}
				  className="text-black dark:text-dm-text"
				  styles={{
					control: (base) => ({
					  ...base,
					  backgroundColor: darkMode ? '#bfc7d2' : 'white',
					  borderColor: darkMode ? '#94a3b8' : base.borderColor,
					  color: darkMode ? '#0f172a' : 'black',
					}),
					menu: (base) => ({
					  ...base,
					  backgroundColor: darkMode ? '#bfc7d2' : 'white',
					  color: darkMode ? '#0f172a' : 'black',
					}),
					multiValue: (base) => ({
					  ...base,
					  backgroundColor: darkMode ? '#94a3b8' : base.backgroundColor,
					  color: darkMode ? 'black' : 'inherit',
					}),
					input: (base) => ({
					  ...base,
					  color: darkMode ? '#0f172a' : 'black',
					}),
					singleValue: (base) => ({
					  ...base,
					  color: darkMode ? '#0f172a' : 'black',
					}),
				  }}
				/>
              </div>
				<button
				  className="w-full bg-teal-600 text-white px-4 py-2 rounded hover:bg-teal-700 flex items-center justify-center gap-2"
				  onClick={handleSearch}
				>
				  <Search size={16} /> Rechercher
				</button>
				<div className="space-y-2">
				  {/* Ligne avec 2 boutons côte à côte */}
				  <div className="grid grid-cols-2 gap-2">
					<button
					  className="bg-blue-900 text-white px-4 py-2 rounded hover:bg-blue-800 flex items-center justify-center gap-2"
					  onClick={() => handleExport('xlsx')}
					>
					  <FileDown size={16} /> XLSX (combiné)
					</button>
					<button
					  className="bg-blue-900 text-white px-4 py-2 rounded hover:bg-blue-800 flex items-center justify-center gap-2"
					  onClick={() => handleExport('xlsx_split')}
					>
					  <FileDown size={16} /> XLSX (multiples)
					</button>
				  </div>

				  {/* Ligne CSV seule */}
				  <div>
					<button
					  className="w-full bg-blue-900 text-white px-4 py-2 rounded hover:bg-blue-800 flex items-center justify-center gap-2"
					  onClick={() => handleExport('csv')}
					>
					  <FileDown size={16} /> CSV
					</button>
				  </div>
				</div>
              <div className="bg-white dark:bg-[#bfc7d2] p-4 rounded shadow dark:text-dm-text">
                <h4 className="text-sm font-semibold mb-2">Principaux dangers</h4>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={CMR_DATA}>
                    <XAxis
					  dataKey="name"
					  stroke={darkMode ? '#1f2937' : '#000'}
					  angle={-45}
					  textAnchor="end"
					  interval={0}
					  height={80}
					/>
                    <YAxis stroke={darkMode ? '#1f2937' : '#000'} allowDecimals={false} />
                    <Tooltip wrapperStyle={{ backgroundColor: darkMode ? '#e5e7eb' : '#fff', color: '#000' }} />
                    <Bar dataKey="value">
                      {CMR_DATA.map((entry, index) => (
                        <Cell key={"cell-${index}"} fill={entry.fill} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="flex-1 space-y-4">
              {Object.entries(results).map(([cas, data]) => {
                const currentTab = activeTabs[cas];
                const details = data.details || {};
                const isExpanded = expandedCards[cas] || false;

                return (
                  <div key={cas} className={"bg-white dark:bg-[#bfc7d2] p-4 rounded shadow border-l-4 " + (data.sources.includes('Introuvable') ? "border-red-600" : "border-teal-600") + " dark:text-dm-text"}>
                    <div className="font-semibold text-blue-900 mb-2 text-lg">CAS {cas}</div>
                    {data.substanceName && (
                      <div className="text-sm italic text-gray-600 dark:text-gray-200 mb-2">
                        {data.substanceName}
                      </div>
                    )}
					<div className="flex flex-wrap gap-2 mb-2">
					  {['Cancérogène', 'Mutagène', 'Reprotox.'].map((cmr) => (
						data.CMR?.[cmr] && (
						  <span key={cmr} className="px-3 py-1 bg-red-600 text-white rounded-full text-xs font-semibold">{cmr}</span>
						)
					  ))}
					  {['PE', 'Sens. Resp.', 'Sens. Cut.'].map((effet) => (
						data.PE_Sens?.[effet] && (
						  <span key={effet} className="px-3 py-1 bg-yellow-500 text-white rounded-full text-xs font-semibold">{effet}</span>
						)
					  ))}
					</div>
                    <div className="text-sm text-blue-700 mb-2">{data.sources.join(', ')}</div>

                    {Object.keys(details).length > 0 && (
                      <>
                        <button
                          onClick={() => setExpandedCards(prev => ({ ...prev, [cas]: !prev[cas] }))}
                          className="mt-2 px-3 py-1 bg-blue-900 text-white text-sm rounded hover:bg-blue-800 transition"
                        >
                          {isExpanded ? 'Masquer les détails' : 'Voir les détails'}
                        </button>

                        {isExpanded && (
                          <div className="flex border-t pt-4 gap-4">
                            <div className="w-1/4">
                              {Object.keys(details).map((table) => (
                                <div
                                  key={table}
                                  onClick={() => setActiveTabs(prev => ({ ...prev, [cas]: table }))}
                                  className={`cursor-pointer px-2 py-1 rounded mb-1 text-sm ${currentTab === table ? 'bg-teal-600 text-white' : 'hover:bg-gray-100 dark:hover:bg-gray-600'}`}
                                >
                                  {table.replaceAll('_', ' ')}
                                </div>
                              ))}
                            </div>
                            <div className="w-3/4 text-sm space-y-2">
                              {Object.entries(details[currentTab] || {})
                                .filter(([_, val]) => isValidValue(val))
                                .map(([col, val]) => (
                                  <div key={col} className="bg-gray-50 dark:bg-gray-700 p-2 rounded dark:text-gray-100">
                                    <strong>{col}:</strong> {val}
                                  </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </main>
)}
        </div>
      </div>
    </div>
  );
}

export default App;
