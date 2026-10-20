import { useEffect, useRef, useState, type JSX, type PointerEvent as ReactPointerEvent, type ReactNode } from "react"
import { MoonLoader } from "react-spinners"
import { FaPlus, FaTrash } from "react-icons/fa"
import {
    cancelHoursRequest, getActivityTypes, getMyHoursRequests, submitHoursRequests, HOURS_REQUEST_REASONS,
    type HoursRequest, type MyHoursRequests
} from "../Tools/Fetch"
import { fromDateKey, startOfWeek, toDateKey } from "../Tools/dates"

//the day view: a whole day top to bottom, scrolled to the morning to start
const HOUR_PX = 44
const DAY_MINUTES = 24 * 60
const SNAP = 15 // dragging snaps to quarter hours - the time boxes below can be set to any minute
const DEFAULT_LENGTH = 60 // a tap (or a click without dragging) adds an hour
const DETAILS_MAX_LENGTH = 500 // same cap as the backend's HOURS_REQUEST_DETAILS_MAX_LENGTH

type Draft = {id: number, start: number, end: number, activities: string[], reason: string, details: string}
type Block = {start: number, end: number}

//minutes past midnight, Pacific - every time in the app is Pacific, like the kiosk and the backend
function pacificMinutes(date: Date): number {
    const parts = new Intl.DateTimeFormat("en-US", {hour: "numeric", minute: "numeric", hourCycle: "h23", timeZone: "America/Los_Angeles"}).formatToParts(date)
    const get = (type: string) => Number(parts.find(p => p.type === type)?.value || 0)
    return get("hour") * 60 + get("minute")
}

//540 -> "9:00 AM", 1440 -> "12:00 AM" (midnight at the end of the day)
function formatMinutes(minutes: number): string {
    const h = Math.floor(minutes / 60) % 24
    const m = minutes % 60
    return `${h % 12 === 0 ? 12 : h % 12}:${m.toString().padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`
}

function formatLength(minutes: number): string {
    const h = Math.floor(minutes / 60)
    const m = minutes % 60
    return h && m ? `${h}h ${m}m` : h ? `${h}h` : `${m}m`
}

//minutes <-> the "HH:MM" an <input type="time"> and the backend use ("24:00" for the end of the day)
function toHHMM(minutes: number): string {
    return `${Math.floor(minutes / 60).toString().padStart(2, "0")}:${(minutes % 60).toString().padStart(2, "0")}`
}

function fromHHMM(value: string): number | null {
    const [h, m] = value.split(":").map(Number)
    return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null
}

function overlaps(a: Block, b: Block): boolean {
    return a.start < b.end && b.start < a.end
}

function dayLabel(key: string, weekday: "short" | "long" = "long"): string {
    return fromDateKey(key).toLocaleDateString("en-US", {weekday, month: "short", day: "numeric"})
}

const STATUS_STYLE: Record<HoursRequest["status"], string> = {
    pending: "bg-amber-500 text-black",
    approved: "bg-green-600 text-black",
    denied: "bg-red-500 text-black",
}

