import { useEffect, useState, type JSX } from "react"
import { onAuthStateChanged, deleteUser, signOut, type User as FirebaseUser } from "firebase/auth"
import { doc, getDoc } from "firebase/firestore"
import { useNavigate } from "react-router-dom"
import { MoonLoader } from "react-spinners"
import Header from "../Components/Header"
import { Loading } from "../Components/SectionEditor/Edit"
import { getFirebaseAuth } from "../Tools/firebase"
import { db, deleteUserAccountData } from "../Tools/firestore"
import { mapFirebaseAuthError } from "../Tools/authErrors"
import { toDateKey } from "../Tools/dates"
import type { User as CustomUser, DayHours } from "../Tools/types"
import {
    addDayNote, changeRootAdminPasscode, checkAutoClockout, deleteDayNote, deleteRootAccount, getActivityTypes, getAllHours,
    getRootAdminToken, rootAdminLogout, setMemberDayHours, type ApiDayHours, type ApiOpenSession, type MemberHours, type OfficeScheduleDay
} from "../Tools/Fetch"
import { type OpenSession, type WeeklyHoursEntry } from "../Components/WeeklyHoursTable"
import HoursCarousel from "../Components/HoursCarousel"
import RootAdminLogin from "../Components/RootAdminLogin"
import OfficeTimeDisclaimer from "../Components/OfficeTimeDisclaimer"
import BreakCriteria from "../Components/BreakCriteria"
import type { DayNoteHandlers } from "../Components/DayNotes"

type RawDayHours = DayHours | ApiDayHours

//dates read straight off the user doc are Firestore Timestamps (have .toDate()), not plain JS Dates -
//normalize both that and the backend's ISO strings (/all-hours, /check-auto-clockout) to a Date.
function toDate(value: unknown): Date {
    return typeof value === "string" ? new Date(value) : (value as {toDate: () => Date}).toDate()
}

function toWeeklyHoursEntries(entries: RawDayHours[]): WeeklyHoursEntry[] {
    return entries.map(e => ({
        hours: e.hours,
        activities: e.activities,
        autoClockedOut: e.autoClockedOut,
        editedByAdmin: e.editedByAdmin,
        breakAllowanceMinutes: "breakAllowanceMinutes" in e ? e.breakAllowanceMinutes : undefined,
        date: toDate(e.date),
        sessions: (e.sessions || []).map(s => ({
            clockIn: toDate(s.clockIn),
            clockOut: toDate(s.clockOut),
            activities: s.activities || [],
            autoClockedOut: s.autoClockedOut,
            breakSeconds: s.breakSeconds,
            canceledTour: s.canceledTour,
            notes: toNotes(s.notes),
            workedOn: s.workedOn,
        })),
        dayNotes: (e.dayNotes || []).map(n => ({id: n.id, text: n.text, at: n.at ? toDate(n.at) : null})),
    }))
}

//notes from the backend (ISO times) or straight off the user doc (Firestore Timestamps)
function toNotes(notes: {text: string, at: unknown}[] | undefined): {text: string, at: Date | null}[] {
    return (notes || []).map(n => ({text: n.text, at: n.at ? toDate(n.at) : null}))
}

function toOpenSession(session: ApiOpenSession | null | undefined): OpenSession | null {
    return session ? {clockIn: new Date(session.clockIn), activities: session.activities, break: session.break, notes: toNotes(session.notes)} : null
}


const DELETE_CONFIRM_PHRASE = "Yes I want to delete my account"
const SESSION_EXPIRED_NOTICE = "Your admin session expired - please log in again."

