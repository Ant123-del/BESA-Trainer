import { useEffect, useState, type JSX } from "react"
import { onAuthStateChanged, deleteUser, type User as FirebaseUser } from "firebase/auth"
import { collection, doc, getDoc, getDocs, limit, query, updateDoc, where } from "firebase/firestore"
import { getStorage, ref, uploadBytes } from "firebase/storage"
import { useNavigate } from "react-router-dom"
import { MoonLoader } from "react-spinners"
import Header from "../Components/Header"
import { Loading, floorNameDecoder } from "../Components/Edit"
import { getFirebaseAuth } from "../Tools/firebase"
import { db, deleteUserAccountData, removeCustomScript } from "../Tools/firestore"
import { getScript } from "../Tools/Fetch"
import { mapFirebaseAuthError } from "../Tools/authErrors"
import type { CosScript, Floor, Script, User as CustomUser } from "../Tools/types"

const DELETE_CONFIRM_PHRASE = "Yes I want to delete my account"

type ScriptStatus = {
    cosScript: CosScript
    floorName: string
    currentFloor: Floor | null
    defaultScriptSrc: string | null
    outOfDate: boolean
}

export default function Profile(): JSX.Element {
    const navigate = useNavigate()
    const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null)
    const [userData, setUserData] = useState<CustomUser | null>(null)
    const [loading, setLoading] = useState(true)

    const [scriptStatuses, setScriptStatuses] = useState<ScriptStatus[]>([])
    const [statusesLoading, setStatusesLoading] = useState(true)
    const [removingId, setRemovingId] = useState<string | null>(null)
    const [updatingId, setUpdatingId] = useState<string | null>(null)
    const [scriptActionError, setScriptActionError] = useState("")

    const [deletePopup, setDeletePopup] = useState(false)
    const [confirmText, setConfirmText] = useState("")
    const [deleting, setDeleting] = useState(false)
    const [deleteError, setDeleteError] = useState("")

    useEffect(() => {
        const auth = getFirebaseAuth()
        const unsub = onAuthStateChanged(auth, (user) => {
            setFirebaseUser(user)
            if (!user?.uid) {
                navigate("/")
                return
            }

            const docRef = doc(db, "training_data", "data_root", "users", user.uid)
            getDoc(docRef).then((docSnap) => {
                setUserData(docSnap.exists() ? docSnap.data() as CustomUser : null)
                setLoading(false)
            })
        })
        return unsub
    }, [])

    //figures out, per custom script, which floor it belongs to and whether that floor's current
    //draft still matches what the custom script was originally copied from.
    useEffect(() => {
        if (!userData) {
            return
        }
        if (userData.scriptPaths.length === 0) {
            setScriptStatuses([])
            setStatusesLoading(false)
            return
        }

        let cancelled = false
        setStatusesLoading(true)
        Promise.all(userData.scriptPaths.map(async (cosScript): Promise<ScriptStatus> => {
            const floorDocs = await getDocs(query(
                collection(db, "training_data/floors/" + cosScript.floorCode),
                where("current", "==", true),
                limit(1)
            ))
            const currentFloor = floorDocs.empty ? null : floorDocs.docs[0].data() as Floor

            let defaultScriptSrc: string | null = null
            if (currentFloor) {
                const scriptDoc = await getDoc(doc(db, "training_data/data_root/scripts/" + currentFloor.defScriptId))
                defaultScriptSrc = scriptDoc.exists() ? (scriptDoc.data() as Script).src : null
            }

            return {
                cosScript,
                floorName: floorNameDecoder(cosScript.floorCode),
                currentFloor,
                defaultScriptSrc,
                outOfDate: !!currentFloor && cosScript.scriptDeviationId !== currentFloor.defScriptId
            }
        })).then((results) => {
            if (!cancelled) {
                setScriptStatuses(results)
                setStatusesLoading(false)
            }
        })

        return () => { cancelled = true }
    }, [userData])

    async function handleRemoveScript(cosScript: CosScript) {
        if (!userData) {
            return
        }
        setScriptActionError("")
        setRemovingId(cosScript.id)
        try {
            const newScriptPaths = await removeCustomScript(userData.uid, userData.scriptPaths, cosScript)
            setUserData({...userData, scriptPaths: newScriptPaths})
            setScriptStatuses(prev => prev.filter(s => s.cosScript.id !== cosScript.id))
        } catch (e) {
            console.error(e)
            setScriptActionError("Something went wrong reverting that script. Please try again.")
        } finally {
            setRemovingId(null)
        }
    }

    async function handleUpdateScript(status: ScriptStatus) {
        if (!userData || !status.currentFloor || !status.defaultScriptSrc) {
            return
        }
        setScriptActionError("")
        setUpdatingId(status.cosScript.id)
        try {
            const newText = await getScript(status.defaultScriptSrc) || ""
            const storage = getStorage()
            await uploadBytes(ref(storage, status.cosScript.path), new Blob([newText], {type: "text/vtt"}))

            const updatedEntry: CosScript = {...status.cosScript, scriptDeviationId: status.currentFloor.defScriptId}
            const newScriptPaths = userData.scriptPaths.map(s => s.id === status.cosScript.id ? updatedEntry : s)
            await updateDoc(doc(db, "training_data/data_root/users/" + userData.uid), {scriptPaths: newScriptPaths})

            setUserData({...userData, scriptPaths: newScriptPaths})
            setScriptStatuses(prev => prev.map(s => s.cosScript.id === status.cosScript.id ? {...s, cosScript: updatedEntry, outOfDate: false} : s))
        } catch (e) {
            console.error(e)
            setScriptActionError("Something went wrong updating that script. Please try again.")
        } finally {
            setUpdatingId(null)
        }
    }

    async function handleDeleteAccount() {
        if (!firebaseUser || !userData || confirmText !== DELETE_CONFIRM_PHRASE) {
            return
        }
        setDeleting(true)
        setDeleteError("")
        try {
            await deleteUserAccountData(userData.uid, userData.scriptPaths)
            await deleteUser(firebaseUser)
            navigate("/")
        } catch (e) {
            setDeleteError(mapFirebaseAuthError(e))
            setDeleting(false)
        }
    }

    function closeDeletePopup() {
        setDeletePopup(false)
        setConfirmText("")
        setDeleteError("")
    }

    return (
        <div className="bg-gray-900 w-full min-h-screen text-white">
            <Header/>
            <div className="h-16 relative top-0 left-0 w-full"></div>
            <div className="w-5/6 max-w-3xl mx-auto py-10">
                <h1 className="text-4xl tracking-wider mb-8">Profile</h1>

                {loading ?
                    <div className="flex justify-center py-20"><MoonLoader color="white" size={30}/></div>
                    :
                    <div className="flex flex-col gap-8">
                        <section className="bg-gray-800 rounded-2xl p-6">
                            <h2 className="text-2xl tracking-wide mb-4">Manage Account Info</h2>
                            <div className="flex flex-col gap-2 text-sm mb-6">
                                <InfoRow label="Email" value={firebaseUser?.email || "No email on file"}/>
                                <InfoRow label="Role" value={userData?.admin ? "Admin" : "Trainee"}/>
                                <InfoRow label="Account Created"
                                    value={firebaseUser?.metadata.creationTime ? new Date(firebaseUser.metadata.creationTime).toLocaleDateString() : "Unknown"}/>
                            </div>
                            <button onClick={() => setDeletePopup(true)}
                                className="p-2 px-6 rounded-full bg-red-800 hover:bg-red-900 text-sm">
                                Delete Account
                            </button>
                        </section>

                        <section className="bg-gray-800 rounded-2xl p-6">
                            <h2 className="text-2xl tracking-wide mb-1">Manage Custom Scripts</h2>
                            <p className="text-xs text-gray-400 mb-4">
                                Each floor you've practiced gets its own personalized copy of the script. From here you can update
                                one to match the latest draft, or drop it entirely to go back to using the default script.
                            </p>
                            {scriptActionError && <p className="text-red-400 text-sm mb-3">{scriptActionError}</p>}
                            {statusesLoading ?
                                <div className="flex justify-center py-10"><MoonLoader color="white" size={24}/></div>
                                : scriptStatuses.length === 0 ?
                                <p className="text-gray-500 italic text-sm">You don't have any custom scripts yet.</p>
                                :
                                <div className="flex flex-col gap-3">
                                    {scriptStatuses.map(status => (
                                        <div key={status.cosScript.id} className="bg-gray-900/60 rounded-xl p-4 flex justify-between items-center gap-3">
                                            <div>
                                                <h3 className="font-semibold">{status.floorName}</h3>
                                                {status.outOfDate &&
                                                    <span className="text-xs text-amber-400">Out of date - doesn't match the current draft for this floor</span>
                                                }
                                            </div>
                                            <div className="flex items-center gap-2 shrink-0">
                                                {status.outOfDate &&
                                                    <button onClick={() => handleUpdateScript(status)} disabled={updatingId === status.cosScript.id}
                                                        className="p-2 px-4 rounded-full bg-amber-800 hover:bg-amber-900 text-xs disabled:opacity-50">
                                                        {updatingId === status.cosScript.id ? "Updating..." : "Update to Latest"}
                                                    </button>
                                                }
                                                <button onClick={() => handleRemoveScript(status.cosScript)} disabled={removingId === status.cosScript.id}
                                                    className="p-2 px-4 rounded-full border border-gray-400 hover:bg-gray-800 text-xs disabled:opacity-50">
                                                    {removingId === status.cosScript.id ? "Removing..." : "Use Default Script"}
                                                </button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            }
                        </section>
                    </div>
                }
            </div>

            {deletePopup &&
                <Loading onClose={deleting ? undefined : closeDeletePopup}>
                    <div className="bg-gray-900 w-1/3 min-w-96 p-5 rounded-2xl text-center">
                        <h3 className="text-2xl mb-1 text-red-500">Delete Your Account?</h3>
                        <p className="text-sm text-gray-400">
                            This will permanently delete your account, your progress, and every custom script you've made. This action cannot be undone.
                        </p>
                        <p className="text-sm text-gray-300 mt-4">
                            Type <span className="font-semibold text-white">"{DELETE_CONFIRM_PHRASE}"</span> below to confirm.
                        </p>
                        <input
                            value={confirmText}
                            onChange={(e) => setConfirmText(e.target.value)}
                            disabled={deleting}
                            placeholder={DELETE_CONFIRM_PHRASE}
                            className="w-full p-2 rounded-lg bg-gray-700 text-white mt-3"
                        />
                        {deleteError && <p className="text-red-400 text-sm mt-3">{deleteError}</p>}
                        <button onClick={handleDeleteAccount} disabled={deleting || confirmText !== DELETE_CONFIRM_PHRASE}
                            className="rounded-full w-full mt-4 p-2 bg-red-800 hover:bg-red-900 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2">
                            {deleting && <MoonLoader color="white" size={16}/>}
                            {deleting ? "Deleting..." : "Delete My Account"}
                        </button>
                        <button onClick={closeDeletePopup} disabled={deleting}
                            className="rounded-full w-full mt-3 border-solid border-2 border-gray-400 hover:bg-gray-800 p-2 disabled:opacity-40">
                            Cancel
                        </button>
                    </div>
                </Loading>
            }
        </div>
    )
}

function InfoRow({label, value}: {label: string, value: string}) {
    return (
        <div className="flex justify-between border-b border-gray-700 pb-2">
            <span className="text-gray-400">{label}</span>
            <span>{value}</span>
        </div>
    )
}
