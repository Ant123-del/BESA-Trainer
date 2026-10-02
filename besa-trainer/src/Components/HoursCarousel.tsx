import { useRef, useState, type JSX } from "react"
import { FaChevronLeft, FaChevronRight } from "react-icons/fa"
import type { OfficeScheduleDay } from "../Tools/Fetch"
import { sameDay, startOfWeek, toDateKey } from "../Tools/dates"
import WeeklyHoursTable, { type OpenSession, type WeeklyHoursEntry } from "./WeeklyHoursTable"
import OfficeHoursTable from "./OfficeHoursTable"

//the bi-weekly view: last week and this week, one at a time. -1 = last week, 0 = this week (matches the
//backend's HOURS_WEEKS_KEPT = 2).
const WEEK_OFFSETS = [-1, 0]

function formatRange(start: Date): string {
    const end = new Date(start)
    end.setDate(end.getDate() + 6)
    const fmt = (d: Date) => d.toLocaleDateString("en-US", {month: "short", day: "numeric"})
    return `${fmt(start)} – ${fmt(end)}`
}

//one member's logged hours beside their BESA Booking office hours, flipped a week at a time (arrows, the dots,
//or a swipe on a phone). Both tables always show the same week. Opens on this week.
export default function HoursCarousel({entries, openSession, schedule, onEditDay}: {
    entries: WeeklyHoursEntry[]
    openSession?: OpenSession | null
    schedule: OfficeScheduleDay[] | null | undefined
    onEditDay?: (day: WeeklyHoursEntry) => void
}): JSX.Element {
    const [index, setIndex] = useState(WEEK_OFFSETS.length - 1)
    const touchStartX = useRef<number | null>(null)

    const offset = WEEK_OFFSETS[index]
    const weekStart = startOfWeek(new Date(), offset)
    const weekKeys = Array.from({length: 7}, (_, i) => {
        const d = new Date(weekStart)
        d.setDate(d.getDate() + i)
        return toDateKey(d)
    })
    const weekSchedule = schedule ? schedule.filter(d => weekKeys.includes(d.date)) : schedule

    const firstShown = startOfWeek(new Date(), WEEK_OFFSETS[0])
    const twoWeekTotal = entries
        .filter(e => e.date >= firstShown || sameDay(e.date, firstShown))
        .reduce((sum, e) => sum + e.hours, 0)

    function go(next: number) {
        setIndex(Math.max(0, Math.min(WEEK_OFFSETS.length - 1, next)))
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
                    <p className="font-semibold text-sm">{offset === 0 ? "This Week" : "Last Week"}</p>
                    <p className="text-xs text-gray-400">{formatRange(weekStart)}</p>
                    <div className="flex justify-center gap-1.5 mt-1">
                        {WEEK_OFFSETS.map((_, i) => (
                            <button key={i} onClick={() => go(i)} aria-label={i === WEEK_OFFSETS.length - 1 ? "This week" : "Last week"}
                                className={"w-2 h-2 rounded-full " + (i === index ? "bg-amber-500" : "bg-gray-600 hover:bg-gray-500")}/>
                        ))}
                    </div>
                </div>
                <button onClick={() => go(index + 1)} disabled={index === WEEK_OFFSETS.length - 1} aria-label="Next week"
                    className="p-2 rounded-full bg-gray-700 hover:bg-gray-600 disabled:opacity-30 disabled:cursor-not-allowed">
                    <FaChevronRight size={12}/>
                </button>
            </div>

            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_16rem] items-start">
                <WeeklyHoursTable entries={entries} openSession={openSession} schedule={schedule}
                    onEditDay={onEditDay} weekStart={weekStart}/>
                <OfficeHoursTable days={weekSchedule}/>
            </div>
            <p className="text-xs text-gray-400 mt-2 text-right">Two-week total: <span className="text-white font-semibold">{twoWeekTotal}</span> hrs</p>
        </div>
    )
}
