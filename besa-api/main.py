from fastapi import FastAPI, Depends, HTTPException, Header, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from typing import Literal
import time
import math
from datetime import datetime, timedelta, date as date_cls
from zoneinfo import ZoneInfo
from google import genai
import os
import base64
import bcrypt
import hashlib
import hmac
import secrets
import requests
import smtplib
from email.message import EmailMessage

import firebase_admin
from firebase_admin import credentials, storage, auth, firestore

from google.cloud.speech_v2 import SpeechClient
from google.cloud.speech_v2.types import cloud_speech
from google.api_core.client_options import ClientOptions
from google.api_core.exceptions import Conflict
from google.cloud.firestore_v1.base_query import FieldFilter
from google.oauth2 import service_account as gcp_service_account

from dotenv import load_dotenv
#named .env.local (not .env) on purpose - Firebase's deploy tooling auto-loads a plain ".env" file in
#this directory as real Cloud Run env vars, which collides with GEMINI_API_KEY also being declared as
#a secret below (Cloud Run rejects a var being both). ".env.local" is emulator-only by Firebase's own
#convention, so it's never picked up at deploy time - only used here, locally, for uvicorn dev.
load_dotenv(".env.local")

#lazy, not constructed at import time - Firebase's own deploy-time discovery step imports this module
#in a throwaway local process to find the https_fn.on_request()-decorated functions below, WITHOUT the
#secrets (GEMINI_API_KEY etc.) injected yet, since those only exist once the function actually runs in
#production. Building genai.Client() eagerly at import time stalls that discovery step until it times
#out (see https://firebase.google.com/docs/functions/tips#avoid_deployment_timeouts_during_initialization).
_genai_client = None
def _get_genai_client():
    global _genai_client
    if _genai_client is None:
        _genai_client = genai.Client()
    return _genai_client

FIREBASE_CRED_PATH = "./besa-trainer-api-firebase-adminsdk-fbsvc-f685a6ef51.json"

# Firebase SDK - the local service-account file is only present (and gitignored) on a dev machine.
# Deployed on Cloud Functions/Cloud Run, there's no file at all: the function's own runtime service
# account is picked up automatically via Application Default Credentials, so nothing has to be shipped.
if os.path.exists(FIREBASE_CRED_PATH):
    cred = credentials.Certificate(FIREBASE_CRED_PATH)
    speech_credentials = gcp_service_account.Credentials.from_service_account_file(FIREBASE_CRED_PATH)
else:
    cred = credentials.ApplicationDefault()
    speech_credentials = None  # let SpeechClient fall back to ADC too

firebase_admin.initialize_app(cred, {
    "storageBucket": "besa-trainer-api.firebasestorage.app"
})

# Chirp 3 (Speech-to-Text v2) lives only in specific multi-regions today.
SPEECH_LOCATION = "us"
GCP_PROJECT_ID = cred.project_id

_speech_client = None
def _get_speech_client():
    global _speech_client
    if _speech_client is None:
        _speech_client = SpeechClient(
            credentials=speech_credentials,
            client_options=ClientOptions(api_endpoint=f"{SPEECH_LOCATION}-speech.googleapis.com"),
        )
    return _speech_client

app = FastAPI()
security = HTTPBearer()

def get_current_user(cred: HTTPAuthorizationCredentials = Depends(security)):
    token = cred.credentials
    try:
        decoded_token = auth.verify_id_token(token)
        return decoded_token
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired firebase token: " + str(e), 
            headers={"WWW-Authenticate": "Bearer"})


def require_admin(user: dict = Depends(get_current_user)):
    user_id = user.get("uid")
    db = firestore.client()
    user_doc = db.collection("training_data").document("data_root").collection("users").document(user_id).get()

    if not user_doc.exists or not user_doc.to_dict().get("admin"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin priviledges needed"
        )

    return user


#stricter than require_admin - a besa account that's been promoted to admin still isn't a besaLead,
#and only besaLeads can see/manage the roster of who else has admin.
def require_besa_lead(user: dict = Depends(get_current_user)):
    user_id = user.get("uid")
    db = firestore.client()
    user_doc = db.collection("training_data").document("data_root").collection("users").document(user_id).get()

    if not user_doc.exists or user_doc.to_dict().get("accountType") != "besaLead":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="BESA Lead priviledges needed"
        )

    return user


#Assign Tasks: a BESA Lead, or the root account once its admin passcode is unlocked (it opens the page from Profile)
def require_lead_or_root_admin(user: dict = Depends(get_current_user), x_root_admin_token: str = Header(default="")):
    user_doc = _users_ref(firestore.client()).document(user.get("uid")).get()
    account_type = (user_doc.to_dict() or {}).get("accountType") if user_doc.exists else None
    if account_type == "besaLead":
        return user
    if account_type == "root" and _root_admin_session_valid(user.get("uid"), x_root_admin_token):
        return user
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN,
                        detail="Admin login required." if account_type == "root" else "BESA Lead priviledges needed")


#the shared kiosk account - clocks OTHER besa/besaLead accounts in/out by student id, so it needs its
#own tier rather than piggybacking on admin/besaLead (which are about managing the roster, not this).
def require_root(user: dict = Depends(get_current_user)):
    user_id = user.get("uid")
    db = firestore.client()
    user_doc = db.collection("training_data").document("data_root").collection("users").document(user_id).get()

    if not user_doc.exists or user_doc.to_dict().get("accountType") != "root":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Root priviledges needed"
        )

    return user


# ---- BESA roster (besa-app project) ----
# besa-app is a separate Firebase project (BESA Booking) holding the club's own member roster at
# /Besas/{id}, including each member's officeHours. Its Admin SDK path is blocked from Cloud Run in this
# GCP org (cross-project service account restriction), but /Besas is publicly readable - the booking site
# itself reads it to show office hours - so it's read live over Firestore's public REST API with no
# credentials at all. That way office-hour edits on BESA Booking show up here within a minute instead of
# waiting on someone to run sync_roster.py. The old mirror (training_data/data_root/besa_roster_cache,
# still filled by sync_roster.py) is only a fallback for when besa-app can't be reached.
BESA_ROSTER_NAME_FIELD = os.getenv("BESA_ROSTER_NAME_FIELD", "name")
BESA_ROSTER_ROLE_FIELD = os.getenv("BESA_ROSTER_ROLE_FIELD", "role")
BESA_ROSTER_LEAD_VALUE = os.getenv("BESA_ROSTER_LEAD_VALUE", "BESA Lead")
BESA_ROSTER_STATUS_FIELD = os.getenv("BESA_ROSTER_STATUS_FIELD", "status")
BESA_ROSTER_ACTIVE_VALUE = os.getenv("BESA_ROSTER_ACTIVE_VALUE", "active")
BESA_ROSTER_CACHE_COLLECTION = "besa_roster_cache"
BESA_APP_PROJECT_ID = os.getenv("BESA_APP_PROJECT_ID", "besa-app")
BESA_ROSTER_COLLECTION = os.getenv("BESA_ROSTER_COLLECTION", "Besas")
ROSTER_TTL_SECONDS = 60

_roster_cache = {"docs": None, "fetched_at": 0.0}


#Firestore REST encodes every field as {"<type>Value": ...} - unwrap to plain Python values
def _decode_firestore_value(value: dict):
    if "mapValue" in value:
        return {k: _decode_firestore_value(v) for k, v in (value["mapValue"].get("fields") or {}).items()}
    if "arrayValue" in value:
        return [_decode_firestore_value(v) for v in (value["arrayValue"].get("values") or [])]
    if "integerValue" in value:
        return int(value["integerValue"])
    if "nullValue" in value:
        return None
    for key in ("stringValue", "booleanValue", "doubleValue", "timestampValue", "referenceValue"):
        if key in value:
            return value[key]
    return None


def _fetch_live_roster() -> list:
    base = f"https://firestore.googleapis.com/v1/projects/{BESA_APP_PROJECT_ID}/databases/(default)/documents/{BESA_ROSTER_COLLECTION}"
    docs, page_token = [], None
    while True:
        params = {"pageSize": 300, **({"pageToken": page_token} if page_token else {})}
        response = requests.get(base, params=params, timeout=10)
        response.raise_for_status()
        body = response.json()
        for d in body.get("documents") or []:
            docs.append({k: _decode_firestore_value(v) for k, v in (d.get("fields") or {}).items()})
        page_token = body.get("nextPageToken")
        if not page_token:
            return docs


#the roster, live from besa-app (cached per instance for ROSTER_TTL_SECONDS). Each doc is besa-app's own
#shape - {name, role, status, officeHours, ...}. force=True skips the cache - used when a page is (re)loaded or
#a break is started, so an office-hours change on BESA Booking shows up right away instead of up to a minute later.
def _get_roster(force: bool = False) -> list:
    now = time.monotonic()
    if not force and _roster_cache["docs"] is not None and now - _roster_cache["fetched_at"] < ROSTER_TTL_SECONDS:
        return _roster_cache["docs"]
    try:
        docs = _fetch_live_roster()
        _roster_cache.update({"docs": docs, "fetched_at": now})
        return docs
    except Exception as e:
        print(f"Live besa-app roster read failed, using mirror instead: {e}")
        if _roster_cache["docs"] is not None:
            return _roster_cache["docs"]
        db = firestore.client()
        mirror = db.collection("training_data").document("data_root").collection(BESA_ROSTER_CACHE_COLLECTION).stream()
        return [d.to_dict() or {} for d in mirror]


#every active roster entry, tagged besaLead/besa based on its role field
def _active_roster(roster_docs: list) -> list:
    roster = []
    for data in roster_docs:
        if data.get(BESA_ROSTER_STATUS_FIELD) != BESA_ROSTER_ACTIVE_VALUE:
            continue
        name = data.get(BESA_ROSTER_NAME_FIELD)
        if not name:
            continue
        tier = "besaLead" if data.get(BESA_ROSTER_ROLE_FIELD) == BESA_ROSTER_LEAD_VALUE else "besa"
        roster.append({"name": name, "tier": tier})
    return roster


@app.get("/besa-roster")
def besaRoster():
    roster_docs = _get_roster()
    if not roster_docs:
        raise HTTPException(status_code=503, detail="Couldn't load the BESA roster right now.")
    roster = _active_roster(roster_docs)

    #names already claimed by an account in this project get filtered out of the picker
    db = firestore.client()
    claimed = {
        u.to_dict().get("besaName")
        for u in db.collection("training_data").document("data_root").collection("users").stream()
        if (u.to_dict() or {}).get("besaName")
    }

    available = [r for r in roster if r["name"] not in claimed]
    return {"success": True, "roster": available}


class CreateAccountRequest(BaseModel):
    besaName: str | None = None
    studentId: str | None = None


#the only way a user doc gets created (Firestore rules deny client-side creates) - the browser makes the
#Firebase Auth login, then calls this. The tier and admin flag come from the roster here, never from the
#client, so nobody can sign themselves up as a besaLead/admin (or root, which is still hand-made only).
@app.post("/create-account")
def createAccount(request_data: CreateAccountRequest, user: dict = Depends(get_current_user)):
    uid = user.get("uid")
    db = firestore.client()
    users_ref = db.collection("training_data").document("data_root").collection("users")
    user_ref = users_ref.document(uid)

    new_doc = {"uid": uid, "scriptPaths": [], "admin": False, "progress": [], "accountType": "user"}

    if request_data.besaName is not None:
        besa_name = request_data.besaName
        student_id = (request_data.studentId or "").strip()
        if not student_id:
            raise HTTPException(status_code=400, detail="Please enter your school id.")

        entry = next((r for r in _active_roster(_get_roster()) if r["name"] == besa_name), None)
        if entry is None:
            raise HTTPException(status_code=400, detail="That name isn't on the active BESA roster.")

        new_doc.update({
            "accountType": entry["tier"],
            "admin": entry["tier"] == "besaLead",
            "besaName": besa_name,
            "studentId": student_id,
        })

    #in a transaction so two people racing for the same roster name / school id can't both get it
    @firestore.transactional
    def create_in_transaction(transaction):
        if user_ref.get(transaction=transaction).exists:
            return False
        if "besaName" in new_doc:
            if list(users_ref.where("besaName", "==", new_doc["besaName"]).limit(1).get(transaction=transaction)):
                raise HTTPException(status_code=409, detail="That BESA name has already been claimed by another account.")
            if list(users_ref.where("studentId", "==", new_doc["studentId"]).limit(1).get(transaction=transaction)):
                raise HTTPException(status_code=409, detail="That school id is already linked to another account.")
        transaction.create(user_ref, new_doc)
        return True

    created = create_in_transaction(db.transaction())
    return {"success": True, "created": created}


class SetAdminStatusRequest(BaseModel):
    targetUid: str
    admin: bool


@app.post("/set-admin-status")
def setAdminStatus(request_data: SetAdminStatusRequest, lead_user: dict = Depends(require_besa_lead)):
    db = firestore.client()
    target_ref = db.collection("training_data").document("data_root").collection("users").document(request_data.targetUid)
    target_doc = target_ref.get()

    if not target_doc.exists or target_doc.to_dict().get("accountType") not in ("besa", "besaLead"):
        raise HTTPException(status_code=404, detail="No BESA account found with that id.")

    target_ref.update({"admin": request_data.admin})
    return {"success": True, "floorId": "", "message": "Admin status updated."}


@app.get("/besa-accounts")
def besaAccounts(lead_user: dict = Depends(require_lead_or_root_admin)):
    db = firestore.client()
    accounts = []
    for u in db.collection("training_data").document("data_root").collection("users").stream():
        data = u.to_dict() or {}
        if data.get("accountType") not in ("besa", "besaLead"):
            continue
        try:
            email = auth.get_user(u.id).email or ""
        except Exception:
            email = ""
        accounts.append({
            "uid": u.id,
            "email": email,
            "besaName": data.get("besaName"),
            "accountType": data.get("accountType"),
            "admin": bool(data.get("admin")),
            "assignedTasks": data.get("assignedTasks") or [],
            "taskNotes": _serialize_task_notes(data.get("taskNotes")),
        })

    return {"success": True, "accounts": accounts}


# ---- Assigned tasks (BESA Leads' Assign Tasks page) ----
# Leads pick which of the shared activity types each besa/besaLead (themselves included) should work on -
# stored as assignedTasks on the member's user doc. The kiosk's Clock In still offers every activity, but
# highlights these as "Lead recommended" for that person. Clock-out always offers every activity too.
TASK_NAME_MAX_LENGTH = 40


class AssignTasksRequest(BaseModel):
    targetUid: str
    tasks: list[str]


@app.post("/assign-tasks")
def assignTasks(request_data: AssignTasksRequest, lead_user: dict = Depends(require_lead_or_root_admin)):
    db = firestore.client()
    target_ref = _users_ref(db).document(request_data.targetUid)
    target_doc = target_ref.get()
    if not target_doc.exists or (target_doc.to_dict() or {}).get("accountType") not in ("besa", "besaLead"):
        raise HTTPException(status_code=404, detail="No BESA account found with that id.")
    available = _activity_types(db)
    tasks = [t for t in dict.fromkeys(t.strip() for t in request_data.tasks) if t]
    unknown = [t for t in tasks if t not in available]
    if unknown:
        raise HTTPException(status_code=400, detail=f'"{unknown[0]}" isn\'t on the task list anymore - reload the page.')
    target_ref.update({"assignedTasks": tasks})
    return {"success": True, "assignedTasks": tasks}


# ---- Task notes (guidance a BESA Lead leaves on one member's task, for the next time they clock in) ----
# taskNotes on the member's user doc: {task: {description, items: [{id, text, done, doneAt}], updatedAt}}. The
# items are an optional checklist the member ticks off - at the kiosk (Current Sessions) or on their Profile - and
# the leads see that progress on Assign Tasks. A note stays until a lead removes it. Ticking the last checkbox
# emails every BESA Lead and root account (see _notify_checklist_done).
TASK_NOTE_DESCRIPTION_MAX_LENGTH = 1000
TASK_NOTE_ITEM_MAX_LENGTH = 200
TASK_NOTE_MAX_ITEMS = 20


