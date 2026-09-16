import type { JSX } from "react"

export type WeeklyHoursEntry = {
    date: Date
    hours: number
    activities: string[]
    autoClockedOut?: boolean
}

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

function startOfWeek(date: Date): Date {
    const start = new Date(date)
    start.setHours(0, 0, 0, 0)
    start.setDate(start.getDate() - start.getDay())
    return start
}

function sameDay(a: Date, b: Date): boolean {
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

//CruzPay-styled current-week table (Date | Activities | Hours + a totals row), themed for this app's
//dark UI - always shows all 7 days of the current Sun-Sat week, even ones with no hours logged yet.
export default function WeeklyHoursTable({entries}: {entries: WeeklyHoursEntry[]}): JSX.Element {
    const weekStart = startOfWeek(new Date())
    const days = Array.from({length: 7}, (_, i) => {
        const date = new Date(weekStart)
        date.setDate(date.getDate() + i)
        const entry = entries.find(e => sameDay(e.date, date))
        return {date, hours: entry?.hours || 0, activities: entry?.activities || [], autoClockedOut: entry?.autoClockedOut}
    })
    const total = days.reduce((sum, d) => sum + d.hours, 0)

    return (
        <div className="rounded-xl overflow-hidden border border-gray-700">
            <div className="grid grid-cols-[7rem_1fr_5rem] bg-amber-500 text-black text-sm font-semibold">
                <div className="p-2 px-3">Date</div>
                <div className="p-2 px-3">Activities</div>
                <div className="p-2 px-3 text-right">Hours</div>
            </div>
            {days.map((d, i) => (
                <div key={i} className={"grid grid-cols-[7rem_1fr_5rem] text-sm " + (i % 2 === 0 ? "bg-gray-800" : "bg-gray-800/60")}>
                    <div className="p-2 px-3 text-gray-300">{DAY_LABELS[d.date.getDay()]} {(d.date.getMonth() + 1).toString().padStart(2, "0")}/{d.date.getDate().toString().padStart(2, "0")}</div>
                    <div className="p-2 px-3 text-gray-400">{d.activities.length > 0 ? d.activities.join(", ") : "—"}</div>
                    <div className="p-2 px-3 text-right flex items-center justify-end gap-1">
                        {d.autoClockedOut &&
                            <span title="Automatically clocked out - this account forgot to clock out that day" className="text-[10px] px-1.5 py-0.5 rounded bg-yellow-600 text-black font-semibold">AUTO</span>
                        }
                        {d.hours || ""}
                    </div>
                </div>
            ))}
            <div className="grid grid-cols-[7rem_1fr_5rem] bg-amber-500 text-black text-sm font-semibold">
                <div className="p-2 px-3 col-span-2">Total</div>
                <div className="p-2 px-3 text-right">{total}</div>
            </div>
        </div>
    )
}
