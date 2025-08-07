import React, { useState } from 'react';
import './index.css';
import { Menu, ChevronLeft, ChevronRight, Home, HelpCircle, Download, Sun, Moon } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';

const MOCK_RESULTS = {
  '50-00-0': {
    cancerogene: 'Oui',
    mutagene: 'Non',
    sensibilisant: 'Cat. 1',
    sources: ['CLP', 'GHS Japon', 'IARC']
  },
  '64-18-6': {
    cancerogene: 'Non',
    mutagene: 'Non',
    sensibilisant: 'Non',
    sources: ['CLP', 'VTR HSE']
  },
  '75-12-7': {
    cancerogene: 'Oui',
    mutagene: 'Non',
    sensibilisant: 'Non',
    sources: ['CLP', 'IASC']
  }
};

const CMR_DATA = [
  { name: 'Cancérogène', value: 12 },
  { name: 'Mutagène', value: 8 },
  { name: 'Reprotoxique', value: 5 },
];

function App() {
  const [casList, setCasList] = useState('');
  const [classifications, setClassifications] = useState([]);
  const [results, setResults] = useState({});
  const [menuOpen, setMenuOpen] = useState(true);
  const [darkMode, setDarkMode] = useState(false);

  const options = ['CLP', 'GHS Japon', 'IARC', 'VTR HSE'];

  const handleSearch = () => {
    const casNumbers = casList.split('\n').map(c => c.trim()).filter(Boolean);
    const filteredResults = {};
    casNumbers.forEach(cas => {
      if (MOCK_RESULTS[cas]) {
        filteredResults[cas] = MOCK_RESULTS[cas];
      }
    });
    setResults(filteredResults);
  };

  const logoSrc = darkMode ? '/logo-fiole-dark.png' : '/logo-fiole.png';

  return (
    <div className={darkMode ? 'dark' : ''}>
      <div className="relative flex h-screen bg-white dark:bg-dm-bg dark:text-white">
        {/* Menu latéral */}
        <aside className={`z-40 inset-y-0 left-0 bg-white dark:bg-dm-sidebar border-r dark:border-gray-700 transition-all ${menuOpen ? 'w-64 md:flex' : 'w-12 md:flex'} md:relative md:flex-col hidden md:flex`}>
          <div className="flex items-center justify-between p-4 h-16 border-b dark:border-gray-700">
            <div className="flex items-center text-sm font-medium">
              <Menu size={18} className="mr-2" />
              {menuOpen && 'Menu'}
            </div>
            <button onClick={() => setMenuOpen(!menuOpen)} className="text-gray-500 hover:text-gray-700 dark:text-gray-300">
              {menuOpen ? <ChevronLeft size={20} /> : <ChevronRight size={20} />}
            </button>
          </div>
          {menuOpen && (
            <nav className="flex-1 px-4 py-4 space-y-2 text-sm">
              <a href="#" className="flex items-center hover:bg-gray-100 dark:hover:bg-gray-700 px-2 py-1 rounded">
                <Home size={16} className="mr-2" /> Accueil
              </a>
              <a href="#" className="flex items-center hover:bg-gray-100 dark:hover:bg-gray-700 px-2 py-1 rounded">
                <HelpCircle size={16} className="mr-2" /> Aide
              </a>
              <a href="#" className="flex items-center hover:bg-gray-100 dark:hover:bg-gray-700 px-2 py-1 rounded">
                <Download size={16} className="mr-2" /> Export
              </a>
            </nav>
          )}
        </aside>

        {/* Contenu principal */}
        <div className="flex-1 flex flex-col overflow-auto md:ml-0">
          <header className="flex items-center justify-between px-6 h-16 bg-white dark:bg-dm-sidebar border-b dark:border-dm-border">
            <div className="flex items-center gap-3">
              <img src={logoSrc} alt="Toxonomy logo" className="h-8" />
              <span className="text-xl font-semibold text-gray-800 dark:text-white">TOXONOMY</span>
            </div>
            <button onClick={() => setDarkMode(!darkMode)} className="p-2 rounded-full bg-gray-200 hover:bg-gray-300 dark:bg-gray-600 dark:hover:bg-gray-500">
              {darkMode ? <Sun size={18} className="text-white" /> : <Moon size={18} className="text-gray-800" />}
            </button>
          </header>

          <main className="p-4 md:p-8 w-full grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-4 bg-gray-100 dark:bg-[#6c7680] p-6 rounded shadow">
              <textarea
                rows={6}
                className="w-full border border-gray-300 dark:border-dm-border rounded p-2 bg-white dark:bg-[#bfc7d2] dark:text-dm-text"
                placeholder="Collez ici les numéros CAS (un par ligne)"
                value={casList}
                onChange={e => setCasList(e.target.value)}
              />
              <div>
                <p className="font-semibold mb-2">Classifications</p>
                {options.map(opt => (
                  <label key={opt} className="block">
                    <input
                      type="checkbox"
                      className="mr-2"
                      value={opt}
                      checked={classifications.includes(opt)}
                      onChange={e => {
                        const checked = e.target.checked;
                        setClassifications(prev =>
                          checked ? [...prev, opt] : prev.filter(o => o !== opt)
                        );
                      }}
                    />
                    {opt}
                  </label>
                ))}
              </div>
              <button
                className="w-full bg-teal-600 text-white px-4 py-2 rounded hover:bg-teal-700"
                onClick={handleSearch}
              >
                Rechercher
              </button>
              <button className="w-full bg-blue-900 text-white px-4 py-2 rounded hover:bg-blue-800">
                Exporter vers Excel
              </button>
              <div className="bg-white dark:bg-[#bfc7d2] p-4 rounded shadow dark:text-dm-text">
                <h4 className="text-sm font-semibold mb-2">Substances CMR</h4>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={CMR_DATA}>
                    <XAxis dataKey="name" stroke={darkMode ? '#1f2937' : '#000'} />
                    <YAxis stroke={darkMode ? '#1f2937' : '#000'} />
                    <Tooltip wrapperStyle={{ backgroundColor: darkMode ? '#e5e7eb' : '#fff', color: '#000' }} />
                    <Bar dataKey="value" fill="#2ea043" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="space-y-4">
              {Object.entries(results).map(([cas, data]) => (
                <div key={cas} className="bg-white dark:bg-[#bfc7d2] p-4 rounded shadow border-l-4 border-teal-600 dark:text-dm-text">
                  <div className="font-semibold text-blue-900 mb-2">CAS {cas}</div>
                  <ul className="text-sm space-y-1">
                    <li>✔️ Cancérogène : <strong>{data.cancerogene}</strong></li>
                    <li>✔️ Mutagène : <strong>{data.mutagene}</strong></li>
                    <li>⚠️ Sensibilisant : <strong>{data.sensibilisant}</strong></li>
                    <li className="text-blue-600 underline mt-2">{data.sources.join(', ')}</li>
                  </ul>
                </div>
              ))}
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}

export default App;
