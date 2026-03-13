# Toxonomy v2

> Classifications toxicologiques multi-agences — Refonte complète

## Architecture

```
toxonomy/
├── server/
│   └── index.js          # Backend Node.js (Express + better-sqlite3)
├── src/
│   ├── components/
│   │   ├── Header.jsx          # En-tête avec dark mode toggle
│   │   ├── Sidebar.jsx         # Navigation latérale responsive
│   │   ├── SearchPanel.jsx     # Panneau de recherche (CAS + nom + groupes)
│   │   ├── SubstanceCard.jsx   # Carte résultat avec accordions
│   │   ├── AnalyticsPanel.jsx  # Stats + barres de danger + filtres
│   │   └── ClassificationMatrix.jsx  # Matrice croisée substances × sources
│   ├── pages/
│   │   ├── ClassificationsPage.jsx   # Page principale
│   │   ├── VTRPage.jsx               # Valeurs de référence
│   │   └── DocumentationPage.jsx     # Documentation des sources
│   ├── hooks/
│   │   └── useSearch.js        # Hooks (search, dark mode, URL sync, name search)
│   ├── utils/
│   │   ├── api.js              # Utilitaires API + constantes
│   │   └── sources.js          # Configuration des sources
│   ├── App.jsx
│   ├── main.jsx
│   └── index.css               # Design tokens CSS (light/dark)
├── index.html
├── package.json
├── vite.config.js
├── tailwind.config.js
└── postcss.config.js
```

## Changements par rapport à v1

### Backend
- **Python/Flask → Node.js/Express** avec `better-sqlite3` (5-10x plus rapide)
- **Index CAS en mémoire** construit au démarrage : recherche O(1) au lieu de scan O(n×tables)
- **Recherche par nom** de substance (endpoint GET /api/search-name)
- **ExcelJS** pour les exports (remplace pandas/xlsxwriter)
- Même logique Backblaze B2 pour télécharger les DB

### Frontend
- **Composants modulaires** (7 composants au lieu d'un monolithe de 600 lignes)
- **react-router-dom** pour la navigation et les URLs partageables
- **URL sync** : les CAS et groupes sont encodés dans l'URL
- **Recherche par nom** avec auto-complétion debounced
- **Filtres par danger** : cliquer sur une barre dans le panneau analytics
- **Matrice de classification** : vue croisée substances × sources
- **Design tokens CSS** pour un dark mode propre
- **Mobile-first** : sidebar responsive, cartes VTR en mode card sur mobile
- **Skeleton loading** pendant les requêtes
- **Typographie distinctive** : DM Sans + Instrument Serif

### Fonctionnalités nouvelles
- Recherche par nom de substance
- Filtres par type de danger (cancérogène, mutagène, etc.)
- URLs partageables avec paramètres de recherche
- Matrice de classification visuelle
- Interface mobile complète

## Installation

### Prérequis
- Node.js 18+
- Les fichiers `Classifications.db` et `VTR.db` (Backblaze)

### Variables d'environnement
```env
B2_ENDPOINT=https://s3.eu-central-003.backblazeb2.com
B2_BUCKET=your-bucket
B2_KEY_ID_RO=your-key
B2_APP_KEY_RO=your-secret
B2_PREFIX=db/
PORT=5000
```

### Dev local
```bash
npm install

# Terminal 1 : backend
node server/index.js

# Terminal 2 : frontend
npm run dev
```

Le proxy Vite redirige `/api` vers `localhost:5000`.

### Build production
```bash
npm run build     # Génère dist/
npm start         # Lance le serveur qui sert dist/ + API
```

### Déploiement Render
1. Push sur GitHub
2. Créer un Web Service sur Render :
   - **Build command**: `npm install && npm run build`
   - **Start command**: `node server/index.js`
   - Ajouter les variables d'environnement B2_*
3. Le serveur télécharge les DB au premier démarrage et sert le frontend statique

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/sources` | Liste des sources disponibles |
| GET | `/api/search-name?q=benzene` | Recherche par nom (autocomplete) |
| POST | `/api/search` | Recherche classifications par CAS |
| POST | `/api/vtr` | Recherche VTR par CAS |
| POST | `/api/export` | Export XLSX/CSV des classifications |
| POST | `/api/vtr_export/xlsx` | Export XLSX des VTR |

### Exemple POST /api/search
```json
{
  "cas_numbers": ["71-43-2", "50-00-0"],
  "classifications": ["CLP", "IARC", "BKH_DHI"]
}
```
