import { useEffect, useRef, useState } from "react"
import { MoonLoader } from "react-spinners"
import Header from "../Components/Header"
import OfficeTimeDisclaimer from "../Components/OfficeTimeDisclaimer"
import BreakCriteria from "../Components/BreakCriteria"
import { formatDuration, useLiveBreak } from "../Tools/breaks"
import { Loading } from "../Components/SectionEditor/Edit"
import SessionNotes from "../Components/SessionNotes"
import ActivitySplitBar from "../Components/ActivitySplitBar"
import { evenFractions } from "../Tools/activityColors"
import { FaPlus } from "react-icons/fa"
import {
    addActivityType, addSessionNote, canceledTour, clockIn, clockOut, clockOutPreview, endBreak, getActivityTypes, getCurrentSessions,
    removeActivityType, startBreak, type KioskSession
} from "../Tools/Fetch"

const NOTE_MAX_LENGTH = 500 //same cap as the backend's SESSION_NOTE_MAX_LENGTH

//written to the BESA standing at the kiosk, since they're the one deciding whether to press it
const CANCELED_TOUR_WARNING = "Only press this if your tour was canceled - if you have done a tour, do not click this button. It logs you out for the rest of the day and sets your hours for today to 30 minutes, even if you've already been in the office longer."
const CANCELED_TOUR_WHEN_SHOWN = "This button only shows up when your intended activities are only Tours."