#notes as a list (only for `tasks`, in that order, when given - e.g. what they clocked in for)
def _serialize_task_notes(notes, tasks: list | None = None) -> list:
    notes = notes if isinstance(notes, dict) else {}
    names = [t for t in tasks if t in notes] if tasks is not None else sorted(notes)
    return [{
        "task": task,
        "description": notes[task].get("description") or "",
        "items": [{"id": i.get("id"), "text": i.get("text") or "", "done": bool(i.get("done")),
                   "doneAt": i["doneAt"].isoformat() if i.get("doneAt") else None}
                  for i in notes[task].get("items") or [] if isinstance(i, dict)],
        "updatedAt": notes[task]["updatedAt"].isoformat() if notes[task].get("updatedAt") else None,
    } for task in names if isinstance(notes[task], dict)]


class TaskNoteItem(BaseModel):
    id: str | None = None  # an existing item keeps its id (and whether it's checked); new ones get one
    text: str


class SetTaskNoteRequest(BaseModel):
    targetUid: str
    task: str
    description: str = ""
    items: list[TaskNoteItem] = []


#BESA Lead (or root admin) - writes (or, when it's left empty, removes) the note on one member's task
@app.post("/task-notes/set")
def setTaskNote(request_data: SetTaskNoteRequest, lead_user: dict = Depends(require_lead_or_root_admin)):
    db = firestore.client()
    target_ref, data = _besa_doc_by_uid(db, request_data.targetUid)
    task = request_data.task.strip()
    if task not in _activity_types(db):
        raise HTTPException(status_code=400, detail=f'"{task}" isn\'t on the task list anymore - reload the page.')
    description = request_data.description.strip()
    if len(description) > TASK_NOTE_DESCRIPTION_MAX_LENGTH:
        raise HTTPException(status_code=400, detail=f"The description can be at most {TASK_NOTE_DESCRIPTION_MAX_LENGTH} characters.")
    if len(request_data.items) > TASK_NOTE_MAX_ITEMS:
        raise HTTPException(status_code=400, detail=f"A note can have at most {TASK_NOTE_MAX_ITEMS} checkboxes.")

    notes = dict(data.get("taskNotes") or {})
    old_items = {i.get("id"): i for i in (notes.get(task) or {}).get("items") or [] if isinstance(i, dict)}
    items = []
    for item in request_data.items:
        text = item.text.strip()
        if not text:
            continue
        if len(text) > TASK_NOTE_ITEM_MAX_LENGTH:
            raise HTTPException(status_code=400, detail=f"Checkboxes can be at most {TASK_NOTE_ITEM_MAX_LENGTH} characters.")
        old = old_items.get(item.id) if item.id else None
        items.append({"id": old["id"] if old else secrets.token_hex(6), "text": text,
                      "done": bool(old and old.get("done")), "doneAt": (old or {}).get("doneAt")})

    if description or items:
        notes[task] = {"description": description, "items": items, "updatedAt": datetime.now(PACIFIC)}
    else:
        notes.pop(task, None)
    target_ref.update({"taskNotes": notes})
    return {"success": True, "taskNotes": _serialize_task_notes(notes)}


class CheckTaskNoteItemRequest(BaseModel):
    targetUid: str | None = None  # the kiosk (root) says whose; a member checking their own leaves it out
    task: str
    itemId: str
    done: bool


#ticks a checkbox on a task note - the root kiosk for anyone (Current Sessions), or a member on their own Profile
@app.post("/task-notes/check")
def checkTaskNoteItem(request_data: CheckTaskNoteItemRequest, user: dict = Depends(get_current_user)):
    db = firestore.client()
    caller = _users_ref(db).document(user.get("uid")).get()
    caller_type = (caller.to_dict() or {}).get("accountType") if caller.exists else None
    if caller_type == "root":
        if not request_data.targetUid:
            raise HTTPException(status_code=400, detail="Whose note is this?")
        target_uid = request_data.targetUid
    elif caller_type in ("besa", "besaLead") and request_data.targetUid in (None, user.get("uid")):
        target_uid = user.get("uid")
    else:
        raise HTTPException(status_code=403, detail="You can only check off your own task notes.")
    target_ref, data = _besa_doc_by_uid(db, target_uid)

    notes = dict(data.get("taskNotes") or {})
    note = notes.get(request_data.task)
    item = next((i for i in (note or {}).get("items") or [] if isinstance(i, dict) and i.get("id") == request_data.itemId), None)
    if item is None:
        raise HTTPException(status_code=404, detail="That checkbox was removed - reload to see the latest note.")
    was_complete = all(i.get("done") for i in note["items"] if isinstance(i, dict))
    item["done"] = request_data.done
    item["doneAt"] = datetime.now(PACIFIC) if request_data.done else None
    target_ref.update({"taskNotes": notes})
    #this tick finished the checklist - let the leads and root know, so they can follow up or leave a new note
    if not was_complete and all(i.get("done") for i in note["items"] if isinstance(i, dict)):
        _notify_checklist_done(data.get("besaName"), request_data.task, note)
    return {"success": True, "taskNotes": _serialize_task_notes(notes, _activity_types(db))}


#to every BESA Lead and root account, when someone ticks the last checkbox on a task note
def _notify_checklist_done(besa_name, task: str, note: dict):
    name = besa_name or "A BESA"
    items = "\n".join(f"- [x] {i.get('text') or ''}" for i in note.get("items") or [] if isinstance(i, dict))
    description = f'Note: "{note["description"]}"\n\n' if note.get("description") else ""
    body = (f"{name} checked off everything on the {task} note.\n\n{description}{items}\n\n"
            "To leave them a new note or remove this one, go to Assign Tasks.")
    _send_alert_email(f"{name} finished the {task} checklist", body, lambda: _uids_of_type("besaLead", "root"),
                      f"Checklist-done ({name}, {task})")


#what the member can clock in for (every activity), and which of those a lead recommended - their assigned tasks
#that are still on the shared activity list (one removed at the kiosk drops out)
def _clock_in_tasks(db, data: dict) -> tuple[list, list]:
    available = _activity_types(db)
    recommended = [t for t in data.get("assignedTasks") or [] if t in available]
    return available, recommended


#BESA Lead only (Manage Admins) - hours per activity per day from the permanent activity log, over the last
#`days` days (today included). Hours are actual time worked (minutes / 60), not the rounded credited hours.
@app.get("/activity-analytics")
def activityAnalytics(days: int = 30, lead_user: dict = Depends(require_besa_lead)):
    days = max(1, min(days, 365))
    today = datetime.now(PACIFIC).date()
    start = today - timedelta(days=days - 1)
    db = firestore.client()
    logs = db.collection(ACTIVITY_LOG_COLLECTION).where(filter=FieldFilter("date", ">=", start.isoformat())).stream()

    by_day = {(start + timedelta(days=i)).isoformat(): {} for i in range(days)}
    totals, estimated_hours, visits = {}, 0.0, 0
    for doc in logs:
        log = doc.to_dict() or {}
        day = log.get("date")
        if day not in by_day:
            continue
        visits += 1
        for w in log.get("workedOn") or []:
            name, hours = w.get("activity"), (w.get("minutes") or 0) / 60
            if not name:
                continue
            by_day[day][name] = by_day[day].get(name, 0) + hours
            totals[name] = totals.get(name, 0) + hours
            if log.get("estimated"):
                estimated_hours += hours

    #stable order so an activity keeps its color: the shared activity-type list first, then anything else
    root_doc = db.collection("training_data").document("data_root").get()
    type_order = ((root_doc.to_dict() or {}).get("activityTypes") if root_doc.exists else None) or ACTIVITY_TYPES_DEFAULT
    activities = [a for a in type_order if a in totals] + sorted(a for a in totals if a not in type_order)
    #the full shared order (not just activities with data) - colors key off this, matching the kiosk's split bar
    color_order = list(type_order) + sorted(a for a in totals if a not in type_order)

    return {
        "success": True,
        "start": start.isoformat(),
        "end": today.isoformat(),
        "activities": activities,
        "colorOrder": color_order,
        "days": [{"date": d, "hours": {a: round(h, 2) for a, h in acts.items()}} for d, acts in by_day.items()],
        "totals": {a: round(totals[a], 2) for a in activities},
        "estimatedHours": round(estimated_hours, 2),
        "visits": visits,
    }


#BESA Lead only (Manage Admins) - what's being worked on right now, without saying who. For everyone clocked
#in: time so far, and their potential hours (time so far + office hours still left today, from that date's
#effective BESA Booking schedule), each split evenly across the activities they clocked in for - the real
#split isn't known until they clock out.
@app.get("/current-activity")
def currentActivity(lead_user: dict = Depends(require_besa_lead)):
    db = firestore.client()
    now = datetime.now(PACIFIC)
    by_activity, people = {}, 0
    for u in db.collection("training_data").document("data_root").collection("users").stream():
        data = u.to_dict() or {}
        if data.get("accountType") not in ("besa", "besaLead") or not data.get("lastCheckedIn"):
            continue
        data = _auto_clock_out_if_needed(u.reference, data)
        if not data.get("lastCheckedIn"):
            continue
        people += 1
        checked_in_at = _to_pacific(data["lastCheckedIn"])
        so_far = max(0.0, (now - checked_in_at).total_seconds() / 3600)
        office_end = _get_office_hours_end(data.get("besaName"), checked_in_at)
        remaining = max(0.0, (office_end - now).total_seconds() / 3600) if office_end else 0.0
        activities = [a for a in dict.fromkeys(data.get("lastCheckedInActivities") or []) if a] or ["Unspecified"]
        for a in activities:
            entry = by_activity.setdefault(a, {"soFar": 0.0, "potential": 0.0})
            entry["soFar"] += so_far / len(activities)
            entry["potential"] += (so_far + remaining) / len(activities)

    root_doc = db.collection("training_data").document("data_root").get()
    type_order = ((root_doc.to_dict() or {}).get("activityTypes") if root_doc.exists else None) or ACTIVITY_TYPES_DEFAULT
    color_order = list(type_order) + sorted(a for a in by_activity if a not in type_order)
    return {
        "success": True,
        "asOf": now.isoformat(),
        "people": people,
        "colorOrder": color_order,
        "activities": [{"activity": a, "soFarHours": round(by_activity[a]["soFar"], 2), "potentialHours": round(by_activity[a]["potential"], 2)}
                       for a in color_order if a in by_activity],
    }


# ---- Root kiosk: clock in/out, current sessions, hours, activity types ----
PACIFIC = ZoneInfo("America/Los_Angeles")
ACTIVITY_TYPES_DEFAULT = ["Tours", "Summer Project", "BESA Booking", "BESA Trainer", "Other"]


#Sunday-Saturday week, anchored to Pacific local time regardless of what tz `dt` carries.
def _week_start(dt: datetime) -> datetime:
    local = dt.astimezone(PACIFIC)
    start_of_day = local.replace(hour=0, minute=0, second=0, microsecond=0)
    return start_of_day - timedelta(days=(local.weekday() + 1) % 7)


#Firestore hands timestamps back as DatetimeWithNanoseconds, and .astimezone() on one yields a broken copy
#(missing its internal _nanosecond) that crashes when written back to Firestore. Anything read from a doc
#that gets stored again (e.g. lastCheckedIn -> a session's clockIn) must go through this first.
def _to_pacific(dt: datetime) -> datetime:
    return datetime.fromtimestamp(dt.timestamp(), tz=PACIFIC)


def _find_besa_by_student_id(db, student_id: str):
    users_ref = db.collection("training_data").document("data_root").collection("users")
    for u in users_ref.stream():
        data = u.to_dict() or {}
        if data.get("accountType") in ("besa", "besaLead") and data.get("studentId") == student_id:
            return u.reference, data
    return None, None


#time in -> credited hours, to the nearest half hour, rounding up from the quarter marks: under 15 minutes
#past a whole hour rounds down, 15-44 minutes is .5, 45+ is the next hour. Not Python's round(), which rounds
#exact halves to even (15 minutes came out as 0, 1h15 as 1.0).
def _credited_hours(seconds: float) -> float:
    return math.floor(max(0.0, seconds) / 1800 + 0.5) * 0.5


#a day's credited hours: its visits' total time in (plus any unused break they left early with), rounded once
#for the whole day - not each visit rounded separately and summed. Days a root admin set by hand, canceled-tour
#days, and old entries from before visits were tracked keep their stored number.
def _day_hours(entry: dict) -> float:
    sessions = [s for s in entry.get("sessions") or [] if s.get("clockIn") and s.get("clockOut")]
    if entry.get("editedByAdmin") or entry.get("canceledTour") or not sessions:
        return entry.get("hours", 0)
    return _credited_hours(sum((s["clockOut"] - s["clockIn"]).total_seconds() + (s.get("leftEarlySeconds") or 0)
                               for s in sessions))


# ---- Past logs (finished pay periods) ----
# biWeeklyHours on the user doc only holds the current two-week period. When a period ends, its days are moved
# (not deleted) into hours_archive/{uid}_{periodStart}: {uid, besaName, periodStart, days: {YYYY-MM-DD: entry}},
# which Profile's Past Logs reads through /my-hours/past. Firestore rules don't match hours_archive, so only
# this backend (Admin SDK) can read or write it.
HOURS_ARCHIVE_COLLECTION = "hours_archive"


#writes any days from before the current period into their period's archive doc and returns the rest. The
#archive is written before the caller updates the user doc, and a day is keyed by its date, so a retry (or
#the same day archived twice) just overwrites it - nothing is ever lost or duplicated.
def _archive_past_periods(uid: str, besa_name, entries: list, now: datetime) -> list:
    current_start = _period_start(now)
    is_old = lambda e: e.get("date") and e["date"].astimezone(PACIFIC) < current_start
    by_period = {}
    for e in entries:
        if is_old(e):
            start = _period_start(e["date"]).date().isoformat()
            by_period.setdefault(start, {})[e["date"].astimezone(PACIFIC).date().isoformat()] = e
    if not by_period:
        return entries
    db = firestore.client()
    for start, days in by_period.items():
        db.collection(HOURS_ARCHIVE_COLLECTION).document(f"{uid}_{start}").set(
            {"uid": uid, "besaName": besa_name, "periodStart": start, "days": days, "archivedAt": now}, merge=True)
    return [e for e in entries if not is_old(e)]


#archives a member's finished-period days that are still sitting on their user doc (they haven't clocked out
#since the period ended) - returns the doc data as it is afterwards
def _roll_over_periods(target_ref, data: dict) -> dict:
    entries = data.get("biWeeklyHours") or []
    current = _archive_past_periods(target_ref.id, data.get("besaName"), entries, datetime.now(PACIFIC))
    if len(current) == len(entries):
        return data
    target_ref.update({"biWeeklyHours": current})
    return {**data, "biWeeklyHours": current}


#merges this session's hours into (or creates) the entry for checked_in_at's calendar day. Shared by manual
#clock-out and auto-clockout. Days from finished pay periods are moved out by _archive_past_periods afterwards.
#Each day also keeps its individual sessions (arrive/leave time + activities) so the hours table can show
#when someone was actually there - entries written before sessions existed just have none.
#left_early_seconds: unused break they left early with (see /clock-out's leaveEarly) - credited as time in.
#extra: more fields to store on the session (an approved hours request's requested/requestReason/requestDetails).
def _merge_hours_entry(existing: list, checked_in_at: datetime, effective_end: datetime, activities: list, now: datetime, auto_clocked_out: bool = False, break_seconds: int = 0, canceled_tour: bool = False, notes: list | None = None, worked_on: list | None = None, left_early_seconds: int = 0, extra: dict | None = None):
    elapsed_hours = _credited_hours((effective_end - checked_in_at).total_seconds() + left_early_seconds)
    entry_day = checked_in_at.replace(hour=0, minute=0, second=0, microsecond=0)
    #once we know what they actually worked on, that's what the visit (and the day) records - the intended
    #activities picked at clock-in aren't kept. Canceled tours have no split, so they keep their intended ones.
    if worked_on:
        activities = [w["activity"] for w in worked_on]
    session = {"clockIn": checked_in_at, "clockOut": effective_end, "activities": activities, "autoClockedOut": auto_clocked_out,
               "breakSeconds": break_seconds, "canceledTour": canceled_tour, "notes": notes or [], "workedOn": worked_on or [],
               "leftEarlySeconds": left_early_seconds, **(extra or {})}

    merged = False
    new_hours = []
    for e in (e for e in existing if e.get("date")):
        if e["date"].astimezone(PACIFIC).date() == entry_day.date():
            merged_entry = {
                **e,
                "hours": e.get("hours", 0) + elapsed_hours,
                "activities": sorted(set((e.get("activities") or []) + activities)),
                "autoClockedOut": bool(e.get("autoClockedOut")) or auto_clocked_out,
                "sessions": (e.get("sessions") or []) + [session],
            }
            #re-rounded from the whole day's time in (admin-set/canceled-tour days just add, as before)
            merged_entry["hours"] = _day_hours(merged_entry)
            new_hours.append(merged_entry)
            merged = True
        else:
            new_hours.append(e)
    if not merged:
        new_hours.append({
            "date": entry_day,
            "hours": elapsed_hours,
            "activities": activities,
            "autoClockedOut": auto_clocked_out,
            "sessions": [session],
        })
    if canceled_tour:
        #the whole day becomes exactly CANCELED_TOUR_DAY_HOURS, however long they'd been here
        new_hours = [
            {**e, "hours": CANCELED_TOUR_DAY_HOURS, "canceledTour": True}
            if e["date"].astimezone(PACIFIC).date() == entry_day.date() else e
            for e in new_hours
        ]
        elapsed_hours = CANCELED_TOUR_DAY_HOURS
    return new_hours, elapsed_hours


