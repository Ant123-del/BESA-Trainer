from fastapi import FastAPI, Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from mangum import Mangum
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from typing import Literal
import time
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
load_dotenv()
client = genai.Client()

FIREBASE_CRED_PATH = "./besa-trainer-api-firebase-adminsdk-fbsvc-f685a6ef51.json"

# Firebase SDK
cred = credentials.Certificate(FIREBASE_CRED_PATH)
firebase_admin.initialize_app(cred, {
    "storageBucket": "besa-trainer-api.firebasestorage.app"
})

# Chirp 3 (Speech-to-Text v2) lives only in specific multi-regions today.
SPEECH_LOCATION = "us"
GCP_PROJECT_ID = cred.project_id
speech_client = SpeechClient(
    credentials=gcp_service_account.Credentials.from_service_account_file(FIREBASE_CRED_PATH),
    client_options=ClientOptions(api_endpoint=f"{SPEECH_LOCATION}-speech.googleapis.com"),
)

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


# ---- BESA roster (besa-app project) ----
# besa-app is a separate Firebase project holding the club's own member roster at /Besas/{id} - a
# second, named Admin SDK app talks to it, kept apart from the default app (this project)
# initialized above. Each doc: {id, name, email, status, role, supportedTourIds?, officeHours}.
# TODO: BESA_APP_CRED_PATH needs a service-account JSON for besa-app (same idea as
# FIREBASE_CRED_PATH above) dropped somewhere under besa-api/ and pointed to via .env.
BESA_APP_CRED_PATH = os.getenv("BESA_APP_CRED_PATH")
BESA_ROSTER_COLLECTION = os.getenv("BESA_ROSTER_COLLECTION", "Besas")
BESA_ROSTER_NAME_FIELD = os.getenv("BESA_ROSTER_NAME_FIELD", "name")
BESA_ROSTER_ROLE_FIELD = os.getenv("BESA_ROSTER_ROLE_FIELD", "role")
BESA_ROSTER_LEAD_VALUE = os.getenv("BESA_ROSTER_LEAD_VALUE", "BESA Lead")
BESA_ROSTER_STATUS_FIELD = os.getenv("BESA_ROSTER_STATUS_FIELD", "status")
BESA_ROSTER_ACTIVE_VALUE = os.getenv("BESA_ROSTER_ACTIVE_VALUE", "active")

_besa_app = None

def _get_besa_app_db():
    global _besa_app
    if not BESA_APP_CRED_PATH:
        return None
    if _besa_app is None:
        besa_cred = credentials.Certificate(BESA_APP_CRED_PATH)
        _besa_app = firebase_admin.initialize_app(besa_cred, name="besa-app")
    return firestore.client(_besa_app)


@app.get("/besa-roster")
def besaRoster():
    besa_db = _get_besa_app_db()
    if besa_db is None:
        raise HTTPException(status_code=503, detail="BESA roster isn't configured yet (missing BESA_APP_CRED_PATH).")

    #every active roster entry, tagged besaLead/besa based on its role field
    roster = []
    for entry in besa_db.collection(BESA_ROSTER_COLLECTION).stream():
        data = entry.to_dict() or {}
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

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],  # Update if your frontend port is different
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
        operation = speech_client.batch_recognize(
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
    gemini_file = client.files.upload(
        file=temp_local_audio,
        config=types.UploadFileConfig(mime_type="audio/mp3") # Explicitly set audio mime-type
    )

    #Wait for Gemini to process the audio track
    while gemini_file.state.name == "PROCESSING":
        print("Gemini is processing audio tracks...")
        time.sleep(2) # Added a small sleep to avoid spamming rate limits
        gemini_file = client.files.get(name=gemini_file.name)

    if gemini_file.state.name == "FAILED":
        raise HTTPException(status_code=500, detail="Gemini audio processing failed.")

    prompt = (
        "Analyze this audio track and generate a precise transcript. "
        "The output MUST be formatted strictly in valid WebVTT (.vtt) file format. "
        "Include the 'WEBVTT' header, appropriate blank lines, and accurate timestamps (HH:MM:SS.mmm). "
        "Do not wrap the response in markdown blocks like ```vtt or ```text. Return ONLY raw VTT contents."
    )

    print("Generating script content via Gemini...")
    response = client.models.generate_content(
        model="gemini-2.5-flash",
        contents=[gemini_file, prompt]
    )

    #Clean up Gemini's File API space
    client.files.delete(name=gemini_file.name)

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
        gemini_file = client.files.upload(
            file=temp_local_audio,
            config=types.UploadFileConfig(mime_type=request_data.mimeType)
        )

        while gemini_file.state.name == "PROCESSING":
            time.sleep(1)
            gemini_file = client.files.get(name=gemini_file.name)

        if gemini_file.state.name == "FAILED":
            raise HTTPException(status_code=500, detail="Gemini audio processing failed.")

        prompt = (
            "Transcribe this audio recording exactly as spoken, word for word. "
            "Return ONLY the raw transcript text - no labels, timestamps, speaker names, or extra commentary."
        )

        #the voice test needs fast turnaround for a short answer clip, unlike script generation's Chirp 3
        #batch job (built for a full-length narration track) - so this always transcribes via Gemini.
        print("Transcribing recording via Gemini")
        response = client.models.generate_content(
            model="gemini-2.5-flash",
            contents=[gemini_file, prompt]
        )

        client.files.delete(name=gemini_file.name)

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

handler = Mangum(app)