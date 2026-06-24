from fastapi import FastAPI, Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from mangum import Mangum
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import firebase_admin
from firebase_admin import credentials

# Firebase SDK
cred = credentials.Certificate("./besa-trainer-api-firebase-adminsdk-fbsvc-f685a6ef51.json")
firebase_admin.initialize_app(cred)

#FastAPI App
app = FastAPI()
security = HTTPBearer()

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

handler = Mangum(app)