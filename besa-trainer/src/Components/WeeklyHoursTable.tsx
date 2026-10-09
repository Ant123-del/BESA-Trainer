import type { JSX } from "react"
import type { BreakState, OfficeScheduleDay, WorkedOn } from "../Tools/Fetch"
import { formatDuration, useLiveBreak } from "../Tools/breaks"
import { sameDay, startOfWeek, toDateKey } from "../Tools/dates"
import SessionNotes from "./SessionNotes"
import DayNotes, { type DayNote, type DayNoteHandlers } from "./DayNotes"

type Note = {text: string, at: Date | null}

export type WeeklyHoursSession = {
    clockIn: Date
    clockOut: Date
    activities: string[]
    autoClockedOut?: boolean
    breakSeconds?: number
    canceledTour?: boolean
    notes?: Note[]
    workedOn?: WorkedOn[] // what they actually worked on, split at clock-out
    leftEarlySeconds?: number // unused break they left early with - credited on top of the time shown
}

export type WeeklyHoursEntry = {
    date: Date
    hours: number
    activities: string[]
    autoClockedOut?: boolean
    editedByAdmin?: boolean
    sessions?: WeeklyHoursSession[]
    breakAllowanceMinutes?: number // that day's break total, from the backend (scheduled vs. time actually in)
    dayNotes?: DayNote[] // the member's own notes on this day (Profile's My Hours)
}

//someone clocked in right now - shown on its day as "9:02 AM - now" (no hours yet until they clock out)
export type OpenSession = {
    clockIn: Date
    activities: string[]
    break?: BreakState // today's live break status, so the day's break line can tick during a break
    notes?: Note[]
}

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

//always Pacific, same as the kiosk and the backend's week boundaries, whatever the viewer's own timezone
function formatTime(date: Date): string {
    return date.toLocaleTimeString("en-US", {hour: "numeric", minute: "2-digit", timeZone: "America/Los_Angeles"})
}

function Badge({label, title, className}: {label: string, title: string, className: string}) {
    return <span title={title} className={"text-[10px] px-1.5 py-0.5 rounded font-semibold whitespace-nowrap " + className}>{label}</span>
}

//CruzPay-styled one-week table (Date | Time & Activities | Hours + a totals row), themed for this app's
//dark UI - always shows all 7 days of the Sun-Sat week starting at weekStart (this week by default), even ones
//with no hours logged yet. Each
//visit that day gets its own arrive-leave line with the activities picked at clock-in; days logged before
//visits were tracked just show their activities. Passing onEditDay adds an Edit column (root admin's
//Profile view) - it gets the day plus whatever's logged. Passing schedule adds each day's break status
//({left}/{total}, the total coming from that date's effective BESA Booking office hours) up through today.
//Each day's own notes always show; passing dayNoteHandlers (the member's own My Hours) lets them add/delete them.
export default function WeeklyHoursTable({entries, openSession, schedule, onEditDay, dayNoteHandlers, weekStart = startOfWeek(new Date())}: {
    entries: WeeklyHoursEntry[], openSession?: OpenSession | null, schedule?: OfficeScheduleDay[] | null,
    onEditDay?: (day: WeeklyHoursEntry) => void, dayNoteHandlers?: DayNoteHandlers, weekStart?: Date
}): JSX.Element {
    const today = new Date()
    const days = Array.from({length: 7}, (_, i) => {
        const date = new Date(weekStart)
        date.setDate(date.getDate() + i)
        const entry = entries.find(e => sameDay(e.date, date))
        return {
            date,
            hours: entry?.hours || 0,
            activities: entry?.activities || [],
            autoClockedOut: entry?.autoClockedOut,
            editedByAdmin: entry?.editedByAdmin,
            sessions: [...(entry?.sessions || [])].sort((a, b) => a.clockIn.getTime() - b.clockIn.getTime()),
            dayNotes: entry?.dayNotes || [],
            open: openSession && sameDay(openSession.clockIn, date) ? openSession : null,
            upToToday: date.getTime() <= today.getTime(),
            //days they came in carry the backend's allowance (based on time actually in); other days use the schedule
            breakAllowanceSeconds: (entry?.breakAllowanceMinutes ?? schedule?.find(o => o.date === toDateKey(date))?.breakAllowanceMinutes ?? 0) * 60,
        }
    })
    const total = days.reduce((sum, d) => sum + d.hours, 0)
    const cols = onEditDay
        ? "grid-cols-[5rem_1fr_3rem_3.25rem] sm:grid-cols-[7rem_1fr_4rem_3.5rem]"
        : "grid-cols-[5rem_1fr_3.5rem] sm:grid-cols-[7rem_1fr_5rem]"

    return (
        <div className="rounded-xl overflow-hidden border border-gray-700">
            <div className={"grid " + cols + " bg-amber-500 text-black text-sm font-semibold"}>
                <div className="p-2 px-3">Date</div>
                <div className="p-2 px-3">Time & Activities</div>
                <div className="p-2 px-3 text-right">Hours</div>
                {onEditDay && <div/>}
            </div>
            {days.map((d, i) => (
                <div key={i} className={"grid " + cols + " text-sm " + (i % 2 === 0 ? "bg-gray-800" : "bg-gray-800/60")}>
                    <div className="p-2 px-3 text-gray-300">
                        {DAY_LABELS[d.date.getDay()]} <span className="whitespace-nowrap">{(d.date.getMonth() + 1).toString().padStart(2, "0")}/{d.date.getDate().toString().padStart(2, "0")}</span>
                    </div>
                    <div className="p-2 px-3 text-gray-400 flex flex-col gap-1 min-w-0">
                        {d.sessions.map((s, j) => (
                            <SessionLine key={j} clockIn={s.clockIn} clockOut={s.clockOut} activities={s.activities} autoClockedOut={s.autoClockedOut} breakSeconds={s.breakSeconds} canceledTour={s.canceledTour} notes={s.notes} workedOn={s.workedOn} leftEarlySeconds={s.leftEarlySeconds}/>
                        ))}
                        {d.open && <SessionLine clockIn={d.open.clockIn} activities={d.open.activities} notes={d.open.notes}/>}
                        {d.sessions.length === 0 && !d.open &&
                            <span>{d.activities.length > 0 ? d.activities.join(", ") : "—"}</span>
                        }
                        {schedule && d.upToToday &&
                            <BreakLine allowanceSeconds={d.breakAllowanceSeconds}
                                takenSeconds={d.sessions.reduce((sum, s) => sum + (s.breakSeconds || 0), 0)}
                                liveBreak={d.open?.break}/>
                        }
                        <DayNotes date={toDateKey(d.date)} notes={d.dayNotes} handlers={dayNoteHandlers}/>
                    </div>
                    <div className="p-2 px-3 text-right flex flex-wrap items-center justify-end gap-1 content-center">
                        {d.editedByAdmin &&
                            <Badge label="EDITED" title="A root admin edited this day's hours - the total may not match the times shown" className="bg-sky-600 text-black"/>
                        }
                        {d.autoClockedOut && !d.sessions.some(s => s.autoClockedOut) &&
                            <Badge label="AUTO" title="Automatically clocked out - this account forgot to clock out that day" className="bg-yellow-600 text-black"/>
                        }
                        {d.hours || ""}
                    </div>
                    {onEditDay &&
                        <div className="p-1 flex items-center justify-center">
                            <button onClick={() => onEditDay(d)} className="text-xs px-2 py-1 rounded-full bg-gray-700 hover:bg-gray-600">Edit</button>
                        </div>
                    }
                </div>
            ))}
            <div className={"grid " + cols + " bg-amber-500 text-black text-sm font-semibold"}>
                <div className="p-2 px-3 col-span-2">Total</div>
                <div className="p-2 px-3 text-right">{total}</div>
                {onEditDay && <div/>}
            </div>
        </div>
    )
}

