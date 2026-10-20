import { useEffect, useRef, useState, type JSX, type ReactNode } from "react"
import { MoonLoader } from "react-spinners"
import { FaPlus } from "react-icons/fa"
import { cancelHoursRequest, getActivityTypes, getMyHoursRequests, submitHoursRequests, type HoursRequest, type MyHoursRequests } from "../Tools/Fetch"
import {
    DAY_MINUTES, SNAP, dayLabel, firstFreeRange, formatLength, formatMinutes, isoBlock, overlaps, pacificMinutes, toHHMM,
    type Block, type Draft, type FixedBlock
} from "../Tools/dayPlanner"
import { DayTimeline, DraftEditor, Legend, PlannerCalendar } from "./DayPlanner"

const STATUS_STYLE: Record<HoursRequest["status"], string> = {
    pending: "bg-amber-500 text-black",
    approved: "bg-green-600 text-black",
    denied: "bg-red-500 text-black",
}

//besa/besaLead only (Profile) - ask for hours they weren't clocked in for. Pick a day on the calendar, draw one
//or more time ranges on that day's timeline (drag, or tap on a phone), say what was worked on and why it wasn't
//clocked, and send them to the root admin. Approved ones are added to that day like a kiosk visit.
export default function HoursRequestPanel(): JSX.Element {
    const [view, setView] = useState<MyHoursRequests | null | undefined>(undefined) // undefined = loading, null = failed
    const [activityTypes, setActivityTypes] = useState<string[]>([])
    const [selectedDay, setSelectedDay] = useState<string | null>(null)
    const [draftsByDay, setDraftsByDay] = useState<Record<string, Draft[]>>({})
    const [busy, setBusy] = useState(false)
    const [message, setMessage] = useState<{text: string, error: boolean} | null>(null)
    const nextDraftId = useRef(1)

    useEffect(() => {
        getMyHoursRequests().then(result => {
            if (result.success) {
                setView(result)
                setSelectedDay(result.lastDay)
            } else {
                setView(null)
            }
        })
        getActivityTypes().then(result => setActivityTypes(result || []))
    }, [])

    if (view === undefined) {
        return <Section><div className="flex justify-center py-10"><MoonLoader color="white" size={24}/></div></Section>
    }
    if (view === null || !selectedDay) {
        return <Section><p className="text-red-400 text-sm">Couldn't load hours requests - try again later.</p></Section>
    }

    const drafts = draftsByDay[selectedDay] || []
    const setDrafts = (next: Draft[]) => setDraftsByDay(prev => ({...prev, [selectedDay]: next}))
    const isToday = selectedDay === view.lastDay
    const nowMinutes = isToday ? pacificMinutes(new Date()) : DAY_MINUTES

    const logged: Block[] = (view.logged[selectedDay] || []).map(l => ({
        start: pacificMinutes(new Date(l.start)),
        end: l.end ? pacificMinutes(new Date(l.end)) || DAY_MINUTES : nowMinutes,
    }))
    const dayRequests = view.requests.filter(r => r.date === selectedDay)
    const pendingBlocks = dayRequests.filter(r => r.status === "pending").map(r => isoBlock(r.start, r.end))
    const fixed: FixedBlock[] = [
        ...logged.map(b => ({...b, label: "Clocked in", className: "bg-gray-500/80"})),
        ...dayRequests.filter(r => r.status !== "denied").map(r => ({
            ...isoBlock(r.start, r.end),
            label: r.status === "pending" ? "Waiting for approval" : "Approved",
            className: "border-2 border-dashed " + (r.status === "pending" ? "border-amber-400 bg-amber-500/30" : "border-green-400 bg-green-600/30"),
        })),
    ]

    //what's wrong with each draft, if anything - shown under it, and Send stays off until none are left
    const problems = drafts.map(d => {
        if (d.end <= d.start) return "The end time has to be after the start time."
        if (d.end > nowMinutes) return "This goes past the current time."
        if (logged.some(b => overlaps(b, d))) return "This overlaps time that's already logged."
        if (pendingBlocks.some(b => overlaps(b, d))) return "This overlaps a request you've already sent."
        if (drafts.some(o => o.id !== d.id && overlaps(o, d))) return "This overlaps another range on this day."
        if (d.activities.length === 0) return "Pick what you worked on."
        if (d.reason === "other" && !d.details.trim()) return "Say what happened (the reason is \"Other\")."
        return null
    })

    function addDraft(start: number, end: number) {
        const lastDraft = drafts[drafts.length - 1]
        setDrafts([...drafts, {
            id: nextDraftId.current++, start, end,
            //later ranges start from the previous one's answers - usually the same activities and reason
            activities: lastDraft?.activities || [], reason: lastDraft?.reason || "forgotClockIn", details: "",
        }])
        setMessage(null)
    }

    async function send() {
        if (!selectedDay || drafts.length === 0 || problems.some(p => p)) return
        setBusy(true)
        setMessage(null)
        const result = await submitHoursRequests(selectedDay, drafts.map(d => ({
            start: toHHMM(d.start), end: toHHMM(d.end), activities: d.activities, reason: d.reason, details: d.details.trim(),
        })))
        setBusy(false)
        if (result.success) {
            setView(result)
            setDrafts([])
            setMessage({text: `Sent ${drafts.length === 1 ? "your request" : `${drafts.length} requests`} for ${dayLabel(selectedDay)} - they'll show up in My Hours once approved.`, error: false})
        } else {
            setMessage({text: result.detail, error: true})
        }
    }

    async function cancel(request: HoursRequest) {
        setBusy(true)
        setMessage(null)
        const result = await cancelHoursRequest(request.id)
        setBusy(false)
        if (result.success) {
            setView(result)
        } else {
            setMessage({text: result.detail, error: true})
        }
    }

    return (
        <Section>
            <p className="text-sm text-gray-400 mb-4">
                Forgot to clock in, or worked outside the office? Pick the day, drag on its timeline to mark when you worked (tap on
                a phone), then say what you worked on and why. A root admin approves each request before it's added to your hours.
            </p>
            <div className="grid gap-4 grid-cols-[minmax(0,1fr)] lg:grid-cols-[17rem_minmax(0,1fr)] items-start">
                <PlannerCalendar firstDay={view.firstDay} lastDay={view.lastDay} selectedDay={selectedDay}
                    dotsFor={(key) => {
                        const requests = view.requests.filter(r => r.date === key)
                        return [
                            (view.logged[key] || []).length > 0 && "bg-gray-400",
                            (draftsByDay[key] || []).length > 0 && "bg-blue-500",
                            requests.some(r => r.status === "pending") && "bg-amber-500",
                            requests.some(r => r.status === "approved") && "bg-green-500",
                        ].filter(Boolean) as string[]
                    }}
                    onSelect={(day) => { setSelectedDay(day); setMessage(null) }}/>
                <div className="min-w-0">
                    <div className="flex items-center justify-between gap-2 mb-2">
                        <h3 className="font-semibold">{dayLabel(selectedDay)}{isToday && <span className="text-gray-400 font-normal"> · today</span>}</h3>
                        <button onClick={() => {
                            const range = firstFreeRange([...logged, ...pendingBlocks, ...drafts], nowMinutes)
                            addDraft(range.start, range.end)
                        }} disabled={busy || nowMinutes < SNAP}
                            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full bg-gray-700 hover:bg-gray-600 disabled:opacity-40">
                            <FaPlus size={9}/> Add time range
                        </button>
                    </div>
                    <DayTimeline key={selectedDay} fixed={fixed}
                        drafts={drafts} problems={problems} nowMinutes={nowMinutes} isToday={isToday}
                        onCreate={addDraft} onChange={(id, block) => setDrafts(drafts.map(d => d.id === id ? {...d, ...block} : d))}/>
                    <Legend items={[["bg-gray-500", "Clocked in"], ["bg-blue-600", "New request"], ["bg-amber-500/70", "Waiting for approval"], ["bg-green-600/70", "Approved"]]}/>

                    {drafts.length > 0 &&
                        <div className="flex flex-col gap-3 mt-4">
                            {drafts.map((d, i) => (
                                <DraftEditor key={d.id} index={i} draft={d} problem={problems[i]} activityTypes={activityTypes}
                                    maxMinutes={nowMinutes} disabled={busy} mode="request"
                                    onChange={(next) => setDrafts(drafts.map(o => o.id === d.id ? next : o))}
                                    onRemove={() => setDrafts(drafts.filter(o => o.id !== d.id))}/>
                            ))}
                        </div>
                    }
                    {message && <p className={"text-sm mt-3 " + (message.error ? "text-red-400" : "text-green-400")}>{message.text}</p>}
                    {drafts.length > 0 &&
                        <button onClick={() => void send()} disabled={busy || problems.some(p => p)}
                            className="w-full mt-3 py-3 rounded-full bg-blue-800 hover:bg-blue-900 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2">
                            {busy && <MoonLoader color="white" size={16}/>}
                            Send {drafts.length === 1 ? "Request" : `${drafts.length} Requests`} for Approval
                        </button>
                    }
                </div>
            </div>

            <h3 className="font-semibold mt-6 mb-2">My Requests</h3>
            {view.requests.length === 0 ?
                <p className="text-gray-500 italic text-sm">You haven't sent any requests recently.</p>
                :
                <div className="flex flex-col gap-2">
                    {view.requests.map(r => <RequestRow key={r.id} request={r} busy={busy} onCancel={() => void cancel(r)}/>)}
                </div>
            }
        </Section>
    )
}

