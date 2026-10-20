import { useEffect, useRef, useState, type JSX } from "react"
import { MoonLoader } from "react-spinners"
import { FaPlus } from "react-icons/fa"
import { getActivityTypes, getMemberDays, setMemberDay, type MemberDays, type MemberVisit } from "../Tools/Fetch"
import {
    DAY_MINUTES, creditedHours, dayLabel, firstFreeRange, isoBlock, overlaps, pacificMinutes, toHHMM,
    type Draft, type FixedBlock
} from "../Tools/dayPlanner"
import { DayTimeline, DraftEditor, Legend, PlannerCalendar } from "./DayPlanner"

//a stored visit as an editable range - its id comes from its index, so it stays the same across renders
function visitDraft(v: MemberVisit): Draft {
    const tags = [
        v.autoClockedOut && "AUTO", v.canceledTour && "CANCELED TOUR", v.leftEarlySeconds > 0 && "LEFT EARLY",
        v.requested && "REQUESTED", v.adminEdited && "ADMIN",
    ].filter(Boolean) as string[]
    return {id: -(v.index + 1), ...isoBlock(v.start, v.end), activities: v.activities, reason: "", details: v.adminNote, source: v.index, tags}
}

//what saving would send - also how an edited day is told apart from the stored one
function editKey(drafts: Draft[]): string {
    return JSON.stringify(drafts.map(d => [d.source ?? null, d.start, d.end, d.activities, d.details.trim()]))
}

//root admin only (Profile) - the Request Hours calendar and timeline, pointed at any member's days and with
//nothing to approve: every visit on the day can be moved, resized, deleted or added, then the day is saved at
//once. Shortening or deleting visits lowers the day's hours; the total is re-rounded from what's left.
export default function RootHoursEditor({members, onSaved, onSessionExpired}: {
    members: {uid: string, besaName?: string}[] | null
    onSaved: () => void
    onSessionExpired: () => void
}): JSX.Element {
    const [uid, setUid] = useState("")
    const [view, setView] = useState<MemberDays | null>(null)
    const [loading, setLoading] = useState(false)
    const [selectedDay, setSelectedDay] = useState<string | null>(null)
    //only days that have been touched - the rest come straight from `view`
    const [editedDays, setEditedDays] = useState<Record<string, Draft[]>>({})
    const [activityTypes, setActivityTypes] = useState<string[]>([])
    const [busy, setBusy] = useState(false)
    const [message, setMessage] = useState<{text: string, error: boolean} | null>(null)
    const nextDraftId = useRef(1)

    useEffect(() => {
        getActivityTypes().then(result => setActivityTypes(result || []))
    }, [])

    const storedDrafts = (day: string) => (view?.days[day]?.visits || []).map(visitDraft)
    const isDirty = (day: string) => editedDays[day] !== undefined && editKey(editedDays[day]) !== editKey(storedDrafts(day))
    const unsavedDays = Object.keys(editedDays).filter(isDirty)

    async function pickMember(next: string) {
        if (unsavedDays.length > 0 && !window.confirm(`Discard unsaved changes to ${unsavedDays.length === 1 ? "1 day" : `${unsavedDays.length} days`}?`)) return
        setUid(next)
        setView(null)
        setEditedDays({})
        setMessage(null)
        if (!next) return
        setLoading(true)
        const result = await getMemberDays(next)
        setLoading(false)
        if (result.success) {
            setView(result)
            setSelectedDay(result.lastDay)
        } else if (result.status === 403) {
            onSessionExpired()
        } else {
            setMessage({text: result.detail, error: true})
        }
    }

    const sorted = [...(members || [])].sort((a, b) => (a.besaName || "").localeCompare(b.besaName || ""))

    return (
        <section className="bg-gray-800 rounded-2xl p-3 sm:p-6">
            <h2 className="text-2xl tracking-wide mb-2">Edit Anyone's Hours</h2>
            <p className="text-sm text-gray-400 mb-4">
                Pick a member and a day, then add, drag, resize or delete their visits on the timeline (tap on a phone to add one).
                Nothing needs approving - Save Day applies it, and the day's hours are recalculated from the visits, so shortening
                or removing time lowers them.
            </p>
            <label className="block text-sm text-gray-400 mb-1">Member</label>
            <div className="flex items-center gap-3 mb-4">
                <select value={uid} disabled={members === null || busy} onChange={(e) => void pickMember(e.target.value)}
                    className="w-full sm:w-72 p-2 px-3 rounded-xl bg-gray-700 text-white disabled:opacity-60">
                    <option value="">{members === null ? "Loading members..." : "Choose a member"}</option>
                    {sorted.map(m => <option key={m.uid} value={m.uid}>{m.besaName || "(no name on file)"}</option>)}
                </select>
                {loading && <MoonLoader color="white" size={18}/>}
            </div>
            {message && !view && <p className={"text-sm " + (message.error ? "text-red-400" : "text-green-400")}>{message.text}</p>}
            {view && selectedDay &&
                <DayEditor view={view} day={selectedDay} drafts={editedDays[selectedDay] ?? storedDrafts(selectedDay)}
                    dirty={isDirty(selectedDay)} unsavedDays={unsavedDays} activityTypes={activityTypes} busy={busy} message={message}
                    newId={() => nextDraftId.current++}
                    onSelectDay={(day) => { setSelectedDay(day); setMessage(null) }}
                    onChange={(drafts) => setEditedDays(prev => ({...prev, [selectedDay]: drafts}))}
                    onReset={() => setEditedDays(prev => {
                        const next = {...prev}
                        delete next[selectedDay]
                        return next
                    })}
                    onSave={async (drafts) => {
                        setBusy(true)
                        setMessage(null)
                        const result = await setMemberDay(view.uid, selectedDay, drafts.map(d => ({
                            source: d.source, start: toHHMM(d.start), end: toHHMM(d.end), activities: d.activities, note: d.details.trim(),
                        })))
                        setBusy(false)
                        if (result.success) {
                            const before = view.days[selectedDay]?.hours ?? 0
                            const after = result.days[selectedDay]?.hours ?? 0
                            setView(result)
                            setEditedDays(prev => {
                                const next = {...prev}
                                delete next[selectedDay]
                                return next
                            })
                            setMessage({text: `Saved ${view.besaName || "their"} ${dayLabel(selectedDay)} - ${before} → ${after} hours.`, error: false})
                            onSaved()
                        } else if (result.status === 403) {
                            onSessionExpired()
                        } else {
                            setMessage({text: result.detail, error: true})
                        }
                    }}/>
            }
        </section>
    )
}

