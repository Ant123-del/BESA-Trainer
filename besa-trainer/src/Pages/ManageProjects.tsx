import { useEffect, useState, type JSX } from "react"
import { Link } from "react-router-dom"
import { FaPlus, FaTimes } from "react-icons/fa"
import { MoonLoader } from "react-spinners"
import Header from "../Components/Header"
import {
    deleteTrackingProject, getTrackingProjects, saveTrackingCalendars, saveTrackingProject, type TrackingMeasureConfig, type TrackingProject
} from "../Tools/Fetch"

const MEASURE_KINDS: {type: string, label: string, hint: string}[] = [
    {type: "quantity", label: "Self report: a number", hint: "They type how many at clock-out."},
    {type: "checkbox", label: "Self report: a checkbox", hint: "They tick whether it got done."},
    {type: "screenshot", label: "Old vs new screenshots", hint: "They send a screenshot from the home page, and the AI compares it with the last one."},
    {type: "github", label: "GitHub commits", hint: "Commits by them while clocked in, matched by email then name."},
    {type: "google_sheets", label: "Google Sheets", hint: "Rows and cells added since they clocked in."},
    {type: "google_slides", label: "Google Slides", hint: "Slides, rearranging and text since they clocked in. Animations can't be seen, so add a number for those."},
    {type: "gmail", label: "Gmail sent", hint: "Emails sent from the connected account while they were clocked in."},
    {type: "google_calendar", label: "Google Calendar changes", hint: "Uses the calendars listed above."},
    {type: "booking_db", label: "BESA Booking database", hint: "Every change while clocked in, for them to tick off."},
    {type: "trainer_data", label: "BESA Trainer data input", hint: "What they saved in BESA Trainer on their account."},
    {type: "trainer_practice", label: "BESA Trainer practice", hint: "Practice checkpoints on their account."},
    {type: "custom_api", label: "Another API", hint: "Calls a URL at clock-out and gives the AI what comes back."},
]

const INPUT = "w-full p-2 rounded-lg bg-gray-900 border border-gray-600 text-sm"

function lines(values: string[] | undefined): string {
    return (values || []).join("\n")
}

function splitLines(text: string): string[] {
    return text.split("\n").map(l => l.trim()).filter(Boolean)
}

//the settings each kind of measure needs
function MeasureFields({measure, onChange}: {measure: TrackingMeasureConfig, onChange: (m: TrackingMeasureConfig) => void}): JSX.Element | null {
    switch (measure.type) {
        case "quantity":
            return <input className={INPUT} value={measure.unit || ""} onChange={(e) => onChange({...measure, unit: e.target.value})} maxLength={30}
                placeholder="Unit, e.g. printed" aria-label="Unit"/>
        case "screenshot":
            return <textarea className={INPUT} rows={2} value={measure.lookFor || ""} onChange={(e) => onChange({...measure, lookFor: e.target.value})} maxLength={1000}
                placeholder="What should the AI look out for?" aria-label="What the AI should look out for"/>
        case "github":
            return <textarea className={INPUT} rows={2} value={lines(measure.repos)} onChange={(e) => onChange({...measure, repos: e.target.value.split("\n")})}
                placeholder="One repository per line: owner/name or a GitHub link" aria-label="Repositories"/>
        case "google_sheets":
        case "google_slides":
            return <textarea className={INPUT} rows={2} value={lines(measure.fileIds)} onChange={(e) => onChange({...measure, fileIds: e.target.value.split("\n")})}
                placeholder="One link per line. The connected account needs access to each file." aria-label="File links"/>
        case "custom_api":
            return (
                <div className="flex flex-col gap-2">
                    <input className={INPUT} value={measure.url || ""} onChange={(e) => onChange({...measure, url: e.target.value})} maxLength={500}
                        placeholder="https://... ({since}, {until}, {email} and {name} get filled in)" aria-label="URL"/>
                    <div className="flex gap-2">
                        <input className={INPUT} value={measure.headerName || ""} onChange={(e) => onChange({...measure, headerName: e.target.value})} maxLength={60}
                            placeholder="Auth header (optional)" aria-label="Auth header name"/>
                        <input className={INPUT} type="password" value={measure.headerValue || ""} onChange={(e) => onChange({...measure, headerValue: e.target.value})}
                            placeholder={measure.hasHeaderValue ? "Saved - leave blank to keep" : "Header value"} aria-label="Auth header value" autoComplete="off"/>
                    </div>
                </div>
            )
        default:
            return null
    }
}