#a BESA (not BESA Lead) whose tour was canceled gets logged out with the whole day set to exactly this much
CANCELED_TOUR_DAY_HOURS = 0.5
TOUR_ACTIVITY = "Tours"


def _serialize_hours_entry(e: dict) -> dict:
    return {
        "date": e["date"].isoformat(),
        "hours": _day_hours(e),
        "activities": e.get("activities") or [],
        "autoClockedOut": bool(e.get("autoClockedOut")),
        "editedByAdmin": bool(e.get("editedByAdmin")),
        "canceledTour": bool(e.get("canceledTour")),
        "sessions": [
            {
                "clockIn": s["clockIn"].isoformat(),
                "clockOut": s["clockOut"].isoformat(),
                "activities": s.get("activities") or [],
                "autoClockedOut": bool(s.get("autoClockedOut")),
                "breakSeconds": s.get("breakSeconds") or 0,
                "canceledTour": bool(s.get("canceledTour")),
                "notes": _serialize_notes(s.get("notes")),
                "workedOn": s.get("workedOn") or [],
                "leftEarlySeconds": s.get("leftEarlySeconds") or 0,
                #added afterwards by an approved hours request rather than clocked at the kiosk
                "requested": bool(s.get("requested")),
                "requestReason": HOURS_REQUEST_REASONS.get(s.get("requestReason"), s.get("requestReason") or ""),
                "requestDetails": s.get("requestDetails") or "",
                #added or changed by a root admin on Edit Anyone's Hours, with their note if they left one
                "adminEdited": bool(s.get("adminEdited")),
                "adminNote": s.get("adminNote") or "",
            }
            for s in (e.get("sessions") or []) if s.get("clockIn") and s.get("clockOut")
        ],
        "dayNotes": _serialize_day_notes(e.get("dayNotes")),
    }


#the still-open session (clocked in, not out yet), so the table can show "9:02 AM - now" and today's
#live break status
#notes/comments added from the kiosk's Current Sessions during a visit - [{text, at}] on the user doc while
#they're clocked in (lastCheckedInNotes), then moved onto that visit's session record when they clock out
SESSION_NOTE_MAX_LENGTH = 500


def _serialize_notes(notes) -> list:
    return [{"text": n.get("text") or "", "at": n["at"].isoformat() if n.get("at") else None}
            for n in (notes or []) if isinstance(n, dict) and n.get("text")]


#notes a member writes on a day from their own Profile's My Hours - [{id, text, at}] on that day's
#biWeeklyHours entry (dayNotes), separate from the kiosk's per-visit notes. The id lets them delete one.
def _serialize_day_notes(notes) -> list:
    return [{"id": n.get("id") or "", "text": n.get("text") or "", "at": n["at"].isoformat() if n.get("at") else None}
            for n in (notes or []) if isinstance(n, dict) and n.get("text")]


def _open_session(data: dict):
    if not data.get("lastCheckedIn"):
        return None
    return {"clockIn": data["lastCheckedIn"].isoformat(), "activities": data.get("lastCheckedInActivities") or [],
            "break": _break_state(data, datetime.now(PACIFIC)),
            "notes": _serialize_notes(data.get("lastCheckedInNotes"))}


WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"]
#hours run in fixed two-week periods (two Sun-Sat weeks, flipped through as a carousel), starting from this
#Sunday and repeating every 14 days. When a period ends its days move to the past-logs archive (see
#_archive_past_periods), and My Hours only ever shows the current period.
PAY_PERIOD_ANCHOR = date_cls(2026, 9, 27)
PAY_PERIOD_DAYS = 14


