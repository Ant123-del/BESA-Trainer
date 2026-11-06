import { useState, type JSX } from "react"
import { FaCheck } from "react-icons/fa"
import { MoonLoader } from "react-spinners"
import { Screenshot } from "./GradeBadge"
import CourseChecklist from "./CourseChecklist"
import type { WorkItem, WorkMeasure, WorkMode, WorkProject, WorkReportInput } from "../Tools/Fetch"

const DESCRIPTION_MAX_LENGTH = 1000 //same cap as the backend's WORK_DESCRIPTION_MAX_LENGTH

//what's typed so far, kept by measure so Re-check doesn't lose it
export type WorkEntries = {
    description: string
    quantities: Record<string, string>
    checked: Record<string, boolean>
    confirmed: Record<string, string[]>
}

export const emptyEntries = (): WorkEntries => ({description: "", quantities: {}, checked: {}, confirmed: {}})

const key = (project: WorkProject, measure: WorkMeasure) => `${project.projectId}/${measure.measureId}`

//everything starts ticked that was matched to them, so they only un-tick what wasn't theirs. Re-check leaves anything they already touched alone.
export function withDefaultConfirmed(entries: WorkEntries, projects: WorkProject[]): WorkEntries {
    const confirmed = {...entries.confirmed}
    for (const project of projects) {
        for (const measure of project.measures) {
            if (measure.confirmable && confirmed[key(project, measure)] === undefined) {
                confirmed[key(project, measure)] = measure.items.filter(i => i.mine).map(i => i.id)
            }
        }
    }
    return {...entries, confirmed}
}

export function toWorkReport(entries: WorkEntries, projects: WorkProject[], workMode: WorkMode, officePercent: number): WorkReportInput {
    return {
        description: entries.description.trim(),
        workMode,
        ...(workMode === "hybrid" ? {officePercent} : {}),
        projects: projects.map(project => ({
            projectId: project.projectId,
            measures: project.measures.map(measure => {
                const k = key(project, measure)
                const quantity = Number(entries.quantities[k])
                return {
                    measureId: measure.measureId,
                    ...(measure.type === "quantity" && Number.isFinite(quantity) && quantity >= 0 ? {quantity} : {}),
                    ...(measure.type === "checkbox" ? {checked: !!entries.checked[k]} : {}),
                    ...(measure.confirmable ? {confirmedItems: entries.confirmed[k] || []} : {}),
                }
            }),
        })),
    }
}

function ItemRow({item, confirmable, confirmed, onToggle}: {item: WorkItem, confirmable: boolean, confirmed: boolean, onToggle: () => void}): JSX.Element {
    const body = (
        <div className="min-w-0 flex-1">
            <p className="text-sm text-white break-words">{item.label}</p>
            {item.detail && <p className="text-xs text-gray-400 break-words">{item.detail}</p>}
            {(item.fields || []).map(f => (
                <p key={f.field} className="text-xs text-gray-400 break-words">
                    <span className="text-gray-300">{f.field}</span>: {f.private ? "changed" : <>{f.before ?? "empty"} → {f.after ?? "empty"}</>}
                </p>
            ))}
        </div>
    )
    if (!confirmable) {
        return <div className="flex items-start gap-3 py-1.5">{body}</div>
    }
    return (
        <label className="flex items-start gap-3 py-1.5 cursor-pointer">
            <input type="checkbox" checked={confirmed} onChange={onToggle} className="mt-1 w-4 h-4 accent-amber-500 shrink-0"/>
            {body}
        </label>
    )
}

function statusColor(status: WorkMeasure["status"]): string {
    if (status === "unavailable" || status === "missing") return "text-amber-300"
    return "text-gray-300"
}

