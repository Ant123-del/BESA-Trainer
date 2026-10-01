import type { JSX } from "react"

//what counts as a break and how the daily allowance works - shown where breaks are taken (the kiosk's
//Current Sessions) and where they're reported (the hours tables). Keep the allowance wording in sync with
//the backend's _break_allowance_minutes. Collapsed by default so it doesn't crowd the kiosk/hours views.
export default function BreakCriteria({className = ""}: {className?: string}): JSX.Element {
    return (
        <details className={"group text-xs text-sky-200/90 bg-sky-900/30 border border-sky-700/50 rounded-lg p-2 px-3 " + className}>
            <summary className="font-semibold cursor-pointer select-none list-none [&::-webkit-details-marker]:hidden flex items-center gap-1.5">
                <span className="inline-block transition-transform group-open:rotate-90">▶</span>
                How breaks work
            </summary>
            <ul className="list-disc pl-4 flex flex-col gap-0.5 mt-1.5">
                <li>
                    <span className="font-semibold">What counts as a break:</span> any time spent on something not
                    BESA-related, such as being on your phone. Going to the bathroom does not count as a break.
                </li>
                <li>
                    <span className="font-semibold">Vibe coding by itself is not a break.</span> But if you start
                    vibe coding and then look at your phone while you wait, that time counts as a break.
                </li>
                <li>
                    <span className="font-semibold">Breaks may not be allowed at certain times</span> - such as
                    during tours or Baskin events - unless authorized.
                </li>
                <li>
                    <span className="font-semibold">Out of break time?</span> If you've used up your break time and
                    still need to attend to something, clock out of the system.
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
        </details>
    )
}