function ProjectEditor({initial, activityTypes, onSaved, onDeleted, onCancel}: {
    initial: Partial<TrackingProject>, activityTypes: string[], onSaved: (p: TrackingProject) => void, onDeleted: (id: string) => void, onCancel: () => void
}): JSX.Element {
    const [name, setName] = useState(initial.name || "")
    const [description, setDescription] = useState(initial.description || "")
    const [activities, setActivities] = useState<string[]>(initial.activities || [])
    const [measures, setMeasures] = useState<TrackingMeasureConfig[]>(initial.measures || [])
    const [adding, setAdding] = useState("quantity")
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState("")

    function update(index: number, next: TrackingMeasureConfig) {
        setMeasures(measures.map((m, i) => i === index ? next : m))
    }

    function addMeasure() {
        const kind = MEASURE_KINDS.find(k => k.type === adding)
        setMeasures([...measures, {type: adding, label: kind?.label.replace(/^Self report: /, "") || ""}])
    }

    async function handleSave() {
        setBusy(true)
        setError("")
        const result = await saveTrackingProject({
            id: initial.id, name, description, activities,
            measures: measures.map(m => ({...m, repos: splitLines(lines(m.repos)), fileIds: splitLines(lines(m.fileIds))})),
        })
        setBusy(false)
        if (result.success) {
            onSaved(result.project)
        } else {
            setError(result.detail)
        }
    }

    async function handleDelete() {
        if (!initial.id || !window.confirm(`Delete ${initial.name}? Past days keep their reports.`)) return
        setBusy(true)
        const result = await deleteTrackingProject(initial.id)
        setBusy(false)
        if (result.success) {
            onDeleted(initial.id)
        } else {
            setError(result.detail)
        }
    }

    return (
        <div className="rounded-xl bg-gray-900 p-3 sm:p-4 flex flex-col gap-3">
            <div>
                <label htmlFor="project-name" className="block text-sm mb-1">Name</label>
                <input id="project-name" className={INPUT} value={name} onChange={(e) => setName(e.target.value)} maxLength={40}/>
            </div>
            <div>
                <label htmlFor="project-description" className="block text-sm mb-1">Description</label>
                <input id="project-description" className={INPUT} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={300}/>
            </div>
            <fieldset>
                <legend className="text-sm mb-1">Kiosk activities that count as this project</legend>
                <p className="text-xs text-gray-400 mb-2">Leave these empty and a new activity named after the project is added to the kiosk.</p>
                <div className="flex flex-wrap gap-2">
                    {[...new Set([...activityTypes, ...activities])].map(activity => (
                        <button key={activity} type="button" aria-pressed={activities.includes(activity)}
                            onClick={() => setActivities(activities.includes(activity) ? activities.filter(a => a !== activity) : [...activities, activity])}
                            className={"px-3 py-1 rounded-full text-xs font-bold " + (activities.includes(activity) ? "bg-be-orange text-black" : "bg-gray-700 hover:bg-gray-600")}>
                            {activity}
                        </button>
                    ))}
                </div>
            </fieldset>
            <div>
                <h3 className="text-sm mb-2">How it's measured</h3>
                <div className="flex flex-col gap-2">
                    {measures.map((measure, i) => (
                        <div key={measure.id || i} className="rounded-lg border border-gray-700 p-3 flex flex-col gap-2">
                            <div className="flex items-center gap-2">
                                <input className={INPUT} value={measure.label} onChange={(e) => update(i, {...measure, label: e.target.value})} maxLength={60} aria-label="Measure name"/>
                                <button type="button" aria-label={`Remove ${measure.label}`} onClick={() => setMeasures(measures.filter((_, j) => j !== i))} className="p-2 text-gray-400 hover:text-red-400">
                                    <FaTimes/>
                                </button>
                            </div>
                            <p className="text-xs text-gray-400">{MEASURE_KINDS.find(k => k.type === measure.type)?.hint ?? "The Slugworks course checklist."}</p>
                            <MeasureFields measure={measure} onChange={(next) => update(i, next)}/>
                        </div>
                    ))}
                </div>
                <div className="flex gap-2 mt-2">
                    <select value={adding} onChange={(e) => setAdding(e.target.value)} aria-label="Kind of measure" className={INPUT}>
                        {MEASURE_KINDS.map(kind => <option key={kind.type} value={kind.type}>{kind.label}</option>)}
                    </select>
                    <button type="button" onClick={addMeasure} className="px-4 rounded-full bg-gray-700 hover:bg-gray-600 text-sm flex items-center gap-2 shrink-0">
                        <FaPlus className="w-3 h-3"/> Add
                    </button>
                </div>
            </div>
            {error && <p className="text-sm text-red-400">{error}</p>}
            <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => void handleSave()} disabled={busy || !name.trim()} className="px-5 py-2 rounded-full bg-blue-800 hover:bg-blue-900 text-sm disabled:opacity-40">Save</button>
                <button type="button" onClick={onCancel} disabled={busy} className="px-5 py-2 rounded-full border border-gray-500 hover:bg-gray-700 text-sm">Cancel</button>
                {initial.id &&
                    <button type="button" onClick={() => void handleDelete()} disabled={busy} className="px-5 py-2 rounded-full text-red-400 hover:bg-gray-800 text-sm ml-auto">Delete</button>
                }
            </div>
        </div>
    )
}