//one measure's row on the confirm screen: something to fill in, or what was found, with a tick-box per row for
//the sources several people share
function MeasureRow({project, measure, entries, setEntries, studentId}: {
    project: WorkProject, measure: WorkMeasure, entries: WorkEntries, setEntries: (e: WorkEntries) => void, studentId: string
}): JSX.Element {
    const k = key(project, measure)
    const confirmed = entries.confirmed[k] || []
    const inputId = `measure-${k}`

    if (measure.type === "quantity") {
        return (
            <div className="flex items-center gap-3 py-1.5">
                <label htmlFor={inputId} className="flex-1 text-sm">{measure.label}</label>
                <input id={inputId} type="number" min={0} inputMode="numeric" value={entries.quantities[k] ?? ""} placeholder="0"
                    onChange={(e) => setEntries({...entries, quantities: {...entries.quantities, [k]: e.target.value}})}
                    className="w-24 p-2 rounded-lg bg-gray-800 text-white border border-gray-600 text-right"/>
                {measure.unit && <span className="text-xs text-gray-400 w-14">{measure.unit}</span>}
            </div>
        )
    }
    if (measure.type === "checkbox") {
        return (
            <label className="flex items-center gap-3 py-1.5 cursor-pointer">
                <input type="checkbox" checked={!!entries.checked[k]} className="w-4 h-4 accent-amber-500"
                    onChange={(e) => setEntries({...entries, checked: {...entries.checked, [k]: e.target.checked}})}/>
                <span className="text-sm">{measure.label}</span>
            </label>
        )
    }

    if (measure.type === "course") {
        return (
            <div className="py-1.5">
                <p className="text-sm font-semibold mb-1">{measure.label}</p>
                <CourseChecklist studentId={studentId} startClosed/>
            </div>
        )
    }

    const categories = [...new Set(measure.items.map(i => i.category || ""))]
    return (
        <div className="py-1.5">
            <p className="text-sm font-semibold">{measure.label}</p>
            <p className={"text-xs mb-1 " + statusColor(measure.status)}>{measure.summary}</p>
            {measure.newScreenshot &&
                <div className="flex gap-3 my-2">
                    {measure.oldScreenshot && <Screenshot id={measure.oldScreenshot} label="Old"/>}
                    <Screenshot id={measure.newScreenshot} label="New"/>
                </div>
            }
            {categories.map(category => (
                <div key={category}>
                    {category && <p className="text-xs uppercase tracking-wide text-amber-400 mt-2">{category}</p>}
                    {measure.items.filter(i => (i.category || "") === category).map(item => (
                        <ItemRow key={item.id} item={item} confirmable={measure.confirmable} confirmed={confirmed.includes(item.id)}
                            onToggle={() => setEntries({...entries, confirmed: {
                                ...entries.confirmed,
                                [k]: confirmed.includes(item.id) ? confirmed.filter(i => i !== item.id) : [...confirmed, item.id],
                            }})}/>
                    ))}
                </div>
            ))}
        </div>
    )
}

//clock-out's second screen: what was found for each project they picked, for them to confirm and fill in
export default function WorkReportForm({projects, untracked, entries, setEntries, rechecking, onRecheck, studentId}: {
    projects: WorkProject[], untracked: string[], entries: WorkEntries, setEntries: (e: WorkEntries) => void,
    rechecking: boolean, onRecheck: () => void, studentId: string
}): JSX.Element {
    const [recheckedAt, setRecheckedAt] = useState<number | null>(null)

    return (
        <>
            {projects.length > 0 &&
                <div className="flex items-center justify-end gap-2 mb-2">
                    {recheckedAt && !rechecking && <span className="text-xs text-green-400 flex items-center gap-1"><FaCheck className="w-3 h-3"/> Up to date</span>}
                    <button type="button" disabled={rechecking} onClick={() => { setRecheckedAt(Date.now()); onRecheck() }}
                        className="text-xs px-3 py-1.5 rounded-full border border-gray-500 hover:bg-gray-700 disabled:opacity-40 flex items-center gap-2">
                        {rechecking && <MoonLoader color="white" size={10}/>}
                        Re-check
                    </button>
                </div>
            }
            <div className="flex flex-col gap-3 mb-4">
                {projects.map(project => (
                    <section key={project.projectId} className="rounded-xl bg-gray-800/70 border border-gray-700 p-3 sm:p-4">
                        <h4 className="font-bold text-amber-400">{project.name}</h4>
                        <div className="divide-y divide-gray-700/70">
                            {project.measures.map(measure => (
                                <MeasureRow key={measure.measureId} project={project} measure={measure} entries={entries} setEntries={setEntries} studentId={studentId}/>
                            ))}
                        </div>
                    </section>
                ))}
            </div>
            {untracked.length > 0 &&
                <p className="text-xs text-gray-400 mb-3">Nothing to measure for {untracked.join(", ")}.</p>
            }
            <label htmlFor="work-description" className="block text-sm font-semibold mb-1">
                What did you do today?{projects.length === 0 && <span className="font-normal text-gray-400"> (optional)</span>}
            </label>
            <textarea id="work-description" rows={3} maxLength={DESCRIPTION_MAX_LENGTH} value={entries.description}
                onChange={(e) => setEntries({...entries, description: e.target.value})}
                className="w-full p-3 rounded-xl bg-gray-800 text-white border border-gray-600"/>
        </>
    )
}
