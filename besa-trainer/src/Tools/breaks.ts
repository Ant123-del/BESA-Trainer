import { useEffect, useState } from "react"
import type { BreakState } from "./Fetch"

//"4:05" - minutes:seconds, for break countdowns and allowances
export function formatDuration(totalSeconds: number): string {
    const seconds = Math.max(0, Math.round(totalSeconds))
    return `${Math.floor(seconds / 60)}:${(seconds % 60).toString().padStart(2, "0")}`
}

//a member's break state as of right now - ticks every second while they're on break, so the countdown and
//{left}/{total} keep moving between refreshes. Shared by the kiosk's Current Sessions and the hours table.
export function useLiveBreak(brk: BreakState | null | undefined) {
    const [now, setNow] = useState(() => Date.now())
    const ticking = !!brk?.onBreak

    useEffect(() => {
        if (!ticking) return
        const interval = setInterval(() => setNow(Date.now()), 1000)
        return () => clearInterval(interval)
    }, [ticking])

    if (!brk) return null
    const breakEndsAt = brk.breakEndsAt ? new Date(brk.breakEndsAt).getTime() : null
    const breakStartedAt = brk.breakStartedAt ? new Date(brk.breakStartedAt).getTime() : null
    const breakLeft = breakEndsAt ? Math.max(0, (breakEndsAt - now) / 1000) : 0
    const onBreak = brk.onBreak && breakLeft > 0
    const used = brk.onBreak && breakStartedAt && breakEndsAt
        ? brk.usedBeforeBreakSeconds + (Math.min(now, breakEndsAt) - breakStartedAt) / 1000
        : brk.usedSeconds
    return {
        onBreak,
        breakLeft,
        //was on break at the last refresh, but it has since run out on its own
        breakRanOut: brk.onBreak && breakLeft === 0,
        used,
        remaining: Math.max(0, brk.allowanceSeconds - used),
        allowance: brk.allowanceSeconds,
        resetNow: () => setNow(Date.now()),
    }
}
