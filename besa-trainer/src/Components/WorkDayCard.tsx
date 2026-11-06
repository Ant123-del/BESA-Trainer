import { useState, type JSX, type ReactNode } from "react"
import { FaChevronDown, FaChevronRight } from "react-icons/fa"
import GradeBadge, { GRADE_LABELS, Screenshot } from "./GradeBadge"
import { ExplainGrade } from "./WorkGradeResult"
import type { WorkDay } from "../Tools/Fetch"

function modeLabel(visit: WorkDay["visits"][number]): string {
    if (visit.workMode === "hybrid") return `Hybrid (${visit.officePercent}% office)`
    return visit.workMode === "out" ? "Out" : "Office"
}

function dayLabel(date: string): string {
    const [year, month, day] = date.split("-").map(Number)
    return new Date(year, month - 1, day).toLocaleDateString(undefined, {weekday: "short", month: "short", day: "numeric"})
}

const PENDING_TEXT: Record<string, string> = {
    pending: "Grade on its way",
    failed: "Grade on its way",
    none: "Nothing to grade",
}

//one day's grade and description. `owner` is the member's own Profile, which can explain a bad grade; `leadControls`
//is the Work Review page's controls for that day.
export default function WorkDayCard({day, showName, owner, onChange, leadControls}: {
    day: WorkDay, showName?: boolean, owner?: boolean, onChange?: (day: WorkDay) => void, leadControls?: ReactNode
}): JSX.Element {
    const [open, setOpen] = useState(false)
    const grades = new Map(day.projectGrades.map(p => [p.project, p]))

    return (
        <article className="rounded-xl bg-gray-900 p-3 sm:p-4">
            <div className="flex items-start gap-3">
                {day.grade ? <GradeBadge grade={day.grade}/> : <span className="w-8 h-8 rounded-full bg-gray-700 shrink-0" aria-hidden></span>}
                <div className="flex-1 min-w-0">
                    <p className="font-semibold">
                        {showName && <>{day.besaName} · </>}{dayLabel(day.date)}
                        <span className="text-gray-400 font-normal"> · {day.hours} h</span>
                    </p>
                    <p className="text-xs text-gray-400">
                        {day.grade ? GRADE_LABELS[day.grade] : PENDING_TEXT[day.gradeStatus]}
                        {day.override && " · set by a lead"}
                        {" · "}{[...new Set(day.visits.map(modeLabel))].join(", ")}
                    </p>
                    {day.description && <p className="text-sm mt-2 whitespace-pre-wrap break-words">{day.description}</p>}
                    {day.gradeReason && <p className="text-sm text-gray-400 mt-1 break-words">{day.gradeReason}</p>}
                    {day.override?.note && <p className="text-sm text-gray-400 mt-1 break-words">Lead: {day.override.note}</p>}
                    {day.explanation && <p className="text-sm text-gray-300 mt-1 break-words"><span className="font-semibold">Explanation:</span> {day.explanation}</p>}
                </div>
                <button type="button" aria-expanded={open} aria-label="Details" onClick={() => setOpen(!open)} className="p-2 text-gray-400 hover:text-white">
                    {open ? <FaChevronDown/> : <FaChevronRight/>}
                </button>
            </div>

            {owner && day.needsExplanation && onChange && <ExplainGrade day={day} onSaved={onChange}/>}

            {open &&
                <div className="mt-3 border-t border-gray-700 pt-3 flex flex-col gap-3">
                    {day.visits.flatMap(visit => visit.projects).map((project, i) => (
                        <div key={project.projectId + i}>
                            <p className="font-semibold text-sm text-amber-400 flex items-center gap-2">
                                {project.name}
                                {grades.get(project.name) && <span className="text-gray-400 font-normal">({grades.get(project.name)?.grade})</span>}
                            </p>
                            {grades.get(project.name)?.differences && <p className="text-xs text-gray-300 mb-1">{grades.get(project.name)?.differences}</p>}
                            {project.measures.map(measure => (
                                <div key={measure.measureId} className="text-xs text-gray-300 py-0.5">
                                    <span className="text-gray-400">{measure.label}: </span>
                                    {measure.type === "quantity" ? `${measure.quantity ?? 0} ${measure.unit}`
                                        : measure.type === "checkbox" ? (measure.checked ? "Yes" : "No")
                                        : measure.confirmable ? `${measure.summary} (${measure.confirmedCount ?? 0} confirmed)`
                                        : measure.summary}
                                    {measure.newScreenshot &&
                                        <div className="flex gap-3 my-2 max-w-md">
                                            {measure.oldScreenshot && <Screenshot id={measure.oldScreenshot} label="Old"/>}
                                            <Screenshot id={measure.newScreenshot} label="New"/>
                                        </div>
                                    }
                                </div>
                            ))}
                        </div>
                    ))}
                    {leadControls}
                </div>
            }
        </article>
    )
}
