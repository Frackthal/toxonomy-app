import os
import boto3

B2_ENDPOINT = os.environ["B2_ENDPOINT"]
B2_BUCKET   = os.environ["B2_BUCKET"]
B2_KEY_ID   = os.environ["B2_KEY_ID_RO"]
B2_APP_KEY  = os.environ["B2_APP_KEY_RO"]
B2_PREFIX   = os.environ.get("B2_PREFIX", "db/")
DOWNLOAD_DIR = os.environ.get("DATA_DIR", ".")  # tu peux laisser comme ça

os.makedirs(DOWNLOAD_DIR, exist_ok=True)

def download_db(db_name: str) -> str:
    """Télécharge db_name dans DOWNLOAD_DIR si absent. Retourne le chemin local."""
    local_path = os.path.join(DOWNLOAD_DIR, db_name)
    if os.path.exists(local_path):
        print(f"{db_name} déjà présent.")
        return local_path

    print(f"Téléchargement de {db_name} depuis Backblaze...")
    s3 = boto3.client(
        "s3",
        endpoint_url=B2_ENDPOINT,
        aws_access_key_id=B2_KEY_ID,
        aws_secret_access_key=B2_APP_KEY,
    )
    s3.download_file(B2_BUCKET, f"{B2_PREFIX}{db_name}", local_path)
    print(f"{db_name} téléchargé.")
    return local_path
