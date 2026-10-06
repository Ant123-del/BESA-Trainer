import { useLayoutEffect, useRef, useState, type JSX, type KeyboardEvent, type PointerEvent } from "react"
import { activityColor, textOn } from "../Tools/activityColors"

//smallest share any one activity can be squeezed to while dragging - unpick it instead to drop it entirely
const MIN_SHARE = 0.02

//divider time labels closer than this (px) would overlap, so they're spread across extra lines
const LABEL_MIN_GAP = 64
const LABEL_LINE_H = 16

//"1:05 PM" - Pacific, like every other time on the kiosk
function formatClock(date: Date): string {
    return date.toLocaleTimeString("en-US", {hour: "numeric", minute: "2-digit", timeZone: "America/Los_Angeles"})
}

function formatMinutes(minutes: number): string {
    const m = Math.round(minutes)
    return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`
}

//the clock-out "what did you actually work on" timeline: the visit as one bar split into a segment per picked
//activity, with a draggable divider between each pair (2 activities = 1 slider, 3 = 2, ...). Dividers snap to
//whole minutes of the visit and also move with the arrow keys (Shift = 5 minutes). fractions sum to 1.
//The visit's start and end times sit on either side of the bar, and each divider shows the time it falls at.
export default function ActivitySplitBar({activities, fractions, onChange, totalMinutes, colorOrder, startTime}: {
    activities: string[]
    fractions: number[]
    onChange: (fractions: number[]) => void
    totalMinutes: number
    colorOrder: string[]
    startTime: Date
}): JSX.Element {
    const barRef = useRef<HTMLDivElement>(null)
    const draggingRef = useRef<number | null>(null)
    const [barWidth, setBarWidth] = useState(0)

    useLayoutEffect(() => {
        if (!barRef.current) return
        const observer = new ResizeObserver(entries => setBarWidth(entries[0].contentRect.width))
        observer.observe(barRef.current)
        return () => observer.disconnect()
    }, [])

    const timeAt = (fraction: number) => new Date(startTime.getTime() + fraction * totalMinutes * 60_000)

    //cumulative right edge of each segment, so divider i sits at boundaries[i]
    const boundaries = fractions.slice(0, -1).reduce<number[]>((acc, f) => [...acc, (acc[acc.length - 1] ?? 0) + f], [])
    const minuteStep = totalMinutes >= 1 ? 1 / totalMinutes : 0.01

    function moveDivider(i: number, position: number) {
        const lower = (i === 0 ? 0 : boundaries[i - 1]) + MIN_SHARE
        const upper = (i === boundaries.length - 1 ? 1 : boundaries[i + 1]) - MIN_SHARE
        const snapped = Math.round(position / minuteStep) * minuteStep
        const clamped = Math.min(upper, Math.max(lower, snapped))
        const next = [...boundaries]
        next[i] = clamped
        const edges = [0, ...next, 1]
        onChange(edges.slice(1).map((edge, k) => edge - edges[k]))
    }

    function positionFromPointer(e: PointerEvent): number {
        const rect = barRef.current!.getBoundingClientRect()
        return (e.clientX - rect.left) / rect.width
    }

    function onKeyDown(i: number, e: KeyboardEvent) {
        const step = minuteStep * (e.shiftKey ? 5 : 1)
        if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
            e.preventDefault()
            moveDivider(i, boundaries[i] - step)
        } else if (e.key === "ArrowRight" || e.key === "ArrowUp") {
            e.preventDefault()
            moveDivider(i, boundaries[i] + step)
        }
    }

    //greedy: each divider's time label goes on the first line where it clears the last label already there,
    //so bunched-up dividers stack their labels instead of overlapping
    const lastOnLine: number[] = []
    const labelLine = boundaries.map(b => {
        const x = b * barWidth
        let line = lastOnLine.findIndex(prev => x - prev >= LABEL_MIN_GAP)
        if (line === -1) line = lastOnLine.length
        lastOnLine[line] = x
        return line
    })
    const labelLines = Math.max(1, lastOnLine.length)

    return (
        <div>
            <div className="flex items-center gap-2">
                <span className="text-xs text-gray-300 tabular-nums whitespace-nowrap shrink-0 text-right w-16" title="Clocked in">
                    {formatClock(startTime)}
                </span>
                <div ref={barRef} className="relative flex-1 h-11 select-none touch-none">
                    {/* segments - a 2px surface gap between them, square ends except the bar's outer corners */}
                    <div className="absolute inset-0 flex gap-[2px]">
                        {activities.map((name, i) => {
                            const color = activityColor(name, colorOrder)
                            const pct = fractions[i] * 100
                            return (
                                <div key={name} title={`${name}: ${formatMinutes(fractions[i] * totalMinutes)} (${Math.round(pct)}%)`}
                                    className={"h-full flex items-center justify-center overflow-hidden px-1 " +
                                        (i === 0 ? "rounded-l-lg " : "") + (i === activities.length - 1 ? "rounded-r-lg" : "")}
                                    style={{width: `${pct}%`, backgroundColor: color, color: textOn(color)}}>
                                    {/* inline label only when there's room - the list below always has it */}
                                    {pct >= 14 &&
                                        <span className="text-xs font-semibold whitespace-nowrap">{Math.round(pct)}% · {formatMinutes(fractions[i] * totalMinutes)}</span>
                                    }
                                </div>
                            )
                        })}
                    </div>
                    {/* one draggable divider between each pair of segments */}
                    {boundaries.map((b, i) => (
                        <div key={i}
                            role="slider" tabIndex={0}
                            aria-label={`Split between ${activities[i]} and ${activities[i + 1]}`}
                            aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(b * 100)}
                            aria-valuetext={`${activities[i]} ${Math.round(fractions[i] * 100)}%, ${activities[i + 1]} ${Math.round(fractions[i + 1] * 100)}%`}
                            onKeyDown={(e) => onKeyDown(i, e)}
                            onPointerDown={(e) => {
                                draggingRef.current = i
                                e.currentTarget.setPointerCapture(e.pointerId)
                            }}
                            onPointerMove={(e) => {
                                if (draggingRef.current === i) moveDivider(i, positionFromPointer(e))
                            }}
                            onPointerUp={() => { draggingRef.current = null }}
                            onPointerCancel={() => { draggingRef.current = null }}
                            className="absolute top-[-6px] bottom-[-6px] w-6 -ml-3 flex items-center justify-center cursor-ew-resize group outline-none"
                            style={{left: `${b * 100}%`}}>
                            <span className="h-full w-2 rounded-full bg-white shadow ring-2 ring-gray-900 group-hover:scale-x-125 group-focus-visible:ring-amber-400 transition-transform"/>
                        </div>
                    ))}
                </div>
                <span className="text-xs text-gray-300 tabular-nums whitespace-nowrap shrink-0 w-16" title="Clocking out">
                    {formatClock(timeAt(1))}
                </span>
            </div>

            {/* the time each divider falls at, right under it - moves as the dividers are dragged */}
            {boundaries.length > 0 &&
                <div className="flex gap-2" aria-hidden="true">
                    <span className="w-16 shrink-0"/>
                    <div className="relative flex-1" style={{height: labelLines * LABEL_LINE_H + 6}}>
                        {boundaries.map((b, i) => (
                            <span key={i} className="absolute -translate-x-1/2 flex flex-col items-center" style={{left: `${b * 100}%`, top: 0}}>
                                {/* the tick stretches down to whichever line this label landed on */}
                                <span className="w-px bg-gray-400" style={{height: 6 + labelLine[i] * LABEL_LINE_H}}/>
                                <span className="text-[11px] text-white font-semibold tabular-nums whitespace-nowrap leading-tight">{formatClock(timeAt(b))}</span>
                            </span>
                        ))}
                    </div>
                    <span className="w-16 shrink-0"/>
                </div>
            }

            {/* the always-visible breakdown: identity is never color alone */}
            <ul className="mt-3 flex flex-col gap-1">
                {activities.map((name, i) => (
                    <li key={name} className="flex items-center gap-2 text-sm">
                        <span className="w-3 h-3 rounded-sm shrink-0" style={{backgroundColor: activityColor(name, colorOrder)}}/>
                        <span className="flex-1 text-gray-200">{name}</span>
                        <span className="text-gray-400 tabular-nums">{Math.round(fractions[i] * 100)}%</span>
                        <span className="text-white font-semibold tabular-nums w-16 text-right">{formatMinutes(fractions[i] * totalMinutes)}</span>
                    </li>
                ))}
            </ul>
        </div>
    )
}
