import { useEffect, useState } from "react"
import { MoonLoader } from "react-spinners"
import Header from "../Components/Header"
import OfficeTimeDisclaimer from "../Components/OfficeTimeDisclaimer"
import BreakCriteria from "../Components/BreakCriteria"
import { formatDuration, useLiveBreak } from "../Tools/breaks"
import { Loading } from "../Components/SectionEditor/Edit"

const CANCELED_TOUR_WARNING = "This logs them out for the rest of the day and sets today's hours to 30 minutes - even if they've already been in the office longer."
import {
    addActivityType, canceledTour, clockIn, clockOut, endBreak, getActivityTypes, getCurrentSessions,
    removeActivityType, startBreak, type KioskSession
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
                <ClockOutPanel sessions={sessions} onChanged={refreshSessions}/>
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

    //every clock-in has to say what they came in to work on
    const canSubmit = !!studentId.trim() && selected.length > 0

    async function handleSubmit() {
        if (!canSubmit) return
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
            <OfficeTimeDisclaimer className="mb-4 text-center"/>
            <label className="block text-sm text-gray-400 mb-1">Enter School Id</label>
            <input
                value={studentId}
                onChange={(e) => setStudentId(e.target.value)}
                placeholder="Ex: 1234567"
                className="w-full p-3 rounded-xl bg-gray-700 text-white mb-4"
            />
            <label className="block text-sm text-gray-400 mb-2 text-center">Activities Intended <span className="text-red-400">*</span></label>
            <div className="flex flex-wrap gap-2 justify-center mb-4">
                {activityTypes === null ?
                    <MoonLoader color="white" size={20}/>
                    : activityTypes.map(name => (
                        <ActivityChip key={name} label={name} selected={selected.includes(name)} onClick={() => toggleActivity(name)}/>
                    ))
                }
            </div>
            {selected.length === 0 && activityTypes !== null &&
                <p className="text-xs text-gray-400 text-center mb-3">Pick at least one activity you intend to work on to clock in.</p>
            }
            {message && <p className={"text-sm text-center mb-3 " + (message.error ? "text-red-400" : "text-green-400")}>{message.text}</p>}
            <button
                onClick={() => void handleSubmit()}
                disabled={busy || !canSubmit}
                className="w-full py-3 rounded-full bg-blue-800 hover:bg-blue-900 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
                {busy && <MoonLoader color="white" size={16}/>}
                Submit
            </button>
        </section>
    )
}

