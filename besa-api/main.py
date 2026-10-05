from fastapi import FastAPI, Depends, HTTPException, Header, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from typing import Literal
import time
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

import firebase_admin
from firebase_admin import credentials, storage, auth, firestore

from google.cloud.speech_v2 import SpeechClient
from google.cloud.speech_v2.types import cloud_speech
from google.api_core.client_options import ClientOptions
from google.api_core.exceptions import Conflict
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
def besaAccounts(lead_user: dict = Depends(require_besa_lead)):
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
        })

    return {"success": True, "accounts": accounts}


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


#prunes biWeeklyHours to the current two-week pay period (relative to `now`), then merges this session's hours into
#(or creates) the entry for checked_in_at's calendar day. Shared by manual clock-out and auto-clockout.
#Each day also keeps its individual sessions (arrive/leave time + activities) so the hours table can show
#when someone was actually there - entries written before sessions existed just have none.
def _merge_hours_entry(existing: list, checked_in_at: datetime, effective_end: datetime, activities: list, now: datetime, auto_clocked_out: bool = False, break_seconds: int = 0, canceled_tour: bool = False, notes: list | None = None):
    elapsed_hours = max(0.0, round((effective_end - checked_in_at).total_seconds() / 1800) * 0.5)
    entry_day = checked_in_at.replace(hour=0, minute=0, second=0, microsecond=0)
    keep_from = _period_start(now)
    session = {"clockIn": checked_in_at, "clockOut": effective_end, "activities": activities, "autoClockedOut": auto_clocked_out,
               "breakSeconds": break_seconds, "canceledTour": canceled_tour, "notes": notes or []}

    pruned = [e for e in existing if e.get("date") and e["date"].astimezone(PACIFIC) >= keep_from]

    merged = False
    new_hours = []
    for e in pruned:
        if e["date"].astimezone(PACIFIC).date() == entry_day.date():
            new_hours.append({
                **e,
                "hours": e.get("hours", 0) + elapsed_hours,
                "activities": sorted(set((e.get("activities") or []) + activities)),
                "autoClockedOut": bool(e.get("autoClockedOut")) or auto_clocked_out,
                "sessions": (e.get("sessions") or []) + [session],
            })
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
        "hours": e.get("hours", 0),
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
            }
            for s in (e.get("sessions") or []) if s.get("clockIn") and s.get("clockOut")
        ],
    }


#the still-open session (clocked in, not out yet), so the table can show "9:02 AM - now" and today's
#live break status
#notes/comments added from the kiosk's Current Sessions during a visit - [{text, at}] on the user doc while
#they're clocked in (lastCheckedInNotes), then moved onto that visit's session record when they clock out
SESSION_NOTE_MAX_LENGTH = 500


def _serialize_notes(notes) -> list:
    return [{"text": n.get("text") or "", "at": n["at"].isoformat() if n.get("at") else None}
            for n in (notes or []) if isinstance(n, dict) and n.get("text")]


def _open_session(data: dict):
    if not data.get("lastCheckedIn"):
        return None
    return {"clockIn": data["lastCheckedIn"].isoformat(), "activities": data.get("lastCheckedInActivities") or [],
            "break": _break_state(data, datetime.now(PACIFIC)),
            "notes": _serialize_notes(data.get("lastCheckedInNotes"))}


WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"]
#hours run in fixed two-week periods (two Sun-Sat weeks, flipped through as a carousel), starting from this
#Sunday and repeating every 14 days. When a period ends everything resets: the next clock-out prunes the old
#period's hours, and the views only ever show the current period.
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