#midnight (Pacific) on the Sunday the current two-week period started
def _period_start(now: datetime) -> datetime:
    days_in = (now.astimezone(PACIFIC).date() - PAY_PERIOD_ANCHOR).days
    start = PAY_PERIOD_ANCHOR + timedelta(days=PAY_PERIOD_DAYS * (days_in // PAY_PERIOD_DAYS))
    return datetime(start.year, start.month, start.day, tzinfo=PACIFIC)


def _hhmm_to_minutes(value) -> int | None:
    try:
        h, m = str(value).split(":")
        return int(h) * 60 + int(m)
    except (ValueError, AttributeError):
        return None


def _minutes_to_hhmm(minutes: int) -> str:
    return f"{minutes // 60:02d}:{minutes % 60:02d}"


def _clean_slots(raw_slots) -> list:
    slots = []
    for slot in raw_slots or []:
        if not isinstance(slot, dict):
            continue
        start, end = _hhmm_to_minutes(slot.get("start")), _hhmm_to_minutes(slot.get("end"))
        if start is not None and end is not None and end > start:
            slots.append((start, end))
    return sorted(slots)


def _roster_doc_for(besa_name, roster_docs: list):
    return next((d for d in roster_docs if besa_name and d.get(BESA_ROSTER_NAME_FIELD) == besa_name), None)


#one date's office hours on BESA Booking:
#  officeHours        - the weekly recurring schedule ({"monday": {"available", "timeSlots"}, ...})
#  tempAdjustments    - [{date: "YYYY-MM-DD", timeSlots, reason?}] replaces that one date's hours outright
#tempUnavailability ("outs", e.g. meetings pulled in from their calendar) is deliberately ignored - an out
#doesn't shrink the schedule, the break allowance, or the auto-clockout time, and isn't shown anywhere.
#Returns the slots plus whether they're temporary, so the views can say why a day differs from the usual week.
def _office_day(roster_doc: dict, day: date_cls) -> dict:
    key = day.isoformat()
    weekday = WEEKDAYS[(day.weekday() + 1) % 7]

    temp = next((a for a in roster_doc.get("tempAdjustments") or [] if isinstance(a, dict) and a.get("date") == key), None)
    if temp is not None:
        slots = _clean_slots(temp.get("timeSlots"))
    else:
        weekly = (roster_doc.get("officeHours") or {}).get(weekday) or {}
        slots = _clean_slots(weekly.get("timeSlots")) if weekly.get("available", True) else []

    scheduled_hours = sum(e - st for st, e in slots) / 60
    return {
        "date": key,
        "day": weekday,
        "slots": [{"start": _minutes_to_hhmm(st), "end": _minutes_to_hhmm(e)} for st, e in slots],
        "temporary": temp is not None,
        "temporaryReason": (temp or {}).get("reason") or "",
        "unavailable": [],  #outs are ignored (see above) - kept so older clients still get the field
        "scheduledHours": round(scheduled_hours, 2),
        "breakAllowanceMinutes": _break_allowance_minutes(scheduled_hours),
    }


#the member's effective office hours for every day of the current two-week period (both carousel weeks) -
#None if their name isn't on the BESA Booking roster at all.
def _office_schedule(besa_name, roster_docs: list):
    roster_doc = _roster_doc_for(besa_name, roster_docs)
    if roster_doc is None:
        return None
    first_day = _period_start(datetime.now(PACIFIC)).date()
    return [_office_day(roster_doc, first_day + timedelta(days=i)) for i in range(PAY_PERIOD_DAYS)]


def _office_day_for(besa_name, day: datetime):
    roster_doc = _roster_doc_for(besa_name, _get_roster())
    return _office_day(roster_doc, day.date()) if roster_doc else None


#latest office-hours slot end on the check-in's date that's still after the check-in time (covers someone with
#multiple slots that day) - uses that date's effective hours, so temp hours/unavailability are respected.
def _get_office_hours_end(besa_name, checked_in_at: datetime):
    office_day = _office_day_for(besa_name, checked_in_at)
    if office_day is None:
        return None

    candidate_ends = []
    for slot in office_day["slots"]:
        end_minutes = _hhmm_to_minutes(slot["end"])
        end_dt = checked_in_at.replace(hour=end_minutes // 60, minute=end_minutes % 60, second=0, microsecond=0)
        if end_dt > checked_in_at:
            candidate_ends.append(end_dt)

    return max(candidate_ends) if candidate_ends else None


# ---- Breaks (taken from the root kiosk's Current Sessions list) ----
# A day's break allowance comes from that day's scheduled office hours on BESA Booking: +5 minutes per full
# scheduled hour up to 15 (reached at hour 3), flat through hour 5, then +5 more for every full hour past 5
# (1h=5, 2h=10, 3-5h=15, 6h=20, 7h=25...). The in-progress break lives on the user doc as breakStartedAt/
# breakEndsAt, and breakUsedSeconds holds what's been used today so far - seeded at clock-in with break time
# from earlier visits that day (breakCarriedSeconds), since the allowance is per day, not per visit.
BREAK_FIELDS_RESET = {"breakUsedSeconds": 0, "breakCarriedSeconds": 0, "breakStartedAt": None, "breakEndsAt": None,
                      "breakEndNotified": True}
#everything tied to one visit that's cleared on clock in and every kind of clock out
VISIT_FIELDS_RESET = {**BREAK_FIELDS_RESET, "lastCheckedInNotes": []}
SHORT_BREAK_SECONDS = 5 * 60


def _break_allowance_minutes(scheduled_hours: float) -> int:
    #rounded to the nearest half hour first, the same way worked hours are credited - so clocking in a few
    #seconds after the hour (2.99h) doesn't drop someone a whole step
    whole_hours = int(round(scheduled_hours * 2) / 2)
    minutes = 5 * min(whole_hours, 3)
    if whole_hours > 5:
        minutes += 5 * (whole_hours - 5)
    return minutes


def _scheduled_hours_on(besa_name, day: datetime) -> float:
    office_day = _office_day_for(besa_name, day)
    return office_day["scheduledHours"] if office_day else 0.0


#hours already clocked in on `day` from finished visits (falls back to the day's credited hours for entries
#recorded before visits were tracked)
def _worked_hours_on(entries: list, day) -> float:
    for e in entries or []:
        if e.get("date") and e["date"].astimezone(PACIFIC).date() == day:
            sessions = e.get("sessions") or []
            if not sessions:
                return e.get("hours") or 0
            return sum(max(0.0, (s["clockOut"] - s["clockIn"]).total_seconds() / 3600)
                       for s in sessions if s.get("clockIn") and s.get("clockOut") and not s.get("canceledTour"))
    return 0.0


#the hours a day's break allowance is based on: the larger of their scheduled office hours and the time
#they're actually in the office - so meetings marked "unavailable" on BESA Booking, or staying past their
#schedule, don't shortchange anyone. For today that's time already clocked in + the scheduled time still left.
#"Still left" is only the time inside the remaining slots - a gap or an unavailable block between slots (e.g.
#9-12 and 2-5) isn't time they'll be in, so it mustn't count (it used to: the span to the last slot's end did).
def _break_basis_hours(office_day: dict | None, worked_hours: float, open_since: datetime | None, now: datetime) -> float:
    scheduled = office_day["scheduledHours"] if office_day else 0.0
    in_office = worked_hours
    if open_since is not None:
        in_office += max(0.0, (now - open_since).total_seconds() / 3600)
        now_minutes = now.hour * 60 + now.minute + now.second / 60
        for sl in (office_day or {}).get("slots") or []:
            start, end = _hhmm_to_minutes(sl["start"]), _hhmm_to_minutes(sl["end"])
            if start is not None and end is not None:
                in_office += max(0.0, end - max(start, now_minutes)) / 60
    return max(scheduled, in_office)


#break time used this visit, including however much of an in-progress break has elapsed by `now`
def _break_used_seconds(data: dict, now: datetime) -> int:
    used = data.get("breakUsedSeconds") or 0
    if data.get("breakStartedAt") and data.get("breakEndsAt"):
        started = _to_pacific(data["breakStartedAt"])
        ends = _to_pacific(data["breakEndsAt"])
        used += max(0, int((min(now, ends) - started).total_seconds()))
    return used


#just this visit's break time (excluding what was carried over from earlier visits today), for its session record
def _visit_break_seconds(data: dict, now: datetime) -> int:
    return max(0, _break_used_seconds(data, now) - (data.get("breakCarriedSeconds") or 0))


def _break_state(data: dict, now: datetime) -> dict:
    checked_in_at = _to_pacific(data["lastCheckedIn"])
    office_day = _office_day_for(data.get("besaName"), checked_in_at)
    scheduled = office_day["scheduledHours"] if office_day else 0.0
    basis = _break_basis_hours(office_day, _worked_hours_on(data.get("biWeeklyHours"), checked_in_at.date()), checked_in_at, now)
    allowance = _break_allowance_minutes(basis) * 60
    used = _break_used_seconds(data, now)
    ends = _to_pacific(data["breakEndsAt"]) if data.get("breakEndsAt") else None
    on_break = bool(ends and now < ends)
    return {
        "scheduledHours": round(scheduled, 2),
        "basisHours": round(basis, 2),
        "allowanceSeconds": allowance,
        "usedSeconds": used,
        "remainingSeconds": max(0, allowance - used),
        "onBreak": on_break,
        #with these two the kiosk can tick the countdown locally: used = before + (now - startedAt)
        "breakStartedAt": _to_pacific(data["breakStartedAt"]).isoformat() if on_break else None,
        "usedBeforeBreakSeconds": (data.get("breakUsedSeconds") or 0) if on_break else used,
        "breakEndsAt": ends.isoformat() if on_break else None,
    }


#if someone forgot to clock out and it's now past 8pm of the day they clocked in, close their session
#automatically using their scheduled office-hours end time (from the besa-app roster) as the effective
#clock-out, rather than crediting them until 8pm or leaving them clocked in forever. Falls back to 8pm
#itself if no matching office-hours slot is found. Runs lazily (no scheduler infra exists here) -
#triggered from every endpoint that reads/lists clocked-in accounts, plus a self-check endpoint below.
def _auto_clock_out_if_needed(target_ref, data: dict) -> dict:
    last_checked_in = data.get("lastCheckedIn")
    if not last_checked_in:
        return data

    checked_in_at = _to_pacific(last_checked_in)
    now = datetime.now(PACIFIC)
    cutoff = checked_in_at.replace(hour=20, minute=0, second=0, microsecond=0)
    if now < cutoff:
        return data

    office_end = _get_office_hours_end(data.get("besaName"), checked_in_at)
    effective_end = office_end if office_end and office_end > checked_in_at else cutoff

    activities = data.get("lastCheckedInActivities") or []
    break_seconds = _visit_break_seconds(data, effective_end)
    worked_on = _work_split(_even_shares(activities), max(0.0, (effective_end - checked_in_at).total_seconds() / 60),
                            _credited_hours((effective_end - checked_in_at).total_seconds()))
    new_hours, _ = _merge_hours_entry(data.get("biWeeklyHours") or [], checked_in_at, effective_end, activities, now,
                                      auto_clocked_out=True, break_seconds=break_seconds, notes=data.get("lastCheckedInNotes"),
                                      worked_on=worked_on)

    new_hours = _archive_past_periods(target_ref.id, data.get("besaName"), new_hours, now)
    update = {"biWeeklyHours": new_hours, "lastCheckedIn": None, "lastCheckedInActivities": [], **VISIT_FIELDS_RESET}
    target_ref.update(update)
    _log_activity(firestore.client(), target_ref.id, data, checked_in_at, effective_end, worked_on, estimated=True)
    return {**data, **update}


class ClockInRequest(BaseModel):
    studentId: str
    activities: list[str]


class ClockInOptionsRequest(BaseModel):
    studentId: str


#root only - who a School Id belongs to, every task they can pick, and which ones a lead recommended (with notes)
@app.post("/clock-in/options")
def clockInOptions(request_data: ClockInOptionsRequest, root_user: dict = Depends(require_root)):
    db = firestore.client()
    target_ref, data = _find_besa_by_student_id(db, request_data.studentId.strip())
    if target_ref is None:
        raise HTTPException(status_code=404, detail="No BESA account found with that School Id.")
    data = _auto_clock_out_if_needed(target_ref, data)
    tasks, recommended = _clock_in_tasks(db, data)
    return {"success": True, "besaName": data.get("besaName"), "tasks": tasks, "recommended": recommended,
            "alreadyClockedIn": bool(data.get("lastCheckedIn")), "taskNotes": _serialize_task_notes(data.get("taskNotes"), tasks)}


@app.post("/clock-in")
def clockIn(request_data: ClockInRequest, root_user: dict = Depends(require_root)):
    activities = [a for a in request_data.activities if a.strip()]
    if not activities:
        raise HTTPException(status_code=400, detail="Pick at least one activity you intend to work on.")
    db = firestore.client()
    target_ref, data = _find_besa_by_student_id(db, request_data.studentId)
    if target_ref is None:
        raise HTTPException(status_code=404, detail="No BESA account found with that School Id.")
    available = _activity_types(db)
    not_allowed = [a for a in activities if a not in available]
    if not_allowed:
        raise HTTPException(status_code=400, detail=f'"{not_allowed[0]}" isn\'t on the activity list anymore.')
    #a forgotten session from an earlier day shouldn't block today's legitimate clock-in
    data = _auto_clock_out_if_needed(target_ref, data)
    if data.get("lastCheckedIn"):
        raise HTTPException(status_code=409, detail=f"{data.get('besaName')} is already clocked in.")

    now = datetime.now(PACIFIC)
    #the allowance is per day, so break time already taken on an earlier visit today still counts
    taken_today = sum(
        (sess.get("breakSeconds") or 0)
        for e in (data.get("biWeeklyHours") or []) if e.get("date") and e["date"].astimezone(PACIFIC).date() == now.date()
        for sess in (e.get("sessions") or [])
    )
    target_ref.update({"lastCheckedIn": now, "lastCheckedInActivities": activities, **VISIT_FIELDS_RESET,
                       "breakUsedSeconds": taken_today, "breakCarriedSeconds": taken_today})
    return {"success": True, "besaName": data.get("besaName"), "clockedInAt": now.isoformat()}


# ---- What they actually worked on (split chosen at clock-out) + the permanent activity log ----
# At clock-out the kiosk asks which activities were actually worked on and how the visit splits between them
# (a timeline bar with a slider between each pair). Each share becomes actual minutes plus its share of the
# visit's credited hours. It's saved on the visit (workedOn) AND appended to a top-level activity_log
# collection, which - unlike biWeeklyHours - is never cleared at the end of a pay period, so the Manage Admins
# analytics can look back as far as it likes. Firestore rules don't match activity_log, so only this backend
# (Admin SDK) can read or write it.
ACTIVITY_LOG_COLLECTION = "activity_log"
MAX_WORKED_ON = 12


class WorkedOnShare(BaseModel):
    activity: str
    fraction: float = Field(gt=0, le=1)


def _work_split(shares: list, elapsed_minutes: float, credited_hours: float) -> list:
    total = sum(sh["fraction"] for sh in shares) or 1
    return [{
        "activity": sh["activity"],
        "fraction": round(sh["fraction"] / total, 4),
        "minutes": round(elapsed_minutes * sh["fraction"] / total, 1),
        "hours": round(credited_hours * sh["fraction"] / total, 2),
    } for sh in shares]


def _even_shares(activities: list) -> list:
    names = [a for a in dict.fromkeys(activities) if a]
    return [{"activity": a, "fraction": 1 / len(names)} for a in names]


def _validate_shares(raw: list) -> list:
    shares, seen = [], set()
    for sh in raw:
        name = sh.activity.strip()
        if not name:
            raise HTTPException(status_code=400, detail="Every activity worked on needs a name.")
        if name in seen:
            raise HTTPException(status_code=400, detail=f'"{name}" is listed twice.')
        seen.add(name)
        shares.append({"activity": name, "fraction": sh.fraction})
    if not shares:
        raise HTTPException(status_code=400, detail="Pick at least one activity you actually worked on.")
    if len(shares) > MAX_WORKED_ON:
        raise HTTPException(status_code=400, detail=f"Pick at most {MAX_WORKED_ON} activities.")
    return shares


def _log_activity(db, uid: str, data: dict, checked_in_at: datetime, ended_at: datetime, worked_on: list, estimated: bool):
    if not worked_on:
        return
    db.collection(ACTIVITY_LOG_COLLECTION).add({
        "uid": uid,
        "besaName": data.get("besaName"),
        "date": checked_in_at.date().isoformat(),
        "clockIn": checked_in_at,
        "clockOut": ended_at,
        "workedOn": worked_on,
        #auto clock-outs never got a split, so theirs is an even split of the intended activities
        "estimated": estimated,
        "createdAt": datetime.now(PACIFIC),
    })


class ClockOutPreviewRequest(BaseModel):
    studentId: str
    leaveEarly: bool = False  # see ClockOutRequest


#"Leave Early" (kiosk Current Sessions): instead of taking the rest of today's break, they leave that much
#earlier and are credited as if they'd stayed - so the unused break time is used up and counted as time in.
def _leave_early_seconds(data: dict, now: datetime) -> int:
    remaining = _break_state(data, now)["remainingSeconds"]
    if remaining <= 0:
        raise HTTPException(status_code=409, detail=f"{data.get('besaName')} has no unused break time left today to leave early with.")
    return remaining


#root only - who this School Id is and how long they've been in, so the kiosk can ask what they actually
#worked on before clocking them out
@app.post("/clock-out/preview")
def clockOutPreview(request_data: ClockOutPreviewRequest, root_user: dict = Depends(require_root)):
    db = firestore.client()
    target_ref, data = _find_besa_by_student_id(db, request_data.studentId)
    if target_ref is None:
        raise HTTPException(status_code=404, detail="No BESA account found with that School Id.")
    data = _auto_clock_out_if_needed(target_ref, data)
    if not data.get("lastCheckedIn"):
        raise HTTPException(status_code=409, detail=f"{data.get('besaName')} isn't currently clocked in.")
    checked_in_at = _to_pacific(data["lastCheckedIn"])
    now = datetime.now(PACIFIC)
    leave_early_seconds = _leave_early_seconds(data, now) if request_data.leaveEarly else 0
    return {
        "success": True,
        "besaName": data.get("besaName"),
        "intendedActivities": data.get("lastCheckedInActivities") or [],
        "clockedInAt": checked_in_at.isoformat(),
        "elapsedMinutes": round(max(0.0, (now - checked_in_at).total_seconds() / 60), 1),
        "creditedHours": _credited_hours((now - checked_in_at).total_seconds() + leave_early_seconds),
        "leaveEarlySeconds": leave_early_seconds,
    }


class ClockOutRequest(BaseModel):
    studentId: str
    #what they actually worked on and how the visit splits between them - an even split of the intended
    #activities is used if this is left out (older kiosk builds)
    actualActivities: list[WorkedOnShare] | None = None
    #leaving early with today's unused break time (see _leave_early_seconds)
    leaveEarly: bool = False


@app.post("/clock-out")
def clockOut(request_data: ClockOutRequest, root_user: dict = Depends(require_root)):
    db = firestore.client()
    target_ref, data = _find_besa_by_student_id(db, request_data.studentId)
    if target_ref is None:
        raise HTTPException(status_code=404, detail="No BESA account found with that School Id.")

    last_checked_in = data.get("lastCheckedIn")
    if not last_checked_in:
        raise HTTPException(status_code=409, detail=f"{data.get('besaName')} isn't currently clocked in.")

    now = datetime.now(PACIFIC)
    checked_in_at = _to_pacific(last_checked_in)
    activities = data.get("lastCheckedInActivities") or []
    shares = _validate_shares(request_data.actualActivities) if request_data.actualActivities is not None else _even_shares(activities)
    leave_early_seconds = _leave_early_seconds(data, now) if request_data.leaveEarly else 0
    elapsed_minutes = max(0.0, (now - checked_in_at).total_seconds() / 60)
    credited_hours = _credited_hours((now - checked_in_at).total_seconds() + leave_early_seconds)
    worked_on = _work_split(shares, elapsed_minutes, credited_hours)
    #the break they left early with is used up, so it isn't available again if they come back later today
    new_hours, elapsed_hours = _merge_hours_entry(data.get("biWeeklyHours") or [], checked_in_at, now, activities, now,
                                                  break_seconds=_visit_break_seconds(data, now) + leave_early_seconds,
                                                  notes=data.get("lastCheckedInNotes"), worked_on=worked_on,
                                                  left_early_seconds=leave_early_seconds)
    new_hours = _archive_past_periods(target_ref.id, data.get("besaName"), new_hours, now)

    target_ref.update({
        "biWeeklyHours": new_hours,
        "lastCheckedIn": None,
        "lastCheckedInActivities": [],
        **VISIT_FIELDS_RESET,
    })
    _log_activity(db, target_ref.id, data, checked_in_at, now, worked_on, estimated=request_data.actualActivities is None)
    return {"success": True, "besaName": data.get("besaName"), "hoursThisSession": elapsed_hours, "workedOn": worked_on,
            "leftEarlySeconds": leave_early_seconds}


@app.post("/check-auto-clockout")
def checkAutoClockout(user: dict = Depends(get_current_user), fresh: bool = False):
    if fresh:
        _get_roster(force=True)
    db = firestore.client()
    target_ref = db.collection("training_data").document("data_root").collection("users").document(user.get("uid"))
    doc = target_ref.get()
    if not doc.exists:
        raise HTTPException(status_code=404, detail="User not found.")

    data = _auto_clock_out_if_needed(target_ref, doc.to_dict() or {})
    hours = _shown_weeks_hours(data)
    return {"success": True, "biWeeklyHours": hours, "openSession": _open_session(data),
            "taskNotes": _serialize_task_notes(data.get("taskNotes"), _activity_types(db)),
            "officeSchedule": _office_schedule(data.get("besaName"), _get_roster()),
            "periodStart": _period_start(datetime.now(PACIFIC)).date().isoformat()}


@app.get("/current-sessions")
def currentSessions(root_user: dict = Depends(require_root), fresh: bool = False):
    #the kiosk's 60s polling uses the cached roster; a page load/refresh passes fresh=true
    if fresh:
        _get_roster(force=True)
    db = firestore.client()
    sessions = []
    for u in db.collection("training_data").document("data_root").collection("users").stream():
        data = u.to_dict() or {}
        if data.get("accountType") not in ("besa", "besaLead"):
            continue
        if data.get("lastCheckedIn"):
            #closes out anyone who's been sitting clocked in past 8pm before listing "current" sessions
            data = _auto_clock_out_if_needed(u.reference, data)
        if not data.get("lastCheckedIn"):
            continue
        sessions.append({
            "uid": u.id,
            "besaName": data.get("besaName"),
            "activities": data.get("lastCheckedInActivities") or [],
            "clockedInAt": data["lastCheckedIn"].isoformat(),
            "break": _break_state(data, datetime.now(PACIFIC)),
            "canCancelTour": _can_cancel_tour(data),
            "notes": _serialize_notes(data.get("lastCheckedInNotes")),
            #the leads' notes on the tasks they clocked in for
            "taskNotes": _serialize_task_notes(data.get("taskNotes"), data.get("lastCheckedInActivities") or []),
        })
    return {"success": True, "sessions": sessions}


def _clocked_in_besa(db, target_uid: str):
    target_ref = db.collection("training_data").document("data_root").collection("users").document(target_uid)
    doc = target_ref.get()
    data = (doc.to_dict() or {}) if doc.exists else {}
    if data.get("accountType") not in ("besa", "besaLead"):
        raise HTTPException(status_code=404, detail="No BESA account found with that id.")
    data = _auto_clock_out_if_needed(target_ref, data)
    if not data.get("lastCheckedIn"):
        raise HTTPException(status_code=409, detail=f"{data.get('besaName')} isn't currently clocked in.")
    return target_ref, data


#Canceled Tour is only for regular BESAs (not BESA Leads) who came in only for a tour
def _can_cancel_tour(data: dict) -> bool:
    activities = data.get("lastCheckedInActivities") or []
    return data.get("accountType") == "besa" and len(activities) > 0 and all(a == TOUR_ACTIVITY for a in activities)


class CanceledTourRequest(BaseModel):
    targetUid: str


#root only - their tour was canceled: log them out for the day and set the day's hours to exactly 30 minutes
@app.post("/canceled-tour")
def canceledTour(request_data: CanceledTourRequest, root_user: dict = Depends(require_root)):
    db = firestore.client()
    target_ref, data = _clocked_in_besa(db, request_data.targetUid)
    if not _can_cancel_tour(data):
        raise HTTPException(status_code=403, detail="Canceled Tour is only for BESAs (not BESA Leads) who clocked in only for Tours.")

    now = datetime.now(PACIFIC)
    checked_in_at = _to_pacific(data["lastCheckedIn"])
    new_hours, day_hours = _merge_hours_entry(data.get("biWeeklyHours") or [], checked_in_at, now,
                                              data.get("lastCheckedInActivities") or [], now,
                                              break_seconds=_visit_break_seconds(data, now), canceled_tour=True,
                                              notes=data.get("lastCheckedInNotes"))
    new_hours = _archive_past_periods(target_ref.id, data.get("besaName"), new_hours, now)
    target_ref.update({"biWeeklyHours": new_hours, "lastCheckedIn": None, "lastCheckedInActivities": [], **VISIT_FIELDS_RESET})
    return {"success": True, "besaName": data.get("besaName"), "dayHours": day_hours}


class SessionNoteRequest(BaseModel):
    targetUid: str
    text: str


#root only - adds a note/comment to a clocked-in member's current visit (kiosk's Current Sessions)
@app.post("/session-note")
def addSessionNote(request_data: SessionNoteRequest, root_user: dict = Depends(require_root)):
    text = request_data.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="The note is empty.")
    if len(text) > SESSION_NOTE_MAX_LENGTH:
        raise HTTPException(status_code=400, detail=f"Notes can be at most {SESSION_NOTE_MAX_LENGTH} characters.")

    db = firestore.client()
    target_ref, data = _clocked_in_besa(db, request_data.targetUid)
    notes = (data.get("lastCheckedInNotes") or []) + [{"text": text, "at": datetime.now(PACIFIC)}]
    target_ref.update({"lastCheckedInNotes": notes})
    return {"success": True, "notes": _serialize_notes(notes)}


class StartBreakRequest(BaseModel):
    targetUid: str
    mode: Literal["short", "all"]  # "short" = 5 minutes (or whatever's left, if less), "all" = everything left


@app.post("/break/start")
def startBreak(request_data: StartBreakRequest, root_user: dict = Depends(require_root)):
    _get_roster(force=True)  #the allowance being spent should reflect their office hours right now
    db = firestore.client()
    target_ref, data = _clocked_in_besa(db, request_data.targetUid)
    now = datetime.now(PACIFIC)
    state = _break_state(data, now)
    if state["onBreak"]:
        raise HTTPException(status_code=409, detail=f"{data.get('besaName')} is already on break.")
    if state["remainingSeconds"] <= 0:
        detail = "No break time scheduled today (no office hours on BESA Booking)." if state["allowanceSeconds"] == 0 else "No break time left today."
        raise HTTPException(status_code=409, detail=detail)

    duration = min(SHORT_BREAK_SECONDS, state["remainingSeconds"]) if request_data.mode == "short" else state["remainingSeconds"]
    target_ref.update({
        #fold any earlier (finished) break into the used total before starting this one
        "breakUsedSeconds": state["usedSeconds"],
        "breakStartedAt": now,
        "breakEndsAt": now + timedelta(seconds=duration),
        "breakEndNotified": False,  #picked up by break_end_alerts once breakEndsAt passes
    })
    return {"success": True, "besaName": data.get("besaName"), "breakSeconds": duration}


class EndBreakRequest(BaseModel):
    targetUid: str


@app.post("/break/end")
def endBreak(request_data: EndBreakRequest, root_user: dict = Depends(require_root)):
    db = firestore.client()
    target_ref, data = _clocked_in_besa(db, request_data.targetUid)
    now = datetime.now(PACIFIC)
    if not _break_state(data, now)["onBreak"]:
        raise HTTPException(status_code=409, detail=f"{data.get('besaName')} isn't on break.")
    #only the time actually taken counts - the rest stays available for later
    target_ref.update({"breakUsedSeconds": _break_used_seconds(data, now), "breakStartedAt": None, "breakEndsAt": None})
    _notify_break_ended(target_ref.id, data.get("besaName"))
    return {"success": True, "besaName": data.get("besaName")}


# ---- Alert emails: "your break has ended" and new hours requests ----
# Break ended: emailed to the BESA whose break it was plus every BESA Lead and root account (BCC, so nobody sees
# the others' addresses) whenever a break ends: right away
# when the kiosk ends it early (above), or by the break_end_alerts scheduled function (bottom of this file)
# within about a minute of a break's timer running out. Sent from a Gmail account over SMTP using a Google
# App Password. Off unless both BREAK_ALERT_GMAIL_ADDRESS and BREAK_ALERT_GMAIL_APP_PASSWORD are set.
# Hours requests (see /my-hours/requests) are emailed the same way to every root account, so whoever runs the
# kiosk knows there's something to approve.
GMAIL_SMTP_HOST = "smtp.gmail.com"
GMAIL_SMTP_PORT = 465
#a break that ran out longer ago than this (e.g. the scheduler was down) is skipped, not announced late
BREAK_ALERT_MAX_LATE = timedelta(minutes=10)


#uids of every account of these types (e.g. "besaLead", "root")
def _uids_of_type(*account_types: str) -> set:
    users_ref = firestore.client().collection("training_data").document("data_root").collection("users")
    return {u.id for t in account_types for u in users_ref.where(filter=FieldFilter("accountType", "==", t)).stream()}


#sign-in emails of these accounts - they live on Firebase Auth, not the user docs
def _auth_emails(uids) -> list:
    uids = sorted(uids)
    emails = []
    for i in range(0, len(uids), 100):  # get_users takes at most 100 identifiers per call
        result = auth.get_users([auth.UidIdentifier(uid) for uid in uids[i:i + 100]])
        emails += [u.email for u in result.users if u.email]
    return emails


#sends one alert email to the accounts recipient_uids() returns (BCC'd). Does nothing if the Gmail secrets aren't
#set, and never raises - an alert failing must never fail the action that triggered it.
def _send_alert_email(subject: str, body: str, recipient_uids, what: str):
    sender = os.getenv("BREAK_ALERT_GMAIL_ADDRESS")
    app_password = os.getenv("BREAK_ALERT_GMAIL_APP_PASSWORD")
    if not sender or not app_password:
        return
    try:
        recipients = _auth_emails(recipient_uids())
        if not recipients:
            return
        message = EmailMessage()
        message["Subject"] = subject
        message["From"] = sender
        message["To"] = sender  # everyone else is BCC'd
        message.set_content(body)
        with smtplib.SMTP_SSL(GMAIL_SMTP_HOST, GMAIL_SMTP_PORT, timeout=10) as smtp:
            smtp.login(sender, app_password)
            smtp.send_message(message, to_addrs=[sender] + recipients)
    except Exception as e:
        print(f"{what} email failed: {e}")


#to the BESA whose break it was, every BESA Lead, and the root account(s)
def _notify_break_ended(on_break_uid: str, besa_name):
    name = besa_name or "A BESA"
    _send_alert_email(f"{name}, your break has ended", f"{name}, your break has ended.",
                      lambda: {on_break_uid} | _uids_of_type("besaLead", "root"), f"Break-ended ({name})")


#every break whose timer has run out and hasn't been announced yet - claimed in a transaction first so an
#overlapping run (or the kiosk ending it at the same moment) can't announce the same break twice
def _send_due_break_alerts():
    db = firestore.client()
    now = datetime.now(PACIFIC)
    users_ref = db.collection("training_data").document("data_root").collection("users")

    @firestore.transactional
    def claim(transaction, ref) -> bool:
        data = ref.get(transaction=transaction).to_dict() or {}
        ends = data.get("breakEndsAt")
        #a missing flag means the break started before alerts existed - never announce those
        if not ends or data.get("breakEndNotified", True) or ends > now:
            return False
        transaction.update(ref, {"breakEndNotified": True})
        return now - ends <= BREAK_ALERT_MAX_LATE

    for snap in users_ref.where(filter=FieldFilter("breakEndsAt", "<=", now)).stream():
        data = snap.to_dict() or {}
        if data.get("breakEndNotified", True):
            continue
        if claim(db.transaction(), snap.reference):
            _notify_break_ended(snap.id, data.get("besaName"))


#the current period's hours entries, each with that day's break allowance (same rule as the kiosk's live one:
#the larger of their scheduled office hours and the time they were actually in the office that day)
def _shown_weeks_hours(data: dict, roster_docs: list | None = None) -> list:
    shown_from = _period_start(datetime.now(PACIFIC))
    roster_doc = _roster_doc_for(data.get("besaName"), roster_docs if roster_docs is not None else _get_roster())
    entries = data.get("biWeeklyHours") or []
    return _hours_for_display([e for e in entries if e.get("date") and e["date"].astimezone(PACIFIC) >= shown_from], roster_doc)


#serialized hours entries, each with that day's break allowance
def _hours_for_display(entries: list, roster_doc) -> list:
    shown = []
    for e in entries:
        day = e["date"].astimezone(PACIFIC).date()
        office_day = _office_day(roster_doc, day) if roster_doc else None
        basis = _break_basis_hours(office_day, _worked_hours_on(entries, day), None, datetime.now(PACIFIC))
        shown.append({**_serialize_hours_entry(e), "breakAllowanceMinutes": _break_allowance_minutes(basis)})
    return shown


#besa/besaLead only - their finished pay periods (Profile's Past Logs), newest first, each with its days and
#that period's office hours from BESA Booking
@app.get("/my-hours/past")
def myPastHours(user: dict = Depends(get_current_user)):
    db = firestore.client()
    target_ref = db.collection("training_data").document("data_root").collection("users").document(user.get("uid"))
    doc = target_ref.get()
    data = (doc.to_dict() or {}) if doc.exists else {}
    if data.get("accountType") not in ("besa", "besaLead"):
        raise HTTPException(status_code=403, detail="Only BESA accounts have hours.")
    data = _roll_over_periods(target_ref, data)

    roster_doc = _roster_doc_for(data.get("besaName"), _get_roster())
    periods = [{"periodStart": archived["periodStart"], **_archived_period_view(archived, roster_doc)}
               for archived in (snap.to_dict() or {} for snap in
                                db.collection(HOURS_ARCHIVE_COLLECTION).where(filter=FieldFilter("uid", "==", target_ref.id)).stream())]
    periods.sort(key=lambda p: p["periodStart"], reverse=True)
    return {"success": True, "periods": periods}


#one archived period doc -> its days (with break allowances) and that period's office hours from BESA Booking
def _archived_period_view(archived: dict, roster_doc) -> dict:
    start = date_cls.fromisoformat(archived["periodStart"])
    entries = sorted((archived.get("days") or {}).values(), key=lambda e: e["date"])
    return {
        "hours": _hours_for_display(entries, roster_doc),
        "officeSchedule": [_office_day(roster_doc, start + timedelta(days=i)) for i in range(PAY_PERIOD_DAYS)] if roster_doc else None,
    }




# ---- Root admin login (passcode on top of the already-signed-in root kiosk account) ----
# The kiosk stays signed in all day, so being "root" alone only unlocks clock in/out. Anything sensitive
# (viewing/editing everyone's hours, deleting the root account) additionally needs the root owner's
# passcode. Its bcrypt hash lives in its own top-level collection, keyed by the root account's uid, that
# only this backend (Admin SDK) ever touches - never under training_data/, which the client reads. Being
# keyed by uid means a deleted-and-recreated root account starts with no passcode and has to set one up.
ROOT_ADMIN_COLLECTION = "root_admin"
ROOT_ADMIN_SESSION_MINUTES = 15
ROOT_ADMIN_MAX_ATTEMPTS = 5
ROOT_ADMIN_LOCKOUT_MINUTES = 5
PASSCODE_MIN_LENGTH = 6
PASSCODE_MAX_BYTES = 72  # bcrypt's hard input limit


def _root_admin_ref(uid: str):
    return firestore.client().collection(ROOT_ADMIN_COLLECTION).document(uid)


def _hash_session_token(token: str) -> str:
    #the session token is already 256 bits of randomness, so a fast hash is enough here - bcrypt is for
    #the human-chosen passcode. Only the hash is stored so a leaked doc can't be replayed as a session.
    return hashlib.sha256(token.encode()).hexdigest()


def _start_admin_session(ref) -> dict:
    token = secrets.token_urlsafe(32)
    expires_at = datetime.now(PACIFIC) + timedelta(minutes=ROOT_ADMIN_SESSION_MINUTES)
    ref.update({
        "sessionTokenHash": _hash_session_token(token),
        "sessionExpiresAt": expires_at,
        "failedAttempts": 0,
        "lockedUntil": None,
    })
    return {"success": True, "adminToken": token, "expiresAt": expires_at.isoformat()}


def _root_admin_session_valid(uid: str, token: str) -> bool:
    doc = _root_admin_ref(uid).get()
    data = (doc.to_dict() or {}) if doc.exists else {}
    stored_hash = data.get("sessionTokenHash")
    expires_at = data.get("sessionExpiresAt")
    return bool(token and stored_hash and expires_at and expires_at >= datetime.now(PACIFIC)
                and hmac.compare_digest(stored_hash, _hash_session_token(token)))


def require_root_admin(root_user: dict = Depends(require_root), x_root_admin_token: str = Header(default="")):
    if not _root_admin_session_valid(root_user.get("uid"), x_root_admin_token):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin login required.")
    return root_user




def _validate_passcode(passcode: str):
    if len(passcode) < PASSCODE_MIN_LENGTH:
        raise HTTPException(status_code=400, detail=f"Passcode must be at least {PASSCODE_MIN_LENGTH} characters.")
    if len(passcode.encode()) > PASSCODE_MAX_BYTES:
        raise HTTPException(status_code=400, detail="Passcode is too long.")


class PasscodeRequest(BaseModel):
    passcode: str


@app.get("/root-admin/status")
def rootAdminStatus(root_user: dict = Depends(require_root)):
    doc = _root_admin_ref(root_user.get("uid")).get()
    return {"success": True, "passcodeSet": doc.exists and bool((doc.to_dict() or {}).get("passcodeHash"))}


@app.post("/root-admin/setup")
def rootAdminSetup(request_data: PasscodeRequest, root_user: dict = Depends(require_root)):
    _validate_passcode(request_data.passcode)
    ref = _root_admin_ref(root_user.get("uid"))
    passcode_hash = bcrypt.hashpw(request_data.passcode.encode(), bcrypt.gensalt()).decode()

    #create() fails if the doc already exists - so two racing setups (or a replayed request) can't
    #overwrite a passcode that's already been set. Changing it goes through /root-admin/change instead.
    try:
        ref.create({"passcodeHash": passcode_hash, "createdAt": datetime.now(PACIFIC), "failedAttempts": 0, "lockedUntil": None})
    except Conflict:
        raise HTTPException(status_code=409, detail="A passcode is already set up for this account.")

    return _start_admin_session(ref)


@app.post("/root-admin/login")
def rootAdminLogin(request_data: PasscodeRequest, root_user: dict = Depends(require_root)):
    ref = _root_admin_ref(root_user.get("uid"))
    doc = ref.get()
    data = (doc.to_dict() or {}) if doc.exists else {}
    if not data.get("passcodeHash"):
        raise HTTPException(status_code=404, detail="No passcode set up yet.")

    now = datetime.now(PACIFIC)
    locked_until = data.get("lockedUntil")
    if locked_until and locked_until > now:
        minutes_left = max(1, round((locked_until - now).total_seconds() / 60))
        raise HTTPException(status_code=429, detail=f"Too many wrong attempts. Try again in {minutes_left} minute(s).")

    if not bcrypt.checkpw(request_data.passcode.encode()[:PASSCODE_MAX_BYTES], data["passcodeHash"].encode()):
        attempts = (data.get("failedAttempts") or 0) + 1
        if attempts >= ROOT_ADMIN_MAX_ATTEMPTS:
            ref.update({"failedAttempts": 0, "lockedUntil": now + timedelta(minutes=ROOT_ADMIN_LOCKOUT_MINUTES)})
            raise HTTPException(status_code=429, detail=f"Too many wrong attempts. Try again in {ROOT_ADMIN_LOCKOUT_MINUTES} minute(s).")
        ref.update({"failedAttempts": attempts})
        raise HTTPException(status_code=401, detail=f"Incorrect passcode. {ROOT_ADMIN_MAX_ATTEMPTS - attempts} attempt(s) left.")

    return _start_admin_session(ref)


@app.post("/root-admin/logout")
def rootAdminLogout(root_user: dict = Depends(require_root)):
    ref = _root_admin_ref(root_user.get("uid"))
    if ref.get().exists:
        ref.update({"sessionTokenHash": None, "sessionExpiresAt": None})
    return {"success": True}


class ChangePasscodeRequest(BaseModel):
    newPasscode: str


@app.post("/root-admin/change")
def rootAdminChange(request_data: ChangePasscodeRequest, root_user: dict = Depends(require_root_admin)):
    _validate_passcode(request_data.newPasscode)
    ref = _root_admin_ref(root_user.get("uid"))
    ref.update({"passcodeHash": bcrypt.hashpw(request_data.newPasscode.encode(), bcrypt.gensalt()).decode()})
    return _start_admin_session(ref)


#deletes the root account server-side (Admin SDK) rather than via the client's deleteUser(), so the
#passcode doc is guaranteed to go with it - the next root account then has to set up a fresh passcode.
@app.post("/root-admin/delete-account")
def rootAdminDeleteAccount(root_user: dict = Depends(require_root_admin)):
    uid = root_user.get("uid")
    db = firestore.client()
    user_ref = db.collection("training_data").document("data_root").collection("users").document(uid)
    user_doc = user_ref.get()

    bucket = storage.bucket()
    for cos_script in ((user_doc.to_dict() or {}).get("scriptPaths") or []) if user_doc.exists else []:
        try:
            bucket.blob(cos_script.get("path")).delete()
        except Exception as e:
            print(f"Failed to delete custom script blob: {e}")

    _root_admin_ref(uid).delete()
    user_ref.delete()
    auth.delete_user(uid)
    return {"success": True}


@app.get("/all-hours")
def allHours(root_user: dict = Depends(require_root_admin), fresh: bool = False):
    db = firestore.client()
    roster_docs = _get_roster(force=fresh)
    members = []
    for u in db.collection("training_data").document("data_root").collection("users").stream():
        data = u.to_dict() or {}
        if data.get("accountType") not in ("besa", "besaLead"):
            continue
        if data.get("lastCheckedIn"):
            data = _auto_clock_out_if_needed(u.reference, data)
        members.append({"uid": u.id, "besaName": data.get("besaName"), "studentId": data.get("studentId"),
                        "hours": _shown_weeks_hours(data, roster_docs), "openSession": _open_session(data),
                        "officeSchedule": _office_schedule(data.get("besaName"), roster_docs)})
    return {"success": True, "members": members, "periodStart": _period_start(datetime.now(PACIFIC)).date().isoformat()}


#root admin only - Everyone's Past Logs: which finished periods exist, and every member's hours and office hours
#for one of them (periodStart, YYYY-MM-DD - the newest if left out). Members who have no hours that period
#still show, so their office hours can be seen. Archives anyone's finished-period days still on their user doc first.
@app.get("/root-admin/past-hours")
def allPastHours(root_user: dict = Depends(require_root_admin), periodStart: str | None = None):
    db = firestore.client()
    members = []
    for u in db.collection("training_data").document("data_root").collection("users").stream():
        data = u.to_dict() or {}
        if data.get("accountType") in ("besa", "besaLead"):
            members.append((u.id, _roll_over_periods(u.reference, data)))

    archived_by_period = {}
    for snap in db.collection(HOURS_ARCHIVE_COLLECTION).stream():
        archived = snap.to_dict() or {}
        archived_by_period.setdefault(archived.get("periodStart"), {})[archived.get("uid")] = archived
    periods = sorted((p for p in archived_by_period if p), reverse=True)
    chosen = periodStart if periodStart in archived_by_period else (periods[0] if periods else None)
    if chosen is None:
        return {"success": True, "periods": [], "periodStart": None, "members": []}

    roster_docs = _get_roster()
    result = []
    for uid, data in members:
        roster_doc = _roster_doc_for(data.get("besaName"), roster_docs)
        archived = archived_by_period[chosen].get(uid) or {"periodStart": chosen, "days": {}}
        result.append({"uid": uid, "besaName": data.get("besaName"), **_archived_period_view(archived, roster_doc)})
    result.sort(key=lambda m: (m["besaName"] or "").lower())
    return {"success": True, "periods": periods, "periodStart": chosen, "members": result}


class SetDayHoursRequest(BaseModel):
    targetUid: str
    date: str  # YYYY-MM-DD, a day in the current Sun-Sat week
    hours: float = Field(ge=0, le=24)
    activities: list[str]


#root admin only - overwrites (or clears, with 0 hours and no activities) one day's hours entry for a
#besa/besaLead member. Restricted to the current period since older days are moved to the past-logs archive.
@app.post("/root-admin/set-day-hours")
def setDayHours(request_data: SetDayHoursRequest, root_user: dict = Depends(require_root_admin)):
    if (request_data.hours * 2) != int(request_data.hours * 2):
        raise HTTPException(status_code=400, detail="Hours must be in 0.5 increments.")

    try:
        day = date_cls.fromisoformat(request_data.date)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date.")

    entry_day = datetime(day.year, day.month, day.day, tzinfo=PACIFIC)
    period_start = _period_start(datetime.now(PACIFIC))
    if not (period_start <= entry_day < period_start + timedelta(days=PAY_PERIOD_DAYS)):
        raise HTTPException(status_code=400, detail="Only days in the current two-week period can be edited.")

    db = firestore.client()
    target_ref = db.collection("training_data").document("data_root").collection("users").document(request_data.targetUid)
    target_doc = target_ref.get()
    if not target_doc.exists or (target_doc.to_dict() or {}).get("accountType") not in ("besa", "besaLead"):
        raise HTTPException(status_code=404, detail="No BESA account found with that id.")

    data = target_doc.to_dict() or {}
    all_entries = data.get("biWeeklyHours") or []
    is_day = lambda e: e.get("date") and e["date"].astimezone(PACIFIC).date() == day
    existing = next((e for e in all_entries if is_day(e)), None)
    remaining = [e for e in all_entries if not is_day(e)]
    if request_data.hours > 0 or request_data.activities:
        #an admin-set entry is a reviewed number, so it no longer counts as an auto-clockout guess. The
        #recorded arrive/leave sessions are kept as-is (they're what actually happened) and the day is
        #flagged as edited, since its total may no longer match them.
        remaining.append({
            "date": entry_day,
            "hours": request_data.hours,
            "activities": request_data.activities,
            "autoClockedOut": False,
            "editedByAdmin": True,
            "sessions": (existing or {}).get("sessions") or [],
            "dayNotes": (existing or {}).get("dayNotes") or [],
        })
    elif (existing or {}).get("dayNotes"):
        #clearing a day's hours shouldn't throw away the notes the member wrote on it
        remaining.append({"date": entry_day, "hours": 0, "activities": [], "dayNotes": existing["dayNotes"]})

    target_ref.update({"biWeeklyHours": remaining})
    return {"success": True, "hours": _shown_weeks_hours({**data, "biWeeklyHours": remaining})}


# ---- Day notes (a member's own notes on a day of their My Hours) ----
DAY_NOTE_MAX_LENGTH = 500
DAY_NOTES_MAX_PER_DAY = 20


class DayNoteRequest(BaseModel):
    date: str  # YYYY-MM-DD, a day in the current two-week period
    text: str


class DeleteDayNoteRequest(BaseModel):
    date: str
    noteId: str


#the signed-in besa/besaLead's own user doc, plus the requested day (must be in the current period, since
#older days are moved to the past-logs archive)
def _own_hours_day(user: dict, date_str: str):
    try:
        day = date_cls.fromisoformat(date_str)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date.")
    entry_day = datetime(day.year, day.month, day.day, tzinfo=PACIFIC)
    period_start = _period_start(datetime.now(PACIFIC))
    if not (period_start <= entry_day < period_start + timedelta(days=PAY_PERIOD_DAYS)):
        raise HTTPException(status_code=400, detail="Notes can only be added to days in the current two-week period.")

    db = firestore.client()
    target_ref = db.collection("training_data").document("data_root").collection("users").document(user.get("uid"))
    doc = target_ref.get()
    data = (doc.to_dict() or {}) if doc.exists else {}
    if data.get("accountType") not in ("besa", "besaLead"):
        raise HTTPException(status_code=403, detail="Only BESA accounts have hours to add notes to.")
    return target_ref, data, day, entry_day


#replaces that day's dayNotes with whatever `change` returns, creating a 0-hour entry for a day with nothing logged
def _update_day_notes(target_ref, data: dict, day, entry_day: datetime, change) -> list:
    entries = data.get("biWeeklyHours") or []
    is_day = lambda e: e.get("date") and e["date"].astimezone(PACIFIC).date() == day
    existing = next((e for e in entries if is_day(e)), None)
    notes = change((existing or {}).get("dayNotes") or [])
    remaining = [e for e in entries if not is_day(e)]
    if existing:
        remaining.append({**existing, "dayNotes": notes})
    elif notes:
        remaining.append({"date": entry_day, "hours": 0, "activities": [], "dayNotes": notes})
    target_ref.update({"biWeeklyHours": remaining})
    return _shown_weeks_hours({**data, "biWeeklyHours": remaining})


@app.post("/my-hours/note")
def addDayNote(request_data: DayNoteRequest, user: dict = Depends(get_current_user)):
    text = request_data.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="The note is empty.")
    if len(text) > DAY_NOTE_MAX_LENGTH:
        raise HTTPException(status_code=400, detail=f"Notes can be at most {DAY_NOTE_MAX_LENGTH} characters.")
    target_ref, data, day, entry_day = _own_hours_day(user, request_data.date)

    def add(notes: list) -> list:
        if len(notes) >= DAY_NOTES_MAX_PER_DAY:
            raise HTTPException(status_code=400, detail=f"A day can have at most {DAY_NOTES_MAX_PER_DAY} notes.")
        return notes + [{"id": secrets.token_hex(6), "text": text, "at": datetime.now(PACIFIC)}]

    return {"success": True, "biWeeklyHours": _update_day_notes(target_ref, data, day, entry_day, add)}


@app.post("/my-hours/note/delete")
def deleteDayNote(request_data: DeleteDayNoteRequest, user: dict = Depends(get_current_user)):
    target_ref, data, day, entry_day = _own_hours_day(user, request_data.date)
    hours = _update_day_notes(target_ref, data, day, entry_day,
                              lambda notes: [n for n in notes if n.get("id") != request_data.noteId])
    return {"success": True, "biWeeklyHours": hours}


# ---- Hours requests (a member asks for time they weren't clocked in for; a root admin approves it) ----
# From Profile a besa/besaLead picks a day on a calendar and lays out one or more time ranges on it, each with
# what they worked on and why it wasn't clocked (forgot to clock in, worked outside the office, ...). Each range
# is its own doc in hours_requests: {uid, besaName, date, start, end, activities, reason, details, status
# (pending/approved/denied), createdAt, decidedAt, decisionNote}. Approving one adds it to that day exactly like
# a kiosk visit (flagged requested), so it's rounded together with the day's other visits. Days from the current
# and the previous pay period can be requested - an approved one in a finished period goes into its archive doc.
# Firestore rules don't match hours_requests, so only this backend (Admin SDK) can read or write it.
HOURS_REQUESTS_COLLECTION = "hours_requests"
HOURS_REQUEST_REASONS = {
    "forgotClockIn": "Forgot to clock in",
    "forgotClockOut": "Forgot to clock out",
    "outsideOffice": "Worked outside the office",
    "other": "Other",
}
HOURS_REQUEST_DETAILS_MAX_LENGTH = 500
HOURS_REQUESTS_MAX_PER_DAY = 10
#decided requests stay listed (for the member and for root) this long after the decision
HOURS_REQUEST_DECIDED_SHOWN_DAYS = 30


#first and last day a member can ask for hours on: the start of the previous pay period through today
def _request_window(now: datetime):
    return (_period_start(now) - timedelta(days=PAY_PERIOD_DAYS)).date(), now.astimezone(PACIFIC).date()


def _users_ref(db):
    return db.collection("training_data").document("data_root").collection("users")


#the signed-in besa/besaLead's own user doc, with any finished-period days already moved to the archive
def _own_besa_doc(user: dict):
    target_ref = _users_ref(firestore.client()).document(user.get("uid"))
    doc = target_ref.get()
    data = (doc.to_dict() or {}) if doc.exists else {}
    if data.get("accountType") not in ("besa", "besaLead"):
        raise HTTPException(status_code=403, detail="Only BESA accounts have hours.")
    return target_ref, _roll_over_periods(target_ref, data)


#a member's day entries for the pay period starting at period_start: off their user doc for the current period,
#otherwise out of that period's archive doc. Expects the user doc to have been rolled over already.
def _period_entries(db, uid: str, data: dict, period_start: datetime, now: datetime) -> list:
    if period_start >= _period_start(now):
        return data.get("biWeeklyHours") or []
    snap = db.collection(HOURS_ARCHIVE_COLLECTION).document(f"{uid}_{period_start.date().isoformat()}").get()
    return list(((snap.to_dict() or {}).get("days") or {}).values()) if snap.exists else []


def _midnight(day: date_cls) -> datetime:
    return datetime(day.year, day.month, day.day, tzinfo=PACIFIC)


#the visits already logged on `day` (plus the one in progress, if they're clocked in that day) as (start, end)
def _logged_ranges(db, uid: str, data: dict, day: date_cls, now: datetime) -> list:
    entries = _period_entries(db, uid, data, _period_start(_midnight(day)), now)
    entry = next((e for e in entries if e.get("date") and e["date"].astimezone(PACIFIC).date() == day), None)
    ranges = [(_to_pacific(s["clockIn"]), _to_pacific(s["clockOut"]))
              for s in (entry or {}).get("sessions") or [] if s.get("clockIn") and s.get("clockOut")]
    if data.get("lastCheckedIn"):
        opened = _to_pacific(data["lastCheckedIn"])
        if opened.date() == day:
            ranges.append((opened, now))
    return ranges


def _overlaps(a: tuple, b: tuple) -> bool:
    return a[0] < b[1] and b[0] < a[1]


def _request_time_label(start: datetime, end: datetime) -> str:
    fmt = lambda d: d.strftime("%I:%M %p").lstrip("0")
    return f"{fmt(start)} - {fmt(end)}"


def _serialize_hours_request(req_id: str, r: dict) -> dict:
    start, end = _to_pacific(r["start"]), _to_pacific(r["end"])
    return {
        "id": req_id,
        "uid": r.get("uid"),
        "besaName": r.get("besaName"),
        "date": r.get("date"),
        "start": start.isoformat(),
        "end": end.isoformat(),
        "activities": r.get("activities") or [],
        "reason": r.get("reason") or "",
        "reasonLabel": HOURS_REQUEST_REASONS.get(r.get("reason"), r.get("reason") or ""),
        "details": r.get("details") or "",
        "status": r.get("status") or "pending",
        "hours": _credited_hours((end - start).total_seconds()),
        "createdAt": r["createdAt"].isoformat() if r.get("createdAt") else None,
        "decidedAt": r["decidedAt"].isoformat() if r.get("decidedAt") else None,
        "decisionNote": r.get("decisionNote") or "",
    }


def _member_requests(db, uid: str) -> list:
    return [(snap.id, snap.to_dict() or {}) for snap in
            db.collection(HOURS_REQUESTS_COLLECTION).where(filter=FieldFilter("uid", "==", uid)).stream()]


#everything the member's Request Hours panel needs: the days they can pick, what's already logged on each of
#them (so the day view can show it), and their pending + recently decided requests
def _my_requests_view(db, target_ref, data: dict, now: datetime) -> dict:
    first, last = _request_window(now)
    logged = {}
    for period_start in {_period_start(_midnight(first)), _period_start(now)}:
        for e in _period_entries(db, target_ref.id, data, period_start, now):
            day = e["date"].astimezone(PACIFIC).date() if e.get("date") else None
            if day is None or not (first <= day <= last):
                continue
            logged[day.isoformat()] = [{"start": _to_pacific(s["clockIn"]).isoformat(), "end": _to_pacific(s["clockOut"]).isoformat()}
                                       for s in e.get("sessions") or [] if s.get("clockIn") and s.get("clockOut")]
    if data.get("lastCheckedIn"):
        opened = _to_pacific(data["lastCheckedIn"])
        logged.setdefault(opened.date().isoformat(), []).append({"start": opened.isoformat(), "end": None})

    shown_since = now - timedelta(days=HOURS_REQUEST_DECIDED_SHOWN_DAYS)
    requests_ = [_serialize_hours_request(rid, r) for rid, r in _member_requests(db, target_ref.id)
                 if r.get("status") == "pending" or (r.get("decidedAt") and r["decidedAt"] >= shown_since)]
    requests_.sort(key=lambda r: (r["date"], r["start"]), reverse=True)
    return {"success": True, "firstDay": first.isoformat(), "lastDay": last.isoformat(), "now": now.isoformat(),
            "logged": logged, "requests": requests_, "reasons": HOURS_REQUEST_REASONS}


@app.get("/my-hours/requests")
def myHoursRequests(user: dict = Depends(get_current_user)):
    target_ref, data = _own_besa_doc(user)
    return _my_requests_view(firestore.client(), target_ref, data, datetime.now(PACIFIC))


class HoursRequestRange(BaseModel):
    start: str  # "HH:MM", Pacific
    end: str    # "HH:MM" - "24:00" is midnight at the end of the day
    activities: list[str]
    reason: str  # a key of HOURS_REQUEST_REASONS
    details: str = ""


class SubmitHoursRequestsRequest(BaseModel):
    date: str  # YYYY-MM-DD
    ranges: list[HoursRequestRange]


@app.post("/my-hours/requests")
def submitHoursRequests(request_data: SubmitHoursRequestsRequest, user: dict = Depends(get_current_user)):
    target_ref, data = _own_besa_doc(user)
    db = firestore.client()
    now = datetime.now(PACIFIC)
    try:
        day = date_cls.fromisoformat(request_data.date)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date.")
    first, last = _request_window(now)
    if not (first <= day <= last):
        raise HTTPException(status_code=400, detail="Hours can only be requested for days in this or the last pay period, up to today.")
    if not request_data.ranges:
        raise HTTPException(status_code=400, detail="Add at least one time range.")

    pending_today = [(_to_pacific(r["start"]), _to_pacific(r["end"])) for _, r in _member_requests(db, target_ref.id)
                     if r.get("status") == "pending" and r.get("date") == day.isoformat()]
    if len(pending_today) + len(request_data.ranges) > HOURS_REQUESTS_MAX_PER_DAY:
        raise HTTPException(status_code=400, detail=f"A day can have at most {HOURS_REQUESTS_MAX_PER_DAY} pending requests.")
    logged = _logged_ranges(db, target_ref.id, data, day, now)

    new_docs = []
    for rng in request_data.ranges:
        start_minutes, end_minutes = _hhmm_to_minutes(rng.start), _hhmm_to_minutes(rng.end)
        if start_minutes is None or end_minutes is None or not (0 <= start_minutes < end_minutes <= 24 * 60):
            raise HTTPException(status_code=400, detail="Each time range needs a start before its end.")
        start, end = _midnight(day) + timedelta(minutes=start_minutes), _midnight(day) + timedelta(minutes=end_minutes)
        label = _request_time_label(start, end)
        if end > now:
            raise HTTPException(status_code=400, detail=f"{label} hasn't happened yet.")
        if any(_overlaps((start, end), r) for r in logged):
            raise HTTPException(status_code=400, detail=f"{label} overlaps time that's already logged.")
        if any(_overlaps((start, end), r) for r in pending_today):
            raise HTTPException(status_code=400, detail=f"{label} overlaps another of your requests.")
        if rng.reason not in HOURS_REQUEST_REASONS:
            raise HTTPException(status_code=400, detail=f"Pick a reason for {label}.")
        details = rng.details.strip()
        if len(details) > HOURS_REQUEST_DETAILS_MAX_LENGTH:
            raise HTTPException(status_code=400, detail=f"Details can be at most {HOURS_REQUEST_DETAILS_MAX_LENGTH} characters.")
        if rng.reason == "other" and not details:
            raise HTTPException(status_code=400, detail=f'Say what happened for {label} (the reason is "Other").')
        activities = [a for a in dict.fromkeys(a.strip() for a in rng.activities) if a]
        if not activities:
            raise HTTPException(status_code=400, detail=f"Pick what you worked on for {label}.")
        if len(activities) > MAX_WORKED_ON:
            raise HTTPException(status_code=400, detail=f"Pick at most {MAX_WORKED_ON} activities.")
        pending_today.append((start, end))
        new_docs.append({"uid": target_ref.id, "besaName": data.get("besaName"), "date": day.isoformat(), "start": start,
                         "end": end, "activities": activities, "reason": rng.reason, "details": details,
                         "status": "pending", "createdAt": now, "decidedAt": None, "decisionNote": ""})

    batch = db.batch()
    for d in new_docs:
        batch.set(db.collection(HOURS_REQUESTS_COLLECTION).document(), d)
    batch.commit()
    _notify_hours_requested(data.get("besaName"), day, new_docs)
    return _my_requests_view(db, target_ref, data, now)


#emails the root account(s) that there's something to approve - one email per submit, listing every range
def _notify_hours_requested(besa_name, day: date_cls, docs: list):
    name = besa_name or "A BESA"
    day_text = f"{day.strftime('%A, %B')} {day.day}"
    lines = []
    for d in docs:
        line = (f"- {_request_time_label(d['start'], d['end'])} ({_credited_hours((d['end'] - d['start']).total_seconds())} h): "
                f"{', '.join(d['activities'])}. Reason: {HOURS_REQUEST_REASONS.get(d['reason'], d['reason'])}")
        if d["details"]:
            line += f' - "{d["details"]}"'
        lines.append(line)
    count = "an hours request" if len(docs) == 1 else f"{len(docs)} hours requests"
    body = (f"{name} sent {count} for {day_text}:\n\n" + "\n".join(lines) +
            "\n\nTo approve or deny, open Profile on the root account, unlock admin, and go to Hours Requests.")
    _send_alert_email(f"Hours request from {name} for {day_text}", body, lambda: _uids_of_type("root"), f"Hours-request ({name})")


class CancelHoursRequestRequest(BaseModel):
    requestId: str


@app.post("/my-hours/requests/cancel")
def cancelHoursRequest(request_data: CancelHoursRequestRequest, user: dict = Depends(get_current_user)):
    target_ref, data = _own_besa_doc(user)
    db = firestore.client()
    req_ref = db.collection(HOURS_REQUESTS_COLLECTION).document(request_data.requestId)
    snap = req_ref.get()
    req = (snap.to_dict() or {}) if snap.exists else {}
    if req.get("uid") != target_ref.id:
        raise HTTPException(status_code=404, detail="Request not found.")
    if req.get("status") != "pending":
        raise HTTPException(status_code=409, detail="That request has already been decided.")
    req_ref.delete()
    return _my_requests_view(db, target_ref, data, datetime.now(PACIFIC))


#root admin's list: every pending request (oldest day first) plus the recently decided ones (newest first)
def _root_requests_view(db, now: datetime) -> dict:
    requests_ref = db.collection(HOURS_REQUESTS_COLLECTION)
    pending = [_serialize_hours_request(s.id, s.to_dict() or {})
               for s in requests_ref.where(filter=FieldFilter("status", "==", "pending")).stream()]
    pending.sort(key=lambda r: (r["date"], r["start"]))
    since = now - timedelta(days=HOURS_REQUEST_DECIDED_SHOWN_DAYS)
    decided = [_serialize_hours_request(s.id, s.to_dict() or {})
               for s in requests_ref.where(filter=FieldFilter("decidedAt", ">=", since)).stream()]
    decided.sort(key=lambda r: r["decidedAt"] or "", reverse=True)
    return {"success": True, "pending": pending, "decided": decided}


@app.get("/root-admin/hours-requests")
def hoursRequests(root_user: dict = Depends(require_root_admin)):
    return _root_requests_view(firestore.client(), datetime.now(PACIFIC))


class DecideHoursRequestRequest(BaseModel):
    requestId: str
    approve: bool
    note: str = ""


#adds an approved request to its day as a visit, on the user doc or (for a finished period) in its archive doc
def _add_requested_visit(db, target_ref, data: dict, req: dict, now: datetime):
    start, end = _to_pacific(req["start"]), _to_pacific(req["end"])
    activities = req.get("activities") or []
    seconds = (end - start).total_seconds()
    worked_on = _work_split(_even_shares(activities), seconds / 60, _credited_hours(seconds))
    extra = {"requested": True, "requestReason": req.get("reason"), "requestDetails": req.get("details") or ""}
    period_start = _period_start(start)
    if period_start >= _period_start(now):
        new_hours, _ = _merge_hours_entry(data.get("biWeeklyHours") or [], start, end, activities, now, worked_on=worked_on, extra=extra)
        target_ref.update({"biWeeklyHours": new_hours})
    else:
        archive_ref = db.collection(HOURS_ARCHIVE_COLLECTION).document(f"{target_ref.id}_{period_start.date().isoformat()}")
        snap = archive_ref.get()
        days = ((snap.to_dict() or {}).get("days") or {}) if snap.exists else {}
        new_days, _ = _merge_hours_entry(list(days.values()), start, end, activities, now, worked_on=worked_on, extra=extra)
        archive_ref.set({"uid": target_ref.id, "besaName": data.get("besaName"), "periodStart": period_start.date().isoformat(),
                         "days": {e["date"].astimezone(PACIFIC).date().isoformat(): e for e in new_days},
                         **({} if snap.exists else {"archivedAt": now})}, merge=True)
    _log_activity(db, target_ref.id, data, start, end, worked_on, estimated=len(activities) > 1)


@app.post("/root-admin/hours-requests/decide")
def decideHoursRequest(request_data: DecideHoursRequestRequest, root_user: dict = Depends(require_root_admin)):
    note = request_data.note.strip()
    if len(note) > HOURS_REQUEST_DETAILS_MAX_LENGTH:
        raise HTTPException(status_code=400, detail=f"The note can be at most {HOURS_REQUEST_DETAILS_MAX_LENGTH} characters.")
    db = firestore.client()
    now = datetime.now(PACIFIC)
    req_ref = db.collection(HOURS_REQUESTS_COLLECTION).document(request_data.requestId)
    snap = req_ref.get()
    if not snap.exists:
        raise HTTPException(status_code=404, detail="Request not found - the member may have canceled it.")
    req = snap.to_dict() or {}
    if req.get("status") != "pending":
        raise HTTPException(status_code=409, detail="That request has already been decided.")

    if request_data.approve:
        target_ref = _users_ref(db).document(req.get("uid"))
        target_doc = target_ref.get()
        data = (target_doc.to_dict() or {}) if target_doc.exists else {}
        if data.get("accountType") not in ("besa", "besaLead"):
            raise HTTPException(status_code=404, detail="That member's account no longer exists.")
        data = _roll_over_periods(target_ref, data)
        start, end = _to_pacific(req["start"]), _to_pacific(req["end"])
        #they may have clocked in for part of this time since asking - approving would count it twice
        if any(_overlaps((start, end), r) for r in _logged_ranges(db, target_ref.id, data, start.date(), now)):
            raise HTTPException(status_code=409, detail="This overlaps a visit that's been logged since it was requested - deny it, or edit the day by hand.")
        _add_requested_visit(db, target_ref, data, req, now)

    req_ref.update({"status": "approved" if request_data.approve else "denied", "decidedAt": now, "decisionNote": note})
    return _root_requests_view(db, now)


# ---- Root admin editing a member's visits directly (Profile's Edit Anyone's Hours) ----
# The same calendar + day timeline as Request Hours, but nothing to approve: root admin sees every visit on the
# member's day and can add, move, resize (lowering or raising the hours) or delete them, then saves the whole day
# at once. Visits keep everything else they recorded (breaks, notes, kiosk flags); added or changed ones are
# flagged adminEdited. The day's hours are re-rounded from its visits, so a total that was set by hand
# (editedByAdmin) or a canceled-tour day's fixed 30 minutes is replaced by the visits' time.

def _visit_view(index: int, sess: dict) -> dict:
    worked_on = sess.get("workedOn") or []
    return {
        "index": index,
        "start": _to_pacific(sess["clockIn"]).isoformat(),
        "end": _to_pacific(sess["clockOut"]).isoformat(),
        "activities": [w["activity"] for w in worked_on] if worked_on else (sess.get("activities") or []),
        "autoClockedOut": bool(sess.get("autoClockedOut")),
        "canceledTour": bool(sess.get("canceledTour")),
        "requested": bool(sess.get("requested")),
        "adminEdited": bool(sess.get("adminEdited")),
        "adminNote": sess.get("adminNote") or "",
        "leftEarlySeconds": sess.get("leftEarlySeconds") or 0,
    }


#one member's days in the editable window (this and the last pay period): each day's visits (index = its place in
#the stored list, which saving refers back to), its hours, and whether its total was set by hand; plus the visit
#in progress and pending requests, which show on the timeline but can't be edited there
def _member_days_view(db, target_ref, data: dict, now: datetime) -> dict:
    first, last = _request_window(now)
    days = {}
    for period_start in {_period_start(_midnight(first)), _period_start(now)}:
        for e in _period_entries(db, target_ref.id, data, period_start, now):
            day = e["date"].astimezone(PACIFIC).date() if e.get("date") else None
            if day is None or not (first <= day <= last):
                continue
            days[day.isoformat()] = {
                "hours": _day_hours(e),
                "handSet": bool(e.get("editedByAdmin") or e.get("canceledTour")) or (bool(e.get("hours")) and not e.get("sessions")),
                "visits": [_visit_view(i, sess) for i, sess in enumerate(e.get("sessions") or []) if sess.get("clockIn") and sess.get("clockOut")],
            }
    open_session = None
    if data.get("lastCheckedIn"):
        open_session = {"start": _to_pacific(data["lastCheckedIn"]).isoformat()}
    pending = [{"date": r.get("date"), "start": _to_pacific(r["start"]).isoformat(), "end": _to_pacific(r["end"]).isoformat()}
               for _, r in _member_requests(db, target_ref.id) if r.get("status") == "pending"]
    return {"success": True, "uid": target_ref.id, "besaName": data.get("besaName"), "firstDay": first.isoformat(),
            "lastDay": last.isoformat(), "now": now.isoformat(), "days": days, "openSession": open_session, "pending": pending}


def _besa_doc_by_uid(db, uid: str):
    target_ref = _users_ref(db).document(uid)
    doc = target_ref.get()
    data = (doc.to_dict() or {}) if doc.exists else {}
    if data.get("accountType") not in ("besa", "besaLead"):
        raise HTTPException(status_code=404, detail="No BESA account found with that id.")
    return target_ref, _roll_over_periods(target_ref, data)


@app.get("/root-admin/member-days")
def memberDays(uid: str, root_user: dict = Depends(require_root_admin)):
    db = firestore.client()
    target_ref, data = _besa_doc_by_uid(db, uid)
    return _member_days_view(db, target_ref, data, datetime.now(PACIFIC))


class MemberVisit(BaseModel):
    source: int | None = None  # the stored visit this was (its index from /root-admin/member-days), None for a new one
    start: str  # "HH:MM", Pacific
    end: str    # "HH:MM" - "24:00" is midnight at the end of the day
    activities: list[str]
    note: str = ""


class SetMemberDayRequest(BaseModel):
    targetUid: str
    date: str  # YYYY-MM-DD
    visits: list[MemberVisit]  # the day's whole list - stored visits left out are deleted


#replaces a day's entries in the period they belong to: the user doc for the current period, otherwise the archive doc
def _write_period_entries(db, target_ref, data: dict, period_start: datetime, entries: list, now: datetime):
    if period_start >= _period_start(now):
        target_ref.update({"biWeeklyHours": entries})
        return
    archive_ref = db.collection(HOURS_ARCHIVE_COLLECTION).document(f"{target_ref.id}_{period_start.date().isoformat()}")
    snap = archive_ref.get()
    archived = (snap.to_dict() or {}) if snap.exists else {"uid": target_ref.id, "besaName": data.get("besaName"),
                                                           "periodStart": period_start.date().isoformat(), "archivedAt": now}
    archive_ref.set({**archived, "days": {e["date"].astimezone(PACIFIC).date().isoformat(): e for e in entries}})


#drops the activity_log records of visits that were changed or deleted (matched by their clock-in time)
def _unlog_activity(db, uid: str, clock_ins: list):
    if not clock_ins:
        return
    stamps = {ci.timestamp() for ci in clock_ins}
    for snap in db.collection(ACTIVITY_LOG_COLLECTION).where(filter=FieldFilter("uid", "==", uid)).stream():
        logged_in = (snap.to_dict() or {}).get("clockIn")
        if logged_in and logged_in.timestamp() in stamps:
            snap.reference.delete()


@app.post("/root-admin/member-day")
def setMemberDay(request_data: SetMemberDayRequest, root_user: dict = Depends(require_root_admin)):
    db = firestore.client()
    now = datetime.now(PACIFIC)
    target_ref, data = _besa_doc_by_uid(db, request_data.targetUid)
    try:
        day = date_cls.fromisoformat(request_data.date)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date.")
    first, last = _request_window(now)
    if not (first <= day <= last):
        raise HTTPException(status_code=400, detail="Only days in this or the last pay period, up to today, can be edited here.")

    period_start = _period_start(_midnight(day))
    entries = _period_entries(db, target_ref.id, data, period_start, now)
    is_day = lambda e: e.get("date") and e["date"].astimezone(PACIFIC).date() == day
    existing = next((e for e in entries if is_day(e)), None)
    old_sessions = (existing or {}).get("sessions") or []

    in_progress = None
    if data.get("lastCheckedIn") and _to_pacific(data["lastCheckedIn"]).date() == day:
        in_progress = (_to_pacific(data["lastCheckedIn"]), now)

    sources_seen = set()
    taken = []
    new_sessions, changed, changed_sources = [], [], set()
    for visit in request_data.visits:
        start_minutes, end_minutes = _hhmm_to_minutes(visit.start), _hhmm_to_minutes(visit.end)
        if start_minutes is None or end_minutes is None or not (0 <= start_minutes < end_minutes <= 24 * 60):
            raise HTTPException(status_code=400, detail="Each visit needs a start before its end.")
        start, end = _midnight(day) + timedelta(minutes=start_minutes), _midnight(day) + timedelta(minutes=end_minutes)
        label = _request_time_label(start, end)
        if end > now:
            raise HTTPException(status_code=400, detail=f"{label} hasn't happened yet.")
        if in_progress and _overlaps((start, end), in_progress):
            raise HTTPException(status_code=400, detail=f"{label} overlaps the visit they're clocked in for right now.")
        if any(_overlaps((start, end), t) for t in taken):
            raise HTTPException(status_code=400, detail=f"{label} overlaps another visit that day.")
        taken.append((start, end))
        activities = [a for a in dict.fromkeys(a.strip() for a in visit.activities) if a]
        if not activities:
            raise HTTPException(status_code=400, detail=f"Pick what was worked on for {label}.")
        if len(activities) > MAX_WORKED_ON:
            raise HTTPException(status_code=400, detail=f"Pick at most {MAX_WORKED_ON} activities.")
        note = visit.note.strip()
        if len(note) > HOURS_REQUEST_DETAILS_MAX_LENGTH:
            raise HTTPException(status_code=400, detail=f"Notes can be at most {HOURS_REQUEST_DETAILS_MAX_LENGTH} characters.")

        if visit.source is not None:
            if not (0 <= visit.source < len(old_sessions)) or visit.source in sources_seen:
                raise HTTPException(status_code=409, detail="This day changed since it was loaded - reload and try again.")
            sources_seen.add(visit.source)
            base = old_sessions[visit.source]
        else:
            base = None

        base_activities = _visit_view(0, base)["activities"] if base else None
        same = (base is not None and _to_pacific(base["clockIn"]) == start and _to_pacific(base["clockOut"]) == end
                and base_activities == activities and (base.get("adminNote") or "") == note)
        if same:
            new_sessions.append(base)
            continue

        seconds = (end - start).total_seconds()
        #same activities keep the split chosen at clock-out, just rescaled to the new length; otherwise an even split
        old_split = {w["activity"]: w["fraction"] for w in (base or {}).get("workedOn") or []}
        shares = ([{"activity": a, "fraction": old_split[a]} for a in activities]
                  if base and set(old_split) == set(activities) else _even_shares(activities))
        worked_on = _work_split(shares, seconds / 60, _credited_hours(seconds + ((base or {}).get("leftEarlySeconds") or 0)))
        times_changed = base is None or _to_pacific(base["clockIn"]) != start or _to_pacific(base["clockOut"]) != end
        new_sessions.append({
            **(base or {"breakSeconds": 0, "canceledTour": False, "notes": [], "leftEarlySeconds": 0}),
            "clockIn": start, "clockOut": end, "activities": activities, "workedOn": worked_on,
            #a forgotten clock-out's guessed leave time is no longer a guess once root admin sets it
            "autoClockedOut": bool((base or {}).get("autoClockedOut")) and not times_changed,
            "adminEdited": True, "adminNote": note,
        })
        changed.append(new_sessions[-1])
        if visit.source is not None:
            changed_sources.add(visit.source)

    removed = [s for i, s in enumerate(old_sessions) if i not in sources_seen]
    if not changed and not removed:
        return _member_days_view(db, target_ref, data, now)

    new_sessions.sort(key=lambda sess: sess["clockIn"])
    remaining = [e for e in entries if not is_day(e)]
    if new_sessions or (existing or {}).get("dayNotes"):
        entry = {
            **(existing or {"date": _midnight(day)}),
            "activities": sorted({a for sess in new_sessions for a in sess.get("activities") or []}),
            "autoClockedOut": any(sess.get("autoClockedOut") for sess in new_sessions),
            "editedByAdmin": False,
            "canceledTour": False,
            "sessions": new_sessions,
        }
        entry["hours"] = _day_hours(entry) if new_sessions else 0
        remaining.append(entry)
    _write_period_entries(db, target_ref, data, period_start, remaining, now)
    if period_start >= _period_start(now):
        data = {**data, "biWeeklyHours": remaining}

    #keep the analytics' permanent log in step: changed/deleted visits' old records out, changed/new ones' in
    _unlog_activity(db, target_ref.id, [_to_pacific(sess["clockIn"]) for i, sess in enumerate(old_sessions)
                                        if i not in sources_seen or i in changed_sources])
    for sess in changed:
        _log_activity(db, target_ref.id, data, sess["clockIn"], sess["clockOut"], sess["workedOn"], estimated=False)
    return _member_days_view(db, target_ref, data, now)


def _activity_types(db) -> list:
    root_doc = db.collection("training_data").document("data_root").get()
    types = (root_doc.to_dict() or {}).get("activityTypes") if root_doc.exists else None
    return types or ACTIVITY_TYPES_DEFAULT


@app.get("/activity-types")
def getActivityTypes(user: dict = Depends(get_current_user)):
    return {"success": True, "activityTypes": _activity_types(firestore.client())}


#the kiosk (root) and BESA Leads (Assign Tasks, to make a new task to hand out) can add to the shared list
def require_root_or_lead(user: dict = Depends(get_current_user)):
    user_doc = _users_ref(firestore.client()).document(user.get("uid")).get()
    if not user_doc.exists or (user_doc.to_dict() or {}).get("accountType") not in ("root", "besaLead"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Root or BESA Lead priviledges needed")
    return user


class ActivityTypeRequest(BaseModel):
    name: str


@app.post("/activity-types/add")
def addActivityType(request_data: ActivityTypeRequest, root_user: dict = Depends(require_root_or_lead)):
    name = request_data.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="The name is empty.")
    if len(name) > TASK_NAME_MAX_LENGTH:
        raise HTTPException(status_code=400, detail=f"Names can be at most {TASK_NAME_MAX_LENGTH} characters.")
    db = firestore.client()
    root_ref = db.collection("training_data").document("data_root")
    #seed the defaults on the doc the first time anyone touches this list, so "add" from a fresh
    #doc doesn't silently drop the mockup's starting activities
    root_doc = root_ref.get()
    current = (root_doc.to_dict() or {}).get("activityTypes") if root_doc.exists else None
    base = current if current is not None else ACTIVITY_TYPES_DEFAULT
    if name not in base:
        base = base + [name]
    root_ref.set({"activityTypes": base}, merge=True)
    return {"success": True, "activityTypes": base}


@app.post("/activity-types/remove")
def removeActivityType(request_data: ActivityTypeRequest, root_user: dict = Depends(require_root)):
    db = firestore.client()
    root_ref = db.collection("training_data").document("data_root")
    root_doc = root_ref.get()
    current = (root_doc.to_dict() or {}).get("activityTypes") if root_doc.exists else None
    base = current if current is not None else ACTIVITY_TYPES_DEFAULT
    base = [t for t in base if t != request_data.name]
    root_ref.set({"activityTypes": base}, merge=True)
    return {"success": True, "activityTypes": base}


#comma-separated in prod (e.g. "https://besa-trainer.vercel.app,https://besa-trainer-git-main.vercel.app") -
#defaults to local dev only so a deploy without this set fails closed rather than open.
ALLOWED_ORIGINS = [o.strip() for o in os.getenv("ALLOWED_ORIGINS", "http://localhost:5173").split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
def home():
    return {"message": "nothing"}


class ScriptRequest(BaseModel):
    floorId: str
    scriptId: str
    videoExtension: str = "mp4"
    aiModel: Literal["chirp", "gemini"] = "chirp"

from moviepy.video.io.VideoFileClip import VideoFileClip
from google.genai import types

def _generate_vtt_with_chirp(bucket, temp_local_audio: str, floor_id: str) -> str:
    #Chirp 3 (Speech-to-Text v2) only accepts audio via a Cloud Storage URI,
    #so stage the extracted mp3 there temporarily.
    audio_gcs_path = f"temp-audio/{floor_id}.mp3"
    audio_blob = bucket.blob(audio_gcs_path)
    print("Uploading audio to Cloud Storage for Chirp 3 transcription...")
    audio_blob.upload_from_filename(temp_local_audio, content_type="audio/mp3")
    audio_uri = f"gs://{bucket.name}/{audio_gcs_path}"

    try:
        recognition_config = cloud_speech.RecognitionConfig(
            auto_decoding_config=cloud_speech.AutoDetectDecodingConfig(),
            language_codes=["en-US"],
            model="chirp_3",
            features=cloud_speech.RecognitionFeatures(
                enable_word_time_offsets=True,
                enable_automatic_punctuation=True,
            ),
        )

        print("Generating script content via Chirp 3...")
        operation = _get_speech_client().batch_recognize(
            request=cloud_speech.BatchRecognizeRequest(
                recognizer=f"projects/{GCP_PROJECT_ID}/locations/{SPEECH_LOCATION}/recognizers/_",
                config=recognition_config,
                files=[cloud_speech.BatchRecognizeFileMetadata(uri=audio_uri)],
                recognition_output_config=cloud_speech.RecognitionOutputConfig(
                    inline_response_config=cloud_speech.InlineOutputConfig(),
                    output_format_config=cloud_speech.OutputFormatConfig(
                        vtt=cloud_speech.VttOutputFileFormatConfig(),
                    ),
                ),
            )
        )
        #Long-running operation: Chirp 3 processes the full audio track before returning.
        batch_response = operation.result(timeout=600)
        vtt_content = batch_response.results[audio_uri].inline_result.vtt_captions

        if not vtt_content:
            raise HTTPException(status_code=500, detail="Chirp 3 returned no captions for this audio.")
        return vtt_content
    finally:
        #Clean up the temporary audio copy from Cloud Storage
        audio_blob.delete()

def _generate_vtt_with_gemini(temp_local_audio: str) -> str:
    print("Uploading audio to Gemini Files API...")
    gemini_file = _get_genai_client().files.upload(
        file=temp_local_audio,
        config=types.UploadFileConfig(mime_type="audio/mp3") # Explicitly set audio mime-type
    )

    #Wait for Gemini to process the audio track
    while gemini_file.state.name == "PROCESSING":
        print("Gemini is processing audio tracks...")
        time.sleep(2) # Added a small sleep to avoid spamming rate limits
        gemini_file = _get_genai_client().files.get(name=gemini_file.name)

    if gemini_file.state.name == "FAILED":
        raise HTTPException(status_code=500, detail="Gemini audio processing failed.")

    prompt = (
        "Analyze this audio track and generate a precise transcript. "
        "The output MUST be formatted strictly in valid WebVTT (.vtt) file format. "
        "Include the 'WEBVTT' header, appropriate blank lines, and accurate timestamps (HH:MM:SS.mmm). "
        "Do not wrap the response in markdown blocks like ```vtt or ```text. Return ONLY raw VTT contents."
    )

    print("Generating script content via Gemini...")
    response = _get_genai_client().models.generate_content(
        model="gemini-2.5-flash",
        contents=[gemini_file, prompt]
    )

    #Clean up Gemini's File API space
    _get_genai_client().files.delete(name=gemini_file.name)

    return response.text

@app.post("/make-script")
def makeScript(request_data: ScriptRequest, admin_user: dict = Depends(require_admin)):
    temp_local_video = f"temp_{request_data.floorId}.{request_data.videoExtension}"
    temp_local_audio = f"temp_{request_data.floorId}.mp3"

    try:
        bucket = storage.bucket()

        script_path = f"scripts/{request_data.scriptId}"
        video_path = f"videos/{request_data.floorId}"

        script_blob = bucket.blob(script_path)
        video_blob = bucket.blob(video_path)

        #Check if training video exists
        if not video_blob.exists():
            raise HTTPException(status_code=404, detail="Source training video not found in storage.")

        #Download the video from Firebase Storage locally
        print(f"Downloading video from Firebase Storage...")
        video_blob.download_to_filename(temp_local_video)

        #EXTRACT AUDIO: Convert video to MP3
        print("Extracting audio from video to optimize token usage...")
        with VideoFileClip(temp_local_video) as video:
            if video.audio is None:
                raise HTTPException(status_code=400, detail="The provided video file has no audio track.")
            # write_audiofile extracts the track and saves it locally
            video.audio.write_audiofile(temp_local_audio, logger=None)

        if request_data.aiModel == "gemini":
            vtt_content = _generate_vtt_with_gemini(temp_local_audio)
        else:
            vtt_content = _generate_vtt_with_chirp(bucket, temp_local_audio, request_data.floorId)

        #Upload the script back to Firebase
        print(f"Uploading script back to Firebase Storage at {script_path}...")
        script_blob.upload_from_string(vtt_content, content_type="text/vtt")

        return {
            "success": True, 
            "floorId": request_data.floorId,
            "message": "Script generated from audio and written to storage successfully."
        }

    except Exception as e:
        import traceback
        traceback.print_exc() 
        raise HTTPException(status_code=500, detail=f"Internal script processor error: {str(e)}")
        
    finally:
        if os.path.exists(temp_local_video):
            os.remove(temp_local_video)
        if os.path.exists(temp_local_audio):
            os.remove(temp_local_audio)


class TranscribeRequest(BaseModel):
    audioBase64: str
    mimeType: str = "audio/webm"


@app.post("/transcribe-audio")
def transcribeAudio(request_data: TranscribeRequest, user: dict = Depends(get_current_user)):
    extension = request_data.mimeType.split("/")[-1].split(";")[0] or "webm"
    temp_local_audio = f"temp_recording_{user.get('uid')}_{int(time.time())}.{extension}"

    try:
        audio_bytes = base64.b64decode(request_data.audioBase64)
        with open(temp_local_audio, "wb") as f:
            f.write(audio_bytes)

        print("Uploading recording to Gemini Files API...")
        gemini_file = _get_genai_client().files.upload(
            file=temp_local_audio,
            config=types.UploadFileConfig(mime_type=request_data.mimeType)
        )

        while gemini_file.state.name == "PROCESSING":
            time.sleep(1)
            gemini_file = _get_genai_client().files.get(name=gemini_file.name)

        if gemini_file.state.name == "FAILED":
            raise HTTPException(status_code=500, detail="Gemini audio processing failed.")

        prompt = (
            "Transcribe this audio recording exactly as spoken, word for word. "
            "Return ONLY the raw transcript text - no labels, timestamps, speaker names, or extra commentary."
        )

        #the voice test needs fast turnaround for a short answer clip, unlike script generation's Chirp 3
        #batch job (built for a full-length narration track) - so this always transcribes via Gemini.
        print("Transcribing recording via Gemini")
        response = _get_genai_client().models.generate_content(
            model="gemini-2.5-flash",
            contents=[gemini_file, prompt]
        )

        _get_genai_client().files.delete(name=gemini_file.name)

        return {"success": True, "text": (response.text or "").strip()}

    except HTTPException:
        raise
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Transcription error: {str(e)}")

    finally:
        if os.path.exists(temp_local_audio):
            os.remove(temp_local_audio)


class ReconcileProgressRequest(BaseModel):
    floorId: str
    markerTimes: list[float]


#whenever an admin adds/removes a marker in the Section Editor, every trainee's saved progress for that
#floor can end up pointing at sectionTimes that no longer match any current marker (a marker's time
#shifted, or it was deleted outright) - the boundary the Simulator uses to gate playback keys off exact
#sectionTime matches, so a stale entry silently makes a section look "already done" when it isn't,
#letting the trainee skip right past a test that was never actually completed. This prunes any progress
#entries, across every account, that don't match one of the floor's current marker times - requires the
#Admin SDK since it has to touch every user's document, not just the caller's own.
@app.post("/reconcile-progress")
def reconcileProgress(request_data: ReconcileProgressRequest, admin_user: dict = Depends(require_admin)):
    db = firestore.client()
    valid_times = set(request_data.markerTimes)

    users_ref = db.collection("training_data").document("data_root").collection("users")
    updated_count = 0
    batch = db.batch()
    batch_size = 0

    for user_doc in users_ref.stream():
        data = user_doc.to_dict() or {}
        progress_list = data.get("progress") or []

        changed = False
        new_progress_list = []
        for entry in progress_list:
            if entry.get("floorId") == request_data.floorId:
                original = entry.get("progress") or []
                pruned = [p for p in original if p.get("sectionTime") in valid_times]
                if len(pruned) != len(original):
                    changed = True
                entry = {**entry, "progress": pruned}
            new_progress_list.append(entry)

        if changed:
            batch.update(user_doc.reference, {"progress": new_progress_list})
            updated_count += 1
            batch_size += 1
            #Firestore batches cap out at 500 writes
            if batch_size >= 450:
                batch.commit()
                batch = db.batch()
                batch_size = 0

    if batch_size > 0:
        batch.commit()

    return {
        "success": True,
        "floorId": request_data.floorId,
        "message": f"Reconciled progress for {updated_count} account(s)."
    }

#---- Firebase Functions entrypoint ----
#Cloud Functions for Firebase (2nd gen, Python) discovers module-level https_fn.on_request()-decorated
#callables and deploys each as its own HTTPS Cloud Run service - it does NOT speak ASGI natively, only
#WSGI-style (Request) -> Response, so the FastAPI app is bridged through a2wsgi. Every route above stays
#reachable under this one function's URL (e.g. https://api-<hash>-<region>.a.run.app/clock-in).
#Local dev is unaffected - `uvicorn main:app --reload` still runs the same `app` object directly.
from firebase_functions import https_fn, options, scheduler_fn
from a2wsgi import ASGIMiddleware

#lazy, not constructed at import time - ASGIMiddleware spawns a background thread running its own
#event loop AT CONSTRUCTION, and functions-framework serves requests via gunicorn's pre-fork worker
#model: if that thread gets created before gunicorn forks, fork() drops every thread but the caller's,
#so each worker inherits a loop object with nobody actually running it - every request then hangs
#forever waiting on a loop that's dead, with no error and no log output. Building it lazily, on first
#request inside the already-forked worker, avoids this entirely.
_wsgi_app = None
def _get_wsgi_app():
    global _wsgi_app
    if _wsgi_app is None:
        _wsgi_app = ASGIMiddleware(app)
    return _wsgi_app

@https_fn.on_request(
    memory=options.MemoryOption.GB_1,
    timeout_sec=900,
    secrets=["GEMINI_API_KEY", "ALLOWED_ORIGINS", "BREAK_ALERT_GMAIL_ADDRESS", "BREAK_ALERT_GMAIL_APP_PASSWORD"],
    invoker="public",
)
def api(req: https_fn.Request) -> https_fn.Response:
    return https_fn.Response.from_app(_get_wsgi_app(), req.environ)


#announces breaks whose timer ran out on their own (see _send_due_break_alerts) - nothing else ever runs at
#the moment a break expires, so this checks once a minute
@scheduler_fn.on_schedule(
    schedule="every 1 minutes",
    timezone="America/Los_Angeles",
    secrets=["BREAK_ALERT_GMAIL_ADDRESS", "BREAK_ALERT_GMAIL_APP_PASSWORD"],
)
def break_end_alerts(event: scheduler_fn.ScheduledEvent) -> None:
    _send_due_break_alerts()