//besa/besaLead only (Profile) - ask for hours they weren't clocked in for. Pick a day on the calendar, draw one
//or more time ranges on that day's timeline (drag, or tap on a phone), say what was worked on and why it wasn't
//clocked, and send them to the root admin. Approved ones are added to that day like a kiosk visit.
export default function HoursRequestPanel(): JSX.Element {
    const [view, setView] = useState<MyHoursRequests | null | undefined>(undefined) // undefined = loading, null = failed
    const [activityTypes, setActivityTypes] = useState<string[]>([])
    const [selectedDay, setSelectedDay] = useState<string | null>(null)
    const [draftsByDay, setDraftsByDay] = useState<Record<string, Draft[]>>({})
    const [busy, setBusy] = useState(false)
    const [message, setMessage] = useState<{text: string, error: boolean} | null>(null)
    const nextDraftId = useRef(1)

    useEffect(() => {
        getMyHoursRequests().then(result => {
            if (result.success) {
                setView(result)
                setSelectedDay(result.lastDay)
            } else {
                setView(null)
            }
        })
        getActivityTypes().then(result => setActivityTypes(result || []))
    }, [])

    if (view === undefined) {
        return <Section><div className="flex justify-center py-10"><MoonLoader color="white" size={24}/></div></Section>
    }
    if (view === null || !selectedDay) {
        return <Section><p className="text-red-400 text-sm">Couldn't load hours requests - try again later.</p></Section>
    }

    const drafts = draftsByDay[selectedDay] || []
    const setDrafts = (next: Draft[]) => setDraftsByDay(prev => ({...prev, [selectedDay]: next}))
    const isToday = selectedDay === view.lastDay
    const nowMinutes = isToday ? pacificMinutes(new Date()) : DAY_MINUTES

    const logged: Block[] = (view.logged[selectedDay] || []).map(l => ({
        start: pacificMinutes(new Date(l.start)),
        end: l.end ? pacificMinutes(new Date(l.end)) || DAY_MINUTES : nowMinutes,
    }))
    const dayRequests = view.requests.filter(r => r.date === selectedDay)
    const toBlock = (r: HoursRequest): Block => ({start: pacificMinutes(new Date(r.start)), end: pacificMinutes(new Date(r.end)) || DAY_MINUTES})
    const pendingBlocks = dayRequests.filter(r => r.status === "pending").map(toBlock)

    //what's wrong with each draft, if anything - shown under it, and Send stays off until none are left
    const problems = drafts.map(d => {
        if (d.end <= d.start) return "The end time has to be after the start time."
        if (d.end > nowMinutes) return "This goes past the current time."
        if (logged.some(b => overlaps(b, d))) return "This overlaps time that's already logged."
        if (pendingBlocks.some(b => overlaps(b, d))) return "This overlaps a request you've already sent."
        if (drafts.some(o => o.id !== d.id && overlaps(o, d))) return "This overlaps another range on this day."
        if (d.activities.length === 0) return "Pick what you worked on."
        if (d.reason === "other" && !d.details.trim()) return "Say what happened (the reason is \"Other\")."
        return null
    })

    function addDraft(start: number, end: number) {
        const lastDraft = drafts[drafts.length - 1]
        setDrafts([...drafts, {
            id: nextDraftId.current++, start, end,
            //later ranges start from the previous one's answers - usually the same activities and reason
            activities: lastDraft?.activities || [], reason: lastDraft?.reason || "forgotClockIn", details: "",
        }])
        setMessage(null)
    }

    async function send() {
        if (!selectedDay || drafts.length === 0 || problems.some(p => p)) return
        setBusy(true)
        setMessage(null)
        const result = await submitHoursRequests(selectedDay, drafts.map(d => ({
            start: toHHMM(d.start), end: toHHMM(d.end), activities: d.activities, reason: d.reason, details: d.details.trim(),
        })))
        setBusy(false)
        if (result.success) {
            setView(result)
            setDrafts([])
            setMessage({text: `Sent ${drafts.length === 1 ? "your request" : `${drafts.length} requests`} for ${dayLabel(selectedDay)} - they'll show up in My Hours once approved.`, error: false})
        } else {
            setMessage({text: result.detail, error: true})
        }
    }

    async function cancel(request: HoursRequest) {
        setBusy(true)
        setMessage(null)
        const result = await cancelHoursRequest(request.id)
        setBusy(false)
        if (result.success) {
            setView(result)
        } else {
            setMessage({text: result.detail, error: true})
        }
    }

    return (
        <Section>
            <p className="text-sm text-gray-400 mb-4">
                Forgot to clock in, or worked outside the office? Pick the day, drag on its timeline to mark when you worked (tap on
                a phone), then say what you worked on and why. A root admin approves each request before it's added to your hours.
            </p>
            <div className="grid gap-4 grid-cols-[minmax(0,1fr)] lg:grid-cols-[17rem_minmax(0,1fr)] items-start">
                <RequestCalendar view={view} selectedDay={selectedDay} draftsByDay={draftsByDay}
                    onSelect={(day) => { setSelectedDay(day); setMessage(null) }}/>
                <div className="min-w-0">
                    <div className="flex items-center justify-between gap-2 mb-2">
                        <h3 className="font-semibold">{dayLabel(selectedDay)}{isToday && <span className="text-gray-400 font-normal"> · today</span>}</h3>
                        <button onClick={() => {
                            //the first free hour from 9 AM on, so the button never lands on top of logged time
                            const taken = [...logged, ...pendingBlocks, ...drafts]
                            let start = 9 * 60
                            while (start + DEFAULT_LENGTH <= nowMinutes && taken.some(b => overlaps(b, {start, end: start + DEFAULT_LENGTH}))) start += SNAP
                            if (start + DEFAULT_LENGTH > nowMinutes) start = Math.max(0, Math.floor((nowMinutes - DEFAULT_LENGTH) / SNAP) * SNAP)
                            addDraft(start, Math.min(start + DEFAULT_LENGTH, nowMinutes))
                        }} disabled={busy || nowMinutes < SNAP}
                            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full bg-gray-700 hover:bg-gray-600 disabled:opacity-40">
                            <FaPlus size={9}/> Add time range
                        </button>
                    </div>
                    <DayTimeline key={selectedDay} logged={logged} requests={dayRequests.map(r => ({...toBlock(r), status: r.status}))}
                        drafts={drafts} problems={problems} nowMinutes={nowMinutes} isToday={isToday}
                        onCreate={addDraft} onChange={(id, block) => setDrafts(drafts.map(d => d.id === id ? {...d, ...block} : d))}/>
                    <Legend/>

                    {drafts.length > 0 &&
                        <div className="flex flex-col gap-3 mt-4">
                            {drafts.map((d, i) => (
                                <DraftEditor key={d.id} index={i} draft={d} problem={problems[i]} activityTypes={activityTypes}
                                    maxMinutes={nowMinutes} disabled={busy}
                                    onChange={(next) => setDrafts(drafts.map(o => o.id === d.id ? next : o))}
                                    onRemove={() => setDrafts(drafts.filter(o => o.id !== d.id))}/>
                            ))}
                        </div>
                    }
                    {message && <p className={"text-sm mt-3 " + (message.error ? "text-red-400" : "text-green-400")}>{message.text}</p>}
                    {drafts.length > 0 &&
                        <button onClick={() => void send()} disabled={busy || problems.some(p => p)}
                            className="w-full mt-3 py-3 rounded-full bg-blue-800 hover:bg-blue-900 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2">
                            {busy && <MoonLoader color="white" size={16}/>}
                            Send {drafts.length === 1 ? "Request" : `${drafts.length} Requests`} for Approval
                        </button>
                    }
                </div>
            </div>

            <h3 className="font-semibold mt-6 mb-2">My Requests</h3>
            {view.requests.length === 0 ?
                <p className="text-gray-500 italic text-sm">You haven't sent any requests recently.</p>
                :
                <div className="flex flex-col gap-2">
                    {view.requests.map(r => <RequestRow key={r.id} request={r} busy={busy} onCancel={() => void cancel(r)}/>)}
                </div>
            }
        </Section>
    )
}

