import { useEffect, useState } from "react"
import { doc, getDoc } from "firebase/firestore"
import { db } from "../../Tools/firestore"
import { getScript } from "../../Tools/Fetch"
import { groupScriptBySections } from "../../Tools/ScriptDecoder"
import type { Floor, Script } from "../../Tools/types"
import { Loading } from "../SectionEditor/Edit"
import { MoonLoader } from "react-spinners"

type Source = "mine" | "default"

//lets a trainee just read through a floor's script - no testing, no timeline - either their own
//personalized (possibly edited) copy or the floor's untouched default, grouped under each section's title.
export default function ScriptViewer({floor, myScript, onClose}: {floor: Floor, myScript: string, onClose: () => void}) {
    const [source, setSource] = useState<Source>("mine")
    const [defaultScript, setDefaultScript] = useState<string | null>(null)
    const [loadingDefault, setLoadingDefault] = useState(false)

    //the default script is only fetched the first time it's actually asked for, not on open.
    useEffect(() => {
        if (source !== "default" || defaultScript !== null) {
            return
        }
        setLoadingDefault(true)
        getDoc(doc(db, "training_data", "data_root", "scripts", floor.defScriptId)).then(async (data) => {
            if (data.exists()) {
                const s = data.data() as Script
                setDefaultScript(await getScript(s.src) || "")
            } else {
                setDefaultScript("")
            }
        }).finally(() => setLoadingDefault(false))
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [source])

    const text = source === "mine" ? myScript : (defaultScript ?? "")
    const groups = groupScriptBySections(text, floor.markers)

    return (
        <Loading onClose={onClose}>
            <div className="bg-gray-900 w-2/3 max-h-[80vh] p-5 rounded-2xl relative flex flex-col" onClick={(e) => e.stopPropagation()}>
                <button onClick={onClose} className="absolute top-3 right-3 text-gray-400 hover:text-white text-xl leading-none">&times;</button>
                <h3 className="text-2xl mb-1 text-center shrink-0">Script Viewer</h3>
                <div className="flex justify-center gap-3 my-3 shrink-0">
                    <button onClick={() => setSource("mine")}
                        className={"px-4 py-1.5 rounded-full border-2 " + (source === "mine" ? "bg-blue-800 border-blue-800" : "border-gray-600 hover:bg-gray-800")}>
                        My Script
                    </button>
                    <button onClick={() => setSource("default")}
                        className={"px-4 py-1.5 rounded-full border-2 " + (source === "default" ? "bg-blue-800 border-blue-800" : "border-gray-600 hover:bg-gray-800")}>
                        Default Script
                    </button>
                </div>
                <div className="overflow-y-auto flex-1 min-h-0 px-2">
                    {loadingDefault ?
                        <div className="flex justify-center py-10"><MoonLoader color="white" size={30}/></div>
                        : groups.length === 0 ?
                        <p className="text-gray-500 italic text-center py-10">No script available yet.</p>
                        : groups.map((group, i) => (
                            <div key={i} className="mb-6">
                                <h4 className="text-amber-500 text-lg font-semibold tracking-wide mb-2 sticky top-0 bg-gray-900 py-1">{group.title}</h4>
                                {group.lines.map((line, j) => (
                                    <p key={j} className="text-gray-200 mb-2 leading-relaxed">{line.text}</p>
                                ))}
                            </div>
                        ))
                    }
                </div>
            </div>
        </Loading>
    )
}
