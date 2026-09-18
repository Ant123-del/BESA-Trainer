from fastapi import FastAPI, Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from typing import Literal
import time
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
from google import genai
import os
import base64

import firebase_admin
from firebase_admin import credentials, storage, auth, firestore

from google.cloud.speech_v2 import SpeechClient
from google.cloud.speech_v2.types import cloud_speech
from google.api_core.client_options import ClientOptions
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
            detail="Invalid or expired firebase token: : " + e, 
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
# besa-app is a separate Firebase project holding the club's own member roster at /Besas/{id}. We used
# to reach across projects live (a second, named Admin SDK app talking directly to besa-app), but that
# path is blocked in this GCP org - the besa-app service account gets PERMISSION_DENIED from Cloud Run
# even with the correct IAM role granted, which points at an org policy (e.g. a cross-project service
# account restriction) neither project owner can self-serve around. Instead, someone with access to
# both projects runs sync_roster.py locally (same script, same machine, same auth that already proves
# this works outside Cloud Run) to mirror the roster into this project's own Firestore, and everything
# below just reads that local mirror. Each cached doc: {name, role, status, officeHours}.
BESA_ROSTER_NAME_FIELD = os.getenv("BESA_ROSTER_NAME_FIELD", "name")
BESA_ROSTER_ROLE_FIELD = os.getenv("BESA_ROSTER_ROLE_FIELD", "role")
BESA_ROSTER_LEAD_VALUE = os.getenv("BESA_ROSTER_LEAD_VALUE", "BESA Lead")
BESA_ROSTER_STATUS_FIELD = os.getenv("BESA_ROSTER_STATUS_FIELD", "status")
BESA_ROSTER_ACTIVE_VALUE = os.getenv("BESA_ROSTER_ACTIVE_VALUE", "active")
BESA_ROSTER_CACHE_COLLECTION = "besa_roster_cache"


def _get_cached_roster() -> list:
    db = firestore.client()
    docs = db.collection("training_data").document("data_root").collection(BESA_ROSTER_CACHE_COLLECTION).stream()
    return [d.to_dict() or {} for d in docs]


@app.get("/besa-roster")
def besaRoster():
    roster_docs = _get_cached_roster()
    if not roster_docs:
        raise HTTPException(status_code=503, detail="BESA roster cache is empty - ask someone with besa-app access to run sync_roster.py.")

    #every active roster entry, tagged besaLead/besa based on its role field
    roster = []
    for data in roster_docs:
        if data.get(BESA_ROSTER_STATUS_FIELD) != BESA_ROSTER_ACTIVE_VALUE:
            continue
        name = data.get(BESA_ROSTER_NAME_FIELD)
        if not name:
            continue
        tier = "besaLead" if data.get(BESA_ROSTER_ROLE_FIELD) == BESA_ROSTER_LEAD_VALUE else "besa"
        roster.append({"name": name, "tier": tier})

    #names already claimed by an account in this project get filtered out of the picker
    db = firestore.client()
    claimed = {
        u.to_dict().get("besaName")
        for u in db.collection("training_data").document("data_root").collection("users").stream()
        if (u.to_dict() or {}).get("besaName")
    }

    available = [r for r in roster if r["name"] not in claimed]
    return {"success": True, "roster": available}


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


def _find_besa_by_student_id(db, student_id: str):
    users_ref = db.collection("training_data").document("data_root").collection("users")
    for u in users_ref.stream():
        data = u.to_dict() or {}
        if data.get("accountType") in ("besa", "besaLead") and data.get("studentId") == student_id:
            return u.reference, data
    return None, None


#prunes biWeeklyHours to the current week (relative to `now`), then merges this session's hours into
#(or creates) the entry for checked_in_at's calendar day. Shared by manual clock-out and auto-clockout.
def _merge_hours_entry(existing: list, checked_in_at: datetime, effective_end: datetime, activities: list, now: datetime, auto_clocked_out: bool = False):
    elapsed_hours = max(0.0, round((effective_end - checked_in_at).total_seconds() / 1800) * 0.5)
    entry_day = checked_in_at.replace(hour=0, minute=0, second=0, microsecond=0)
    current_week_start = _week_start(now)

    pruned = [e for e in existing if e.get("date") and e["date"].astimezone(PACIFIC) >= current_week_start]

    merged = False
    new_hours = []
    for e in pruned:
        if e["date"].astimezone(PACIFIC).date() == entry_day.date():
            new_hours.append({
                "date": e["date"],
                "hours": e.get("hours", 0) + elapsed_hours,
                "activities": sorted(set((e.get("activities") or []) + activities)),
                "autoClockedOut": bool(e.get("autoClockedOut")) or auto_clocked_out,
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
        })
    return new_hours, elapsed_hours


#besa-app roster docs are matched to our users by name (same linkage /besa-roster uses for claiming).
#Each roster doc's officeHours looks like {"monday": {"available": bool, "timeSlots":
#[{"start": "HH:MM", "end": "HH:MM", "id": ...}, ...]}, ...} - picks the latest slot end on the
#check-in's weekday that's still after the check-in time (covers someone with multiple slots that day).
def _get_office_hours_end(besa_name, checked_in_at: datetime):
    if not besa_name:
        return None

    roster_doc = next((d for d in _get_cached_roster() if d.get(BESA_ROSTER_NAME_FIELD) == besa_name), None)
    if roster_doc is None:
        return None

    office_hours = roster_doc.get("officeHours") or {}
    day_name = checked_in_at.strftime("%A").lower()
    day_slots = (office_hours.get(day_name) or {}).get("timeSlots") or []

    candidate_ends = []
    for slot in day_slots:
        try:
            end_time = datetime.strptime(slot["end"], "%H:%M").time()
        except (KeyError, ValueError, TypeError):
            continue
        end_dt = checked_in_at.replace(hour=end_time.hour, minute=end_time.minute, second=0, microsecond=0)
        if end_dt > checked_in_at:
            candidate_ends.append(end_dt)

    return max(candidate_ends) if candidate_ends else None


