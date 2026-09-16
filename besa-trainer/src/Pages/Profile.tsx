import { useEffect, useState, type JSX } from "react"
import { onAuthStateChanged, deleteUser, type User as FirebaseUser } from "firebase/auth"
import { doc, getDoc } from "firebase/firestore"
import { useNavigate } from "react-router-dom"
import { MoonLoader } from "react-spinners"
import Header from "../Components/Header"
import { Loading } from "../Components/SectionEditor/Edit"
import { getFirebaseAuth } from "../Tools/firebase"
import { db, deleteUserAccountData } from "../Tools/firestore"
import { mapFirebaseAuthError } from "../Tools/authErrors"
import type { User as CustomUser, DayHours } from "../Tools/types"
import { checkAutoClockout, getAllHours, type MemberHours } from "../Tools/Fetch"
import WeeklyHoursTable, { type WeeklyHoursEntry } from "../Components/WeeklyHoursTable"

type RawDayHours = DayHours | {date: string, hours: number, activities: string[], autoClockedOut?: boolean}

//DayHours.date comes back from Firestore as a Timestamp (has .toDate()), not a plain JS Date -
//normalize both that and the backend's ISO-string dates (root's /all-hours) to the same shape.
function toWeeklyHoursEntries(entries: RawDayHours[]): WeeklyHoursEntry[] {
    return entries.map(e => ({
        hours: e.hours,
        activities: e.activities,
        autoClockedOut: e.autoClockedOut,
        date: typeof e.date === "string" ? new Date(e.date) : (e.date as unknown as {toDate: () => Date}).toDate(),
    }))
}

const DELETE_CONFIRM_PHRASE = "Yes I want to delete my account"

export default function Profile(): JSX.Element {
    const navigate = useNavigate()
    const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null)
    const [userData, setUserData] = useState<CustomUser | null>(null)
    const [loading, setLoading] = useState(true)

    const [deletePopup, setDeletePopup] = useState(false)
    const [confirmText, setConfirmText] = useState("")
    const [deleting, setDeleting] = useState(false)
    const [deleteError, setDeleteError] = useState("")

    const [allHours, setAllHours] = useState<MemberHours[] | null>(null)
    //overrides userData.biWeeklyHours once the auto-clockout self-check comes back, so a forgotten
    //session that gets closed out mid-visit shows up without needing a manual refresh.
    const [ownHours, setOwnHours] = useState<RawDayHours[] | null>(null)

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
                const data = docSnap.exists() ? docSnap.data() as CustomUser : null
                setUserData(data)
                setLoading(false)
                if (data?.accountType === "root") {
                    getAllHours().then(result => setAllHours(result || []))
                } else if (data?.accountType === "besa" || data?.accountType === "besaLead") {
                    checkAutoClockout().then(result => result && setOwnHours(result.biWeeklyHours))
                }
            })
        })
        return unsub
    }, [])

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

                        {userData?.accountType === "root" &&
                            <section className="bg-gray-800 rounded-2xl p-6">
                                <h2 className="text-2xl tracking-wide mb-4">Everyone's Hours (This Week)</h2>
                                {allHours === null ?
                                    <div className="flex justify-center py-10"><MoonLoader color="white" size={24}/></div>
                                    : allHours.length === 0 ?
                                    <p className="text-gray-500 italic text-sm">No BESA accounts yet.</p>
                                    :
                                    <div className="flex flex-col gap-6">
                                        {allHours.map(member => (
                                            <div key={member.uid}>
                                                <p className="font-semibold mb-2">{member.besaName || "(no name on file)"}</p>
                                                <WeeklyHoursTable entries={toWeeklyHoursEntries(member.hours)}/>
                                            </div>
                                        ))}
                                    </div>
                                }
                            </section>
                        }

                        {(userData?.accountType === "besa" || userData?.accountType === "besaLead") &&
                            <section className="bg-gray-800 rounded-2xl p-6">
                                <h2 className="text-2xl tracking-wide mb-4">My Hours (This Week)</h2>
                                <WeeklyHoursTable entries={toWeeklyHoursEntries(ownHours ?? userData.biWeeklyHours ?? [])}/>
                            </section>
                        }
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