export default function Profile(): JSX.Element {
    const navigate = useNavigate()
    const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null)
    const [userData, setUserData] = useState<CustomUser | null>(null)
    const [loading, setLoading] = useState(true)

    const [deletePopup, setDeletePopup] = useState(false)
    const [confirmText, setConfirmText] = useState("")
    const [deleting, setDeleting] = useState(false)
    const [deleteError, setDeleteError] = useState("")

    //root only - the passcode-gated admin session (see RootAdminLogin). Starts unlocked if this tab
    //still holds an unexpired session token, so a reload doesn't force re-entering the passcode.
    const [adminUnlocked, setAdminUnlocked] = useState(() => !!getRootAdminToken())
    const [adminNotice, setAdminNotice] = useState("")
    const [allHours, setAllHours] = useState<MemberHours[] | null>(null)
    //Sunday the current two-week hours period started (YYYY-MM-DD, from the backend) - what the carousels show
    const [periodStart, setPeriodStart] = useState<string | undefined>(undefined)
    const [editing, setEditing] = useState<{member: MemberHours, day: WeeklyHoursEntry} | null>(null)

    //overrides userData.biWeeklyHours once the auto-clockout self-check comes back, so a forgotten
    //session that gets closed out mid-visit shows up without needing a manual refresh.
    const [ownHours, setOwnHours] = useState<RawDayHours[] | null>(null)
    //undefined until that check answers - until then the open visit comes off the user doc directly
    const [ownOpenSession, setOwnOpenSession] = useState<OpenSession | null | undefined>(undefined)
    //their BESA booking schedule, from the same check - undefined while loading
    const [ownSchedule, setOwnSchedule] = useState<OfficeScheduleDay[] | null | undefined>(undefined)

    const isRoot = userData?.accountType === "root"

    //their own My Hours only - each save comes back with the updated hours, so the table redraws from that
    const dayNoteHandlers: DayNoteHandlers = {
        add: async (date, text) => {
            const result = await addDayNote(date, text)
            if (result.success && result.biWeeklyHours) setOwnHours(result.biWeeklyHours)
            return result.success ? null : result.detail || "Couldn't save the note."
        },
        remove: async (date, noteId) => {
            const result = await deleteDayNote(date, noteId)
            if (result.success && result.biWeeklyHours) setOwnHours(result.biWeeklyHours)
            return result.success ? null : result.detail || "Couldn't delete the note."
        },
    }

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
                if (data?.accountType === "besa" || data?.accountType === "besaLead") {
                    //fresh: a page load/refresh always re-reads their office hours from BESA Booking
                    checkAutoClockout(true).then(result => {
                        if (!result) {
                            setOwnSchedule(null)
                            return
                        }
                        setOwnHours(result.biWeeklyHours)
                        setOwnOpenSession(toOpenSession(result.openSession))
                        setOwnSchedule(result.officeSchedule ?? null)
                        setPeriodStart(result.periodStart)
                    })
                }
            })
        })
        return unsub
    }, [])

    useEffect(() => {
        if (!isRoot || !adminUnlocked) return
        getAllHours(true).then(result => {
            if (result.success) {
                setAllHours(result.members)
                setPeriodStart(result.periodStart)
            } else {
                //a 403 means the server-side session is gone (expired or logged out elsewhere)
                if (result.status === 403) lockAdmin(SESSION_EXPIRED_NOTICE)
                setAllHours([])
            }
        })
    }, [isRoot, adminUnlocked])

    //any admin call coming back 403 means the server-side session is gone (expired or logged out
    //elsewhere) - drop back to the passcode screen rather than showing a half-broken page.
    function lockAdmin(notice = "") {
        setAdminUnlocked(false)
        setAdminNotice(notice)
        setAllHours(null)
        setEditing(null)
        setDeletePopup(false)
    }

    function handleAdminFailure(result: {status?: number}) {
        if (result.status === 403) lockAdmin(SESSION_EXPIRED_NOTICE)
    }

    async function handleAdminLogout() {
        await rootAdminLogout()
        lockAdmin()
    }

    async function handleDeleteAccount() {
        if (!firebaseUser || !userData || confirmText !== DELETE_CONFIRM_PHRASE) {
            return
        }
        setDeleting(true)
        setDeleteError("")
        try {
            if (isRoot) {
                //server-side, so the root passcode is wiped along with the account - a replacement
                //root account then has to set up its own passcode from scratch.
                const result = await deleteRootAccount()
                if (!result.success) {
                    handleAdminFailure(result)
                    setDeleteError(result.detail)
                    setDeleting(false)
                    return
                }
                await signOut(getFirebaseAuth())
            } else {
                await deleteUserAccountData(userData.uid, userData.scriptPaths)
                await deleteUser(firebaseUser)
            }
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

    const roleLabel = isRoot ? "BESA Root" : userData?.admin ? "Admin" : "Trainee"

    return (
        <div className="bg-gray-900 w-full min-h-screen text-white">
            <Header/>
            <div className="h-16 relative top-0 left-0 w-full"></div>
            <div className="w-5/6 max-w-5xl mx-auto py-10">
                <div className="flex items-center justify-between gap-4 flex-wrap mb-8">
                    <h1 className="text-2xl sm:text-3xl md:text-4xl tracking-wider">Profile</h1>
                    {isRoot && adminUnlocked &&
                        <button onClick={() => void handleAdminLogout()}
                            className="p-2 px-5 rounded-full border-solid border-2 border-gray-400 hover:bg-gray-800 text-sm">
                            Lock Admin
                        </button>
                    }
                </div>

                {loading ?
                    <div className="flex justify-center py-20"><MoonLoader color="white" size={30}/></div>
                    : isRoot && !adminUnlocked ?
                    <RootAdminLogin notice={adminNotice} onUnlocked={() => { setAdminNotice(""); setAdminUnlocked(true) }}/>
                    :
                    <div className="flex flex-col gap-8">
                        <section className="bg-gray-800 rounded-2xl p-6">
                            <h2 className="text-2xl tracking-wide mb-4">Manage Account Info</h2>
                            <div className="flex flex-col gap-2 text-sm mb-6">
                                <InfoRow label="Email" value={firebaseUser?.email || "No email on file"}/>
                                <InfoRow label="Role" value={roleLabel}/>
                                <InfoRow label="Account Created"
                                    value={firebaseUser?.metadata.creationTime ? new Date(firebaseUser.metadata.creationTime).toLocaleDateString() : "Unknown"}/>
                            </div>
                            <button onClick={() => setDeletePopup(true)}
                                className="p-2 px-6 rounded-full bg-red-800 hover:bg-red-900 text-sm">
                                Delete Account
                            </button>
                        </section>

                        {isRoot &&
                            <ChangePasscodePanel onSessionExpired={() => lockAdmin(SESSION_EXPIRED_NOTICE)}/>
                        }

                        {isRoot &&
                            <section className="bg-gray-800 rounded-2xl p-6">
                                <h2 className="text-2xl tracking-wide mb-4">Everyone's Hours (This 2-Week Period)</h2>
                                <OfficeTimeDisclaimer className="mb-2"/>
                                <BreakCriteria className="mb-4"/>
                                {allHours === null ?
                                    <div className="flex justify-center py-10"><MoonLoader color="white" size={24}/></div>
                                    : allHours.length === 0 ?
                                    <p className="text-gray-500 italic text-sm">No BESA accounts yet.</p>
                                    :
                                    <div className="flex flex-col gap-6">
                                        {allHours.map(member => (
                                            <div key={member.uid}>
                                                <p className="font-semibold mb-2">{member.besaName || "(no name on file)"}</p>
                                                <HoursCarousel entries={toWeeklyHoursEntries(member.hours)}
                                                    openSession={toOpenSession(member.openSession)}
                                                    schedule={member.officeSchedule ?? null}
                                                    periodStart={periodStart}
                                                    onEditDay={(day) => setEditing({member, day})}/>
                                            </div>
                                        ))}
                                    </div>
                                }
                            </section>
                        }

                        {(userData?.accountType === "besa" || userData?.accountType === "besaLead") &&
                            <section className="bg-gray-800 rounded-2xl p-6">
                                <h2 className="text-2xl tracking-wide mb-4">My Hours (This 2-Week Period)</h2>
                                <OfficeTimeDisclaimer className="mb-2"/>
                                <BreakCriteria className="mb-4"/>
                                <HoursCarousel entries={toWeeklyHoursEntries(ownHours ?? userData.biWeeklyHours ?? [])}
                                    schedule={ownSchedule}
                                    periodStart={periodStart}
                                    dayNoteHandlers={dayNoteHandlers}
                                    openSession={ownOpenSession !== undefined ? ownOpenSession
                                        : userData.lastCheckedIn ? {clockIn: toDate(userData.lastCheckedIn), activities: userData.lastCheckedInActivities || [], notes: toNotes(userData.lastCheckedInNotes)}
                                        : null}/>
                            </section>
                        }
                    </div>
                }
            </div>

            {editing &&
                <EditHoursPopup
                    member={editing.member}
                    day={editing.day}
                    onClose={() => setEditing(null)}
                    onSessionExpired={() => lockAdmin(SESSION_EXPIRED_NOTICE)}
                    onSaved={(hours) => {
                        setAllHours(prev => prev?.map(m => m.uid === editing.member.uid ? {...m, hours} : m) ?? prev)
                        setEditing(null)
                    }}
                />
            }

            {deletePopup &&
                <Loading onClose={deleting ? undefined : closeDeletePopup}>
                    <div className="bg-gray-900 w-11/12 sm:w-2/3 md:w-1/3 max-w-md p-5 rounded-2xl text-center">
                        <h3 className="text-2xl mb-1 text-red-500">Delete Your Account?</h3>
                        <p className="text-sm text-gray-400">
                            {isRoot
                                ? "This will permanently delete the BESA root account and its admin passcode. A new root account will have to set up a new passcode. This action cannot be undone."
                                : "This will permanently delete your account, your progress, and every custom script you've made. This action cannot be undone."}
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

//root admin only - the current admin session already proves the old passcode was known.
function ChangePasscodePanel({onSessionExpired}: {onSessionExpired: () => void}) {
    const [open, setOpen] = useState(false)
    const [passcode, setPasscode] = useState("")
    const [confirm, setConfirm] = useState("")
    const [busy, setBusy] = useState(false)
    const [message, setMessage] = useState<{text: string, error: boolean} | null>(null)

    const canSubmit = passcode.length >= 6 && passcode === confirm

    async function handleSave() {
        if (!canSubmit) return
        setBusy(true)
        setMessage(null)
        const result = await changeRootAdminPasscode(passcode)
        setBusy(false)
        if (result.success) {
            setMessage({text: "Passcode updated.", error: false})
            setPasscode("")
            setConfirm("")
            setOpen(false)
        } else if (result.status === 403) {
            onSessionExpired()
        } else {
            setMessage({text: result.detail, error: true})
        }
    }

    return (
        <section className="bg-gray-800 rounded-2xl p-6">
            <div className="flex items-center justify-between gap-4 flex-wrap">
                <h2 className="text-2xl tracking-wide">Admin Passcode</h2>
                {!open &&
                    <button onClick={() => { setOpen(true); setMessage(null) }}
                        className="p-2 px-5 rounded-full bg-gray-700 hover:bg-gray-600 text-sm">
                        Change Passcode
                    </button>
                }
            </div>
            {message && <p className={"text-sm mt-3 " + (message.error ? "text-red-400" : "text-green-400")}>{message.text}</p>}
            {open &&
                <div className="flex flex-col gap-3 mt-4">
                    <input type="password" autoComplete="new-password" value={passcode} disabled={busy}
                        onChange={(e) => setPasscode(e.target.value)} placeholder="New passcode (6+ characters)"
                        className="w-full p-3 rounded-xl bg-gray-700 text-white"/>
                    <input type="password" autoComplete="new-password" value={confirm} disabled={busy}
                        onChange={(e) => setConfirm(e.target.value)} placeholder="Confirm new passcode"
                        className="w-full p-3 rounded-xl bg-gray-700 text-white"/>
                    {confirm.length > 0 && passcode !== confirm && <p className="text-red-400 text-sm">Passcodes don't match.</p>}
                    <div className="flex gap-2">
                        <button onClick={() => void handleSave()} disabled={busy || !canSubmit}
                            className="flex-1 py-2 rounded-full bg-blue-800 hover:bg-blue-900 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2">
                            {busy && <MoonLoader color="white" size={16}/>}
                            Save
                        </button>
                        <button onClick={() => { setOpen(false); setPasscode(""); setConfirm("") }} disabled={busy}
                            className="flex-1 py-2 rounded-full border-solid border-2 border-gray-400 hover:bg-gray-700 disabled:opacity-40">
                            Cancel
                        </button>
                    </div>
                </div>
            }
        </section>
    )
}

//root admin only - overwrites one member's hours/activities for one day of the current week.
function EditHoursPopup({member, day, onClose, onSaved, onSessionExpired}: {
    member: MemberHours
    day: WeeklyHoursEntry
    onClose: () => void
    onSaved: (hours: MemberHours["hours"]) => void
    onSessionExpired: () => void
}) {
    const [hours, setHours] = useState(day.hours.toString())
    const [activities, setActivities] = useState<string[]>(day.activities)
    const [activityTypes, setActivityTypes] = useState<string[] | null>(null)
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState("")

    useEffect(() => {
        getActivityTypes().then(result => setActivityTypes(result || []))
    }, [])

    //keep any activity already logged that day selectable, even if it's since been removed from the list
    const chipNames = [...new Set([...(activityTypes || []), ...day.activities])]
    const hoursNumber = Number(hours)
    const hoursValid = hours.trim() !== "" && Number.isFinite(hoursNumber) && hoursNumber >= 0 && hoursNumber <= 24 && hoursNumber * 2 === Math.round(hoursNumber * 2)

    function toggleActivity(name: string) {
        setActivities(prev => prev.includes(name) ? prev.filter(a => a !== name) : [...prev, name])
    }

    async function save(newHours: number, newActivities: string[]) {
        setBusy(true)
        setError("")
        const result = await setMemberDayHours(member.uid, toDateKey(day.date), newHours, newActivities)
        setBusy(false)
        if (result.success) {
            onSaved(result.hours)
        } else if (result.status === 403) {
            onSessionExpired()
        } else {
            setError(result.detail)
        }
    }

    const dayLabel = day.date.toLocaleDateString(undefined, {weekday: "long", month: "short", day: "numeric"})

    return (
        <Loading onClose={busy ? undefined : onClose}>
            <div className="bg-gray-900 w-11/12 sm:w-2/3 md:w-1/2 max-w-md p-5 rounded-2xl">
                <h3 className="text-2xl mb-1 text-center">Edit Hours</h3>
                <p className="text-sm text-gray-400 text-center mb-4">{member.besaName || "(no name on file)"} · {dayLabel}</p>

                <label className="block text-sm text-gray-400 mb-1">Hours (0.5 increments)</label>
                <input type="number" min={0} max={24} step={0.5} value={hours} disabled={busy}
                    onChange={(e) => setHours(e.target.value)}
                    className="w-full p-3 rounded-xl bg-gray-700 text-white mb-4"/>
                {!hoursValid && <p className="text-red-400 text-sm -mt-3 mb-3">Enter 0-24 hours in 0.5 increments.</p>}

                <label className="block text-sm text-gray-400 mb-2">Activities</label>
                <div className="flex flex-wrap gap-2 mb-4">
                    {activityTypes === null ?
                        <MoonLoader color="white" size={20}/>
                        : chipNames.map(name => (
                            <button key={name} type="button" onClick={() => toggleActivity(name)} disabled={busy}
                                className={"px-3 py-1.5 rounded-full text-sm font-semibold " +
                                    (activities.includes(name) ? "bg-amber-500 text-black" : "bg-gray-700 text-gray-200 hover:bg-gray-600")}>
                                {name}
                            </button>
                        ))
                    }
                </div>

                {error && <p className="text-red-400 text-sm text-center mb-3">{error}</p>}
                <button onClick={() => void save(hoursNumber, activities)} disabled={busy || !hoursValid}
                    className="rounded-full w-full p-2 bg-blue-800 hover:bg-blue-900 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2">
                    {busy && <MoonLoader color="white" size={16}/>}
                    Save
                </button>
                {(day.hours > 0 || day.activities.length > 0) &&
                    <button onClick={() => void save(0, [])} disabled={busy}
                        className="rounded-full w-full mt-3 p-2 bg-red-800 hover:bg-red-900 disabled:opacity-40">
                        Clear Day
                    </button>
                }
                <button onClick={onClose} disabled={busy}
                    className="rounded-full w-full mt-3 border-solid border-2 border-gray-400 hover:bg-gray-800 p-2 disabled:opacity-40">
                    Cancel
                </button>
            </div>
        </Loading>
    )
}
