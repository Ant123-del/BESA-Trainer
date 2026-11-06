import type { JSX } from "react"
import type { WorkMode } from "../Tools/Fetch"

const MODES: {mode: WorkMode, title: string, what: string, grade: string}[] = [
    {mode: "office", title: "Office Mode", what: "You were on office tasks the whole time.", grade: "100% tracked and graded"},
    {mode: "hybrid", title: "Hybrid Mode", what: "Some office tasks, some out of the office, like a tour or event.", grade: "Only the office part is graded"},
    {mode: "out", title: "Out Mode", what: "You were out of the office the whole time, on tours, events and so on.", grade: "No grade needed"},
]

function hoursLabel(minutes: number): string {
    return minutes >= 60 ? `${(minutes / 60).toFixed(1).replace(/\.0$/, "")} h` : `${Math.round(minutes)} min`
}

//clock-out's question for the work tracking can't reach: each card explains itself, and hybrid asks for the split
export default function WorkModeCards({mode, onMode, officePercent, onOfficePercent, totalMinutes}: {
    mode: WorkMode | null, onMode: (mode: WorkMode) => void, officePercent: number, onOfficePercent: (percent: number) => void, totalMinutes: number
}): JSX.Element {
    return (
        <fieldset>
            <legend className="text-lg font-semibold text-center w-full mb-1">Where was your time?</legend>
            <p className="text-sm text-gray-300 text-center mb-3">Not everything can be measured, so only office tasks get a grade.</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {MODES.map(card => (
                    <button key={card.mode} type="button" aria-pressed={mode === card.mode} onClick={() => onMode(card.mode)}
                        className={"rounded-xl border-2 p-3 text-left transition-colors " +
                            (mode === card.mode ? "border-amber-500 bg-gray-800" : "border-gray-700 hover:border-gray-500")}>
                        <span className="block font-bold text-amber-400">{card.title}</span>
                        <span className="block text-sm mt-1">{card.what}</span>
                        <span className="block text-xs text-gray-400 mt-2">{card.grade}</span>
                    </button>
                ))}
            </div>
            {mode === "hybrid" &&
                <div className="mt-4">
                    <label htmlFor="office-percent" className="block text-sm font-semibold text-center mb-2">
                        {officePercent}% office tasks · {100 - officePercent}% out
                    </label>
                    <input id="office-percent" type="range" min={1} max={99} value={officePercent} onChange={(e) => onOfficePercent(Number(e.target.value))}
                        className="w-full accent-amber-500"/>
                    <p className="text-xs text-gray-400 text-center mt-1">
                        About {hoursLabel(totalMinutes * officePercent / 100)} office, {hoursLabel(totalMinutes * (100 - officePercent) / 100)} out
                    </p>
                </div>
            }
        </fieldset>
    )
}
