import { useEffect, useState } from "react"
import { MoonLoader } from "react-spinners"
import Header from "../Components/Header"
import {
    addActivityType, clockIn, clockOut, getActivityTypes, getCurrentSessions,
    removeActivityType, type KioskSession
} from "../Tools/Fetch"

//the shared kiosk's home screen (root accountType only, see Home.tsx) - clock BESA members in/out by
//school id, see who's currently clocked in, and manage the shared activity-type list.
export default function RootDashboard() {
    const [activityTypes, setActivityTypes] = useState<string[] | null>(null)
    const [sessions, setSessions] = useState<KioskSession[] | null>(null)

    useEffect(() => {
        getActivityTypes().then(result => setActivityTypes(result || []))
        refreshSessions()
        //the kiosk computer stays open all day, so poll rather than only refreshing after an action -
        //this is also what actually closes out anyone who forgot to clock out once it passes 8pm,
        //since that check runs lazily as a side effect of the backend's /current-sessions call.
        const interval = setInterval(refreshSessions, 60_000)
        return () => clearInterval(interval)
    }, [])

    function refreshSessions() {
        getCurrentSessions().then(result => setSessions(result || []))
    }

    return (
        <div className="bg-gray-900 w-full min-h-screen text-white">
            <Header/>
            <div className="h-16 relative top-0 left-0 w-full"></div>
            <div className="w-5/6 max-w-3xl mx-auto py-10 flex flex-col gap-8">
                <ClockInPanel activityTypes={activityTypes} onClockedIn={refreshSessions}/>
                <ClockOutPanel sessions={sessions} onClockedOut={refreshSessions}/>
                <ActivityTypesPanel activityTypes={activityTypes} setActivityTypes={setActivityTypes}/>
            </div>
        </div>
    )
}

function ActivityChip({label, selected, onClick}: {label: string, selected: boolean, onClick: () => void}) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={"px-4 py-2 rounded-full text-sm font-semibold " +
                (selected ? "bg-amber-500 text-black" : "bg-gray-700 text-gray-200 hover:bg-gray-600")}
        >
            {label}
        </button>
    )
}

function ClockInPanel({activityTypes, onClockedIn}: {activityTypes: string[] | null, onClockedIn: () => void}) {
    const [studentId, setStudentId] = useState("")
    const [selected, setSelected] = useState<string[]>([])
    const [busy, setBusy] = useState(false)
    const [message, setMessage] = useState<{text: string, error: boolean} | null>(null)

    function toggleActivity(name: string) {
        setSelected(prev => prev.includes(name) ? prev.filter(a => a !== name) : [...prev, name])
    }

    async function handleSubmit() {
        if (!studentId.trim()) return
        setBusy(true)
        setMessage(null)
        const result = await clockIn(studentId.trim(), selected)
        if (result?.success) {
            setMessage({text: `Clocked in ${result.besaName || ""}.`, error: false})
            setStudentId("")
            setSelected([])
            onClockedIn()
        } else {
            setMessage({text: result?.detail || "Something went wrong.", error: true})
        }
        setBusy(false)
    }

    return (
        <section className="bg-gray-800 rounded-2xl p-6">
            <h2 className="text-2xl tracking-wide mb-4 text-center">Clock In</h2>
            <label className="block text-sm text-gray-400 mb-1">Enter School Id</label>
            <input
                value={studentId}
                onChange={(e) => setStudentId(e.target.value)}
                placeholder="Ex: 1234567"
                className="w-full p-3 rounded-xl bg-gray-700 text-white mb-4"
            />
            <label className="block text-sm text-gray-400 mb-2 text-center">Activities Intended</label>
            <div className="flex flex-wrap gap-2 justify-center mb-4">
                {activityTypes === null ?
                    <MoonLoader color="white" size={20}/>
                    : activityTypes.map(name => (
                        <ActivityChip key={name} label={name} selected={selected.includes(name)} onClick={() => toggleActivity(name)}/>
                    ))
                }
            </div>
            {message && <p className={"text-sm text-center mb-3 " + (message.error ? "text-red-400" : "text-green-400")}>{message.text}</p>}
            <button
                onClick={() => void handleSubmit()}
                disabled={busy || !studentId.trim()}
                className="w-full py-3 rounded-full bg-blue-800 hover:bg-blue-900 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
                {busy && <MoonLoader color="white" size={16}/>}
                Submit
            </button>
        </section>
    )
}