function Section({children}: {children: ReactNode}) {
    return (
        <section className="bg-gray-800 rounded-2xl p-3 sm:p-6">
            <h2 className="text-2xl tracking-wide mb-2">Request Hours</h2>
            {children}
        </section>
    )
}

function RequestRow({request, busy, onCancel}: {request: HoursRequest, busy: boolean, onCancel: () => void}) {
    const {start, end} = isoBlock(request.start, request.end)
    return (
        <div className="rounded-xl bg-gray-900/40 border border-gray-700 p-3 text-sm flex flex-wrap items-start gap-x-3 gap-y-1">
            <div className="flex-1 min-w-[12rem]">
                <p>
                    <span className="font-semibold">{dayLabel(request.date, "short")}</span>
                    <span className="text-gray-300"> · {formatMinutes(start)} – {formatMinutes(end)}</span>
                    <span className="text-gray-400"> · {formatLength(end - start)}</span>
                </p>
                <p className="text-gray-400">{request.activities.join(", ")} · {request.reasonLabel}</p>
                {request.details && <p className="text-gray-400 italic break-words">"{request.details}"</p>}
                {request.decisionNote && <p className="text-gray-300 break-words">Admin: {request.decisionNote}</p>}
            </div>
            <div className="flex items-center gap-2">
                <span className={"text-[10px] px-1.5 py-0.5 rounded font-semibold uppercase " + STATUS_STYLE[request.status]}>
                    {request.status === "pending" ? "Waiting" : request.status}
                </span>
                {request.status === "pending" &&
                    <button onClick={onCancel} disabled={busy}
                        className="text-xs px-3 py-1 rounded-full border border-gray-500 hover:bg-gray-700 disabled:opacity-40">
                        Cancel
                    </button>
                }
            </div>
        </div>
    )
}
