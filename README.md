# Toxonomy v3

> Classifications toxicologiques multi-agences + profils toxicologiques IA

## Architecture

```
toxonomy/
├── api/                          # Vercel Serverless Functions
│   ├── _lib/
│   │   ├── shared.js             # Clients Turso, CAS utils, config sources
│   │   └── toxProfile.js         # Génération profil tox (PubChem + OpenRouter)
│   ├── export/
│   │   ├── multiple.js           # Export multi-onglets (un par source)
│   │   └── combined.js           # Export combiné (une ligne par CAS)
│   ├── tox-profile/
│   │   └── cache.js              # Stats du cache profil tox
│   ├── vtr_export/
│   │   └── xlsx.js               # Export VTR en XLSX
│   ├── export.js                 # Export basique CSV/XLSX
│   ├── search.js                 # Recherche classifications par CAS
│   ├── search-name.js            # Autocomplete par nom de substance
│   ├── sources.js                # Liste des sources disponibles
│   ├── tox-profile.js            # Génération profil toxicologique
│   └── vtr.js                    # Recherche VTR par CAS
├── scripts/
│   ├── build-turso-indexes.js    # Indexation Classifications (run once)
│   └── build-vtr-index.js        # Indexation VTR (run once)
├── src/
│   ├── components/
│   │   ├── Header.jsx
│   │   ├── Sidebar.jsx
│   │   ├── SearchPanel.jsx
│   │   ├── SubstanceCard.jsx
│   │   ├── AnalyticsPanel.jsx
│   │   └── ClassificationMatrix.jsx
│   ├── pages/
│   │   ├── ClassificationsPage.jsx
│   │   ├── VTRPage.jsx
│   │   └── DocumentationPage.jsx
│   ├── hooks/
│   │   └── useSearch.js
│   ├── utils/
│   │   ├── api.js
│   │   └── sources.js
│   ├── App.jsx
│   ├── main.jsx
│   └── index.css
├── index.html
├── package.json
├── vercel.json
├── vite.config.js
├── tailwind.config.js
└── postcss.config.js
```

## Stack

- **Frontend** : React 18 + Vite + Tailwind CSS
- **Backend** : Vercel Serverless Functions (Node.js)
- **Base de données** : Turso (libSQL hébergé)
- **LLM** : OpenRouter (profils toxicologiques)
- **Données** : PubChem PUG-View API (toxicité, GHS, HSDB)

## Changements v2 → v3

### Infrastructure
- **Render → Vercel** : serverless, plus de serveur persistant
- **SQLite local → Turso** : base de données hébergée, accès HTTP
- **R2/B2 supprimé** : les données sont directement dans Turso
- **Index en mémoire → tables de lookup** : `cas_lookup`, `name_lookup`, `vtr_cas_lookup` persistées dans Turso

### Backend
- **Express → Vercel Functions** : chaque route est un fichier indépendant dans `api/`
- **better-sqlite3 → @libsql/client** : client HTTP vers Turso
- **Requêtes batch** : `batchGetCasLookup` et `getSubstanceNames` récupèrent toutes les données en 2 requêtes au lieu de N×M
- **ExcelJS via writeBuffer()** : compatible serverless (pas de streaming)

### Profils toxicologiques
- **Gemini → OpenRouter** : modèle configurable avec fallback
- **4 prompts parallèles** : extraction PubChem/HSDB + génération par sections ECHA/REACH

## Installation

### Prérequis
- Node.js 18+
- Compte Vercel
- Bases Turso (Classifications + VTR)

### Variables d'environnement (Vercel Dashboard)

```env
TURSO_CLASSIFICATIONS_URL=libsql://...
TURSO_CLASSIFICATIONS_TOKEN=...
TURSO_VTR_URL=libsql://...
TURSO_VTR_TOKEN=...
OPENROUTER_API_KEY=...
OPENROUTER_MODEL=openrouter/hunter-alpha    # optionnel
```

### Indexation initiale (une seule fois)

Après avoir chargé les données dans Turso, lancer les scripts d'indexation :

```bash
npm install @libsql/client

TURSO_CLASSIFICATIONS_URL=... TURSO_CLASSIFICATIONS_TOKEN=... \
  node scripts/build-turso-indexes.js

TURSO_VTR_URL=... TURSO_VTR_TOKEN=... \
  node scripts/build-vtr-index.js
```

Ces scripts créent les tables `cas_lookup`, `name_lookup` et `vtr_cas_lookup` utilisées par les API routes pour des recherches indexées.

### Déploiement

1. Push sur GitHub
2. Importer le repo dans Vercel (framework : Vite)
3. Ajouter les variables d'environnement
4. Deploy automatique à chaque push

### Dev local

```bash
npm install
vercel dev
```

Les API routes et le frontend Vite sont servis ensemble par `vercel dev`.

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/sources` | Liste des sources disponibles |
| GET | `/api/search-name?q=benzene` | Recherche par nom (autocomplete) |
| POST | `/api/search` | Recherche classifications par CAS |
| POST | `/api/vtr` | Recherche VTR par CAS |
| POST | `/api/export` | Export basique CSV/XLSX |
| POST | `/api/export/multiple` | Export multi-onglets XLSX |
| POST | `/api/export/combined` | Export combiné XLSX |
| POST | `/api/vtr_export/xlsx` | Export VTR en XLSX |
| POST | `/api/tox-profile` | Génération profil toxicologique |
| GET | `/api/tox-profile/cache` | Stats du cache |

### Exemple POST /api/search

```json
{
  "cas_numbers": ["71-43-2", "50-00-0"],
  "classifications": ["CLP", "IARC", "BKH_DHI"]
}
```