function ClockOutPanel({sessions, onClockedOut}: {sessions: KioskSession[] | null, onClockedOut: () => void}) {
    const [studentId, setStudentId] = useState("")
    const [busy, setBusy] = useState(false)
    const [message, setMessage] = useState<{text: string, error: boolean} | null>(null)

    async function handleSubmit() {
        if (!studentId.trim()) return
        setBusy(true)
        setMessage(null)
        const result = await clockOut(studentId.trim())
        if (result?.success) {
            setMessage({text: `Clocked out ${result.besaName || ""} - ${result.hoursThisSession} hour(s) this session.`, error: false})
            setStudentId("")
            onClockedOut()
        } else {
            setMessage({text: result?.detail || "Something went wrong.", error: true})
        }
        setBusy(false)
    }

    return (
        <section className="bg-gray-800 rounded-2xl p-6">
            <h2 className="text-2xl tracking-wide mb-4 text-center">Clock Out</h2>
            <label className="block text-sm text-gray-400 mb-1">Enter School Id</label>
            <input
                value={studentId}
                onChange={(e) => setStudentId(e.target.value)}
                placeholder="Ex: 1234567"
                className="w-full p-3 rounded-xl bg-gray-700 text-white mb-4"
            />
            {message && <p className={"text-sm text-center mb-3 " + (message.error ? "text-red-400" : "text-green-400")}>{message.text}</p>}
            <button
                onClick={() => void handleSubmit()}
                disabled={busy || !studentId.trim()}
                className="w-full py-3 rounded-full bg-blue-800 hover:bg-blue-900 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2 mb-6"
            >
                {busy && <MoonLoader color="white" size={16}/>}
                Submit
            </button>

            <hr className="border-gray-700 mb-4"/>
            <h3 className="text-lg tracking-wide mb-3">Current Sessions</h3>
            {sessions === null ?
                <div className="flex justify-center py-6"><MoonLoader color="white" size={24}/></div>
                : sessions.length === 0 ?
                <p className="text-gray-500 italic text-sm">Nobody is currently clocked in.</p>
                :
                <div className="flex flex-col gap-2">
                    {sessions.map(s => (
                        <div key={s.uid} className="bg-gray-700 rounded-xl p-3 flex items-center justify-between gap-3 flex-wrap">
                            <span className="font-semibold">{s.besaName || "(no name on file)"}</span>
                            <div className="flex flex-wrap gap-1">
                                {s.activities.map(a => (
                                    <span key={a} className="text-xs px-2 py-0.5 rounded-full bg-amber-500 text-black">{a}</span>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
            }
        </section>
    )
}

function ActivityTypesPanel({activityTypes, setActivityTypes}: {
    activityTypes: string[] | null, setActivityTypes: (types: string[]) => void
}) {
    const [selected, setSelected] = useState<string | null>(null)
    const [newName, setNewName] = useState("")
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState("")

    async function handleAdd() {
        if (!newName.trim()) return
        setBusy(true)
        setError("")
        const result = await addActivityType(newName.trim())
        if (result) {
            setActivityTypes(result)
            setNewName("")
        } else {
            setError("Something went wrong adding that activity.")
        }
        setBusy(false)
    }

    async function handleDelete() {
        if (!selected) return
        setBusy(true)
        setError("")
        const result = await removeActivityType(selected)
        if (result) {
            setActivityTypes(result)
            setSelected(null)
        } else {
            setError("Something went wrong removing that activity.")
        }
        setBusy(false)
    }

    return (
        <section className="bg-gray-800 rounded-2xl p-6">
            <h2 className="text-2xl tracking-wide mb-4 text-center">Add / Remove Activities</h2>
            <div className="flex flex-wrap gap-2 justify-center mb-4">
                {activityTypes === null ?
                    <MoonLoader color="white" size={20}/>
                    : activityTypes.map(name => (
                        <ActivityChip key={name} label={name} selected={selected === name} onClick={() => setSelected(prev => prev === name ? null : name)}/>
                    ))
                }
            </div>
            {error && <p className="text-red-400 text-sm text-center mb-3">{error}</p>}
            <div className="flex gap-2">
                <input
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="Enter Activity Name"
                    className="flex-1 p-3 rounded-xl bg-gray-700 text-white"
                />
                <button
                    onClick={() => void handleAdd()}
                    disabled={busy || !newName.trim()}
                    className="px-5 py-2 rounded-full bg-blue-800 hover:bg-blue-900 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                    Add
                </button>
                <button
                    onClick={() => void handleDelete()}
                    disabled={busy || !selected}
                    className="px-5 py-2 rounded-full bg-red-800 hover:bg-red-900 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                    Delete
                </button>
            </div>
        </section>
    )
}