//"9:02 AM - 11:30 AM  Tours, Other" - clockOut omitted means they're still clocked in
function SessionLine({clockIn, clockOut, activities, autoClockedOut, breakSeconds, canceledTour, notes, workedOn, leftEarlySeconds}: {
    clockIn: Date, clockOut?: Date, activities: string[], autoClockedOut?: boolean, breakSeconds?: number, canceledTour?: boolean,
    notes?: Note[], workedOn?: WorkedOn[], leftEarlySeconds?: number
}) {
    //the break they left early with is shown on its own, not as a break taken
    const breakTaken = (breakSeconds || 0) - (leftEarlySeconds || 0)
    return (
        <div className="flex flex-col gap-0.5">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <span className="text-gray-200 whitespace-nowrap">
                    {formatTime(clockIn)} – {clockOut ? formatTime(clockOut) : "now"}
                </span>
                {!clockOut &&
                    <Badge label="HERE" title="Currently clocked in" className="bg-green-600 text-black"/>
                }
                {canceledTour &&
                    <Badge label="CANCELED TOUR" title="Tour was canceled - logged out and the day was set to 30 minutes" className="bg-red-400 text-black"/>
                }
                {!!leftEarlySeconds &&
                    <Badge label={`LEFT EARLY · +${Math.round(leftEarlySeconds / 60)}m`} title="Left early with their unused break time - credited as if they'd stayed that much longer" className="bg-emerald-400 text-black"/>
                }
                {autoClockedOut &&
                    <Badge label="AUTO" title="Forgot to clock out - leave time is their scheduled office-hours end (or 8 PM)" className="bg-yellow-600 text-black"/>
                }
                {/* one list: what they actually worked on (with time) once known, otherwise what they intended */}
                {workedOn && workedOn.length > 0 ?
                    <span className="text-gray-400" title={autoClockedOut ? "Forgot to clock out - split evenly across what they clocked in for" : "What they actually worked on"}>
                        {workedOn.map(w => `${w.activity} ${Math.round(w.minutes)}m`).join(" · ")}
                    </span>
                    : activities.length > 0 && <span className="text-gray-400">{activities.join(", ")}</span>
                }
                {breakTaken > 0 && <span className="text-sky-300/80 whitespace-nowrap">{Math.round(breakTaken / 60)} min break</span>}
            </div>
            <SessionNotes notes={notes}/>
        </div>
    )
}

//"Breaks: 10:00 / 15:00 left" for one day. While someone's clocked in today, the live break state (which
//already counts earlier visits today) drives it and ticks during a break; otherwise it's the day's total
//allowance minus the break time recorded on its visits.
function BreakLine({allowanceSeconds, takenSeconds, liveBreak}: {
    allowanceSeconds: number, takenSeconds: number, liveBreak?: BreakState
}) {
    const live = useLiveBreak(liveBreak)
    const allowance = live ? live.allowance : allowanceSeconds
    const remaining = live ? live.remaining : Math.max(0, allowanceSeconds - takenSeconds)
    if (allowance === 0 && takenSeconds === 0) return null

    return (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
            <span className="text-sky-300/90">
                Breaks: <span className="tabular-nums font-semibold">{formatDuration(remaining)}</span>
                <span className="tabular-nums"> / {formatDuration(allowance)}</span> left
            </span>
            {live?.onBreak &&
                <Badge label={`ON BREAK · ${formatDuration(live.breakLeft)}`} title="Currently on break" className="bg-sky-500 text-black tabular-nums"/>
            }
        </div>
    )
}
