import type { JSX } from "react"
import { MoonLoader } from "react-spinners"
import type { OfficeScheduleDay } from "../Tools/Fetch"
import { toDateKey } from "../Tools/dates"

const DAY_LABELS: Record<string, string> = {
    sunday: "Sun", monday: "Mon", tuesday: "Tue", wednesday: "Wed", thursday: "Thu", friday: "Fri", saturday: "Sat",
}

//"13:00" -> "1:00 PM" - roster times are already Pacific wall-clock, so no timezone math here
function formatSlotTime(hhmm: string): string {
    const [h, m] = hhmm.split(":").map(Number)
    if (Number.isNaN(h) || Number.isNaN(m)) return hhmm
    return `${h % 12 || 12}:${m.toString().padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`
}

//one week of the member's actual office hours from BESA Booking, shown beside their logged hours for the same
//week. Each date is its effective hours: temporary hours (TEMP) replace the usual weekly ones, and unavailable
//time is already taken out and listed with its reason. undefined = still loading, null = their name isn't on
//the booking roster.
export default function OfficeHoursTable({days}: {days: OfficeScheduleDay[] | null | undefined}): JSX.Element {
    const todayKey = toDateKey(new Date())
    const total = (days || []).reduce((sum, d) => sum + d.scheduledHours, 0)

    return (
        <div className="rounded-xl overflow-hidden border border-gray-700">
            <div className="bg-amber-500 text-black text-sm font-semibold p-2 px-3">Office Hours (BESA Booking)</div>
            {days === undefined ?
                <div className="flex justify-center py-6 bg-gray-800"><MoonLoader color="white" size={20}/></div>
                : days === null ?
                <p className="p-3 text-sm text-gray-400 italic bg-gray-800">No BESA booking schedule found for this name.</p>
                :
                <>
                    {days.map((d, i) => {
                        const [, month, dayOfMonth] = d.date.split("-")
                        const isToday = d.date === todayKey
                        return (
                            <div key={d.date} className={"grid grid-cols-[4.25rem_1fr] text-sm " + (isToday ? "bg-gray-700" : i % 2 === 0 ? "bg-gray-800" : "bg-gray-800/60")}>
                                <div className={"p-2 px-3 " + (isToday ? "text-white font-semibold" : "text-gray-300")}>
                                    {DAY_LABELS[d.day] || d.day} <span className="text-xs text-gray-400">{month}/{dayOfMonth}</span>
                                </div>
                                <div className="p-2 px-3 text-gray-200 flex flex-col gap-0.5">
                                    {d.temporary &&
                                        <span title={d.temporaryReason || "Temporary hours for this date"}
                                            className="self-start text-[10px] px-1.5 py-0.5 rounded font-semibold bg-violet-400 text-black">TEMP</span>
                                    }
                                    {d.slots.length === 0 ?
                                        <span className="text-gray-500">—</span>
                                        : d.slots.map((sl, j) => (
                                            <span key={j} className="whitespace-nowrap">{formatSlotTime(sl.start)} – {formatSlotTime(sl.end)}</span>
                                        ))
                                    }
                                    {d.unavailable.map((u, j) => (
                                        <span key={"u" + j} className="text-xs text-red-300/90">
                                            Unavailable {u.allDay ? "all day" : `${formatSlotTime(u.start!)} – ${formatSlotTime(u.end!)}`}
                                            {u.reason && <span className="text-gray-400"> · {u.reason}</span>}
                                        </span>
                                    ))}
                                </div>
                            </div>
                        )
                    })}
                    <div className="flex justify-between bg-amber-500 text-black text-sm font-semibold p-2 px-3">
                        <span>Scheduled</span>
                        <span>{Math.round(total * 100) / 100} hrs</span>
                    </div>
                </>
            }
        </div>
    )
}
