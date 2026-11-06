import { useEffect, useState, type JSX } from "react"
import { MoonLoader } from "react-spinners"
import GradeBadge, { GRADE_LABELS } from "./GradeBadge"
import { explainGrade, gradeWorkDay, type WorkDay } from "../Tools/Fetch"

const EXPLANATION_MAX_LENGTH = 500 //same cap as the backend's GRADE_EXPLANATION_MAX_LENGTH

//a box under a B or C for saying why - what's saved lands in that day's notes. atKiosk is the clock-out screen, which
//isn't signed in as the member.
export function ExplainGrade({day, atKiosk, onSaved}: {day: WorkDay, atKiosk?: boolean, onSaved: (day: WorkDay) => void}): JSX.Element {
    const [text, setText] = useState(day.explanation)
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState("")

    async function handleSave() {
        setBusy(true)
        setError("")
        const result = await explainGrade(day.id, text, atKiosk)
        setBusy(false)
        if (result.success) {
            onSaved(result.day)
        } else {
            setError(result.detail)
        }
    }

    return (
        <div className="mt-3">
            <label htmlFor={`explain-${day.id}`} className="block text-sm font-semibold mb-1">
                What happened? This goes in your notes for the day.
            </label>
            <textarea id={`explain-${day.id}`} rows={3} maxLength={EXPLANATION_MAX_LENGTH} value={text} onChange={(e) => setText(e.target.value)}
                className="w-full p-3 rounded-xl bg-gray-800 text-white border border-gray-600 text-sm"/>
            {error && <p className="text-sm text-red-400 mt-1">{error}</p>}
            <button type="button" onClick={() => void handleSave()} disabled={busy || !text.trim()}
                className="mt-2 px-5 py-2 rounded-full bg-be-orange hover:bg-be-orange-dark text-black text-sm font-bold disabled:opacity-40 disabled:cursor-not-allowed">
                {busy ? "Saving..." : "Save"}
            </button>
        </div>
    )
}

//clock-out's last screen - they're already clocked out by now, so this can take as long as the AI takes, and nothing
//here can go wrong in a way that matters: a failed grade gets retried and turns up on their Profile.
export default function WorkGradeResult({workDayId, besaName, outMode}: {workDayId: string | null, besaName: string, outMode: boolean}): JSX.Element {
    const [day, setDay] = useState<WorkDay | null>(null)
    const [loading, setLoading] = useState(!!workDayId)

    useEffect(() => {
        if (!workDayId) return
        gradeWorkDay(workDayId).then(result => {
            if (result.success) setDay(result.day)
            setLoading(false)
        })
    }, [workDayId])

    if (loading) {
        return (
            <div className="flex flex-col items-center py-10 gap-4">
                <MoonLoader color="white" size={36}/>
                <p className="text-gray-300">{besaName} is clocked out. Grading your day...</p>
            </div>
        )
    }

    if (!day?.grade) {
        return (
            <div className="text-center py-8">
                <h3 className="text-2xl font-semibold text-amber-400 mb-2">You're clocked out</h3>
                <p className="text-sm text-gray-300">
                    {outMode ? "Out mode, so there's no grade for this visit."
                        : day?.gradeStatus === "none" ? "Nothing to grade for this visit."
                        : "Your grade for today will show up on your Profile soon."}
                </p>
            </div>
        )
    }

    return (
        <div className="py-2">
            <div className="flex flex-col items-center text-center gap-3 mb-3">
                <GradeBadge grade={day.grade} large/>
                <h3 className="text-xl font-semibold">{GRADE_LABELS[day.grade]}</h3>
                <p className="text-sm text-gray-300">{day.gradeReason}</p>
            </div>
            {day.needsExplanation ? <ExplainGrade day={day} atKiosk onSaved={setDay}/>
                : day.explanation && <p className="text-sm text-green-400 text-center">Saved to your notes for today.</p>}
        </div>
    )
}