//the shared kiosk's home screen (root accountType only, see Home.tsx) - clock BESA members in/out by
//school id, see who's currently clocked in, and manage the shared activity-type list.
export default function RootDashboard() {
    const [activityTypes, setActivityTypes] = useState<string[] | null>(null)
    const [sessions, setSessions] = useState<KioskSession[] | null>(null)

    useEffect(() => {
        getActivityTypes().then(result => setActivityTypes(result || []))
        //page load/refresh re-reads everyone's office hours from BESA Booking; the polling below can use the cache
        refreshSessions(true)
        //the kiosk computer stays open all day, so poll rather than only refreshing after an action -
        //this is also what actually closes out anyone who forgot to clock out once it passes 8pm,
        //since that check runs lazily as a side effect of the backend's /current-sessions call.
        const interval = setInterval(() => refreshSessions(), 60_000)
        return () => clearInterval(interval)
    }, [])

    function refreshSessions(fresh = false) {
        getCurrentSessions(fresh).then(result => setSessions(result || []))
    }

    return (
        <div className="bg-gray-900 w-full min-h-screen text-white">
            <Header/>
            <div className="h-16 relative top-0 left-0 w-full"></div>
            <div className="w-5/6 max-w-3xl mx-auto py-10 flex flex-col gap-8">
                <ClockInPanel activityTypes={activityTypes} onClockedIn={() => refreshSessions()}/>
                <ClockOutPanel sessions={sessions} activityTypes={activityTypes} onChanged={() => refreshSessions()}/>
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

type ClockOutPreview = {besaName: string, intendedActivities: string[], elapsedMinutes: number, creditedHours: number, clockedInAt: Date, leaveEarlySeconds: number}

//two steps: School Id -> Next, then "what did you actually work on?" (pick activities, split the visit
//between them on the timeline bar) -> Confirm Clock Out. A Current Sessions row's "Leave Early" puts it in
//leave-early mode: same steps, but they're credited their unused break time as if they'd stayed.
function ClockOutPanel({sessions, activityTypes, onChanged}: {
    sessions: KioskSession[] | null, activityTypes: string[] | null, onChanged: () => void
}) {
    const [studentId, setStudentId] = useState("")
    const [busy, setBusy] = useState(false)
    const [message, setMessage] = useState<{text: string, error: boolean} | null>(null)
    const [preview, setPreview] = useState<ClockOutPreview | null>(null)
    const [worked, setWorked] = useState<string[]>([])
    const [fractions, setFractions] = useState<number[]>([])
    const [leaveEarlyFor, setLeaveEarlyFor] = useState<KioskSession | null>(null)
    const panelRef = useRef<HTMLElement>(null)
    const idInputRef = useRef<HTMLInputElement>(null)

    function startLeaveEarly(session: KioskSession) {
        setLeaveEarlyFor(session)
        setPreview(null)
        setMessage(null)
        panelRef.current?.scrollIntoView({behavior: "smooth", block: "start"})
        idInputRef.current?.focus({preventScroll: true})
    }

    //the shared activity list, plus anything they clocked in for that's since been removed from it - this is
    //also the color order, so an activity's color matches the analytics chart
    const choices = [...(activityTypes || []), ...(preview?.intendedActivities || []).filter(a => !(activityTypes || []).includes(a))]

    function setWorkedOn(next: string[]) {
        setWorked(next)
        setFractions(evenFractions(next.length))
    }

    function reset() {
        setPreview(null)
        setWorked([])
        setFractions([])
    }

    async function handleNext() {
        if (!studentId.trim()) return
        setBusy(true)
        setMessage(null)
        const result = await clockOutPreview(studentId.trim(), !!leaveEarlyFor)
        setBusy(false)
        if (result.success) {
            setPreview({
                besaName: result.besaName || "",
                intendedActivities: result.intendedActivities || [],
                elapsedMinutes: result.elapsedMinutes || 0,
                creditedHours: result.creditedHours || 0,
                leaveEarlySeconds: result.leaveEarlySeconds || 0,
                clockedInAt: result.clockedInAt ? new Date(result.clockedInAt) : new Date(Date.now() - (result.elapsedMinutes || 0) * 60_000),
            })
            //start from what they said they'd do - easy to change
            setWorkedOn(result.intendedActivities || [])
        } else {
            setMessage({text: result.detail || "Something went wrong.", error: true})
        }
    }

    async function handleConfirm() {
        if (!preview || worked.length === 0) return
        setBusy(true)
        setMessage(null)
        const result = await clockOut(studentId.trim(), worked.map((activity, i) => ({activity, fraction: fractions[i]})), !!leaveEarlyFor)
        setBusy(false)
        if (result?.success) {
            const leftEarly = result.leftEarlySeconds ? ` (left early with ${formatDuration(result.leftEarlySeconds)} of unused break)` : ""
            setMessage({text: `Clocked out ${result.besaName || ""} - ${result.hoursThisSession} hour(s) this session${leftEarly}.`, error: false})
            setStudentId("")
            setLeaveEarlyFor(null)
            reset()
            onChanged()
        } else {
            setMessage({text: result?.detail || "Something went wrong.", error: true})
        }
    }

    return (
        <section ref={panelRef} className="bg-gray-800 rounded-2xl p-6 scroll-mt-20">
            <h2 className="text-2xl tracking-wide mb-4 text-center">{leaveEarlyFor ? "Leave Early" : "Clock Out"}</h2>
            {leaveEarlyFor &&
                <div className="rounded-xl bg-emerald-900/50 border border-emerald-700 p-3 mb-4 text-sm flex items-start gap-3">
                    <p className="flex-1 text-emerald-100">
                        <span className="font-semibold">{leaveEarlyFor.besaName || "This BESA"}</span> is leaving early with their unused break
                        time (about {formatDuration(leaveEarlyFor.break.remainingSeconds)}). They're credited as if they'd stayed that much
                        longer, and today's break time is used up.
                    </p>
                    <button onClick={() => { setLeaveEarlyFor(null); reset(); setMessage(null) }} disabled={busy}
                        className="text-xs px-3 py-1.5 rounded-full bg-gray-600 hover:bg-gray-500 disabled:opacity-40">
                        Cancel
                    </button>
                </div>
            }
            {preview === null ?
                <>
                    <label className="block text-sm text-gray-400 mb-1">Enter School Id</label>
                    <input
                        ref={idInputRef}
                        value={studentId}
                        onChange={(e) => setStudentId(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") void handleNext() }}
                        placeholder="Ex: 1234567"
                        className="w-full p-3 rounded-xl bg-gray-700 text-white mb-4"
                    />
                    {message && <p className={"text-sm text-center mb-3 " + (message.error ? "text-red-400" : "text-green-400")}>{message.text}</p>}
                    <button
                        onClick={() => void handleNext()}
                        disabled={busy || !studentId.trim()}
                        className="w-full py-3 rounded-full bg-blue-800 hover:bg-blue-900 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2 mb-6"
                    >
                        {busy && <MoonLoader color="white" size={16}/>}
                        Next
                    </button>
                </>
                :
                <div className="mb-6">
                    <p className="text-center text-sm text-gray-300 mb-1">
                        <span className="font-semibold text-white">{preview.besaName}</span> · in for {Math.round(preview.elapsedMinutes)} min
                        {preview.leaveEarlySeconds > 0 &&
                            <span className="text-emerald-300"> + {Math.round(preview.leaveEarlySeconds / 60)} min unused break · credited {preview.creditedHours} h</span>
                        }
                    </p>
                    <h3 className="text-lg tracking-wide text-center mb-1">What activities did you actually work on?</h3>
                    <p className="text-xs text-gray-400 text-center mb-3">
                        Pick everything you worked on, then drag the dividers so the bar matches how your time was split.
                    </p>
                    <div className="flex flex-wrap gap-2 justify-center mb-4">
                        {choices.map(name => (
                            <ActivityChip key={name} label={name} selected={worked.includes(name)}
                                onClick={() => setWorkedOn(worked.includes(name) ? worked.filter(a => a !== name) : [...worked, name])}/>
                        ))}
                    </div>
                    {worked.length === 0 ?
                        <p className="text-sm text-gray-400 text-center mb-3">Pick at least one activity you actually worked on.</p>
                        :
                        <div className="mb-4">
                            <ActivitySplitBar activities={worked} fractions={fractions} onChange={setFractions}
                                totalMinutes={preview.elapsedMinutes} colorOrder={choices} startTime={preview.clockedInAt}/>
                        </div>
                    }
                    {message && <p className={"text-sm text-center mb-3 " + (message.error ? "text-red-400" : "text-green-400")}>{message.text}</p>}
                    <div className="flex gap-2">
                        <button onClick={() => { reset(); setMessage(null) }} disabled={busy}
                            className="flex-1 py-3 rounded-full border-solid border-2 border-gray-400 hover:bg-gray-700 disabled:opacity-40">
                            Back
                        </button>
                        <button onClick={() => void handleConfirm()} disabled={busy || worked.length === 0}
                            className="flex-[2] py-3 rounded-full bg-blue-800 hover:bg-blue-900 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2">
                            {busy && <MoonLoader color="white" size={16}/>}
                            {leaveEarlyFor ? "Confirm Leave Early" : "Confirm Clock Out"}
                        </button>
                    </div>
                </div>
            }

            <hr className="border-gray-700 mb-4"/>
            <h3 className="text-lg tracking-wide mb-3">Current Sessions</h3>
            <BreakCriteria className="mb-3"/>
            {sessions === null ?
                <div className="flex justify-center py-6"><MoonLoader color="white" size={24}/></div>
                : sessions.length === 0 ?
                <p className="text-gray-500 italic text-sm">Nobody is currently clocked in.</p>
                :
                <div className="flex flex-col gap-2">
                    {sessions.map(s => <SessionRow key={s.uid} session={s} onChanged={onChanged} onLeaveEarly={() => startLeaveEarly(s)}/>)}
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
//minutes at a time or everything left at once, shown as {time left}/{today's total} - or leave early with it.
function SessionRow({session, onChanged, onLeaveEarly}: {session: KioskSession, onChanged: () => void, onLeaveEarly: () => void}) {
    const brk = session.break
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState("")
    const [confirmCancelTour, setConfirmCancelTour] = useState(false)
    const [noteOpen, setNoteOpen] = useState(false)
    const [noteText, setNoteText] = useState("")
    const {onBreak, breakLeft, breakRanOut, remaining, resetNow} = useLiveBreak(brk)!

    //the break ran out on its own - pull fresh state so the buttons come back
    useEffect(() => {
        if (breakRanOut) onChanged()
    }, [breakRanOut, onChanged])

    async function run(action: () => Promise<{success: boolean, detail?: string}>): Promise<boolean> {
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
        return result.success
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
                        <button onClick={onLeaveEarly} disabled={busy}
                            title="Leave now and use the unused break time instead - credited as if they'd stayed that much longer"
                            className="text-xs px-3 py-1.5 rounded-full bg-emerald-700 hover:bg-emerald-800 disabled:opacity-40">
                            Leave Early ({formatDuration(remaining)})
                        </button>
                    </div>
                }
            </div>
            <SessionNotes notes={session.notes}/>
            {noteOpen ?
                <div className="flex flex-col gap-2">
                    <textarea value={noteText} onChange={(e) => setNoteText(e.target.value)} disabled={busy} autoFocus
                        maxLength={NOTE_MAX_LENGTH} rows={2} placeholder="Add a note or comment about this visit..."
                        className="w-full p-2 rounded-lg bg-gray-800 text-white text-sm"/>
                    <div className="flex items-center gap-2">
                        <span className="text-[11px] text-gray-500 flex-1">{noteText.length}/{NOTE_MAX_LENGTH}</span>
                        <button onClick={() => { setNoteOpen(false); setNoteText("") }} disabled={busy}
                            className="text-xs px-3 py-1.5 rounded-full bg-gray-600 hover:bg-gray-500 disabled:opacity-40">
                            Cancel
                        </button>
                        <button disabled={busy || !noteText.trim()}
                            onClick={() => void run(() => addSessionNote(session.uid, noteText)).then(ok => {
                                if (ok) { setNoteOpen(false); setNoteText("") }
                            })}
                            className="text-xs px-3 py-1.5 rounded-full bg-blue-800 hover:bg-blue-900 disabled:opacity-40">
                            Save Note
                        </button>
                    </div>
                </div>
                :
                <button onClick={() => setNoteOpen(true)} disabled={busy}
                    className="self-start flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full bg-gray-600 hover:bg-gray-500 disabled:opacity-40">
                    <FaPlus size={10}/> Add a note/comment
                </button>
            }
            {session.canCancelTour &&
                <div className="flex items-center gap-2 flex-wrap border-t border-gray-600 pt-2">
                    <button onClick={() => setConfirmCancelTour(true)} disabled={busy}
                        className="text-xs px-3 py-1.5 rounded-full bg-red-800 hover:bg-red-900 disabled:opacity-40 whitespace-nowrap">
                        Canceled Tour
                    </button>
                    <span className="text-xs text-yellow-300/90 flex-1 min-w-[12rem]">
                        ⚠ {CANCELED_TOUR_WARNING} <span className="text-gray-400">{CANCELED_TOUR_WHEN_SHOWN}</span>
                    </span>
                </div>
            }
            {error && <p className="text-red-400 text-xs">{error}</p>}

            {confirmCancelTour &&
                <Loading onClose={busy ? undefined : () => setConfirmCancelTour(false)}>
                    <div className="bg-gray-900 w-11/12 sm:w-2/3 md:w-1/3 max-w-md p-5 rounded-2xl text-center">
                        <h3 className="text-2xl mb-2 text-red-500">Was your tour canceled?</h3>
                        <p className="text-sm text-gray-300 mb-1">
                            {session.besaName ? `${session.besaName}, you` : "You"} will be logged out for the day.
                        </p>
                        <p className="text-sm text-yellow-300/90">⚠ {CANCELED_TOUR_WARNING}</p>
                        <p className="text-xs text-gray-400 mt-1">{CANCELED_TOUR_WHEN_SHOWN}</p>
                        <button
                            onClick={() => void run(() => canceledTour(session.uid)).then(() => setConfirmCancelTour(false))}
                            disabled={busy}
                            className="rounded-full w-full mt-4 p-2 bg-red-800 hover:bg-red-900 disabled:opacity-40 flex items-center justify-center gap-2">
                            {busy && <MoonLoader color="white" size={16}/>}
                            Yes, my tour was canceled - log me out with 30 minutes
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
