import type { JSX } from "react"
import { useState } from "react"
import { signInWithPopup } from "firebase/auth"
import { useNavigate } from "react-router-dom"
import Image from "../imgs/Google.png"
import { mapFirebaseAuthError } from "../Tools/authErrors"
import { getFirebaseAuth, googleAuthProvider } from "../Tools/firebase"
import type { BesaSignupInfo } from "../Tools/Fetch"
import { signUp } from "../Tools/signup"

//when used from the BESA signup flow, the caller passes along whichever roster name the user already
//picked from the dropdown, so a fresh account claims it the same way the email/password path does.
export default function GoogleSignInButton({besaSelection}: {besaSelection?: BesaSignupInfo}): JSX.Element {
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
      //opens google login in a popup, then the backend creates the user doc if this is a new account -
      //an existing account just signs in. The Google login may predate this app, so it's never deleted.
      await signUp(() => signInWithPopup(getFirebaseAuth(), googleAuthProvider), besaSelection)
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