function DayEditor({view, day, drafts, dirty, unsavedDays, activityTypes, busy, message, newId, onSelectDay, onChange, onReset, onSave}: {
    view: MemberDays, day: string, drafts: Draft[], dirty: boolean, unsavedDays: string[], activityTypes: string[], busy: boolean
    message: {text: string, error: boolean} | null, newId: () => number
    onSelectDay: (day: string) => void, onChange: (drafts: Draft[]) => void, onReset: () => void, onSave: (drafts: Draft[]) => Promise<void>
}) {
    const stored = view.days[day]
    const isToday = day === view.lastDay
    const nowMinutes = isToday ? pacificMinutes(new Date()) : DAY_MINUTES

    const openStart = view.openSession && toDayKey(view.openSession.start) === day ? pacificMinutes(new Date(view.openSession.start)) : null
    const inProgress = openStart !== null ? {start: openStart, end: Math.max(openStart + 1, nowMinutes)} : null
    const fixed: FixedBlock[] = [
        ...(inProgress ? [{...inProgress, label: "Clocked in now", className: "bg-green-700/80"}] : []),
        ...view.pending.filter(p => p.date === day).map(p => ({
            ...isoBlock(p.start, p.end), label: "Request waiting", className: "border-2 border-dashed border-amber-400 bg-amber-500/30",
        })),
    ]

    const problems = drafts.map(d => {
        if (d.end <= d.start) return "The end time has to be after the start time."
        if (d.end > nowMinutes) return "This goes past the current time."
        if (inProgress && overlaps(inProgress, d)) return "This overlaps the visit they're clocked in for right now."
        if (drafts.some(o => o.id !== d.id && overlaps(o, d))) return "This overlaps another visit on this day."
        if (d.activities.length === 0) return "Pick what was worked on."
        return null
    })

    //the day's new total, rounded the way the backend does it (left-early break time still counts)
    const leftEarly = (d: Draft) => d.source !== undefined ? stored?.visits.find(v => v.index === d.source)?.leftEarlySeconds || 0 : 0
    const hoursBefore = stored?.hours ?? 0
    const hoursAfter = creditedHours(drafts.reduce((sum, d) => sum + Math.max(0, d.end - d.start) * 60 + leftEarly(d), 0))

    function addDraft(start: number, end: number) {
        const last = drafts[drafts.length - 1]
        onChange([...drafts, {id: newId(), start, end, activities: last?.activities || [], reason: "", details: ""}])
    }

    return (
        <div className="grid gap-4 grid-cols-[minmax(0,1fr)] lg:grid-cols-[17rem_minmax(0,1fr)] items-start">
            <div>
                <PlannerCalendar firstDay={view.firstDay} lastDay={view.lastDay} selectedDay={day}
                    dotsFor={(key) => [
                        (view.days[key]?.visits.length || 0) > 0 && "bg-gray-400",
                        unsavedDays.includes(key) && "bg-blue-500",
                        view.pending.some(p => p.date === key) && "bg-amber-500",
                    ].filter(Boolean) as string[]}
                    onSelect={onSelectDay}/>
                {unsavedDays.length > 0 &&
                    <p className="text-xs text-blue-300 mt-2">Unsaved: {unsavedDays.sort().map(d => dayLabel(d, "short")).join(", ")}</p>
                }
            </div>
            <div className="min-w-0">
                <div className="flex items-center justify-between gap-2 mb-2">
                    <h3 className="font-semibold">{view.besaName || "(no name on file)"} · {dayLabel(day)}{isToday && <span className="text-gray-400 font-normal"> · today</span>}</h3>
                    <button onClick={() => {
                        const range = firstFreeRange([...fixed, ...drafts], nowMinutes)
                        addDraft(range.start, range.end)
                    }} disabled={busy || nowMinutes < 15}
                        className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full bg-gray-700 hover:bg-gray-600 disabled:opacity-40">
                        <FaPlus size={9}/> Add visit
                    </button>
                </div>
                {stored?.handSet &&
                    <p className="text-xs text-amber-300 mb-2">
                        This day's total ({stored.hours} h) was set by hand or is a canceled tour's 30 minutes. Saving replaces it with the visits' time.
                    </p>
                }
                <DayTimeline key={`${view.uid}-${day}`} fixed={fixed} drafts={drafts} problems={problems} nowMinutes={nowMinutes} isToday={isToday}
                    onCreate={addDraft} onChange={(id, block) => onChange(drafts.map(d => d.id === id ? {...d, ...block} : d))}/>
                <Legend items={[["bg-blue-600", "Visit (editable)"], ["bg-green-700", "Clocked in now"], ["bg-amber-500/70", "Request waiting"]]}/>

                {drafts.length === 0 &&
                    <p className="text-gray-500 italic text-sm mt-3">{dirty ? "Every visit on this day will be deleted." : "No visits logged on this day."}</p>
                }
                {drafts.length > 0 &&
                    <div className="flex flex-col gap-3 mt-4">
                        {drafts.map((d, i) => (
                            <DraftEditor key={d.id} index={i} draft={d} problem={problems[i]} activityTypes={activityTypes}
                                maxMinutes={nowMinutes} disabled={busy} mode="admin"
                                onChange={(next) => onChange(drafts.map(o => o.id === d.id ? next : o))}
                                onRemove={() => onChange(drafts.filter(o => o.id !== d.id))}/>
                        ))}
                    </div>
                }

                <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-sm">
                    <span className="text-gray-300">
                        Day total: <span className="font-semibold text-white">{hoursBefore} h</span>
                        {dirty && hoursAfter !== hoursBefore &&
                            <> → <span className={"font-semibold " + (hoursAfter < hoursBefore ? "text-red-300" : "text-green-300")}>{hoursAfter} h</span></>
                        }
                    </span>
                </div>
                {message && <p className={"text-sm mt-2 " + (message.error ? "text-red-400" : "text-green-400")}>{message.text}</p>}
                {dirty &&
                    <div className="flex gap-2 mt-3">
                        <button onClick={onReset} disabled={busy}
                            className="flex-1 py-3 rounded-full border-2 border-gray-400 hover:bg-gray-700 disabled:opacity-40">
                            Undo Changes
                        </button>
                        <button onClick={() => void onSave(drafts)} disabled={busy || problems.some(p => p)}
                            className="flex-[2] py-3 rounded-full bg-blue-800 hover:bg-blue-900 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2">
                            {busy && <MoonLoader color="white" size={16}/>}
                            Save Day
                        </button>
                    </div>
                }
            </div>
        </div>
    )
}

//an ISO time's Pacific calendar day, YYYY-MM-DD
function toDayKey(iso: string): string {
    return new Date(iso).toLocaleDateString("en-CA", {timeZone: "America/Los_Angeles"})
}