#one date's actual office hours on BESA Booking. Three layers, in order:
#  officeHours        - the weekly recurring schedule ({"monday": {"available", "timeSlots"}, ...})
#  tempAdjustments    - [{date: "YYYY-MM-DD", timeSlots, reason?}] replaces that one date's hours outright
#  tempUnavailability - [{date, allDay, start?, end?, reason?}] removes time from that date (all of it if allDay)
#Returns the effective slots plus what changed, so the views can say why a day differs from the usual week.
def _office_day(roster_doc: dict, day: date_cls) -> dict:
    key = day.isoformat()
    weekday = WEEKDAYS[(day.weekday() + 1) % 7]

    temp = next((a for a in roster_doc.get("tempAdjustments") or [] if isinstance(a, dict) and a.get("date") == key), None)
    if temp is not None:
        base = _clean_slots(temp.get("timeSlots"))
    else:
        weekly = (roster_doc.get("officeHours") or {}).get(weekday) or {}
        base = _clean_slots(weekly.get("timeSlots")) if weekly.get("available", True) else []

    slots = list(base)
    unavailable = {}
    for u in roster_doc.get("tempUnavailability") or []:
        if not isinstance(u, dict) or u.get("date") != key:
            continue
        if u.get("allDay"):
            u_start, u_end = 0, 24 * 60
        else:
            u_start, u_end = _hhmm_to_minutes(u.get("start")), _hhmm_to_minutes(u.get("end"))
            if u_start is None or u_end is None or u_end <= u_start:
                continue
        #only list unavailability that actually cuts into their office hours that day (deduped - the booking
        #site sometimes stores the same block twice, once by hand and once from the calendar)
        if not any(u_start < e and u_end > st for st, e in base):
            continue
        sig = (bool(u.get("allDay")), u_start, u_end)
        if sig in unavailable:
            if not unavailable[sig]["reason"]:
                unavailable[sig]["reason"] = u.get("reason") or ""  #prefer whichever copy says why
            continue
        unavailable[sig] = {"allDay": bool(u.get("allDay")), "start": None if u.get("allDay") else _minutes_to_hhmm(u_start),
                            "end": None if u.get("allDay") else _minutes_to_hhmm(u_end), "reason": u.get("reason") or ""}
        trimmed = []
        for st, e in slots:
            if u_end <= st or u_start >= e:
                trimmed.append((st, e))
                continue
            if st < u_start:
                trimmed.append((st, u_start))
            if u_end < e:
                trimmed.append((u_end, e))
        slots = trimmed

    scheduled_hours = sum(e - st for st, e in slots) / 60
    return {
        "date": key,
        "day": weekday,
        "slots": [{"start": _minutes_to_hhmm(st), "end": _minutes_to_hhmm(e)} for st, e in slots],
        "temporary": temp is not None,
        "temporaryReason": (temp or {}).get("reason") or "",
        "unavailable": sorted(unavailable.values(), key=lambda u: u["start"] or ""),
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
BREAK_FIELDS_RESET = {"breakUsedSeconds": 0, "breakCarriedSeconds": 0, "breakStartedAt": None, "breakEndsAt": None}
#everything tied to one visit that's cleared on clock in and every kind of clock out
VISIT_FIELDS_RESET = {**BREAK_FIELDS_RESET, "lastCheckedInNotes": []}
SHORT_BREAK_SECONDS = 5 * 60


def _break_allowance_minutes(scheduled_hours: float) -> int:
    whole_hours = int(scheduled_hours)
    minutes = 5 * min(whole_hours, 3)
    if whole_hours > 5:
        minutes += 5 * (whole_hours - 5)
    return minutes


def _scheduled_hours_on(besa_name, day: datetime) -> float:
    office_day = _office_day_for(besa_name, day)
    return office_day["scheduledHours"] if office_day else 0.0


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
    scheduled = _scheduled_hours_on(data.get("besaName"), checked_in_at)
    allowance = _break_allowance_minutes(scheduled) * 60
    used = _break_used_seconds(data, now)
    ends = _to_pacific(data["breakEndsAt"]) if data.get("breakEndsAt") else None
    on_break = bool(ends and now < ends)
    return {
        "scheduledHours": round(scheduled, 2),
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
    new_hours, _ = _merge_hours_entry(data.get("biWeeklyHours") or [], checked_in_at, effective_end, activities, now,
                                      auto_clocked_out=True, break_seconds=break_seconds, notes=data.get("lastCheckedInNotes"))

    update = {"biWeeklyHours": new_hours, "lastCheckedIn": None, "lastCheckedInActivities": [], **VISIT_FIELDS_RESET}
    target_ref.update(update)
    return {**data, **update}


class ClockInRequest(BaseModel):
    studentId: str
    activities: list[str]


@app.post("/clock-in")
def clockIn(request_data: ClockInRequest, root_user: dict = Depends(require_root)):
    activities = [a for a in request_data.activities if a.strip()]
    if not activities:
        raise HTTPException(status_code=400, detail="Pick at least one activity you intend to work on.")
    db = firestore.client()
    target_ref, data = _find_besa_by_student_id(db, request_data.studentId)
    if target_ref is None:
        raise HTTPException(status_code=404, detail="No BESA account found with that School Id.")
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


class ClockOutRequest(BaseModel):
    studentId: str


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
    new_hours, elapsed_hours = _merge_hours_entry(data.get("biWeeklyHours") or [], checked_in_at, now, activities, now,
                                                  break_seconds=_visit_break_seconds(data, now), notes=data.get("lastCheckedInNotes"))

    target_ref.update({
        "biWeeklyHours": new_hours,
        "lastCheckedIn": None,
        "lastCheckedInActivities": [],
        **VISIT_FIELDS_RESET,
    })
    return {"success": True, "besaName": data.get("besaName"), "hoursThisSession": elapsed_hours}


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
    hours = [_serialize_hours_entry(e) for e in (data.get("biWeeklyHours") or []) if e.get("date")]
    return {"success": True, "biWeeklyHours": hours, "openSession": _open_session(data),
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
    return {"success": True, "besaName": data.get("besaName")}


def _shown_weeks_hours(data: dict) -> list:
    shown_from = _period_start(datetime.now(PACIFIC))
    return [
        _serialize_hours_entry(e)
        for e in (data.get("biWeeklyHours") or [])
        if e.get("date") and e["date"].astimezone(PACIFIC) >= shown_from
    ]


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


def require_root_admin(root_user: dict = Depends(require_root), x_root_admin_token: str = Header(default="")):
    doc = _root_admin_ref(root_user.get("uid")).get()
    data = (doc.to_dict() or {}) if doc.exists else {}
    stored_hash = data.get("sessionTokenHash")
    expires_at = data.get("sessionExpiresAt")

    if (not x_root_admin_token or not stored_hash or not expires_at
            or expires_at < datetime.now(PACIFIC)
            or not hmac.compare_digest(stored_hash, _hash_session_token(x_root_admin_token))):
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
                        "hours": _shown_weeks_hours(data), "openSession": _open_session(data),
                        "officeSchedule": _office_schedule(data.get("besaName"), roster_docs)})
    return {"success": True, "members": members, "periodStart": _period_start(datetime.now(PACIFIC)).date().isoformat()}


class SetDayHoursRequest(BaseModel):
    targetUid: str
    date: str  # YYYY-MM-DD, a day in the current Sun-Sat week
    hours: float = Field(ge=0, le=24)
    activities: list[str]


#root admin only - overwrites (or clears, with 0 hours and no activities) one day's hours entry for a
#besa/besaLead member. Restricted to the current week since older entries get pruned on the next clock-out.
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
        })

    target_ref.update({"biWeeklyHours": remaining})
    return {"success": True, "hours": _shown_weeks_hours({**data, "biWeeklyHours": remaining})}