function Section({children}: {children: ReactNode}) {
    return (
        <section className="bg-gray-800 rounded-2xl p-3 sm:p-6">
            <h2 className="text-2xl tracking-wide mb-2">Request Hours</h2>
            {children}
        </section>
    )
}

function Legend() {
    const item = (className: string, label: string) => (
        <span className="flex items-center gap-1.5"><span className={"w-3 h-3 rounded-sm " + className}/>{label}</span>
    )
    return (
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-400 mt-2">
            {item("bg-gray-500", "Clocked in")}
            {item("bg-blue-600", "New request")}
            {item("bg-amber-500/70", "Waiting for approval")}
            {item("bg-green-600/70", "Approved")}
        </div>
    )
}

//the days hours can be requested for (this and the last pay period, up to today) as Sun-Sat weeks. Dots mark
//days with logged visits, unsent ranges, and pending/approved requests.
function RequestCalendar({view, selectedDay, draftsByDay, onSelect}: {
    view: MyHoursRequests, selectedDay: string, draftsByDay: Record<string, Draft[]>, onSelect: (day: string) => void
}) {
    const first = startOfWeek(fromDateKey(view.firstDay))
    const lastKey = view.lastDay
    const weeks: string[][] = []
    for (let week = new Date(first); toDateKey(week) <= lastKey; week.setDate(week.getDate() + 7)) {
        weeks.push(Array.from({length: 7}, (_, i) => {
            const d = new Date(week)
            d.setDate(d.getDate() + i)
            return toDateKey(d)
        }))
    }

    return (
        <div className="rounded-xl border border-gray-700 p-2 sm:p-3 bg-gray-900/40">
            <p className="text-sm font-semibold text-center mb-2">
                {fromDateKey(view.firstDay).toLocaleDateString("en-US", {month: "short", day: "numeric"})} – {fromDateKey(lastKey).toLocaleDateString("en-US", {month: "short", day: "numeric"})}
            </p>
            <div className="grid grid-cols-7 gap-1 text-[11px] text-gray-500 text-center mb-1">
                {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => <span key={i}>{d}</span>)}
            </div>
            <div className="grid grid-cols-7 gap-1">
                {weeks.flat().map(key => {
                    const inWindow = key >= view.firstDay && key <= lastKey
                    const date = fromDateKey(key)
                    const requests = view.requests.filter(r => r.date === key)
                    const dots = [
                        (view.logged[key] || []).length > 0 && "bg-gray-400",
                        (draftsByDay[key] || []).length > 0 && "bg-blue-500",
                        requests.some(r => r.status === "pending") && "bg-amber-500",
                        requests.some(r => r.status === "approved") && "bg-green-500",
                    ].filter(Boolean) as string[]
                    return (
                        <button key={key} disabled={!inWindow} onClick={() => onSelect(key)}
                            aria-label={dayLabel(key)} aria-pressed={key === selectedDay}
                            className={"aspect-square rounded-lg flex flex-col items-center justify-center gap-0.5 text-sm " +
                                (key === selectedDay ? "bg-amber-500 text-black font-semibold" : inWindow ? "bg-gray-700 hover:bg-gray-600" : "text-gray-600 cursor-not-allowed")}>
                            <span>{date.getDate() === 1 ? date.toLocaleDateString("en-US", {month: "short"}) + " 1" : date.getDate()}</span>
                            <span className="flex gap-0.5 h-1.5">
                                {dots.map(c => <span key={c} className={"w-1.5 h-1.5 rounded-full " + (key === selectedDay ? "bg-black/70" : c)}/>)}
                            </span>
                        </button>
                    )
                })}
            </div>
        </div>
    )
}

