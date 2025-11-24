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
    "TEDX": ["Chemical name"],
    "USEPA_Carcinogens": ["CAS RN", "Substance name"],
    "EU_EDlists": ["Substance Name"],
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
    "NTP_Carcinogens": lambda row: dict(row).get("Rationale and comments") and any(
        phrase in str(row["Rationale and comments"])
        for phrase in [
            "known to be a human carcinogen",
            "reasonably be anticipated to be a human carcinogen",
            "carcinogenicity"
        ]
    ),
    "MAK_Carcinogens": lambda row: dict(row).get("Carc.") and str(row["Carc."]).strip() not in ["", "5"]
}


def normalize_cas(cas):
    if not cas:
        return ""
    cas = str(cas).strip()
    cas = cas.replace(" ", "")
    cas = cas.replace("CAS", "").replace("cas", "").replace("№", "").replace("No.", "")
    match = re.search(r"(\d{2,7}-\d{2}-\d)", cas)
    return match.group(1) if match else cas


def extract_cas_list(raw_cas):
    if not raw_cas:
        return []
    text = str(raw_cas)
    text = re.sub(r'CAS[: ]*', '', text, flags=re.IGNORECASE)
    parts = re.split(r'[;,/]|\\n', text)
    cas_list = []
    for part in parts:
        cas = normalize_cas(part)
        if cas:
            cas_list.append(cas)
    return cas_list


def is_classified(value):
    if value is None:
        return False
    if isinstance(value, (int, float)):
        return True
    s = str(value).strip().lower()
    if s == "":
        return False
    if s in ["-", "not classified", "not applicable", "nc"]:
        return False
    if s.startswith("no "):
        return False
    return True


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


def build_substance_name_index(cursor):
    """
    Construit un index CAS -> nom de substance en lisant une fois
    les tables de reference (CLP et GHS principaux).
    """
    name_index = {}
    priority_tables = ["CLP", "GHS_Australia", "GHS_Japan", "GHS_Korea", "GHS_China"]
    for table in priority_tables:
        try:
            rows = cursor.execute(f'SELECT [Substance Name], CAS FROM "{table}"').fetchall()
        except Exception:
            continue
        for row in rows:
            raw_cas = str(row["CAS"])
            all_cas = extract_cas_list(raw_cas)
            for cas in [normalize_cas(c) for c in all_cas]:
                if cas and cas not in name_index:
                    name = row["Substance Name"]
                    if name:
                        name_index[cas] = name.strip()
    return name_index


@app.route('/api/search', methods=['POST'])
def search_classifications():
    data = request.json
    cas_numbers = [normalize_cas(cas) for cas in data.get('cas_numbers', [])]
    selected_tables = data.get('classifications', [])
    result = {}

    if not cas_numbers or not selected_tables:
        return jsonify({})

    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()

    # Index des noms de substances pour les CAS demandés
    name_index = build_substance_name_index(cursor)

    cas_set = set(cas_numbers)

    # Initialisation des entrées résultat
    for cas in cas_numbers:
        result[cas] = {
            'CAS': cas,
            'substanceName': name_index.get(cas),
            'CMR': {},
            'PE_Sens': {},
            'sources': [],
            'details': {}
        }

    # Pour éviter de traiter plusieurs fois le même couple CAS/table
    seen_tables = {cas: set() for cas in cas_numbers}

    for table in selected_tables:
        try:
            rows = cursor.execute(f'SELECT * FROM "{table}"').fetchall()
        except Exception:
            continue

        excluded = EXCLUDED_COLUMNS.get(table, [])

        for row in rows:
            raw_cas = str(row['CAS'])
            all_cas = extract_cas_list(raw_cas)
            # CAS de la ligne qui nous intéressent
            target_cas = [normalize_cas(c) for c in all_cas if normalize_cas(c) in cas_set]
            if not target_cas:
                continue

            for cas in target_cas:
                # Un seul enregistrement par table et par CAS
                if table in seen_tables[cas]:
                    continue
                seen_tables[cas].add(table)

                entry = result[cas]

                pretty_table = table.replace('_', ' ')
                if pretty_table not in entry['sources']:
                    entry['sources'].append(pretty_table)

                entry['details'].setdefault(table, {})

                # CMR direct
                for col in row.keys():
                    val = row[col]
                    if col in CMR_COLUMNS and is_classified(val):
                        entry['CMR'][CMR_COLUMNS[col]] = True

                # Cancers spécifiques (IARC, USEPA_Carcinogens, etc.)
                if table in SPECIAL_CARCINOGENICITY:
                    try:
                        if SPECIAL_CARCINOGENICITY[table](dict(row)):
                            entry['CMR']['Cancérogène'] = True
                    except Exception:
                        pass

                # PE
                if table == 'BKH_DHI' and dict(row).get("Category") in ['CAT1', 'CAT2']:
                    entry['PE_Sens']['PE'] = True
                if table == 'DEDuCT' and dict(row).get("Category") in ['I', 'II', 'III', 'IV']:
                    entry['PE_Sens']['PE'] = True
                if table == 'EU_EDlists' and dict(row).get("List") in ['List I', 'List II', 'List III']:
                    entry['PE_Sens']['PE'] = True
                if table == 'SINList' and 'endocrine disruptor' in str(
                    dict(row).get("Health and environmental concern", '')
                ).lower():
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

                # Détails
                for col in row.keys():
                    val = row[col]
                    if col not in ['CAS', 'Substance Name'] and col not in excluded and is_classified(val):
                        entry['details'][table][col] = val

    # Marquage des CAS introuvables
    for cas, entry in result.items():
        if not entry['sources']:
            entry['sources'] = ['Introuvable']

    conn.close()
    return jsonify(result)


