import type { JSX } from "react"

//what does and doesn't count against the break allowance - shown where breaks are taken (the kiosk's
//Current Sessions) and where they're reported (the hours tables).
export default function BreakCriteria({className = ""}: {className?: string}): JSX.Element {
    return (
        <p className={"text-xs text-sky-200/90 bg-sky-900/30 border border-sky-700/50 rounded-lg p-2 px-3 " + className}>
            <span className="font-semibold">What counts as a break:</span> any time spent on something not BESA-related.
            Going to the bathroom does not count as a break.
        </p>
    )
}
