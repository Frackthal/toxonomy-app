import React, { useState } from 'react';
import './index.css';
import Header from './components/Header';


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

function App() {
  const [casList, setCasList] = useState('');
  const [classifications, setClassifications] = useState([]);
  const [results, setResults] = useState({});

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

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <Header />
      <main className="p-6 max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="md:col-span-1 space-y-4">
          <textarea
            rows={8}
            className="w-full border border-gray-300 rounded p-2"
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
        </div>
        <div className="md:col-span-2 space-y-4">
          {Object.entries(results).map(([cas, data]) => (
            <div key={cas} className="bg-white p-4 rounded shadow border-l-4 border-teal-600">
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
  );
}

export default App;