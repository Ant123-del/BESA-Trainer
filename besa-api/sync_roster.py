"""
Mirrors besa-app's roster (the club's own member list, a separate Firebase project) into this
project's own Firestore at training_data/data_root/besa_roster_cache/{id}.

Why this exists: the deployed besa-api Cloud Function used to read besa-app's Firestore live, using a
second Admin SDK app authenticated as besa-app's own service account. That works fine run locally (as
this script does) but gets PERMISSION_DENIED when called from within Cloud Run in this GCP org, even
with the correct IAM role granted on the service account - almost certainly an org policy restricting
cross-project service account usage that neither project's owner can self-serve around. Since local
runs work, someone with access to both projects runs this script periodically instead, and the deployed
app just reads the mirror - see the comment above _get_cached_roster() in main.py.

Usage:
    python3 sync_roster.py

Requires (in besa-api/.env.local):
    BESA_APP_CRED_PATH   - path to a besa-app service-account JSON key file
And the existing local besa-trainer-api credential file (FIREBASE_CRED_PATH in main.py) present, same
as for local `uvicorn main:app` dev.
"""
import os

import firebase_admin
from firebase_admin import credentials, firestore
from dotenv import load_dotenv

load_dotenv(".env.local")

PRIMARY_CRED_PATH = "./besa-trainer-api-firebase-adminsdk-fbsvc-f685a6ef51.json"
BESA_APP_CRED_PATH = os.getenv("BESA_APP_CRED_PATH")
BESA_ROSTER_COLLECTION = os.getenv("BESA_ROSTER_COLLECTION", "Besas")
CACHE_COLLECTION = "besa_roster_cache"
CACHED_FIELDS = ("name", "role", "status", "officeHours")


def main():
    if not BESA_APP_CRED_PATH or not os.path.exists(BESA_APP_CRED_PATH):
        raise SystemExit("BESA_APP_CRED_PATH isn't set (or the file doesn't exist) - check besa-api/.env.local")
    if not os.path.exists(PRIMARY_CRED_PATH):
        raise SystemExit(f"Missing {PRIMARY_CRED_PATH} - same credential file local `uvicorn main:app` dev needs")

    primary_app = firebase_admin.initialize_app(credentials.Certificate(PRIMARY_CRED_PATH), name="sync-primary")
    besa_app = firebase_admin.initialize_app(credentials.Certificate(BESA_APP_CRED_PATH), name="sync-besa-app")

    primary_db = firestore.client(primary_app)
    besa_db = firestore.client(besa_app)

    source_docs = list(besa_db.collection(BESA_ROSTER_COLLECTION).stream())
    print(f"Read {len(source_docs)} roster doc(s) from besa-app/{BESA_ROSTER_COLLECTION}")

    cache_ref = primary_db.collection("training_data").document("data_root").collection(CACHE_COLLECTION)

    seen_ids = set()
    batch = primary_db.batch()
    for doc in source_docs:
        data = doc.to_dict() or {}
        cached = {field: data.get(field) for field in CACHED_FIELDS}
        batch.set(cache_ref.document(doc.id), cached)
        seen_ids.add(doc.id)
    batch.commit()

    #drop cached entries for anyone no longer on the live roster
    removed = 0
    for existing in cache_ref.stream():
        if existing.id not in seen_ids:
            existing.reference.delete()
            removed += 1

    print(f"Synced {len(seen_ids)} member(s) into besa_roster_cache, removed {removed} stale entr{'y' if removed == 1 else 'ies'}.")


if __name__ == "__main__":
    main()
