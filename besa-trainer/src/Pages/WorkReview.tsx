import { useEffect, useState, type JSX } from "react"
import { Link } from "react-router-dom"
import { MoonLoader } from "react-spinners"
import Header from "../Components/Header"
import WorkDayCard from "../Components/WorkDayCard"
import { getCertifications, getWorkReview, overrideGrade, regradeDay, type WorkDay, type WorkGrade } from "../Tools/Fetch"

const GRADES: WorkGrade[] = ["A", "B", "C"]
const NOTE_MAX_LENGTH = 500

//a lead's say on one day - the AI's grade is a prompt to look, so a lead can always set it aside
function LeadControls({day, onChange}: {day: WorkDay, onChange: (day: WorkDay) => void}): JSX.Element {
    const [note, setNote] = useState(day.override?.note || "")
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState("")

    async function run(action: () => ReturnType<typeof regradeDay>) {
        setBusy(true)
        setError("")
        const result = await action()
        setBusy(false)
        if (result.success) {
            onChange(result.day)
        } else {
            setError(result.detail)
        }
    }

    return (
        <div className="border-t border-gray-700 pt-3">
            <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={NOTE_MAX_LENGTH} placeholder="Note (optional)" aria-label="Note on this grade"
                className="w-full p-2 rounded-lg bg-gray-800 border border-gray-600 text-sm mb-2"/>
            <div className="flex flex-wrap gap-2">
                {GRADES.map(grade => (
                    <button key={grade} type="button" disabled={busy} onClick={() => void run(() => overrideGrade(day.id, grade, note))}
                        className="px-3 py-1.5 rounded-full border border-gray-500 hover:bg-gray-700 text-xs disabled:opacity-40">
                        Set {grade}
                    </button>
                ))}
                {day.override &&
                    <button type="button" disabled={busy} onClick={() => void run(() => overrideGrade(day.id, null, ""))}
                        className="px-3 py-1.5 rounded-full border border-gray-500 hover:bg-gray-700 text-xs disabled:opacity-40">
                        Back to AI grade ({day.aiGrade || "none"})
                    </button>
                }
                <button type="button" disabled={busy} onClick={() => void run(() => regradeDay(day.id))}
                    className="px-3 py-1.5 rounded-full border border-gray-500 hover:bg-gray-700 text-xs disabled:opacity-40">
                    Grade Again
                </button>
            </div>
            {error && <p className="text-sm text-red-400 mt-1">{error}</p>}
        </div>
    )
}

function Certifications(): JSX.Element {
    const [data, setData] = useState<Awaited<ReturnType<typeof getCertifications>> | null>(null)

    useEffect(() => {
        getCertifications().then(setData)
    }, [])

    if (!data) return <div className="flex justify-center py-6"><MoonLoader color="white" size={24}/></div>
    if (!data.success) return <p className="text-sm text-red-400">{data.detail}</p>

    return (
        <div className="overflow-x-auto">
            <table className="w-full text-sm">
                <thead>
                    <tr className="text-left text-gray-400">
                        <th scope="col" className="py-2 pr-4 font-medium">Member</th>
                        <th scope="col" className="py-2 pr-4 font-medium">Items</th>
                        <th scope="col" className="py-2 font-medium">Certified</th>
                    </tr>
                </thead>
                <tbody>
                    {data.members.map(member => (
                        <tr key={member.uid} className="border-t border-gray-700 align-top">
                            <td className="py-2 pr-4 whitespace-nowrap">{member.besaName}</td>
                            <td className="py-2 pr-4 tabular-nums whitespace-nowrap">{member.finished}/{member.total}</td>
                            <td className="py-2 text-gray-300">{member.certified.join(", ") || "None yet"}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    )
}

//leads and the unlocked root account: everyone's graded days, most recent first, and who's certified on what
export default function WorkReview(): JSX.Element {
    const [days, setDays] = useState<WorkDay[] | null>(null)
    const [error, setError] = useState("")
    const [onlyFlagged, setOnlyFlagged] = useState(false)
    const [search, setSearch] = useState("")

    useEffect(() => {
        getWorkReview(30).then(result => {
            if (result.success) {
                setDays(result.days)
            } else {
                setError(result.detail)
            }
        })
    }, [])

    const shown = (days || []).filter(d =>
        (!onlyFlagged || d.grade === "B" || d.grade === "C") && (d.besaName || "").toLowerCase().includes(search.trim().toLowerCase()))

    return (
        <div className="bg-be-navy-darker w-full min-h-screen text-white font-sans">
            <Header/>
            <div className="h-20 relative top-0 left-0 w-full"></div>
            <div className="w-11/12 max-w-4xl mx-auto py-8 flex flex-col gap-6">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <h1 className="text-2xl sm:text-3xl md:text-4xl tracking-wider">Work Review</h1>
                    <Link to="/manage-projects" className="p-2 px-5 rounded-full bg-blue-800 hover:bg-blue-900 text-sm">Manage Projects</Link>
                </div>
                <section className="bg-gray-800 rounded-2xl p-3 sm:p-6">
                    <h2 className="text-2xl tracking-wide mb-3">Last 30 Days</h2>
                    <div className="flex flex-wrap items-center gap-4 mb-4">
                        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name" aria-label="Search by name"
                            className="p-2 px-3 rounded-lg bg-gray-900 border border-gray-600 text-sm"/>
                        <label className="flex items-center gap-2 text-sm cursor-pointer">
                            <input type="checkbox" checked={onlyFlagged} onChange={(e) => setOnlyFlagged(e.target.checked)} className="w-4 h-4 accent-amber-500"/>
                            Only B and C
                        </label>
                    </div>
                    {error && <p className="text-sm text-red-400">{error}</p>}
                    {!days && !error && <div className="flex justify-center py-6"><MoonLoader color="white" size={24}/></div>}
                    {days && shown.length === 0 && <p className="text-sm text-gray-400 italic">Nothing here.</p>}
                    <div className="flex flex-col gap-3">
                        {shown.map(day => {
                            const update = (next: WorkDay) => setDays(all => (all || []).map(d => d.id === next.id ? next : d))
                            return <WorkDayCard key={day.id} day={day} showName leadControls={<LeadControls day={day} onChange={update}/>}/>
                        })}
                    </div>
                </section>
                <section className="bg-gray-800 rounded-2xl p-3 sm:p-6">
                    <h2 className="text-2xl tracking-wide mb-3">Slugworks Certifications</h2>
                    <Certifications/>
                </section>
            </div>
        </div>
    )
}
