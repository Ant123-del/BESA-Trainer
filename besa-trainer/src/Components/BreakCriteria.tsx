import type { JSX } from "react"

//what counts as a break and how the daily allowance works - shown where breaks are taken (the kiosk's
//Current Sessions) and where they're reported (the hours tables). Keep the allowance wording in sync with
//the backend's _break_allowance_minutes.
export default function BreakCriteria({className = ""}: {className?: string}): JSX.Element {
    return (
        <div className={"text-xs text-sky-200/90 bg-sky-900/30 border border-sky-700/50 rounded-lg p-2 px-3 " + className}>
            <p className="font-semibold mb-1">How breaks work</p>
            <ul className="list-disc pl-4 flex flex-col gap-0.5">
                <li>
                    <span className="font-semibold">What counts as a break:</span> any time spent on something not
                    BESA-related - including vibe coding and being on your phone. Going to the bathroom does not count
                    as a break.
                </li>
                <li>
                    <span className="font-semibold">Breaks count toward your hours</span> - break time is included in
                    the hours you work, not taken out of them.
                </li>
                <li>
                    <span className="font-semibold">How much you get:</span> every scheduled office hour that day on
                    BESA Booking earns +5 minutes of potential break, up to 15 minutes at 3 hours. It stays at 15
                    through 5 hours, then each hour past 5 adds another +5 minutes (e.g. 6 hours = 20 minutes).
                </li>
                <li>
                    Breaks are taken at the BESA Root kiosk, 5 minutes at a time or all remaining time at once,
                    and shown as time left / today's total.
                </li>
            </ul>
        </div>
    )
}
