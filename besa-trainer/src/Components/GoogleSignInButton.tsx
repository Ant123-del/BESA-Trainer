import type { JSX } from "react"
import { useState } from "react"
import { signInWithPopup, type Auth, type UserCredential } from "firebase/auth"
import { useNavigate } from "react-router-dom"
import Image from "../imgs/Google.png"
import { mapFirebaseAuthError } from "../authErrors"
import { getFirebaseAuth, googleAuthProvider, isFirebaseConfigured } from "../firebase"
import type { User as CustomUser } from "../types"
import { createUserDoc, db, getUserDataById } from "../firestore"
import { doc, getDoc } from "firebase/firestore"


export default function GoogleSignInButton(): JSX.Element {
  //we are using navigate to redirect the user to the home page after they sign in
  const navigate = useNavigate()
  //busy is a boolean that is true if the user is signing in
  const [busy, setBusy] = useState(false)
  //error is a string that is the error message from the firebase auth error
  const [error, setError] = useState<string | null>(null)

  async function onGoogleSignIn(): Promise<void> {
    setError(null)
    setBusy(true)
    try {
      //opens google login in a popup, firebase handles tokens after they finish
      const auth: Auth = getFirebaseAuth()
      const userCredential:UserCredential = await signInWithPopup(auth, googleAuthProvider) // This is the magic method that opens the google login popup
      //Need to make sure account doesnt already exist.
      const docRef = doc(db, "training_data", "data_root", "users", userCredential.user.uid)
      const docSnap = await getDoc(docRef)
      if(!docSnap.exists()) {
        //if doesnt exists, makes new document
        const user: CustomUser = {
          uid: userCredential.user.uid,
          progress: [],
          sections: [],
          admin: false
        }
        //Adds custom user data to database.
        await createUserDoc(user)
      }
      navigate("/")
    } catch (e) {
      setError(mapFirebaseAuthError(e)) // Tracks error if there is any
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto w-3/4">
      {/*google oauth button*/}
      <button
        type="button"
        className={"flex w-full justify-center items-center border border-solid border-blue-900 rounded-2xl bg-white h-10 gap-5 mt-5 hover:brightness-75 active:brightness-50 disabled:cursor-not-allowed disabled:opacity-60 cursor-pointer"}
        onClick={() => void onGoogleSignIn()}
        disabled={busy}
      >
        <img src={Image} alt="" className="w-5" width={20} height={20} />
        <span className="block">{busy ? "Signing in…" : "Sign in with Google"}</span>
      </button>
      {/*error message*/}
      {error ? (
        <p className="mt-2 text-center text-xs text-red-600" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}
