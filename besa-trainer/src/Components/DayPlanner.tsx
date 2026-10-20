import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react"
import { FaTrash } from "react-icons/fa"
import { HOURS_REQUEST_REASONS } from "../Tools/Fetch"
import { fromDateKey, startOfWeek, toDateKey } from "../Tools/dates"
import {
    DAY_MINUTES, DEFAULT_LENGTH, DETAILS_MAX_LENGTH, HOUR_PX, SNAP, dayLabel, formatLength, formatMinutes, fromHHMM, toHHMM,
    type Block, type Draft, type FixedBlock
} from "../Tools/dayPlanner"

//the day-timeline editor shared by a member's Request Hours and root admin's Edit Anyone's Hours: a calendar to
//pick the day, the day's timeline to draw/drag ranges on, and an editor per range.

//the pickable days (firstDay-lastDay, YYYY-MM-DD) as Sun-Sat weeks. dotsFor gives each day's marker colors.
export function PlannerCalendar({firstDay, lastDay, selectedDay, dotsFor, onSelect}: {
    firstDay: string, lastDay: string, selectedDay: string, dotsFor: (day: string) => string[], onSelect: (day: string) => void
}) {
    const weeks: string[][] = []
    for (let week = startOfWeek(fromDateKey(firstDay)); toDateKey(week) <= lastDay; week.setDate(week.getDate() + 7)) {
        weeks.push(Array.from({length: 7}, (_, i) => {
            const d = new Date(week)
            d.setDate(d.getDate() + i)
            return toDateKey(d)
        }))
    }
    const short = (key: string) => fromDateKey(key).toLocaleDateString("en-US", {month: "short", day: "numeric"})

    return (
        <div className="rounded-xl border border-gray-700 p-2 sm:p-3 bg-gray-900/40">
            <p className="text-sm font-semibold text-center mb-2">{short(firstDay)} – {short(lastDay)}</p>
            <div className="grid grid-cols-7 gap-1 text-[11px] text-gray-500 text-center mb-1">
                {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => <span key={i}>{d}</span>)}
            </div>
            <div className="grid grid-cols-7 gap-1">
                {weeks.flat().map(key => {
                    const inWindow = key >= firstDay && key <= lastDay
                    const date = fromDateKey(key)
                    const dots = inWindow ? dotsFor(key) : []
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

export function Legend({items}: {items: [className: string, label: string][]}) {
    return (
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-400 mt-2">
            {items.map(([className, label]) => (
                <span key={label} className="flex items-center gap-1.5"><span className={"w-3 h-3 rounded-sm " + className}/>{label}</span>
            ))}
        </div>
    )
}

type DragState = {kind: "create", anchor: number} | {kind: "start" | "end", id: number} | {kind: "move", id: number, offset: number, length: number}

//the selected day, midnight to midnight, in a scroll box. `fixed` blocks can't be changed here; the editable
//ranges can be drawn (drag on empty time with a mouse, or tap on a phone so the box still scrolls with a
//finger), resized by their top/bottom handles, and moved by dragging them (mouse).
export function DayTimeline({fixed, drafts, problems, nowMinutes, isToday, onCreate, onChange}: {
    fixed: FixedBlock[]
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
        const earliest = Math.min(7 * 60, ...fixed.map(b => b.start), ...drafts.map(b => b.start))
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
                    {/* time that hasn't happened yet can't be logged */}
                    {isToday &&
                        <div className="absolute inset-x-0 bottom-0 bg-gray-950/60 pointer-events-none flex items-start justify-center border-t-2 border-red-500"
                            style={{top: top(nowMinutes)}}>
                            <span className="text-[11px] text-red-300 mt-1">Now</span>
                        </div>
                    }
                    {fixed.map((b, i) => (
                        <div key={`f${i}`} className={"absolute left-1 right-1 rounded-md text-[11px] text-white px-2 overflow-hidden pointer-events-none " + b.className}
                            style={{top: top(b.start), height: height(b)}}>
                            {b.label} · {formatMinutes(b.start)} – {formatMinutes(b.end)}
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

//one editable range: exact times and what was worked on, plus why it wasn't clocked (mode "request", a member's
//Request Hours) or an optional note (mode "admin", root admin editing a member's day)
export function DraftEditor({index, draft, problem, activityTypes, maxMinutes, disabled, mode, onChange, onRemove}: {
    index: number, draft: Draft, problem: string | null, activityTypes: string[], maxMinutes: number, disabled: boolean
    mode: "request" | "admin", onChange: (draft: Draft) => void, onRemove: () => void
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
                {(draft.tags || []).map(tag => (
                    <span key={tag} className="text-[10px] px-1.5 py-0.5 rounded font-semibold bg-gray-600 text-gray-100">{tag}</span>
                ))}
                <button onClick={onRemove} disabled={disabled} aria-label={`Remove range ${index + 1}`}
                    className="ml-auto p-2 rounded-full bg-gray-700 hover:bg-red-800 disabled:opacity-40">
                    <FaTrash size={11}/>
                </button>
            </div>

            <p className="text-xs text-gray-400 mb-1.5">{mode === "admin" ? "What was worked on?" : "What did you work on?"}</p>
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

            {mode === "request" && <>
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
            </>}
            <textarea value={draft.details} disabled={disabled} maxLength={DETAILS_MAX_LENGTH} rows={mode === "admin" ? 1 : 2}
                onChange={(e) => onChange({...draft, details: e.target.value})}
                placeholder={mode === "admin" ? "Note on this visit (optional - the member sees it)"
                    : draft.reason === "other" ? "What happened? (required)" : "Anything the admin should know? (optional)"}
                className="w-full p-2 rounded-lg bg-gray-700 text-white text-sm"/>
            {problem && <p className="text-red-400 text-xs mt-1">{problem}</p>}
        </div>
    )
}