@app.get("/activity-types")
def getActivityTypes(user: dict = Depends(get_current_user)):
    db = firestore.client()
    root_doc = db.collection("training_data").document("data_root").get()
    types = (root_doc.to_dict() or {}).get("activityTypes") if root_doc.exists else None
    return {"success": True, "activityTypes": types or ACTIVITY_TYPES_DEFAULT}


class ActivityTypeRequest(BaseModel):
    name: str


@app.post("/activity-types/add")
def addActivityType(request_data: ActivityTypeRequest, root_user: dict = Depends(require_root)):
    db = firestore.client()
    root_ref = db.collection("training_data").document("data_root")
    #seed the defaults on the doc the first time anyone touches this list, so "add" from a fresh
    #doc doesn't silently drop the mockup's starting activities
    root_doc = root_ref.get()
    current = (root_doc.to_dict() or {}).get("activityTypes") if root_doc.exists else None
    base = current if current is not None else ACTIVITY_TYPES_DEFAULT
    if request_data.name not in base:
        base = base + [request_data.name]
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
from firebase_functions import https_fn, options
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
    secrets=["GEMINI_API_KEY", "ALLOWED_ORIGINS"],
    invoker="public",
)
def api(req: https_fn.Request) -> https_fn.Response:
    return https_fn.Response.from_app(_get_wsgi_app(), req.environ)
