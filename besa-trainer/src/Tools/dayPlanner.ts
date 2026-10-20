//shared by the day-timeline editors (Components/DayPlanner): a member's Request Hours and root admin's Edit
//Anyone's Hours. Times on a day are minutes past midnight, Pacific - like the kiosk and the backend.
import { fromDateKey } from "./dates"

export const HOUR_PX = 44
export const DAY_MINUTES = 24 * 60
export const SNAP = 15 // dragging snaps to quarter hours - the time boxes can be set to any minute
export const DEFAULT_LENGTH = 60 // a tap (or a click without dragging) adds an hour
export const DETAILS_MAX_LENGTH = 500 // same cap as the backend's HOURS_REQUEST_DETAILS_MAX_LENGTH

export type Block = {start: number, end: number}

//a range on the timeline that can be changed. reason/details: a request's why (Request Hours) or an optional
//note (root admin). source: which of the day's stored visits it started as (root admin), absent for new ones.
//tags: short labels about where it came from ("AUTO", "REQUESTED"...), shown in its editor.
export type Draft = {id: number, start: number, end: number, activities: string[], reason: string, details: string, source?: number, tags?: string[]}

//something on the timeline that can't be changed there (a logged visit, a sent request, the visit in progress)
export type FixedBlock = Block & {label: string, className: string}

export function pacificMinutes(date: Date): number {
    const parts = new Intl.DateTimeFormat("en-US", {hour: "numeric", minute: "numeric", hourCycle: "h23", timeZone: "America/Los_Angeles"}).formatToParts(date)
    const get = (type: string) => Number(parts.find(p => p.type === type)?.value || 0)
    return get("hour") * 60 + get("minute")
}

//an ISO start/end pair as a block on its day - an end at midnight is the end of the day, not its start
export function isoBlock(start: string, end: string): Block {
    return {start: pacificMinutes(new Date(start)), end: pacificMinutes(new Date(end)) || DAY_MINUTES}
}

//540 -> "9:00 AM", 1440 -> "12:00 AM" (midnight at the end of the day)
export function formatMinutes(minutes: number): string {
    const h = Math.floor(minutes / 60) % 24
    const m = minutes % 60
    return `${h % 12 === 0 ? 12 : h % 12}:${m.toString().padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`
}

export function formatLength(minutes: number): string {
    const h = Math.floor(minutes / 60)
    const m = minutes % 60
    return h && m ? `${h}h ${m}m` : h ? `${h}h` : `${m}m`
}

//minutes <-> the "HH:MM" an <input type="time"> and the backend use ("24:00" for the end of the day)
export function toHHMM(minutes: number): string {
    return `${Math.floor(minutes / 60).toString().padStart(2, "0")}:${(minutes % 60).toString().padStart(2, "0")}`
}

export function fromHHMM(value: string): number | null {
    const [h, m] = value.split(":").map(Number)
    return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null
}

export function overlaps(a: Block, b: Block): boolean {
    return a.start < b.end && b.start < a.end
}

export function dayLabel(key: string, weekday: "short" | "long" = "long"): string {
    return fromDateKey(key).toLocaleDateString("en-US", {weekday, month: "short", day: "numeric"})
}

//where "Add time range" puts a new hour: the first free one from 9 AM on, or the last hour before now
export function firstFreeRange(taken: Block[], nowMinutes: number): Block {
    let start = 9 * 60
    while (start + DEFAULT_LENGTH <= nowMinutes && taken.some(b => overlaps(b, {start, end: start + DEFAULT_LENGTH}))) start += SNAP
    if (start + DEFAULT_LENGTH > nowMinutes) start = Math.max(0, Math.floor((nowMinutes - DEFAULT_LENGTH) / SNAP) * SNAP)
    return {start, end: Math.min(start + DEFAULT_LENGTH, nowMinutes)}
}

//a day's credited hours from its total time in - the backend's _credited_hours (nearest half hour, up from the quarters)
export function creditedHours(seconds: number): number {
    return Math.floor(Math.max(0, seconds) / 1800 + 0.5) * 0.5
}
