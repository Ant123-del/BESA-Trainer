import { useEffect, useRef, useState, type ClipboardEvent, type JSX } from "react"
import { Link } from "react-router-dom"
import { FaCamera } from "react-icons/fa"
import { MoonLoader } from "react-spinners"
import { getScreenshotTargets, uploadScreenshot, type ScreenshotTarget } from "../Tools/Fetch"

const MAX_SIDE = 2000 //plenty to read a CAD timeline, and keeps a phone photo under the backend's size limit
const NOTE_MAX_LENGTH = 200 //same cap as the backend's SCREENSHOT_NOTE_MAX_LENGTH

async function shrinkImage(file: Blob): Promise<Blob> {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement("canvas")
    canvas.width = Math.round(bitmap.width * scale)
    canvas.height = Math.round(bitmap.height * scale)
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    bitmap.close()
    return new Promise((resolve, reject) => {
        canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("Couldn't read that image.")), "image/jpeg", 0.85)
    })
}

function timeOf(iso: string): string {
    return new Date(iso).toLocaleString(undefined, {weekday: "short", hour: "numeric", minute: "2-digit"})
}

//top of the BESA home page: the screenshot behind old-vs-new grading gets sent from their own device, then they clock out
//at the kiosk. Works from a phone (the picker offers the camera) or a computer (choose a file, or just paste).
export default function ScreenshotCard(): JSX.Element | null {
    const [targets, setTargets] = useState<ScreenshotTarget[] | null>(null)
    const [chosen, setChosen] = useState(0)
    const [note, setNote] = useState("")
    const [busy, setBusy] = useState(false)
    const [message, setMessage] = useState<{text: string, error: boolean} | null>(null)
    const fileRef = useRef<HTMLInputElement>(null)

    function refresh() {
        getScreenshotTargets().then(result => { if (result.success) setTargets(result.targets) })
    }

    useEffect(refresh, [])

    if (!targets || targets.length === 0) return null
    const target = targets[Math.min(chosen, targets.length - 1)]

    async function send(file: Blob) {
        setBusy(true)
        setMessage(null)
        try {
            const result = await uploadScreenshot(target.projectId, target.measureId, await shrinkImage(file), note)
            if (result.success) {
                setMessage({text: "Sent! You can clock out at the kiosk whenever you're done.", error: false})
                setNote("")
                refresh()
            } else {
                setMessage({text: result.detail, error: true})
            }
        } catch {
            setMessage({text: "Couldn't read that image. Try a JPEG or PNG.", error: true})
        }
        setBusy(false)
        if (fileRef.current) fileRef.current.value = ""
    }

    function handlePaste(e: ClipboardEvent) {
        const image = [...e.clipboardData.files].find(f => f.type.startsWith("image/"))
        if (image && !busy) void send(image)
    }

    return (
        <section onPaste={handlePaste} aria-labelledby="screenshot-title" className="rounded-2xl bg-be-navy border-l-4 border-be-orange p-4 sm:p-5 mb-6 shadow-md">
            <div className="flex flex-col lg:flex-row lg:items-center gap-4">
                <div className="flex-1 min-w-0">
                    <h2 id="screenshot-title" className="text-xl font-bold tracking-wide">Send a Progress Screenshot</h2>
                    <p className="text-sm text-be-light-gray">
                        Finished for now? Screenshot your latest work (for Fusion 360, include the design history at the bottom), send it here, then clock out at the kiosk.
                    </p>
                    <div className="flex flex-wrap gap-2 mt-3">
                        {targets.map((t, i) => (
                            <button key={t.projectId + t.measureId} type="button" onClick={() => setChosen(i)}
                                className={"px-3 py-1.5 rounded-full text-sm font-bold transition-colors " +
                                    (t === target ? "bg-be-orange text-black" : "bg-be-navy-darker text-white hover:bg-be-navy-dark")}>
                                {t.projectName}
                            </button>
                        ))}
                    </div>
                    <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={NOTE_MAX_LENGTH} aria-label="Note about this screenshot"
                        placeholder="What are you working on? (optional)"
                        className="w-full mt-3 p-2 px-3 rounded-lg bg-be-navy-darker text-white border border-be-light-gray/30 text-sm"/>
                </div>
                <div className="lg:w-56 shrink-0">
                    <input ref={fileRef} type="file" accept="image/*" className="hidden" disabled={busy} aria-label="Choose a screenshot"
                        onChange={(e) => { const file = e.target.files?.[0]; if (file) void send(file) }}/>
                    <button type="button" onClick={() => fileRef.current?.click()} disabled={busy}
                        className="w-full py-3 rounded-full bg-be-orange hover:bg-be-orange-dark text-black font-bold disabled:opacity-40 flex items-center justify-center gap-2">
                        {busy ? <MoonLoader color="black" size={16}/> : <FaCamera/>}
                        Choose Screenshot
                    </button>
                    <p className="text-xs text-be-light-gray text-center mt-2">
                        {target.waitingAt ? `Latest sent ${timeOf(target.waitingAt)}` : "On a computer you can also paste it here"}
                    </p>
                </div>
            </div>
            {message && <p className={"text-sm mt-3 " + (message.error ? "text-red-400" : "text-green-400")}>{message.text}</p>}
        </section>
    )
}

//the other thing members go to themselves rather than through the kiosk
export function SlugworksLink(): JSX.Element {
    return (
        <Link to="/slugworks" className="block rounded-2xl bg-be-navy hover:bg-be-navy-dark p-4 sm:p-5 mb-6 shadow-md transition-colors">
            <h2 className="text-xl font-bold tracking-wide">Slugworks Course</h2>
            <p className="text-sm text-be-light-gray">Check off what you've finished and get certified on the machines.</p>
        </Link>
    )
}
