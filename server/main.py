from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
import sqlite3
import os
import re
import pandas as pd
from flask import send_file
from io import BytesIO, StringIO
from download_db import download_db

download_db("Classifications.db")
download_db("VTR.db")

app = Flask(__name__, static_folder='../client/dist', static_url_path='/')
CORS(app, resources={r"/api/*": {"origins": "*"}})

DB_PATH = os.path.join(os.path.dirname(__file__), 'Classifications.db')

CMR_COLUMNS = {
    "Carcinogenicity": "Cancérogène",
    "Germ cell mutagenicity": "Mutagène",
    "Reproductive toxicity": "Reprotox."
}

EXCLUDED_COLUMNS = {
    "BKH_DHI": ["Substance Name"],
    "DEDuCT": ["Substance name"],
    "IARC": ["Agent"],
    "MAK_Allergens": ["Substance name"],
    "MAK_Carcinogens": ["Substance name"],
    "NTP_Carcinogens": ["NAME OR SYNONYM"],
    "SINList": ["EC Number", "Name", "Synonyms"],
    "TEDX": ["Chemical Name", "Alternative Names"],
    "USEPA_Carcinogens": ["CHEMICAL NAME"],
    "USEPA_PE": ["Chemical Name"],
    "ACGIH": ["Substance"],
    "OEHHA": ["Name"],
    "AOEC_Asthmagens": ["Primary Name"],
    "CLP_Notifications": ["EC"]
}

SPECIAL_CARCINOGENICITY = {
    "IARC": lambda row: dict(row).get("Group") and str(row["Group"]).strip() not in ["", "3"],
    "USEPA_Carcinogens": lambda row: dict(row).get("WOE DESCRIPTION") and str(row["WOE DESCRIPTION"]).strip() not in [
        "D (Not classifiable as to human carcinogenicity)",
        "Carcinogenic potential cannot be determined",
        "Data are inadequate for an assessment of human carcinogenic potential",
        "Not likely to be carcinogenic to humans",
        ""
    ],
    "NTP_Carcinogens": lambda row: dict(row).get("Listing") and str(row["Listing"]).strip() != "",
    "MAK_Carcinogens": lambda row: dict(row).get("Category") and str(row["Category"]).strip() != "",
    "ACGIH": lambda row: any((x in str(row.get("Notation", "")).upper()) for x in ["A1", "A2", "A3"]),
    "OEHHA": lambda row: "cancer" in str(row.get("Toxicity", "")).lower(),
}


def normalize_cas(cas):
    if not isinstance(cas, str):
        return ""
    return cas.replace('–', '-').replace('—', '-').replace('‐', '-').replace('"', '').strip()


def extract_cas_list(cell):
    return re.split(r'[;,\n/]', cell or '')


def ensure_indexes():
    """Création des index utiles (appelée au chargement du module)."""
    try:
        conn = sqlite3.connect(DB_PATH)
        cur = conn.cursor()
        # Index pour accélérer la recherche dans CLP_Notifications
        cur.execute('CREATE INDEX IF NOT EXISTS idx_clp_notifications_cas ON CLP_Notifications (CAS)')
        conn.commit()
        conn.close()
    except Exception as e:
        print("Erreur lors de la création de l'index sur CLP_Notifications.CAS :", e)


# Création des index au démarrage
ensure_indexes()


@app.route('/api/toxicology', methods=['POST'])
def search_toxicology():
    data = request.get_json()
    cas_numbers = [normalize_cas(cas) for cas in data.get('cas_numbers', [])]
    result = {}

    # Connexion à Toxicology.db
    conn = sqlite3.connect(os.path.join(os.path.dirname(__file__), 'Toxicology.db'))
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()

    # Récupérer toutes les tables
    cursor.execute("SELECT name FROM sqlite_master WHERE type='table'")
    tables = [row['name'] for row in cursor.fetchall()]

    for cas in cas_numbers:
        entry = {'sources': [], 'details': {}}
        for table in tables:
            try:
                rows = cursor.execute(f'SELECT * FROM "{table}"').fetchall()
            except Exception:
                continue

            for row in rows:
                raw_cas = str(row['CAS'])
                all_cas = extract_cas_list(raw_cas)
                if cas in [normalize_cas(c) for c in all_cas]:
                    entry['sources'].append(table.replace("_", " "))
                    # Suppression CAS et CID
                    cols = [c for c in row.keys() if c.lower() not in ['cas', 'cid']]
                    texte = ""
                    for c in cols:
                        val = str(row[c]).strip()
                        if val and val.lower() not in ['-', 'not applicable', 'not classified']:
                            texte += val
                    entry['details'][table] = texte
                    break

        if not entry['sources']:
            entry['sources'].append('Introuvable')

        result[cas] = entry

    conn.close()
    return jsonify(result)


