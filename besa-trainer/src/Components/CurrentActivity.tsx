import { useEffect, useState, type JSX } from "react"
import { MoonLoader } from "react-spinners"
import { getCurrentActivity, type CurrentActivity as Current } from "../Tools/Fetch"
import { activityColor } from "../Tools/activityColors"
import SortToggle, { type SortOrder } from "./SortToggle"

const REFRESH_MS = 60_000

function fmtHours(h: number): string {
    return h >= 10 ? h.toFixed(0) : h.toFixed(1).replace(/\.0$/, "")
}

//Manage Admins: what's being worked on right now, without saying who. Each activity's bar is the hours so far
//(solid) plus the potential hours still to come today if everyone stays through their office hours (lighter),
//split evenly across the activities each person clocked in for. Both numbers are written out on every row.
export default function CurrentActivity(): JSX.Element {
    const [data, setData] = useState<Current | null>(null)
    const [error, setError] = useState("")
    const [sort, setSort] = useState<SortOrder>("default")

    useEffect(() => {
        let cancelled = false
        const load = () => getCurrentActivity().then(result => {
            if (cancelled) return
            if ("activities" in result) {
                setData(result)
                setError("")
            } else {
                setError(result.detail)
            }
        })
        load()
        const interval = setInterval(load, REFRESH_MS)
        return () => { cancelled = true; clearInterval(interval) }
    }, [])

    const rows = [...(data?.activities || [])]
    if (sort !== "default") rows.sort((a, b) => sort === "desc" ? b.soFarHours - a.soFarHours : a.soFarHours - b.soFarHours)
    const max = Math.max(0.5, ...rows.map(r => r.potentialHours))
    const soFarTotal = rows.reduce((sum, r) => sum + r.soFarHours, 0)
    const potentialTotal = rows.reduce((sum, r) => sum + r.potentialHours, 0)

    return (
        <section className="bg-gray-800 rounded-2xl p-5 sm:p-6 mb-8">
            <div className="flex items-start justify-between gap-4 flex-wrap mb-4">
                <div>
                    <h2 className="text-2xl tracking-wide">Current Sessions</h2>
                    <p className="text-sm text-gray-400">
                        What's being worked on right now, and the hours it could add by the end of today's office hours.
                    </p>
                </div>
                <SortToggle value={sort} onChange={setSort}/>
            </div>

            {data === null ?
                error ? <p className="text-red-400 text-sm">{error}</p>
                : <div className="flex justify-center py-10"><MoonLoader color="white" size={24}/></div>
                : rows.length === 0 ?
                <p className="text-gray-500 italic text-sm py-6 text-center">Nobody is clocked in right now.</p>
                :
                <>
                    <div className="flex items-end gap-6 flex-wrap mb-4">
                        <div>
                            <p className="text-3xl font-semibold tabular-nums">{fmtHours(soFarTotal)} <span className="text-base text-gray-400 font-normal">hrs so far</span></p>
                            <p className="text-xs text-gray-400">
                                up to {fmtHours(potentialTotal)} hrs by end of office hours · {data.people} BESA{data.people === 1 ? "" : "s"} clocked in
                            </p>
                        </div>
                        {/* one legend for the encoding (solid vs. lighter) - each row's name carries which activity it is */}
                        <ul className="flex gap-4 text-xs text-gray-300">
                            <li className="flex items-center gap-1.5"><span className="w-4 h-2.5 rounded-sm bg-gray-300"/>So far</li>
                            <li className="flex items-center gap-1.5"><span className="w-4 h-2.5 rounded-sm bg-gray-300/35"/>Potential (rest of office hours)</li>
                        </ul>
                    </div>

                    <ul className="flex flex-col gap-3">
                        {rows.map(r => {
                            const color = activityColor(r.activity, data.colorOrder)
                            const soFarPct = (r.soFarHours / max) * 100
                            const restPct = (Math.max(0, r.potentialHours - r.soFarHours) / max) * 100
                            return (
                                <li key={r.activity} className="grid grid-cols-1 sm:grid-cols-[12rem_1fr_auto] items-center gap-x-3 gap-y-1">
                                    <span className="text-sm text-gray-200 flex items-center gap-1.5 min-w-0">
                                        <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{backgroundColor: color}}/>
                                        <span className="truncate" title={r.activity}>{r.activity}</span>
                                    </span>
                                    <div className="relative h-4 flex gap-[2px]" role="img"
                                        aria-label={`${r.activity}: ${fmtHours(r.soFarHours)} hours so far, up to ${fmtHours(r.potentialHours)} hours by end of office hours`}>
                                        {/* square at the start, 4px rounded data-end; 2px surface gap between so-far and potential */}
                                        {soFarPct > 0 &&
                                            <span className={"h-full " + (restPct > 0.5 ? "rounded-l-sm" : "rounded-sm")} style={{width: `${soFarPct}%`, backgroundColor: color}}/>
                                        }
                                        {restPct > 0.5 &&
                                            <span className="h-full rounded-r" style={{width: `${restPct}%`, backgroundColor: color, opacity: 0.35}}/>
                                        }
                                    </div>
                                    <span className="text-xs text-gray-400 tabular-nums whitespace-nowrap">
                                        <span className="text-white font-semibold">{fmtHours(r.soFarHours)}h</span> so far · up to {fmtHours(r.potentialHours)}h
                                    </span>
                                </li>
                            )
                        })}
                    </ul>
                    <p className="text-xs text-gray-500 mt-4">
                        Split evenly across the activities each person clocked in for - the real split is chosen when they clock out.
                        Updates every minute.
                    </p>
                </>
            }
        </section>
    )
}
