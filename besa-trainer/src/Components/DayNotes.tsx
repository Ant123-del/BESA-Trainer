import { useState, type JSX } from "react"
import { FaTimes } from "react-icons/fa"
import { MoonLoader } from "react-spinners"

export type DayNote = {id: string, text: string, at: Date | null}

//what the hours table calls to change a day's notes (dates are YYYY-MM-DD) - each resolves to an error
//message, or null once it's saved. Only passed on the member's own My Hours, so nobody edits someone else's.
export type DayNoteHandlers = {
    add: (date: string, text: string) => Promise<string | null>
    remove: (date: string, noteId: string) => Promise<string | null>
}

const MAX_LENGTH = 500

//a member's own notes on one day of their hours - read-only unless handlers are passed, in which case
//each note gets a delete button and the day gets a "+ Note" box
export default function DayNotes({date, notes, handlers}: {
    date: string, notes: DayNote[], handlers?: DayNoteHandlers
}): JSX.Element | null {
    const [open, setOpen] = useState(false)
    const [text, setText] = useState("")
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState("")

    if (notes.length === 0 && !handlers) return null

    async function run(action: () => Promise<string | null>): Promise<boolean> {
        setBusy(true)
        setError("")
        const failure = await action()
        setBusy(false)
        if (failure) setError(failure)
        return !failure
    }

    function close() {
        setOpen(false)
        setText("")
        setError("")
    }

    return (
        <div className="flex flex-col gap-1">
            {notes.length > 0 &&
                <ul className="flex flex-col gap-0.5">
                    {notes.map(n => (
                        <li key={n.id} className="text-xs text-gray-200 bg-gray-900/40 border-l-2 border-sky-400/70 rounded-r px-2 py-1 break-words flex items-start gap-2">
                            <span className="flex-1 min-w-0">
                                <span className="text-sky-300/80 mr-1.5 font-semibold">My note</span>
                                {n.text}
                            </span>
                            {handlers &&
                                <button onClick={() => void run(() => handlers.remove(date, n.id))} disabled={busy}
                                    aria-label="Delete note" title="Delete note"
                                    className="text-gray-500 hover:text-red-400 disabled:opacity-40 mt-0.5">
                                    <FaTimes size={10}/>
                                </button>
                            }
                        </li>
                    ))}
                </ul>
            }
            {handlers && (open ?
                <div className="flex flex-col gap-1.5">
                    <textarea value={text} onChange={(e) => setText(e.target.value)} disabled={busy} autoFocus
                        maxLength={MAX_LENGTH} rows={2} placeholder="Add a note about this day..."
                        className="w-full p-2 rounded-lg bg-gray-700 text-white text-xs"/>
                    <div className="flex gap-2">
                        <button onClick={() => void run(() => handlers.add(date, text)).then(ok => { if (ok) close() })}
                            disabled={busy || !text.trim()}
                            className="px-3 py-1 rounded-full bg-blue-800 hover:bg-blue-900 text-xs disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5">
                            {busy && <MoonLoader color="white" size={10}/>}
                            Save Note
                        </button>
                        <button onClick={close} disabled={busy}
                            className="px-3 py-1 rounded-full border border-gray-500 hover:bg-gray-700 text-xs disabled:opacity-40">
                            Cancel
                        </button>
                    </div>
                </div>
                :
                <button onClick={() => setOpen(true)} className="self-start text-xs text-sky-300/80 hover:text-sky-200">
                    + Note
                </button>
            )}
            {error && <p className="text-red-400 text-xs">{error}</p>}
        </div>
    )
}
