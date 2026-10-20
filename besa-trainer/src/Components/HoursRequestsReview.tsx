import { useEffect, useState, type JSX } from "react"
import { MoonLoader } from "react-spinners"
import { decideHoursRequest, getHoursRequests, type HoursRequest } from "../Tools/Fetch"
import { fromDateKey } from "../Tools/dates"

const NOTE_MAX_LENGTH = 500 // same cap as the backend's HOURS_REQUEST_DETAILS_MAX_LENGTH

function formatTime(iso: string): string {
    return new Date(iso).toLocaleTimeString("en-US", {hour: "numeric", minute: "2-digit", timeZone: "America/Los_Angeles"})
}

function formatLength(start: string, end: string): string {
    const minutes = Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60_000)
    const h = Math.floor(minutes / 60)
    const m = minutes % 60
    return h && m ? `${h}h ${m}m` : h ? `${h}h` : `${m}m`
}

//root admin only (Profile) - members' requests for hours they weren't clocked in for. Approving one adds it to
//that member's day as a visit (onApproved lets Everyone's Hours reload); denying can say why.
export default function HoursRequestsReview({onApproved, onSessionExpired}: {onApproved: () => void, onSessionExpired: () => void}): JSX.Element {
    const [data, setData] = useState<{pending: HoursRequest[], decided: HoursRequest[]} | null>(null)
    const [error, setError] = useState("")
    const [busyId, setBusyId] = useState<string | null>(null)
    const [denying, setDenying] = useState<{id: string, note: string} | null>(null)
    const [showDecided, setShowDecided] = useState(false)

    useEffect(() => {
        getHoursRequests().then(result => {
            if (result.success) setData(result)
            else if (result.status === 403) onSessionExpired()
            else setError(result.detail)
        })
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    async function decide(request: HoursRequest, approve: boolean, note = "") {
        setBusyId(request.id)
        setError("")
        const result = await decideHoursRequest(request.id, approve, note)
        setBusyId(null)
        if (result.success) {
            setData(result)
            setDenying(null)
            if (approve) onApproved()
        } else if (result.status === 403) {
            onSessionExpired()
        } else {
            setError(result.detail)
        }
    }

    return (
        <section className="bg-gray-800 rounded-2xl p-3 sm:p-6">
            <div className="flex items-center gap-3 mb-4">
                <h2 className="text-2xl tracking-wide">Hours Requests</h2>
                {data && data.pending.length > 0 &&
                    <span className="text-xs px-2 py-0.5 rounded-full bg-amber-500 text-black font-semibold">{data.pending.length} waiting</span>
                }
            </div>
            {error && <p className="text-red-400 text-sm mb-3">{error}</p>}
            {data === null ? (!error && <div className="flex justify-center py-6"><MoonLoader color="white" size={24}/></div>)
                : <>
                    {data.pending.length === 0 ?
                        <p className="text-gray-500 italic text-sm">No requests waiting for approval.</p>
                        :
                        <div className="flex flex-col gap-2">
                            {data.pending.map(r => (
                                <div key={r.id} className="rounded-xl bg-gray-900/40 border border-gray-700 p-3 text-sm">
                                    <RequestSummary request={r}/>
                                    {denying?.id === r.id ?
                                        <div className="mt-3 flex flex-col gap-2">
                                            <input value={denying.note} maxLength={NOTE_MAX_LENGTH} autoFocus disabled={busyId === r.id}
                                                onChange={(e) => setDenying({id: r.id, note: e.target.value})}
                                                onKeyDown={(e) => { if (e.key === "Enter") void decide(r, false, denying.note) }}
                                                placeholder="Why? (optional - the member sees this)"
                                                className="w-full p-2 rounded-lg bg-gray-700 text-white"/>
                                            <div className="flex gap-2">
                                                <button onClick={() => void decide(r, false, denying.note)} disabled={busyId === r.id}
                                                    className="flex-1 py-2 rounded-full bg-red-800 hover:bg-red-900 disabled:opacity-40 flex items-center justify-center gap-2">
                                                    {busyId === r.id && <MoonLoader color="white" size={14}/>}
                                                    Deny Request
                                                </button>
                                                <button onClick={() => setDenying(null)} disabled={busyId === r.id}
                                                    className="flex-1 py-2 rounded-full border-2 border-gray-400 hover:bg-gray-700 disabled:opacity-40">
                                                    Back
                                                </button>
                                            </div>
                                        </div>
                                        :
                                        <div className="mt-3 flex gap-2">
                                            <button onClick={() => void decide(r, true)} disabled={busyId !== null}
                                                className="flex-[2] py-2 rounded-full bg-green-700 hover:bg-green-800 disabled:opacity-40 flex items-center justify-center gap-2">
                                                {busyId === r.id && <MoonLoader color="white" size={14}/>}
                                                Approve
                                            </button>
                                            <button onClick={() => setDenying({id: r.id, note: ""})} disabled={busyId !== null}
                                                className="flex-1 py-2 rounded-full bg-gray-700 hover:bg-gray-600 disabled:opacity-40">
                                                Deny
                                            </button>
                                        </div>
                                    }
                                </div>
                            ))}
                        </div>
                    }
                    {data.decided.length > 0 &&
                        <div className="mt-4">
                            <button onClick={() => setShowDecided(!showDecided)} className="text-sm text-gray-300 hover:text-white underline">
                                {showDecided ? "Hide" : "Show"} recently decided ({data.decided.length})
                            </button>
                            {showDecided &&
                                <div className="flex flex-col gap-2 mt-2">
                                    {data.decided.map(r => (
                                        <div key={r.id} className="rounded-xl bg-gray-900/40 border border-gray-700 p-3 text-sm opacity-80">
                                            <RequestSummary request={r}/>
                                        </div>
                                    ))}
                                </div>
                            }
                        </div>
                    }
                </>
            }
        </section>
    )
}

function RequestSummary({request}: {request: HoursRequest}) {
    const day = fromDateKey(request.date).toLocaleDateString("en-US", {weekday: "short", month: "short", day: "numeric"})
    return (
        <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
            <div className="flex-1 min-w-[12rem]">
                <p>
                    <span className="font-semibold">{request.besaName || "(no name on file)"}</span>
                    <span className="text-gray-300"> · {day} · {formatTime(request.start)} – {formatTime(request.end)}</span>
                    <span className="text-gray-400"> · {formatLength(request.start, request.end)} (≈{request.hours} h)</span>
                </p>
                <p className="text-gray-400">{request.activities.join(", ")}</p>
                <p className="text-sky-300">{request.reasonLabel}</p>
                {request.details && <p className="text-gray-300 italic break-words">"{request.details}"</p>}
                {request.decisionNote && <p className="text-gray-400 break-words">Note: {request.decisionNote}</p>}
            </div>
            {request.status !== "pending" &&
                <span className={"text-[10px] px-1.5 py-0.5 rounded font-semibold uppercase " + (request.status === "approved" ? "bg-green-600 text-black" : "bg-red-500 text-black")}>
                    {request.status}
                </span>
            }
        </div>
    )
}
