import { useEffect, useRef, useState } from "react"
import { MoonLoader } from "react-spinners"
import Header from "../Components/Header"
import OfficeTimeDisclaimer from "../Components/OfficeTimeDisclaimer"
import BreakCriteria from "../Components/BreakCriteria"
import { formatDuration, useLiveBreak } from "../Tools/breaks"
import { Loading } from "../Components/SectionEditor/Edit"
import SessionNotes from "../Components/SessionNotes"
import ActivitySplitBar from "../Components/ActivitySplitBar"
import TaskNoteCard, { TaskNotesGroup } from "../Components/TaskNoteCard"
import { evenFractions } from "../Tools/activityColors"
import { FaPlus } from "react-icons/fa"
import {
    addActivityType, addSessionNote, canceledTour, checkTaskNoteItem, clockIn, clockOut, clockOutPreview, endBreak, getActivityTypes, getClockInOptions, getCurrentSessions,
    removeActivityType, startBreak, type KioskSession, type TaskNote
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
        <div className="bg-be-navy-darker w-full min-h-screen text-white font-sans">
            <Header/>
            <div className="h-20 relative top-0 left-0 w-full"></div>
            <div className="w-5/6 max-w-3xl mx-auto py-10 flex flex-col gap-8">
                <ClockInPanel onClockedIn={() => refreshSessions()}/>
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
            className={"px-4 py-2 rounded-full text-sm font-bold transition-colors " +
                (selected ? "bg-be-orange text-black" : "bg-be-navy text-white hover:bg-be-navy-dark")}
        >
            {label}
        </button>
    )
}

//a task a BESA Lead assigned this person (Assign Tasks) - ringed, with "Lead recommended" under the name
function RecommendedChip({label, selected, onClick}: {label: string, selected: boolean, onClick: () => void}) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={"px-4 py-1.5 rounded-2xl text-sm font-bold flex flex-col items-center leading-tight ring-2 ring-be-yellow transition-colors " +
                (selected ? "bg-be-orange text-black" : "bg-be-navy text-white hover:bg-be-navy-dark")}
        >
            {label}
            <span className={"text-[10px] font-medium uppercase tracking-wide " + (selected ? "text-black/80" : "text-be-yellow")}>Lead recommended</span>
        </button>
    )
}

//how long after the last keystroke the School Id is looked up
const LOOKUP_DELAY_MS = 400

type ClockInLookup =
    | {status: "loading"}
    | {status: "found", besaName: string, tasks: string[], recommended: string[], alreadyClockedIn: boolean, taskNotes: TaskNote[]}
    | {status: "error", detail: string}

