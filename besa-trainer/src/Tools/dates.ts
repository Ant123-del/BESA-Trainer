//shared calendar helpers for the hours views - local (browser) calendar, which is Pacific on the kiosk and
//for everyone using this, matching the backend's Sun-Sat Pacific weeks.

//YYYY-MM-DD, the same key the backend uses for a day (office schedule dates, admin hour edits)
export function toDateKey(date: Date): string {
    return `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, "0")}-${date.getDate().toString().padStart(2, "0")}`
}

//midnight on the Sunday that starts `date`'s week, shifted by `weekOffset` weeks (-1 = last week)
export function startOfWeek(date: Date, weekOffset = 0): Date {
    const start = new Date(date)
    start.setHours(0, 0, 0, 0)
    start.setDate(start.getDate() - start.getDay() + weekOffset * 7)
    return start
}

export function sameDay(a: Date, b: Date): boolean {
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}