//what's still missing before a project can actually fetch anything
function setupNotes(project: TrackingProject, connections: {google: boolean}, calendars: string[]): string[] {
    const notes: string[] = []
    for (const m of project.measures) {
        if (m.type === "github" && !(m.repos || []).length) notes.push(`${m.label}: needs a repository`)
        if ((m.type === "google_sheets" || m.type === "google_slides") && !(m.fileIds || []).length) notes.push(`${m.label}: needs a file`)
        if (["google_sheets", "google_slides", "gmail", "google_calendar"].includes(m.type) && !connections.google) notes.push(`${m.label}: Google isn't connected`)
        if (m.type === "google_calendar" && calendars.length === 0) notes.push(`${m.label}: no calendars listed`)
    }
    return [...new Set(notes)]
}

//a project is only data, so anything new to track gets set up here rather than in code
export default function ManageProjects(): JSX.Element {
    const [data, setData] = useState<Awaited<ReturnType<typeof getTrackingProjects>> | null>(null)
    const [editing, setEditing] = useState<string | null>(null)
    const [calendars, setCalendars] = useState("")
    const [calendarMessage, setCalendarMessage] = useState("")

    useEffect(() => {
        getTrackingProjects().then(result => {
            setData(result)
            if (result.success) setCalendars(result.calendarIds.join("\n"))
        })
    }, [])

    async function saveCalendars() {
        setCalendarMessage("")
        const result = await saveTrackingCalendars(splitLines(calendars))
        setCalendarMessage(result.success ? "Saved." : result.detail)
        if (result.success && data?.success) setData({...data, calendarIds: result.calendarIds})
    }

    const shell = (body: JSX.Element) => (
        <div className="bg-be-navy-darker w-full min-h-screen text-white font-sans">
            <Header/>
            <div className="h-20 relative top-0 left-0 w-full"></div>
            <div className="w-11/12 max-w-4xl mx-auto py-8 flex flex-col gap-6">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <h1 className="text-2xl sm:text-3xl md:text-4xl tracking-wider">Manage Projects</h1>
                    <Link to="/work-review" className="p-2 px-5 rounded-full bg-blue-800 hover:bg-blue-900 text-sm">Work Review</Link>
                </div>
                {body}
            </div>
        </div>
    )

    if (!data) return shell(<div className="flex justify-center py-16"><MoonLoader color="white" size={36}/></div>)
    if (!data.success) return shell(<p className="text-sm text-red-400">{data.detail}</p>)

    const {projects, connections, activityTypes, calendarIds} = data
    const replaceProjects = (next: TrackingProject[]) => {
        setData({...data, projects: next})
        setEditing(null)
    }
    const editorProps = {
        activityTypes,
        onCancel: () => setEditing(null),
        onDeleted: (id: string) => replaceProjects(projects.filter(p => p.id !== id)),
    }

    return shell(
        <>
            <section className="bg-gray-800 rounded-2xl p-3 sm:p-6">
                <h2 className="text-2xl tracking-wide mb-3">Connections</h2>
                <ul className="text-sm flex flex-col gap-1">
                    <li>{connections.google ? "Connected" : "Not connected"}: Google (Gmail, Calendar, Sheets, Slides)</li>
                    <li>
                        {connections.github === "ok" ? "Connected" : connections.github === "rejected" ? "Token rejected, so replace it. Public repos still work, a few lookups an hour"
                            : "No token, so limited to a few lookups an hour"}: GitHub
                    </li>
                    <li>{connections.ai ? "Connected" : "Not connected"}: AI grading</li>
                </ul>
            </section>

            <section className="bg-gray-800 rounded-2xl p-3 sm:p-6">
                <h2 className="text-2xl tracking-wide mb-1">Calendars</h2>
                <p className="text-sm text-gray-400 mb-3">Every calendar to watch, one id per line. Each has to be shared with the connected Google account.</p>
                <textarea rows={4} value={calendars} onChange={(e) => setCalendars(e.target.value)} className={INPUT} aria-label="Calendar ids"
                    placeholder="something@group.calendar.google.com"/>
                <div className="flex items-center gap-3 mt-2">
                    <button type="button" onClick={() => void saveCalendars()} className="px-5 py-2 rounded-full bg-blue-800 hover:bg-blue-900 text-sm">Save</button>
                    {calendarMessage && <span className="text-sm text-gray-300">{calendarMessage}</span>}
                </div>
            </section>

            <section className="bg-gray-800 rounded-2xl p-3 sm:p-6">
                <div className="flex items-center justify-between gap-3 mb-3">
                    <h2 className="text-2xl tracking-wide">Projects</h2>
                    <button type="button" onClick={() => setEditing("new")} className="px-4 py-2 rounded-full bg-be-orange hover:bg-be-orange-dark text-black text-sm font-bold">New Project</button>
                </div>
                <div className="flex flex-col gap-3">
                    {editing === "new" &&
                        <ProjectEditor key="new" initial={{}} {...editorProps} onSaved={(p) => {
                            setData(current => current?.success ? {...current, projects: [...projects, p], activityTypes: [...new Set([...activityTypes, ...p.activities])]} : current)
                            setEditing(null)
                        }}/>
                    }
                    {projects.map(project => editing === project.id ?
                        <ProjectEditor key={project.id} initial={project} {...editorProps} onSaved={(p) => replaceProjects(projects.map(x => x.id === p.id ? p : x))}/>
                        :
                        <div key={project.id} className="rounded-xl bg-gray-900 p-3 sm:p-4 flex items-start gap-3">
                            <div className="flex-1 min-w-0">
                                <h3 className="font-semibold">{project.name}</h3>
                                <p className="text-xs text-gray-400">{project.measures.map(m => m.label).join(" · ") || "Nothing measured yet"}</p>
                                {setupNotes(project, connections, calendarIds).map(note => <p key={note} className="text-xs text-amber-300">{note}</p>)}
                            </div>
                            <button type="button" onClick={() => setEditing(project.id)} className="px-4 py-1.5 rounded-full border border-gray-500 hover:bg-gray-700 text-sm shrink-0">Edit</button>
                        </div>
                    )}
                </div>
            </section>
        </>
    )
}
