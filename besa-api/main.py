from fastapi import FastAPI, Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from mangum import Mangum
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
import time
from google import genai
import os
import base64

import firebase_admin
from firebase_admin import credentials, storage, auth, firestore

from dotenv import load_dotenv
load_dotenv()
client = genai.Client()

# Firebase SDK
cred = credentials.Certificate("./besa-trainer-api-firebase-adminsdk-fbsvc-f685a6ef51.json")
firebase_admin.initialize_app(cred, {
    "storageBucket": "besa-trainer-api.firebasestorage.app"
})

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

from moviepy.video.io.VideoFileClip import VideoFileClip
from google.genai import types

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
        
        #Upload the lightweight MP3 file to Gemini instead of the video
        print(f"Uploading audio to Gemini Files API...")
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

        #Update prompt context slightly since it's just audio now
        prompt = (
            "Analyze this audio track and generate a precise transcript. "
            "The output MUST be formatted strictly in valid WebVTT (.vtt) file format. "
            "Include the 'WEBVTT' header, appropriate blank lines, and accurate timestamps (HH:MM:SS.mmm). "
            "Do not wrap the response in markdown blocks like ```vtt or ```text. Return ONLY raw VTT contents."
        )

        print("Generating script content via gemini-2.5-flash...")
        response = client.models.generate_content(
            model="gemini-2.5-flash",
            contents=[gemini_file, prompt]
        )
        
        vtt_content = response.text

        #Upload the script back to Firebase
        print(f"Uploading script back to Firebase Storage at {script_path}...")
        script_blob.upload_from_string(vtt_content, content_type="text/vtt")

        #Clean up Gemini's File API space
        client.files.delete(name=gemini_file.name)

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

        print("Transcribing recording via gemini-2.5-flash...")
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