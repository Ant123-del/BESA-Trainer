import { useEffect, useState, type JSX } from "react"
import { onAuthStateChanged, type User as FirebaseUser } from "firebase/auth"
import { doc, getDoc } from "firebase/firestore"
import { MoonLoader } from "react-spinners"
import { getFirebaseAuth } from "../Tools/firebase"
import { db } from "../Tools/firestore"
import type { User as CustomUser } from "../Tools/types"
import NoPermission from "../Pages/NoPermission"
import { getRootAdminToken } from "../Tools/Fetch"

type Level = "auth" | "admin" | "besa" | "besaLead" | "leadOrRootAdmin"

//wraps a route element and gates it behind an auth level - "auth" just needs to be signed in,
//"admin" additionally needs the admin flag, "besa" needs accountType to be "besa" or "besaLead",
//"besaLead" needs accountType === "besaLead" specifically (a besa account promoted to admin still
//isn't a lead). Anything short of that gets NoPermission instead of the real page, rather than a
//silent redirect. "leadOrRootAdmin" (Assign Tasks) also lets in the root account once its admin passcode is
//unlocked on Profile - a root that hasn't unlocked it is pointed back there.
export default function RequireAccess({level, children}: {level: Level, children: JSX.Element}): JSX.Element {
    const [checking, setChecking] = useState(true)
    const [allowed, setAllowed] = useState(false)
    const [rootLocked, setRootLocked] = useState(false)

    useEffect(() => {
        const auth = getFirebaseAuth()
        const unsub = onAuthStateChanged(auth, async (firebaseUser: FirebaseUser | null) => {
            if (!firebaseUser) {
                setAllowed(false)
                setChecking(false)
                return
            }
            if (level === "auth") {
                setAllowed(true)
                setChecking(false)
                return
            }

            const docSnap = await getDoc(doc(db, "training_data", "data_root", "users", firebaseUser.uid))
            const data = docSnap.exists() ? docSnap.data() as CustomUser : null

            if (level === "admin") {
                setAllowed(!!data?.admin)
            } else if (level === "leadOrRootAdmin") {
                const unlockedRoot = data?.accountType === "root" && !!getRootAdminToken()
                setAllowed(data?.accountType === "besaLead" || unlockedRoot)
                setRootLocked(data?.accountType === "root" && !unlockedRoot)
            } else if (level === "besa") {
                setAllowed(data?.accountType === "besa" || data?.accountType === "besaLead")
            } else {
                setAllowed(data?.accountType === "besaLead")
            }
            setChecking(false)
        })
        return unsub
    }, [level])

    if (checking) {
        return <div className="w-full h-screen flex items-center justify-center bg-gray-900"><MoonLoader color="white" size={40}/></div>
    }

    return allowed ? children
        : <NoPermission message={rootLocked ? "Unlock admin with the root passcode on your Profile first, then open Assign Tasks from there." : undefined}/>
}
