import { signOut, type UserCredential } from "firebase/auth"
import { doc, getDoc } from "firebase/firestore"
import { getFirebaseAuth } from "./firebase"
import { db } from "./firestore"
import { createAccount, type BesaSignupInfo } from "./Fetch"

//the signup pages redirect home as soon as onAuthStateChanged sees a user - but during signup that fires
//right after the Firebase login exists and BEFORE the backend has made the user doc (or rejected it, e.g.
//a roster name someone else just claimed). They check this to hold off until signUp() has finished.
let signupInProgress = false
export function isSignupInProgress(): boolean {
    return signupInProgress
}

//makes the Firebase login via `createLogin` (the Google popup), then has the backend create the user doc.
//If the backend refuses, the login is signed out again (never deleted - the Google account may already
//belong to someone) and this throws with the backend's reason.
export async function signUp(createLogin: () => Promise<UserCredential>, besa?: BesaSignupInfo): Promise<void> {
    signupInProgress = true
    try {
        const credential = await createLogin()
        const userRef = doc(db, "training_data", "data_root", "users", credential.user.uid)

        //an existing account signing in through a signup page (e.g. Google) - nothing to create
        if ((await getDoc(userRef)).exists()) return

        const result = await createAccount(besa)
        if (result.success) return

        //the doc may have been made even though the response was lost - don't orphan it in that case
        if ((await getDoc(userRef)).exists()) return

        await signOut(getFirebaseAuth())
        throw new Error(result.detail)
    } finally {
        signupInProgress = false
    }
}