def is_classified(value):
    if not value:
        return False
    v = value.strip().lower()
    return v not in [
        '-', 'not classified', 'not classified (not applicable)', 'classification not possible', '', ','
    ]


def get_substance_name(cursor, cas):
    for table in ["CLP", "GHS_Australia", "GHS_Japan", "GHS_Korea", "GHS_China"]:
        try:
            rows = cursor.execute(f"SELECT [Substance Name], CAS FROM {table}").fetchall()
            for row in rows:
                all_cas = extract_cas_list(row["CAS"])
                if cas in [normalize_cas(c) for c in all_cas]:
                    name = row["Substance Name"]
                    if name:
                        return name.strip()
        except:
            continue
    return None


@app.route('/api/search', methods=['POST'])
def search_classifications():
    data = request.json
    cas_numbers = [normalize_cas(cas) for cas in data.get('cas_numbers', [])]
    selected_tables = data.get('classifications', [])
    result = {}

    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()

    for cas in cas_numbers:
        found = False
        entry = {
            'CAS': cas,
            'substanceName': get_substance_name(cursor, cas),
            'CMR': {},
            'PE_Sens': {},
            'sources': [],
            'details': {}
        }

        for table in selected_tables:
            try:
                if table == "CLP_Notifications":
                    # Optimisation: requête ciblée grâce à l'index CAS
                    rows = cursor.execute(
                        'SELECT * FROM "CLP_Notifications" WHERE CAS = ?',
                        (cas,)
                    ).fetchall()
                else:
                    rows = cursor.execute(f'SELECT * FROM "{table}"').fetchall()
            except Exception:
                continue

            for row in rows:
                raw_cas = str(row['CAS'])
                all_cas = extract_cas_list(raw_cas)
                if cas in [normalize_cas(c) for c in all_cas]:
                    entry['sources'].append(table.replace('_', ' '))
                    entry['details'][table] = {}

                    for col in row.keys():
                        val = row[col]
                        if col in CMR_COLUMNS and is_classified(val):
                            entry['CMR'][CMR_COLUMNS[col]] = True

                    if table in SPECIAL_CARCINOGENICITY:
                        try:
                            if SPECIAL_CARCINOGENICITY[table](dict(row)):
                                entry['CMR']['Cancérogène'] = True
                        except Exception:
                            pass

                    # Ajout logique PE
                    if table == 'BKH_DHI' and dict(row).get("Category") in ['CAT1', 'CAT2']:
                        entry['PE_Sens']['PE'] = True
                    if table == 'DEDuCT' and dict(row).get("Category") in ['I', 'II', 'III', 'IV']:
                        entry['PE_Sens']['PE'] = True
                    if table == 'EU_EDlists' and dict(row).get("List") in ['List I', 'List II', 'List III']:
                        entry['PE_Sens']['PE'] = True
                    if table == 'SINList' and 'endocrine disruptor' in str(dict(row).get("Health and environmental concern", '')).lower():
                        entry['PE_Sens']['PE'] = True
                    if table == 'TEDX':
                        entry['PE_Sens']['PE'] = True
                    if table == 'USEPA_PE':
                        liste = str(dict(row).get("Liste", '')).strip()
                        if liste not in ['Liste 1 (No evidence)', 'Liste 2']:
                            entry['PE_Sens']['PE'] = True

                    # Sens. Resp.
                    if table in ['CLP', 'GHS_Japan', 'GHS_Korea', 'GHS_Australia', 'GHS_China']:
                        if is_classified(dict(row).get("Respiratory sensitization")):
                            entry['PE_Sens']['Sens. Resp.'] = True
                    if table == 'MAK_Allergens' and dict(row).get("Designation") in ['(Sah)', '(Sa)']:
                        entry['PE_Sens']['Sens. Resp.'] = True

                    # Sens. Cut.
                    if table in ['CLP', 'GHS_Japan', 'GHS_Korea', 'GHS_Australia', 'GHS_China']:
                        if is_classified(dict(row).get("Skin sensitization")):
                            entry['PE_Sens']['Sens. Cut.'] = True
                    if table == 'MAK_Allergens' and dict(row).get("Designation") in ['(Sah)', '(Sh)']:
                        entry['PE_Sens']['Sens. Cut.'] = True

                    excluded = EXCLUDED_COLUMNS.get(table, [])
                    for col in row.keys():
                        val = row[col]
                        if col not in ['CAS', 'Substance Name'] and col not in excluded and is_classified(val):
                            entry['details'][table][col] = val

                    found = True
                    break

        if not found:
            entry['sources'] = ['Introuvable']

        result[cas] = entry

    conn.close()
    return jsonify(result)