#if someone forgot to clock out and it's now past 8pm of the day they clocked in, close their session
#automatically using their scheduled office-hours end time (from the besa-app roster) as the effective
#clock-out, rather than crediting them until 8pm or leaving them clocked in forever. Falls back to 8pm
#itself if no matching office-hours slot is found. Runs lazily (no scheduler infra exists here) -
#triggered from every endpoint that reads/lists clocked-in accounts, plus a self-check endpoint below.
def _auto_clock_out_if_needed(target_ref, data: dict) -> dict:
    last_checked_in = data.get("lastCheckedIn")
    if not last_checked_in:
        return data

    checked_in_at = last_checked_in.astimezone(PACIFIC)
    now = datetime.now(PACIFIC)
    cutoff = checked_in_at.replace(hour=20, minute=0, second=0, microsecond=0)
    if now < cutoff:
        return data

    office_end = _get_office_hours_end(data.get("besaName"), checked_in_at)
    effective_end = office_end if office_end and office_end > checked_in_at else cutoff

    activities = data.get("lastCheckedInActivities") or []
    new_hours, _ = _merge_hours_entry(data.get("biWeeklyHours") or [], checked_in_at, effective_end, activities, now, auto_clocked_out=True)

    target_ref.update({
        "biWeeklyHours": new_hours,
        "lastCheckedIn": None,
        "lastCheckedInActivities": [],
    })
    return {**data, "biWeeklyHours": new_hours, "lastCheckedIn": None, "lastCheckedInActivities": []}


class ClockInRequest(BaseModel):
    studentId: str
    activities: list[str]


@app.post("/clock-in")
def clockIn(request_data: ClockInRequest, root_user: dict = Depends(require_root)):
    db = firestore.client()
    target_ref, data = _find_besa_by_student_id(db, request_data.studentId)
    if target_ref is None:
        raise HTTPException(status_code=404, detail="No BESA account found with that School Id.")
    #a forgotten session from an earlier day shouldn't block today's legitimate clock-in
    data = _auto_clock_out_if_needed(target_ref, data)
    if data.get("lastCheckedIn"):
        raise HTTPException(status_code=409, detail=f"{data.get('besaName')} is already clocked in.")

    now = datetime.now(PACIFIC)
    target_ref.update({"lastCheckedIn": now, "lastCheckedInActivities": request_data.activities})
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
    checked_in_at = last_checked_in.astimezone(PACIFIC)
    activities = data.get("lastCheckedInActivities") or []
    new_hours, elapsed_hours = _merge_hours_entry(data.get("biWeeklyHours") or [], checked_in_at, now, activities, now)

    target_ref.update({
        "biWeeklyHours": new_hours,
        "lastCheckedIn": None,
        "lastCheckedInActivities": [],
    })
    return {"success": True, "besaName": data.get("besaName"), "hoursThisSession": elapsed_hours}


@app.post("/check-auto-clockout")
def checkAutoClockout(user: dict = Depends(get_current_user)):
    db = firestore.client()
    target_ref = db.collection("training_data").document("data_root").collection("users").document(user.get("uid"))
    doc = target_ref.get()
    if not doc.exists:
        raise HTTPException(status_code=404, detail="User not found.")

    data = _auto_clock_out_if_needed(target_ref, doc.to_dict() or {})
    hours = [
        {"date": e["date"].isoformat(), "hours": e.get("hours", 0), "activities": e.get("activities") or [], "autoClockedOut": bool(e.get("autoClockedOut"))}
        for e in (data.get("biWeeklyHours") or [])
    ]
    return {"success": True, "biWeeklyHours": hours, "lastCheckedIn": None}


@app.get("/current-sessions")
def currentSessions(root_user: dict = Depends(require_root)):
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
        })
    return {"success": True, "sessions": sessions}


@app.get("/all-hours")
def allHours(root_user: dict = Depends(require_root)):
    db = firestore.client()
    current_week_start = _week_start(datetime.now(PACIFIC))
    members = []
    for u in db.collection("training_data").document("data_root").collection("users").stream():
        data = u.to_dict() or {}
        if data.get("accountType") not in ("besa", "besaLead"):
            continue
        if data.get("lastCheckedIn"):
            data = _auto_clock_out_if_needed(u.reference, data)
        hours = [
            {"date": e["date"].isoformat(), "hours": e.get("hours", 0), "activities": e.get("activities") or [], "autoClockedOut": bool(e.get("autoClockedOut"))}
            for e in (data.get("biWeeklyHours") or [])
            if e.get("date") and e["date"].astimezone(PACIFIC) >= current_week_start
        ]
        members.append({"uid": u.id, "besaName": data.get("besaName"), "studentId": data.get("studentId"), "hours": hours})
    return {"success": True, "members": members}


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
