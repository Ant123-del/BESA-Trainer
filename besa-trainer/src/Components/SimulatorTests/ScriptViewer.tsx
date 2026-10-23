import { groupScriptBySections } from "../../Tools/ScriptDecoder"
import type { Floor } from "../../Tools/types"
import { Loading } from "../SectionEditor/Edit"
import { MoonLoader } from "react-spinners"

export type ScriptSource = "default" | "custom"

//lets a trainee just read through a floor's script - no testing, no timeline - either their own
//personalized (possibly edited) copy or the floor's untouched default, grouped under each section's title.
export default function ScriptViewer({
    floor,
    defaultScript,
    customScript,
    hasCustomScript,
    scriptSource,
    onScriptSourceChange,
    onDeleteCustomScript,
    deletingCustomScript,
    onClose
}: {
    floor: Floor,
    defaultScript: string | null,
    customScript: string | null,
    hasCustomScript: boolean,
    scriptSource: ScriptSource,
    onScriptSourceChange: (source: ScriptSource) => void,
    onDeleteCustomScript: () => void,
    deletingCustomScript: boolean,
    onClose: () => void
}) {
    const activeSource: ScriptSource = hasCustomScript ? scriptSource : "default"
    const text = activeSource === "custom" ? (customScript ?? defaultScript ?? "") : (defaultScript ?? "")
    const groups = groupScriptBySections(text, floor.markers)
    const isLoading = defaultScript === null

    return (
        <Loading onClose={onClose}>
            <div className="bg-be-navy border-2 border-be-orange w-11/12 sm:w-2/3 max-h-[80vh] p-5 rounded-2xl relative flex flex-col font-sans shadow-xl" onClick={(e) => e.stopPropagation()}>
                <button onClick={onClose} className="absolute top-3 right-3 text-be-light-gray hover:text-white text-xl leading-none">&times;</button>
                <div className="flex flex-wrap items-center justify-between gap-3 pr-6 mb-3 shrink-0">
                    <h3 className="text-2xl font-bold text-white">Script Viewer</h3>
                    {hasCustomScript && (
                        <div className="flex items-center gap-2 ml-auto">
                            <div className="inline-flex items-center bg-be-navy-darker p-1 rounded-full border border-be-orange/60">
                                <button
                                    type="button"
                                    onClick={() => onScriptSourceChange("default")}
                                    className={"px-3 py-1 rounded-full text-xs font-bold transition-all " +
                                        (activeSource === "default" ? "bg-be-orange text-black shadow" : "text-be-light-gray hover:text-white")}
                                >
                                    Default Script
                                </button>
                                <button
                                    type="button"
                                    onClick={() => onScriptSourceChange("custom")}
                                    className={"px-3 py-1 rounded-full text-xs font-bold transition-all " +
                                        (activeSource === "custom" ? "bg-be-orange text-black shadow" : "text-be-light-gray hover:text-white")}
                                >
                                    Custom Script
                                </button>
                            </div>
                            {activeSource === "custom" && (
                                <button
                                    type="button"
                                    onClick={onDeleteCustomScript}
                                    disabled={deletingCustomScript}
                                    className="px-3 py-1 rounded-full text-xs font-bold bg-red-600 hover:bg-red-700 text-white transition-colors disabled:opacity-50"
                                >
                                    {deletingCustomScript ? "Deleting..." : "Delete"}
                                </button>
                            )}
                        </div>
                    )}
                </div>
                <div className="overflow-y-auto flex-1 min-h-0 px-2">
                    {isLoading ?
                        <div className="flex justify-center py-10"><MoonLoader color="white" size={30}/></div>
                        : groups.length === 0 ?
                        <p className="text-be-light-gray italic text-center py-10">No script available yet.</p>
                        : groups.map((group, i) => (
                            <div key={i} className="mb-6">
                                <h4 className="text-be-yellow text-lg font-bold tracking-wide mb-2 sticky top-0 bg-be-navy py-1">{group.title}</h4>
                                {group.lines.map((line, j) => (
                                    <p key={j} className="text-white mb-2 leading-relaxed">{line.text}</p>
                                ))}
                            </div>
                        ))
                    }
                </div>
            </div>
        </Loading>
    )
}