function ClockOutPanel({sessions, onChanged}: {sessions: KioskSession[] | null, onChanged: () => void}) {
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
            onChanged()
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
            <BreakCriteria className="mb-3"/>
            {sessions === null ?
                <div className="flex justify-center py-6"><MoonLoader color="white" size={24}/></div>
                : sessions.length === 0 ?
                <p className="text-gray-500 italic text-sm">Nobody is currently clocked in.</p>
                :
                <div className="flex flex-col gap-2">
                    {sessions.map(s => <SessionRow key={s.uid} session={s} onChanged={onChanged}/>)}
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


//one clocked-in member in Current Sessions, with their break controls. Today's break allowance comes from
//their BESA Booking office hours that day (see the backend's _break_allowance_minutes); they can take 5
//minutes at a time or everything left at once, shown as {time left}/{today's total}.
function SessionRow({session, onChanged}: {session: KioskSession, onChanged: () => void}) {
    const brk = session.break
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState("")
    const [confirmCancelTour, setConfirmCancelTour] = useState(false)
    const {onBreak, breakLeft, breakRanOut, remaining, resetNow} = useLiveBreak(brk)!

    //the break ran out on its own - pull fresh state so the buttons come back
    useEffect(() => {
        if (breakRanOut) onChanged()
    }, [breakRanOut, onChanged])

    async function run(action: () => Promise<{success: boolean, detail?: string}>) {
        setBusy(true)
        setError("")
        const result = await action()
        setBusy(false)
        if (result.success) {
            resetNow()
            onChanged()
        } else {
            setError(result.detail || "Something went wrong.")
        }
    }

    return (
        <div className={"rounded-xl p-3 flex flex-col gap-2 " + (onBreak ? "bg-sky-900/60 border border-sky-700" : "bg-gray-700")}>
            <div className="flex items-center justify-between gap-3 flex-wrap">
                <span className="font-semibold">{session.besaName || "(no name on file)"}</span>
                <div className="flex flex-wrap gap-1">
                    {session.activities.map(a => (
                        <span key={a} className="text-xs px-2 py-0.5 rounded-full bg-amber-500 text-black">{a}</span>
                    ))}
                </div>
            </div>

            <div className="flex items-center justify-between gap-2 flex-wrap text-sm">
                {brk.allowanceSeconds === 0 ?
                    <span className="text-gray-400">No break time today (no office hours on BESA Booking)</span>
                    :
                    <span className="text-gray-300">
                        Breaks: <span className="font-semibold text-white tabular-nums">{formatDuration(remaining)}</span>
                        <span className="text-gray-400 tabular-nums"> / {formatDuration(brk.allowanceSeconds)}</span> left
                    </span>
                }
                {onBreak ?
                    <div className="flex items-center gap-2">
                        <span className="text-xs px-2 py-0.5 rounded bg-sky-500 text-black font-semibold tabular-nums">ON BREAK · {formatDuration(breakLeft)}</span>
                        <button onClick={() => void run(() => endBreak(session.uid))} disabled={busy}
                            className="text-xs px-3 py-1.5 rounded-full bg-gray-600 hover:bg-gray-500 disabled:opacity-40">
                            End Break
                        </button>
                    </div>
                    : remaining > 0 &&
                    <div className="flex items-center gap-2">
                        <button onClick={() => void run(() => startBreak(session.uid, "short"))} disabled={busy}
                            className="text-xs px-3 py-1.5 rounded-full bg-sky-700 hover:bg-sky-800 disabled:opacity-40">
                            {remaining >= 300 ? "5 Min Break" : `Break (${formatDuration(remaining)})`}
                        </button>
                        {remaining > 300 &&
                            <button onClick={() => void run(() => startBreak(session.uid, "all"))} disabled={busy}
                                className="text-xs px-3 py-1.5 rounded-full bg-sky-700 hover:bg-sky-800 disabled:opacity-40">
                                Take All ({formatDuration(remaining)})
                            </button>
                        }
                    </div>
                }
            </div>
            {session.canCancelTour &&
                <div className="flex items-center gap-2 flex-wrap border-t border-gray-600 pt-2">
                    <button onClick={() => setConfirmCancelTour(true)} disabled={busy}
                        className="text-xs px-3 py-1.5 rounded-full bg-red-800 hover:bg-red-900 disabled:opacity-40 whitespace-nowrap">
                        Canceled Tour
                    </button>
                    <span className="text-xs text-yellow-300/90 flex-1 min-w-[12rem]">⚠ {CANCELED_TOUR_WARNING}</span>
                </div>
            }
            {error && <p className="text-red-400 text-xs">{error}</p>}

            {confirmCancelTour &&
                <Loading onClose={busy ? undefined : () => setConfirmCancelTour(false)}>
                    <div className="bg-gray-900 w-11/12 sm:w-2/3 md:w-1/3 max-w-md p-5 rounded-2xl text-center">
                        <h3 className="text-2xl mb-2 text-red-500">Canceled Tour?</h3>
                        <p className="text-sm text-gray-300 mb-1">
                            {session.besaName || "This BESA"} will be logged out for the day.
                        </p>
                        <p className="text-sm text-yellow-300/90">⚠ {CANCELED_TOUR_WARNING}</p>
                        <button
                            onClick={() => void run(() => canceledTour(session.uid)).then(() => setConfirmCancelTour(false))}
                            disabled={busy}
                            className="rounded-full w-full mt-4 p-2 bg-red-800 hover:bg-red-900 disabled:opacity-40 flex items-center justify-center gap-2">
                            {busy && <MoonLoader color="white" size={16}/>}
                            Yes, log them out with 30 minutes
                        </button>
                        <button onClick={() => setConfirmCancelTour(false)} disabled={busy}
                            className="rounded-full w-full mt-3 border-solid border-2 border-gray-400 hover:bg-gray-800 p-2 disabled:opacity-40">
                            Cancel
                        </button>
                    </div>
                </Loading>
            }
        </div>
    )
}
