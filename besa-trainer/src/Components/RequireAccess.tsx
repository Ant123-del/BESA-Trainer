import { useEffect, useState, type JSX } from "react"
import { onAuthStateChanged, type User as FirebaseUser } from "firebase/auth"
import { doc, getDoc } from "firebase/firestore"
import { MoonLoader } from "react-spinners"
import { getFirebaseAuth } from "../Tools/firebase"
import { db } from "../Tools/firestore"
import type { User as CustomUser } from "../Tools/types"
import NoPermission from "../Pages/NoPermission"

type Level = "auth" | "admin" | "besaLead"

//wraps a route element and gates it behind an auth level - "auth" just needs to be signed in,
//"admin" additionally needs the admin flag, "besaLead" needs accountType === "besaLead" specifically
//(a besa account promoted to admin still isn't a lead). Anything short of that gets NoPermission
//instead of the real page, rather than a silent redirect.
export default function RequireAccess({level, children}: {level: Level, children: JSX.Element}): JSX.Element {
    const [checking, setChecking] = useState(true)
    const [allowed, setAllowed] = useState(false)

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

            setAllowed(level === "admin" ? !!data?.admin : data?.accountType === "besaLead")
            setChecking(false)
        })
        return unsub
    }, [level])

    if (checking) {
        return <div className="w-full h-screen flex items-center justify-center bg-gray-900"><MoonLoader color="white" size={40}/></div>
    }

    return allowed ? children : <NoPermission/>
}