@app.route('/')
def index():
    return send_from_directory(app.static_folder, 'index.html')


@app.route('/<path:path>')
def serve_static(path):
    if path.startswith('api/'):
        return jsonify({"error": "API route"}), 404
    return send_from_directory(app.static_folder, path)


@app.route('/api/export', methods=['POST'])
def export_classifications():
    data = request.json
    cas_numbers = [normalize_cas(cas) for cas in data.get('cas_numbers', [])]
    selected_tables = data.get('classifications', [])
    export_format = data.get('format', 'xlsx')

    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()

    all_rows = []

    for cas in cas_numbers:
        entry = {
            'CAS': cas,
            'substanceName': get_substance_name(cursor, cas),
            'sources': [],
            'details': {}
        }

        for table in selected_tables:
            try:
                rows = cursor.execute(f'SELECT * FROM "{table}"').fetchall()
            except Exception:
                continue

            for row in rows:
                raw_cas = str(row['CAS'])
                all_cas = extract_cas_list(raw_cas)
                if cas in [normalize_cas(c) for c in all_cas]:
                    entry['sources'].append(table.replace("_", " "))
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

        all_rows.append(entry)

    conn.close()

    rows_for_df = []
    for entry in all_rows:
        for source, details in entry['details'].items():
            rows_for_df.append({
                "CAS": entry['CAS'],
                "Substance Name": entry['substanceName'],
                "Source": source,
                "Details": details
            })
        if not entry['details']:
            rows_for_df.append({
                "CAS": entry['CAS'],
                "Substance Name": entry['substanceName'],
                "Source": ', '.join(entry['sources']),
                "Details": ""
            })

    df = pd.DataFrame(rows_for_df)

    if export_format == 'xlsx':
        output = BytesIO()
        with pd.ExcelWriter(output, engine='xlsxwriter') as writer:
            df.to_excel(writer, sheet_name='Classifications', index=False)
        output.seek(0)
        return send_file(
            output,
            download_name="export_classifications.xlsx",
            as_attachment=True,
            mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        )
    elif export_format == 'csv':
        output = StringIO()
        df.to_csv(output, index=False)
        output.seek(0)
        return send_file(
            BytesIO(output.getvalue().encode('utf-8')),
            download_name="export_classifications.csv",
            as_attachment=True,
            mimetype='text/csv'
        )
    elif export_format == 'txt':
        output = StringIO()
        df.to_csv(output, index=False, sep='\t')
        output.seek(0)
        return send_file(
            BytesIO(output.getvalue().encode('utf-8')),
            download_name="export_classifications.txt",
            as_attachment=True,
            mimetype='text/plain'
        )
    else:
        return jsonify({"error": "Format non supporté"}), 400


def ensure_indexes():
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
        print(f"Erreur lecture vtr_all : {e}")
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

            entry['sources'] = sorted(list(authorities)) if authorities else []
            entry['details'] = {
                'vtr_all': {
                    'columns': visible_columns,
                    'rows': [
                        {col: r[col] for col in visible_columns}
                        for r in matching_rows
                    ]
                }
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
    cursor_vtr = conn_vtr.cursor()
    df = pd.read_sql_query("SELECT * FROM vtr_all", conn_vtr)

    # On filtre sur les CAS demandés
    df_filtered = df[df['cas'].apply(
        lambda raw: any(
            normalize_cas(c) in cas_numbers
            for c in extract_cas_list(raw)
        )
    )]

    conn_vtr.close()

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

