import type { JSX } from "react"
import { MoonLoader } from "react-spinners"
import type { OfficeHoursWeek } from "../Tools/Fetch"

const DAY_LABELS: Record<string, string> = {
    sunday: "Sun", monday: "Mon", tuesday: "Tue", wednesday: "Wed", thursday: "Thu", friday: "Fri", saturday: "Sat",
}

//"13:00" -> "1:00 PM" - roster times are already Pacific wall-clock, so no timezone math here
function formatSlotTime(hhmm: string): string {
    const [h, m] = hhmm.split(":").map(Number)
    if (Number.isNaN(h) || Number.isNaN(m)) return hhmm
    return `${h % 12 || 12}:${m.toString().padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`
}

function slotHours(start: string, end: string): number {
    const [sh, sm] = start.split(":").map(Number)
    const [eh, em] = end.split(":").map(Number)
    const minutes = (eh * 60 + em) - (sh * 60 + sm)
    return Number.isFinite(minutes) && minutes > 0 ? minutes / 60 : 0
}

//the member's scheduled office hours from BESA booking, shown beside their logged hours so the two can be
//compared at a glance - same amber-header look as WeeklyHoursTable. undefined = still loading, null = their
//name isn't on the booking roster.
export default function OfficeHoursTable({officeHours}: {officeHours: OfficeHoursWeek | null | undefined}): JSX.Element {
    const today = new Date().toLocaleDateString("en-US", {weekday: "long", timeZone: "America/Los_Angeles"}).toLowerCase()
    const total = (officeHours || []).reduce((sum, d) => sum + d.slots.reduce((s, sl) => s + slotHours(sl.start, sl.end), 0), 0)

    return (
        <div className="rounded-xl overflow-hidden border border-gray-700">
            <div className="bg-amber-500 text-black text-sm font-semibold p-2 px-3">Office Hours (BESA Booking)</div>
            {officeHours === undefined ?
                <div className="flex justify-center py-6 bg-gray-800"><MoonLoader color="white" size={20}/></div>
                : officeHours === null ?
                <p className="p-3 text-sm text-gray-400 italic bg-gray-800">No BESA booking schedule found for this name.</p>
                :
                <>
                    {officeHours.map((d, i) => (
                        <div key={d.day} className={"grid grid-cols-[3rem_1fr] text-sm " + (d.day === today ? "bg-gray-700" : i % 2 === 0 ? "bg-gray-800" : "bg-gray-800/60")}>
                            <div className={"p-2 px-3 " + (d.day === today ? "text-white font-semibold" : "text-gray-300")}>{DAY_LABELS[d.day] || d.day}</div>
                            <div className="p-2 px-3 text-gray-200 flex flex-col">
                                {d.slots.length === 0 ?
                                    <span className="text-gray-500">—</span>
                                    : d.slots.map((sl, j) => (
                                        <span key={j} className="whitespace-nowrap">{formatSlotTime(sl.start)} – {formatSlotTime(sl.end)}</span>
                                    ))
                                }
                            </div>
                        </div>
                    ))}
                    <div className="flex justify-between bg-amber-500 text-black text-sm font-semibold p-2 px-3">
                        <span>Scheduled</span>
                        <span>{Math.round(total * 100) / 100} hrs</span>
                    </div>
                </>
            }
        </div>
    )
}
