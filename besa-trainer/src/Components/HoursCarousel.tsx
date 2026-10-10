import { useRef, useState, type JSX } from "react"
import { FaChevronLeft, FaChevronRight } from "react-icons/fa"
import type { OfficeScheduleDay } from "../Tools/Fetch"
import { fromDateKey, startOfWeek, toDateKey } from "../Tools/dates"
import WeeklyHoursTable, { type OpenSession, type WeeklyHoursEntry } from "./WeeklyHoursTable"
import type { DayNoteHandlers } from "./DayNotes"
import OfficeHoursTable from "./OfficeHoursTable"

//hours run in fixed two-week periods (the backend's PAY_PERIOD_ANCHOR/_period_start) - week 1 and week 2
const WEEKS_PER_PERIOD = 2

function formatRange(start: Date): string {
    const end = new Date(start)
    end.setDate(end.getDate() + 6)
    const fmt = (d: Date) => d.toLocaleDateString("en-US", {month: "short", day: "numeric"})
    return `${fmt(start)} – ${fmt(end)}`
}

function weekLabel(weekStart: Date): string {
    const offset = Math.round((weekStart.getTime() - startOfWeek(new Date()).getTime()) / (7 * 24 * 3600 * 1000))
    return offset === 0 ? "This Week" : offset === 1 ? "Next Week" : offset === -1 ? "Last Week" : ""
}

//one member's logged hours beside their BESA Booking office hours for the current two-week period, flipped a
//week at a time (arrows, the dots, or a swipe on a phone). Both tables always show the same week. Opens on the
//week containing today. periodStart (YYYY-MM-DD) comes from the backend; until it arrives this week is week 1.
export default function HoursCarousel({entries, openSession, schedule, onEditDay, dayNoteHandlers, copyActivities, periodStart}: {
    entries: WeeklyHoursEntry[]
    openSession?: OpenSession | null
    schedule: OfficeScheduleDay[] | null | undefined
    onEditDay?: (day: WeeklyHoursEntry) => void
    dayNoteHandlers?: DayNoteHandlers
    copyActivities?: boolean
    periodStart?: string
}): JSX.Element {
    const firstWeek = periodStart ? fromDateKey(periodStart) : startOfWeek(new Date())
    const weekStarts = Array.from({length: WEEKS_PER_PERIOD}, (_, i) => startOfWeek(firstWeek, i))
    const todaysWeek = weekStarts.findIndex(w => w.getTime() === startOfWeek(new Date()).getTime())
    const [chosen, setChosen] = useState<number | null>(null)
    const index = chosen ?? Math.max(0, todaysWeek)
    const touchStartX = useRef<number | null>(null)

    const weekStart = weekStarts[index]
    const weekKeys = Array.from({length: 7}, (_, i) => {
        const d = new Date(weekStart)
        d.setDate(d.getDate() + i)
        return toDateKey(d)
    })
    const weekSchedule = schedule ? schedule.filter(d => weekKeys.includes(d.date)) : schedule

    const periodEnd = startOfWeek(firstWeek, WEEKS_PER_PERIOD)
    const periodTotal = entries
        .filter(e => e.date >= firstWeek && e.date < periodEnd)
        .reduce((sum, e) => sum + e.hours, 0)

    function go(next: number) {
        setChosen(Math.max(0, Math.min(WEEKS_PER_PERIOD - 1, next)))
    }

    return (
        <div
            onTouchStart={(e) => { touchStartX.current = e.touches[0].clientX }}
            onTouchEnd={(e) => {
                if (touchStartX.current === null) return
                const dx = e.changedTouches[0].clientX - touchStartX.current
                if (Math.abs(dx) > 60) go(index + (dx < 0 ? 1 : -1))
                touchStartX.current = null
            }}
        >
            <div className="flex items-center justify-between gap-2 mb-3">
                <button onClick={() => go(index - 1)} disabled={index === 0} aria-label="Previous week"
                    className="p-2 rounded-full bg-gray-700 hover:bg-gray-600 disabled:opacity-30 disabled:cursor-not-allowed">
                    <FaChevronLeft size={12}/>
                </button>
                <div className="text-center">
                    <p className="font-semibold text-sm">Week {index + 1} of {WEEKS_PER_PERIOD}{weekLabel(weekStart) && ` · ${weekLabel(weekStart)}`}</p>
                    <p className="text-xs text-gray-400">{formatRange(weekStart)}</p>
                    <div className="flex justify-center gap-1.5 mt-1">
                        {weekStarts.map((_, i) => (
                            <button key={i} onClick={() => go(i)} aria-label={`Week ${i + 1}`}
                                className={"w-2 h-2 rounded-full " + (i === index ? "bg-amber-500" : "bg-gray-600 hover:bg-gray-500")}/>
                        ))}
                    </div>
                </div>
                <button onClick={() => go(index + 1)} disabled={index === WEEKS_PER_PERIOD - 1} aria-label="Next week"
                    className="p-2 rounded-full bg-gray-700 hover:bg-gray-600 disabled:opacity-30 disabled:cursor-not-allowed">
                    <FaChevronRight size={12}/>
                </button>
            </div>

            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_16rem] items-start">
                <WeeklyHoursTable entries={entries} openSession={openSession} schedule={schedule}
                    onEditDay={onEditDay} dayNoteHandlers={dayNoteHandlers} copyActivities={copyActivities} weekStart={weekStart}/>
                <OfficeHoursTable days={weekSchedule}/>
            </div>
            <p className="text-xs text-gray-400 mt-2 text-right">
                Period total ({formatRange(firstWeek).split(" – ")[0]} – {formatRange(weekStarts[WEEKS_PER_PERIOD - 1]).split(" – ")[1]}):{" "}
                <span className="text-white font-semibold">{periodTotal}</span> hrs
            </p>
        </div>
    )
}