@app.route('/')
def index():
    return send_from_directory(app.static_folder, 'index.html')


@app.route('/<path:path>')
def serve_static(path):
    return send_from_directory(app.static_folder, path)


@app.route('/api/export/<fmt>', methods=['POST'])
def export_classifications(fmt):
    data = request.json
    cas_numbers = [normalize_cas(cas) for cas in data.get('cas_numbers', [])]
    selected_tables = data.get('classifications', [])
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()

    export_rows = []
    all_columns = set()
    name_priority = {}

    for cas in cas_numbers:
        row_data = {"CAS": cas, "Nom": get_substance_name(cursor, cas) or ""}
        name_priority[cas] = row_data["Nom"]

        for table in selected_tables:
            try:
                rows = cursor.execute(f'SELECT * FROM "{table}"').fetchall()
            except:
                continue
            for row in rows:
                raw_cas = str(row['CAS'])
                all_cas = extract_cas_list(raw_cas)
                if cas in [normalize_cas(c) for c in all_cas]:
                    excluded = EXCLUDED_COLUMNS.get(table, [])
                    for col in row.keys():
                        if col not in ['CAS', 'Substance Name'] and col not in excluded:
                            val = row[col]
                            if is_classified(val):
                                colname = f"{table}_{col}"
                                row_data[colname] = val
                                all_columns.add(colname)
                    break

        export_rows.append(row_data)

    conn.close()

    columns_order = ["CAS", "Nom"] + sorted(all_columns)
    df = pd.DataFrame(export_rows)
    df = df.reindex(columns=columns_order)

    if fmt == 'xlsx':
        output = BytesIO()
        df.to_excel(output, index=False)
        output.seek(0)
        return send_file(output, download_name="export.xlsx", as_attachment=True,
                         mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    elif fmt == 'csv':
        output = StringIO()
        df.to_csv(output, index=False)
        output.seek(0)
        return send_file(BytesIO(output.getvalue().encode('utf-8')), download_name="export.csv",
                         as_attachment=True, mimetype='text/csv')
    else:
        return jsonify({"error": "Format not supported"}), 400


@app.route('/api/export/xlsx_split', methods=['POST'])
def export_split_classifications():
    data = request.json
    cas_numbers = [normalize_cas(cas) for cas in data.get('cas_numbers', [])]
    selected_tables = data.get('classifications', [])
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()

    output = BytesIO()
    with pd.ExcelWriter(output, engine='xlsxwriter') as writer:
        for table in selected_tables:
            try:
                rows = cursor.execute(f'SELECT * FROM "{table}"').fetchall()
            except:
                continue

            filtered = []
            for row in rows:
                raw_cas = str(row['CAS'])
                all_cas = extract_cas_list(raw_cas)
                if any(normalize_cas(c) in cas_numbers for c in all_cas):
                    d = dict(row)
                    # Supprimer colonnes exclues
                    for col in EXCLUDED_COLUMNS.get(table, []):
                        d.pop(col, None)
                    filtered.append(d)

            if filtered:
                df = pd.DataFrame(filtered)
                df.to_excel(writer, sheet_name=table[:31], index=False)

    conn.close()
    output.seek(0)
    return send_file(output, download_name="export_classifications_par_table.xlsx", as_attachment=True,
                     mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')


@app.route('/api/vtr', methods=['POST'])
def search_vtr():
    data = request.get_json()
    cas_numbers = [normalize_cas(cas) for cas in data.get('cas_numbers', [])]
    result = {}

    # Connexion à VTR.db (vtr_all)
    conn_vtr = sqlite3.connect('VTR.db')
    conn_vtr.row_factory = sqlite3.Row
    cursor_vtr = conn_vtr.cursor()

    # On lit toute la table vtr_all une fois
    try:
        rows_all = cursor_vtr.execute('SELECT * FROM vtr_all').fetchall()
        columns_all = [desc[0] for desc in cursor_vtr.description]
    except Exception as e:
        print(f"⚠️ Erreur lecture vtr_all : {e}")
        conn_vtr.close()
        return jsonify({"error": "Impossible de lire la table vtr_all"}), 500

    # Connexion à Classifications.db pour le nom de substance
    conn_names = sqlite3.connect('Classifications.db')
    conn_names.row_factory = sqlite3.Row
    cursor_names = conn_names.cursor()

    for cas in cas_numbers:
        entry = {
            'substanceName': get_substance_name(cursor_names, cas),
            'sources': [],
            'details': {}
        }

        matching_rows = []
        authorities = set()

        for row in rows_all:
            # Attention: colonne 'cas' en minuscule dans vtr_all
            raw_cas = str(row['cas']) if 'cas' in row.keys() else ''
            all_cas = extract_cas_list(raw_cas)
            if cas in [normalize_cas(c) for c in all_cas]:
                matching_rows.append(row)
                auth = row['authority']
                if auth:
                    authorities.add(str(auth))

        if matching_rows:
            # On masque id, source_system et raw_source côté API
            visible_columns = [
                c for c in columns_all
                if c not in ('id', 'source_system', 'raw_source')
            ]

            rows_list = []
            for row in matching_rows:
                d = {}
                for col in visible_columns:
                    d[col] = row[col]
                rows_list.append(d)

            # sources = autorités distinctes, sinon fallback
            entry['sources'] = sorted(authorities) if authorities else ['Valeurs de référence']

            # Une seule "table logique" pour l’UI
            entry['details']['Valeurs de référence'] = {
                "columns": visible_columns,
                "rows": rows_list
            }
        else:
            entry['sources'] = ['Introuvable']

        result[cas] = entry

    conn_vtr.close()
    conn_names.close()
    return jsonify(result)




@app.route('/api/vtr_export/xlsx', methods=['POST'])
def export_vtr_xlsx():
    data = request.get_json()
    cas_numbers = [normalize_cas(cas) for cas in data.get('cas_numbers', [])]

    conn_vtr = sqlite3.connect('VTR.db')
    conn_vtr.row_factory = sqlite3.Row

    try:
        df = pd.read_sql_query('SELECT * FROM vtr_all', conn_vtr)
    except Exception as e:
        print(f"⚠️ Erreur lecture vtr_all : {e}")
        conn_vtr.close()
        return jsonify({"error": "Impossible de lire la table vtr_all"}), 500

    conn_vtr.close()

    def cas_matches(cell):
        all_cas = extract_cas_list(str(cell))
        return any(normalize_cas(c) in cas_numbers for c in all_cas)

    if 'cas' in df.columns:
        df_filtered = df[df['cas'].apply(cas_matches)]
    else:
        df_filtered = df

    for col in ['id', 'source_system', 'raw_source']:
        if col in df_filtered.columns:
            df_filtered = df_filtered.drop(columns=[col])

    output = BytesIO()
    df_filtered.to_excel(output, sheet_name='vtr_all', index=False)
    output.seek(0)

    return send_file(
        output,
        download_name="export_vtr.xlsx",
        as_attachment=True,
        mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    )



if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)