type DragState = {kind: "create", anchor: number} | {kind: "start" | "end", id: number} | {kind: "move", id: number, offset: number, length: number}

//the selected day, midnight to midnight, in a scroll box. Logged visits and sent requests are fixed blocks;
//unsent ranges can be drawn (drag on empty time with a mouse, or tap on a phone so the box still scrolls with a
//finger), resized by their top/bottom handles, and moved by dragging them (mouse).
function DayTimeline({logged, requests, drafts, problems, nowMinutes, isToday, onCreate, onChange}: {
    logged: Block[]
    requests: (Block & {status: HoursRequest["status"]})[]
    drafts: Draft[]
    problems: (string | null)[]
    nowMinutes: number
    isToday: boolean
    onCreate: (start: number, end: number) => void
    onChange: (id: number, block: Block) => void
}) {
    const scrollRef = useRef<HTMLDivElement>(null)
    const dayRef = useRef<HTMLDivElement>(null)
    const drag = useRef<DragState | null>(null)
    const tap = useRef<{x: number, y: number} | null>(null)
    const [preview, setPreview] = useState<Block | null>(null)

    //open on the morning, or earlier if something's already there
    useEffect(() => {
        const earliest = Math.min(7 * 60, ...logged.map(b => b.start), ...requests.map(b => b.start), ...drafts.map(b => b.start))
        if (scrollRef.current) scrollRef.current.scrollTop = Math.max(0, earliest / 60 * HOUR_PX - 12)
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    const clamp = (m: number) => Math.max(0, Math.min(nowMinutes, m))
    const snap = (m: number) => Math.round(m / SNAP) * SNAP

    function minutesAt(e: ReactPointerEvent) {
        const rect = dayRef.current!.getBoundingClientRect()
        return (e.clientY - rect.top) / HOUR_PX * 60
    }

    //a range starting at `start`, an hour long if there's room before now, otherwise whatever's left
    function defaultRange(start: number): Block {
        const s = clamp(Math.min(snap(start), nowMinutes - SNAP))
        return {start: s, end: clamp(s + DEFAULT_LENGTH)}
    }

    function onBackgroundDown(e: ReactPointerEvent<HTMLDivElement>) {
        if (e.button !== 0 || e.target !== e.currentTarget || nowMinutes < SNAP) return
        if (e.pointerType === "touch") {
            //a finger might be scrolling - only a tap (handled on pointer up) adds a range
            tap.current = {x: e.clientX, y: e.clientY}
            return
        }
        e.preventDefault() // no text selection while drawing
        drag.current = {kind: "create", anchor: clamp(snap(minutesAt(e)))}
        e.currentTarget.setPointerCapture(e.pointerId)
    }

    function startHandleDrag(e: ReactPointerEvent<HTMLElement>, state: DragState) {
        if (e.button !== 0) return
        e.preventDefault()
        e.stopPropagation()
        drag.current = state
        //captured on the day column so its move/up handlers keep getting the pointer
        dayRef.current!.setPointerCapture(e.pointerId)
    }

    function onMove(e: ReactPointerEvent<HTMLDivElement>) {
        const state = drag.current
        if (!state) return
        const at = clamp(snap(minutesAt(e)))
        if (state.kind === "create") {
            setPreview(at === state.anchor ? null : {start: Math.min(at, state.anchor), end: Math.max(at, state.anchor)})
            return
        }
        const draft = drafts.find(d => d.id === state.id)
        if (!draft) return
        if (state.kind === "start") onChange(draft.id, {start: Math.min(at, draft.end - SNAP), end: draft.end})
        else if (state.kind === "end") onChange(draft.id, {start: draft.start, end: Math.max(at, draft.start + SNAP)})
        else if (state.kind === "move") {
            const start = Math.max(0, Math.min(nowMinutes - state.length, snap(minutesAt(e) - state.offset)))
            onChange(draft.id, {start, end: start + state.length})
        }
    }

    function onUp(e: ReactPointerEvent<HTMLDivElement>) {
        const state = drag.current
        drag.current = null
        if (state?.kind === "create") {
            //a click without dragging adds an hour from there
            const range = preview ?? defaultRange(state.anchor)
            setPreview(null)
            if (range.end > range.start) onCreate(range.start, range.end)
        }
        if (tap.current && e.pointerType === "touch") {
            const moved = Math.hypot(e.clientX - tap.current.x, e.clientY - tap.current.y)
            tap.current = null
            const range = defaultRange(minutesAt(e))
            if (moved < 10 && e.target === e.currentTarget && range.end > range.start) onCreate(range.start, range.end)
        }
    }

    function cancelGesture() {
        drag.current = null
        tap.current = null
        setPreview(null)
    }

    const top = (m: number) => m / 60 * HOUR_PX
    const height = (b: Block) => Math.max(6, (b.end - b.start) / 60 * HOUR_PX)

    return (
        <div ref={scrollRef} className="h-[26rem] overflow-y-auto overscroll-contain rounded-xl border border-gray-700 bg-gray-900/40 select-none">
            <div className="relative flex" style={{height: 24 * HOUR_PX}}>
                {/* hour labels */}
                <div className="w-14 shrink-0 relative text-[11px] text-gray-500">
                    {Array.from({length: 24}, (_, h) => (
                        <span key={h} className="absolute right-2 -translate-y-1/2" style={{top: top(h * 60)}}>
                            {h === 0 ? "" : formatMinutes(h * 60).replace(":00", "")}
                        </span>
                    ))}
                </div>
                <div ref={dayRef} className="relative flex-1 cursor-crosshair touch-pan-y"
                    onPointerDown={onBackgroundDown} onPointerMove={onMove} onPointerUp={onUp}
                    onPointerCancel={cancelGesture} onLostPointerCapture={() => { if (drag.current) cancelGesture() }}>
                    {Array.from({length: 24}, (_, h) => (
                        <div key={h} className="absolute inset-x-0 border-t border-gray-700/70 pointer-events-none" style={{top: top(h * 60)}}/>
                    ))}
                    {/* time that hasn't happened yet can't be requested */}
                    {isToday &&
                        <div className="absolute inset-x-0 bottom-0 bg-gray-950/60 pointer-events-none flex items-start justify-center border-t-2 border-red-500"
                            style={{top: top(nowMinutes)}}>
                            <span className="text-[11px] text-red-300 mt-1">Now</span>
                        </div>
                    }
                    {logged.map((b, i) => (
                        <div key={`l${i}`} className="absolute left-1 right-1 rounded-md bg-gray-500/80 text-[11px] text-white px-2 overflow-hidden pointer-events-none"
                            style={{top: top(b.start), height: height(b)}}>
                            Clocked in · {formatMinutes(b.start)} – {formatMinutes(b.end)}
                        </div>
                    ))}
                    {requests.filter(r => r.status !== "denied").map((b, i) => (
                        <div key={`r${i}`} className={"absolute left-1 right-1 rounded-md border-2 border-dashed text-[11px] text-white px-2 overflow-hidden pointer-events-none " +
                            (b.status === "pending" ? "border-amber-400 bg-amber-500/30" : "border-green-400 bg-green-600/30")}
                            style={{top: top(b.start), height: height(b)}}>
                            {b.status === "pending" ? "Waiting for approval" : "Approved"} · {formatMinutes(b.start)} – {formatMinutes(b.end)}
                        </div>
                    ))}
                    {drafts.map((d, i) => (
                        <div key={d.id}
                            onPointerDown={(e) => { if (e.pointerType !== "touch") startHandleDrag(e, {kind: "move", id: d.id, offset: minutesAt(e) - d.start, length: d.end - d.start}) }}
                            className={"absolute left-1 right-1 rounded-md bg-blue-600/90 text-[11px] text-white px-2 overflow-hidden cursor-grab active:cursor-grabbing " +
                                (problems[i] ? "ring-2 ring-red-400" : "ring-1 ring-blue-300")}
                            style={{top: top(d.start), height: height(d)}}>
                            <span className="font-semibold">#{i + 1}</span> · {formatMinutes(d.start)} – {formatMinutes(d.end)} · {formatLength(Math.max(0, d.end - d.start))}
                            {/* resize handles - touch-none so dragging one with a finger doesn't scroll the box */}
                            <span onPointerDown={(e) => startHandleDrag(e, {kind: "start", id: d.id})} aria-hidden="true"
                                className="absolute inset-x-0 -top-1 h-3 cursor-ns-resize touch-none flex justify-center items-center">
                                <span className="w-8 h-1 rounded-full bg-white/90"/>
                            </span>
                            <span onPointerDown={(e) => startHandleDrag(e, {kind: "end", id: d.id})} aria-hidden="true"
                                className="absolute inset-x-0 -bottom-1 h-3 cursor-ns-resize touch-none flex justify-center items-center">
                                <span className="w-8 h-1 rounded-full bg-white/90"/>
                            </span>
                        </div>
                    ))}
                    {preview &&
                        <div className="absolute left-1 right-1 rounded-md bg-blue-500/50 border-2 border-blue-300 text-[11px] text-white px-2 pointer-events-none"
                            style={{top: top(preview.start), height: height(preview)}}>
                            {formatMinutes(preview.start)} – {formatMinutes(preview.end)}
                        </div>
                    }
                </div>
            </div>
        </div>
    )
}

//one unsent range: exact times, what was worked on, and why it wasn't clocked
function DraftEditor({index, draft, problem, activityTypes, maxMinutes, disabled, onChange, onRemove}: {
    index: number, draft: Draft, problem: string | null, activityTypes: string[], maxMinutes: number, disabled: boolean
    onChange: (draft: Draft) => void, onRemove: () => void
}) {
    //keep a picked activity selectable even if it's since been removed from the shared list
    const chips = [...new Set([...activityTypes, ...draft.activities])]
    const setTime = (field: "start" | "end", value: string) => {
        const minutes = fromHHMM(value)
        if (minutes !== null) onChange({...draft, [field]: minutes})
    }

    return (
        <div className={"rounded-xl border p-3 bg-gray-900/40 " + (problem ? "border-red-500/60" : "border-gray-700")}>
            <div className="flex items-center gap-2 flex-wrap mb-3">
                <span className="text-sm font-semibold text-blue-300">#{index + 1}</span>
                <input type="time" value={toHHMM(draft.start)} disabled={disabled} aria-label="Start time"
                    onChange={(e) => setTime("start", e.target.value)}
                    className="p-1.5 px-2 rounded-lg bg-gray-700 text-white text-sm [color-scheme:dark]"/>
                <span className="text-gray-400 text-sm">to</span>
                <input type="time" value={toHHMM(Math.min(draft.end, DAY_MINUTES - 1))} disabled={disabled} aria-label="End time"
                    max={maxMinutes < DAY_MINUTES ? toHHMM(maxMinutes) : undefined}
                    onChange={(e) => setTime("end", e.target.value)}
                    className="p-1.5 px-2 rounded-lg bg-gray-700 text-white text-sm [color-scheme:dark]"/>
                <span className="text-sm text-gray-400">{draft.end > draft.start ? formatLength(draft.end - draft.start) : ""}</span>
                <button onClick={onRemove} disabled={disabled} aria-label={`Remove range ${index + 1}`}
                    className="ml-auto p-2 rounded-full bg-gray-700 hover:bg-red-800 disabled:opacity-40">
                    <FaTrash size={11}/>
                </button>
            </div>

            <p className="text-xs text-gray-400 mb-1.5">What did you work on?</p>
            <div className="flex flex-wrap gap-1.5 mb-3">
                {chips.map(name => {
                    const selected = draft.activities.includes(name)
                    return (
                        <button key={name} type="button" disabled={disabled}
                            onClick={() => onChange({...draft, activities: selected ? draft.activities.filter(a => a !== name) : [...draft.activities, name]})}
                            className={"px-3 py-1 rounded-full text-xs font-semibold " + (selected ? "bg-amber-500 text-black" : "bg-gray-700 text-gray-200 hover:bg-gray-600")}>
                            {name}
                        </button>
                    )
                })}
            </div>

            <p className="text-xs text-gray-400 mb-1.5">Why wasn't it clocked?</p>
            <div className="flex flex-wrap gap-1.5 mb-2">
                {Object.entries(HOURS_REQUEST_REASONS).map(([key, label]) => (
                    <button key={key} type="button" disabled={disabled} aria-pressed={draft.reason === key}
                        onClick={() => onChange({...draft, reason: key})}
                        className={"px-3 py-1 rounded-full text-xs font-semibold " + (draft.reason === key ? "bg-sky-500 text-black" : "bg-gray-700 text-gray-200 hover:bg-gray-600")}>
                        {label}
                    </button>
                ))}
            </div>
            <textarea value={draft.details} disabled={disabled} maxLength={DETAILS_MAX_LENGTH} rows={2}
                onChange={(e) => onChange({...draft, details: e.target.value})}
                placeholder={draft.reason === "other" ? "What happened? (required)" : "Anything the admin should know? (optional)"}
                className="w-full p-2 rounded-lg bg-gray-700 text-white text-sm"/>
            {problem && <p className="text-red-400 text-xs mt-1">{problem}</p>}
        </div>
    )
}

function RequestRow({request, busy, onCancel}: {request: HoursRequest, busy: boolean, onCancel: () => void}) {
    const start = pacificMinutes(new Date(request.start))
    const end = pacificMinutes(new Date(request.end)) || DAY_MINUTES
    return (
        <div className="rounded-xl bg-gray-900/40 border border-gray-700 p-3 text-sm flex flex-wrap items-start gap-x-3 gap-y-1">
            <div className="flex-1 min-w-[12rem]">
                <p>
                    <span className="font-semibold">{dayLabel(request.date, "short")}</span>
                    <span className="text-gray-300"> · {formatMinutes(start)} – {formatMinutes(end)}</span>
                    <span className="text-gray-400"> · {formatLength(end - start)}</span>
                </p>
                <p className="text-gray-400">{request.activities.join(", ")} · {request.reasonLabel}</p>
                {request.details && <p className="text-gray-400 italic break-words">"{request.details}"</p>}
                {request.decisionNote && <p className="text-gray-300 break-words">Admin: {request.decisionNote}</p>}
            </div>
            <div className="flex items-center gap-2">
                <span className={"text-[10px] px-1.5 py-0.5 rounded font-semibold uppercase " + STATUS_STYLE[request.status]}>
                    {request.status === "pending" ? "Waiting" : request.status}
                </span>
                {request.status === "pending" &&
                    <button onClick={onCancel} disabled={busy}
                        className="text-xs px-3 py-1 rounded-full border border-gray-500 hover:bg-gray-700 disabled:opacity-40">
                        Cancel
                    </button>
                }
            </div>
        </div>
    )
}
