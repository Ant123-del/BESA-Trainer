import { useState, type JSX, type ReactNode } from "react"
import { FaChevronDown, FaRegStickyNote } from "react-icons/fa"
import type { TaskNote } from "../Tools/Fetch"

//a BESA Lead's note on one task: the description plus its checklist. Tapping the header opens/closes it.
//onToggle makes the checkboxes tickable (kiosk Current Sessions, the member's Profile); without it they're
//read-only. Resolves to an error message, or null when it saved.
export default function TaskNoteCard({note, defaultOpen = false, onToggle}: {
    note: TaskNote
    defaultOpen?: boolean
    onToggle?: (itemId: string, done: boolean) => Promise<string | null>
}): JSX.Element {
    const [open, setOpen] = useState(defaultOpen)
    const [savingId, setSavingId] = useState<string | null>(null)
    const [error, setError] = useState("")
    const done = note.items.filter(i => i.done).length

    async function toggle(itemId: string, value: boolean) {
        if (!onToggle) return
        setSavingId(itemId)
        setError("")
        const problem = await onToggle(itemId, value)
        setSavingId(null)
        if (problem) setError(problem)
    }

    return (
        <div className="rounded-lg border border-amber-500/40 bg-amber-950/30 text-sm">
            <button type="button" onClick={() => setOpen(!open)} aria-expanded={open}
                className="w-full flex items-center gap-2 px-3 py-2 text-left">
                <FaRegStickyNote className="text-amber-400 shrink-0" size={12}/>
                <span className="font-semibold text-amber-200">{note.task}</span>
                <span className="text-xs text-gray-400">Lead's note</span>
                {note.items.length > 0 &&
                    <span className={"text-xs tabular-nums ml-auto " + (done === note.items.length ? "text-green-400" : "text-gray-300")}>
                        {done}/{note.items.length} done
                    </span>
                }
                <FaChevronDown size={10} className={"shrink-0 text-gray-400 transition-transform " + (note.items.length > 0 ? "" : "ml-auto ") + (open ? "rotate-180" : "")}/>
            </button>
            {open &&
                <div className="px-3 pb-3 flex flex-col gap-2">
                    {note.description && <p className="text-gray-200 whitespace-pre-wrap break-words">{note.description}</p>}
                    {note.items.length > 0 &&
                        <ul className="flex flex-col gap-1">
                            {note.items.map(item => (
                                <li key={item.id}>
                                    <label className={"flex items-start gap-2 " + (onToggle ? "cursor-pointer" : "")}>
                                        <input type="checkbox" checked={item.done} disabled={!onToggle || savingId !== null}
                                            onChange={(e) => void toggle(item.id, e.target.checked)}
                                            className="mt-0.5 w-4 h-4 accent-amber-500 shrink-0"/>
                                        <span className={"break-words " + (item.done ? "line-through text-gray-500" : "text-gray-200")}>{item.text}</span>
                                    </label>
                                </li>
                            ))}
                        </ul>
                    }
                    {error && <p className="text-red-400 text-xs">{error}</p>}
                </div>
            }
        </div>
    )
}

//every lead note on a kiosk Current Sessions row behind one dropdown that starts closed - the
//cards inside start open, so one tap shows everything
export function TaskNotesGroup({notes, children}: {notes: TaskNote[], children: ReactNode}): JSX.Element {
    const [open, setOpen] = useState(false)
    const done = notes.reduce((sum, n) => sum + n.items.filter(i => i.done).length, 0)
    const total = notes.reduce((sum, n) => sum + n.items.length, 0)

    return (
        <div className="rounded-lg border border-amber-500/40 text-sm">
            <button type="button" onClick={() => setOpen(!open)} aria-expanded={open}
                className="w-full flex items-center gap-2 px-3 py-2 text-left">
                <FaRegStickyNote className="text-amber-400 shrink-0" size={12}/>
                <span className="font-semibold text-amber-200">Lead's notes</span>
                <span className="text-xs text-gray-400">{notes.length} task{notes.length === 1 ? "" : "s"}</span>
                {total > 0 &&
                    <span className={"text-xs tabular-nums ml-auto " + (done === total ? "text-green-400" : "text-gray-300")}>{done}/{total} done</span>
                }
                <FaChevronDown size={10} className={"shrink-0 text-gray-400 transition-transform " + (total > 0 ? "" : "ml-auto ") + (open ? "rotate-180" : "")}/>
            </button>
            {open && <div className="px-2 pb-2 flex flex-col gap-2">{children}</div>}
        </div>
    )
}
