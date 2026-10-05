import type { JSX } from "react"

//notes/comments added to a visit from the kiosk's Current Sessions - shown on the kiosk row and under that
//visit in the hours tables (My Hours + root's Everyone's Hours). `at` may be an ISO string or a Date.
export default function SessionNotes({notes, className = ""}: {notes?: {text: string, at: string | Date | null}[], className?: string}): JSX.Element | null {
    if (!notes || notes.length === 0) return null
    return (
        <ul className={"flex flex-col gap-0.5 " + className}>
            {notes.map((n, i) => (
                <li key={i} className="text-xs text-gray-300 bg-gray-900/40 border-l-2 border-amber-500/70 rounded-r px-2 py-1 break-words">
                    {n.at &&
                        <span className="text-gray-500 mr-1.5 whitespace-nowrap">
                            {new Date(n.at).toLocaleTimeString("en-US", {hour: "numeric", minute: "2-digit", timeZone: "America/Los_Angeles"})}
                        </span>
                    }
                    {n.text}
                </li>
            ))}
        </ul>
    )
}
