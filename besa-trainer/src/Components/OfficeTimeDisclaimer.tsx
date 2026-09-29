import type { JSX } from "react"

//shown wherever hours are clocked or viewed - the kiosk only sees people who come into the office.
export default function OfficeTimeDisclaimer({className = ""}: {className?: string}): JSX.Element {
    return (
        <p className={"text-xs text-yellow-300/90 bg-yellow-900/30 border border-yellow-700/50 rounded-lg p-2 px-3 " + className}>
            <span className="font-semibold">Note:</span> This only tracks time spent in the BESA office.
            Working outside the office is highly discouraged during the quarter.
        </p>
    )
}