//School Id, then every task to pick from - the ones a BESA Lead assigned that person (Assign Tasks) come first,
//highlighted as Lead recommended, and picking one opens the lead's note on it. The lookup runs a moment after
//they stop typing.
function ClockInPanel({onClockedIn}: {onClockedIn: () => void}) {
    const [studentId, setStudentId] = useState("")
    const [lookup, setLookup] = useState<ClockInLookup | null>(null)
    const [selected, setSelected] = useState<string[]>([])
    const [busy, setBusy] = useState(false)
    const [message, setMessage] = useState<{text: string, error: boolean} | null>(null)
    const lookupTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
    const latestId = useRef("")

    useEffect(() => () => { if (lookupTimer.current) clearTimeout(lookupTimer.current) }, [])

    function changeStudentId(value: string) {
        setStudentId(value)
        setSelected([])
        setMessage(null)
        if (lookupTimer.current) clearTimeout(lookupTimer.current)
        const id = value.trim()
        latestId.current = id
        if (!id) {
            setLookup(null)
            return
        }
        setLookup({status: "loading"})
        lookupTimer.current = setTimeout(async () => {
            const result = await getClockInOptions(id)
            if (latestId.current !== id) return // they kept typing - a newer lookup is on its way
            setLookup(result.success
                ? {status: "found", besaName: result.besaName || "", tasks: result.tasks || [], recommended: result.recommended || [], alreadyClockedIn: !!result.alreadyClockedIn, taskNotes: result.taskNotes || []}
                : {status: "error", detail: result.detail || "Something went wrong."})
        }, LOOKUP_DELAY_MS)
    }

    function toggleActivity(name: string) {
        setSelected(prev => prev.includes(name) ? prev.filter(a => a !== name) : [...prev, name])
    }

    //every clock-in has to say what they came in to work on
    const canSubmit = lookup?.status === "found" && !lookup.alreadyClockedIn && selected.length > 0

    async function handleSubmit() {
        if (!canSubmit) return
        setBusy(true)
        setMessage(null)
        const result = await clockIn(studentId.trim(), selected)
        if (result?.success) {
            setMessage({text: `Clocked in ${result.besaName || ""}.`, error: false})
            setStudentId("")
            setLookup(null)
            latestId.current = ""
            setSelected([])
            onClockedIn()
        } else {
            setMessage({text: result?.detail || "Something went wrong.", error: true})
        }
        setBusy(false)
    }

    return (
        <section className="bg-be-navy rounded-2xl p-6 border-t-4 border-be-orange shadow-md">
            <h2 className="text-2xl font-bold tracking-wide mb-4 text-center">Clock In</h2>
            <OfficeTimeDisclaimer className="mb-4 text-center"/>
            <label className="block text-sm text-be-light-gray mb-1 font-medium">Enter School Id</label>
            <input
                value={studentId}
                onChange={(e) => changeStudentId(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") void handleSubmit() }}
                placeholder="Ex: 1234567"
                className="w-full p-3 rounded-xl bg-be-navy-darker text-white border border-be-light-gray/30 mb-4"
            />
            {lookup?.status === "loading" &&
                <div className="flex justify-center mb-4"><MoonLoader color="white" size={20}/></div>
            }
            {lookup?.status === "error" &&
                <p className="text-sm text-center text-red-400 mb-4">{lookup.detail}</p>
            }
            {lookup?.status === "found" && <>
                <label className="block text-sm text-be-light-gray mb-2 text-center">
                    <span className="text-white font-bold">{lookup.besaName}</span> - what are you working on? <span className="text-red-400">*</span>
                </label>
                {lookup.alreadyClockedIn ?
                    <p className="text-sm text-center text-be-yellow mb-4">{lookup.besaName} is already clocked in.</p>
                    : <>
                        <div className="flex flex-wrap gap-2 justify-center items-center mb-4">
                            {lookup.recommended.map(name => (
                                <RecommendedChip key={name} label={name} selected={selected.includes(name)} onClick={() => toggleActivity(name)}/>
                            ))}
                            {lookup.tasks.filter(name => !lookup.recommended.includes(name)).map(name => (
                                <ActivityChip key={name} label={name} selected={selected.includes(name)} onClick={() => toggleActivity(name)}/>
                            ))}
                        </div>
                        {selected.length === 0 &&
                            <p className="text-xs text-be-light-gray text-center mb-3">Pick at least one task you intend to work on to clock in.</p>
                        }
                        {/* the leads' guidance on the tasks they picked - it's checked off from Current Sessions */}
                        {lookup.taskNotes.some(note => selected.includes(note.task)) &&
                            <div className="flex flex-col gap-2 mb-4">
                                {lookup.taskNotes.filter(note => selected.includes(note.task)).map(note => <TaskNoteCard key={note.task} note={note} defaultOpen/>)}
                            </div>
                        }
                    </>
                }
            </>}
            {message && <p className={"text-sm text-center mb-3 " + (message.error ? "text-red-400" : "text-green-400")}>{message.text}</p>}
            <button
                onClick={() => void handleSubmit()}
                disabled={busy || !canSubmit}
                className="w-full py-3 rounded-full bg-be-orange hover:bg-be-orange-dark text-black font-bold disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2 transition-colors"
            >
                {busy && <MoonLoader color="black" size={16}/>}
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

    //lock the page behind the popup so scrolling stays inside it
    useEffect(() => {
        if (!preview) return
        const previous = document.body.style.overflow
        document.body.style.overflow = "hidden"
        return () => { document.body.style.overflow = previous }
    }, [preview])

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
        <section ref={panelRef} className="bg-be-navy rounded-2xl p-6 scroll-mt-24 border-t-4 border-be-orange shadow-md">
            <h2 className="text-2xl font-bold tracking-wide mb-4 text-center">{leaveEarlyFor ? "Leave Early" : "Clock Out"}</h2>
            {leaveEarlyFor &&
                <div className="rounded-xl bg-emerald-900/50 border border-emerald-700 p-3 mb-4 text-sm flex items-start gap-3">
                    <p className="flex-1 text-emerald-100">
                        <span className="font-bold">{leaveEarlyFor.besaName || "This BESA"}</span> is leaving early with their unused break
                        time (about {formatDuration(leaveEarlyFor.break.remainingSeconds)}). They're credited as if they'd stayed that much
                        longer, and today's break time is used up.
                    </p>
                    <button onClick={() => { setLeaveEarlyFor(null); reset(); setMessage(null) }} disabled={busy}
                        className="text-xs px-3 py-1.5 rounded-full bg-be-navy-darker hover:bg-be-navy-dark disabled:opacity-40">
                        Cancel
                    </button>
                </div>
            }
            <label className="block text-sm text-be-light-gray mb-1 font-medium">Enter School Id</label>
            <input
                ref={idInputRef}
                value={studentId}
                onChange={(e) => setStudentId(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !preview) void handleNext() }}
                disabled={!!preview}
                placeholder="Ex: 1234567"
                className="w-full p-3 rounded-xl bg-be-navy-darker text-white border border-be-light-gray/30 mb-4"
            />
            {message && !preview && <p className={"text-sm text-center mb-3 " + (message.error ? "text-red-400" : "text-green-400")}>{message.text}</p>}
            <button
                onClick={() => void handleNext()}
                disabled={busy || !studentId.trim() || !!preview}
                className="w-full py-3 rounded-full bg-be-orange hover:bg-be-orange-dark text-black font-bold disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2 mb-6 transition-colors"
            >
                {busy && !preview && <MoonLoader color="black" size={16}/>}
                Next
            </button>

            {/* step 2 is a popup over a dark backdrop, not an in-place swap - in place it looked just like the School
                Id step, so people kept pressing straight through it. Only Back or Confirm closes it. */}
            {preview &&
                <div role="dialog" aria-modal="true" aria-labelledby="worked-on-title"
                    onKeyDown={(e) => { if (e.key === "Escape" && !busy) { reset(); setMessage(null) } }}
                    className="fixed inset-0 z-[100] bg-black/85 backdrop-blur-sm flex items-center justify-center p-3 sm:p-6">
                    {/* the body scrolls on its own and the Back/Confirm row stays pinned to the bottom, so Confirm is
                        always on screen no matter how many activities are picked */}
                    <div className="bg-gray-900 border-2 border-amber-500 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[92dvh] flex flex-col overflow-hidden">
                        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-5 sm:p-7 pb-3 sm:pb-3">
                            <p className="text-center text-sm text-gray-300 mb-2">
                                {leaveEarlyFor ? "Leave Early" : "Clock Out"} · <span className="font-semibold text-white">{preview.besaName}</span> · in for {Math.round(preview.elapsedMinutes)} min
                                {preview.leaveEarlySeconds > 0 &&
                                    <span className="text-emerald-300"> + {Math.round(preview.leaveEarlySeconds / 60)} min unused break · credited {preview.creditedHours} h</span>
                                }
                            </p>
                            <h3 id="worked-on-title" className="text-2xl sm:text-3xl font-semibold text-amber-400 text-center mb-2">
                                What did you actually work on?
                            </h3>
                            <p className="text-sm text-gray-300 text-center mb-5">
                                Pick everything you worked on, then drag the dividers so the bar matches how your time was split.
                            </p>
                            <div className="flex flex-wrap gap-2 justify-center mb-5">
                                {choices.map(name => (
                                    <ActivityChip key={name} label={name} selected={worked.includes(name)}
                                        onClick={() => setWorkedOn(worked.includes(name) ? worked.filter(a => a !== name) : [...worked, name])}/>
                                ))}
                            </div>
                            {worked.length === 0 ?
                                <p className="text-sm text-gray-400 text-center mb-2">Pick at least one activity you actually worked on.</p>
                                :
                                <div className="mb-2">
                                    <ActivitySplitBar activities={worked} fractions={fractions} onChange={setFractions}
                                        totalMinutes={preview.elapsedMinutes} colorOrder={choices} startTime={preview.clockedInAt}/>
                                </div>
                            }
                            {message && <p className={"text-sm text-center " + (message.error ? "text-red-400" : "text-green-400")}>{message.text}</p>}
                        </div>
                        <div className="shrink-0 flex gap-2 px-5 sm:px-7 py-4 border-t border-gray-700 bg-gray-900">
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
        <section className="bg-be-navy rounded-2xl p-6 border-t-4 border-be-orange shadow-md">
            <h2 className="text-2xl font-bold tracking-wide mb-4 text-center">Add / Remove Activities</h2>
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
                    className="flex-1 p-3 rounded-xl bg-be-navy-darker text-white border border-be-light-gray/30"
                />
                <button
                    onClick={() => void handleAdd()}
                    disabled={busy || !newName.trim()}
                    className="px-5 py-2 rounded-full bg-be-orange hover:bg-be-orange-dark text-black font-bold disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                    Add
                </button>
                <button
                    onClick={() => void handleDelete()}
                    disabled={busy || !selected}
                    className="px-5 py-2 rounded-full bg-red-800 hover:bg-red-900 font-bold disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
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
            {/* the leads' notes on what they clocked in for - all behind one closed dropdown */}
            {(session.taskNotes || []).length > 0 &&
                <TaskNotesGroup notes={session.taskNotes || []}>
                    {(session.taskNotes || []).map(note => (
                        <TaskNoteCard key={note.task} note={note} defaultOpen onToggle={async (itemId, done) => {
                            const result = await checkTaskNoteItem(note.task, itemId, done, session.uid)
                            if (result.success) onChanged()
                            return result.success ? null : result.detail || "Couldn't save that."
                        }}/>
                    ))}
                </TaskNotesGroup>
            }
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
