import { initializeApp, type FirebaseApp } from "firebase/app"
import { getFirestore } from 'firebase/firestore'
import { getAuth, GoogleAuthProvider, type Auth } from "firebase/auth"

//web app config from firebase console, vite only exposes VITE_ vars to the browser
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
}

//quick check before we call initializeApp so the app doesnt blow up on missing env
export function isFirebaseConfigured(): boolean {
  //if all the config vars are set, return true
  return Boolean(
    firebaseConfig.apiKey &&
      firebaseConfig.authDomain &&
      firebaseConfig.projectId &&
      firebaseConfig.appId
  )
}

//very complicated way to just to make sure env variables are okay. to get app
export function getFirebaseApp(): FirebaseApp {
  let app: FirebaseApp | null = null
  if (!isFirebaseConfigured()) {
    throw new Error(
      "Firebase env vars are missing"
    )
  }
  if (!app) {
    app = initializeApp(firebaseConfig) // This initializes the Firebase app
  }
  return app
}

//auth instance tied to that app, used for email/password, google popup, signOut, etc
export function getFirebaseAuth(): Auth {
  return getAuth(getFirebaseApp())
}

//google provider object passed into signInWithPopup
export const googleAuthProvider = new GoogleAuthProvider()