import { useEffect, useLayoutEffect, useRef, useState, type JSX, type RefObject } from "react"
import { MoonLoader } from "react-spinners"
import { getActivityAnalytics, type ActivityAnalytics as Analytics } from "../Tools/Fetch"
import { ACTIVITY_PALETTE, OTHER_COLOR, activityColor } from "../Tools/activityColors"
import { fromDateKey } from "../Tools/dates"

const RANGES = [7, 14, 30, 90]
const OTHER = "Other activities"
const ROW_H = 52 //height of each small-multiple row's plot
const ROW_PAD = 12 //room above the tallest bar for the row's scale label
const LABEL_W = 168 //left column with each row's name + total (narrower on phones - see labelW)
const MAX_BAR = 24
const TOTAL_COLOR = "#9ca3af" //neutral - the "All activities" row isn't an entity

function fmtHours(h: number): string {
    return h >= 10 ? h.toFixed(0) : h.toFixed(1).replace(/\.0$/, "")
}

function shortDate(key: string): string {
    return fromDateKey(key).toLocaleDateString("en-US", {month: "short", day: "numeric"})
}

//a "nice" y-axis top and step so gridlines land on round hours
function niceScale(max: number): {top: number, step: number} {
    if (max <= 0) return {top: 1, step: 0.5}
    const rough = max / 4
    const mag = 10 ** Math.floor(Math.log10(rough))
    const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= rough) || rough
    return {top: Math.ceil(max / step) * step, step}
}

//Manage Admins: hours per activity per day from the permanent activity log (what people said they actually
//worked on at clock-out). A row of daily bars per activity (small multiples) + a table view; colors match the
//clock-out split bar.
export default function ActivityAnalytics(): JSX.Element {
    const [days, setDays] = useState(30)
    const [view, setView] = useState<"chart" | "table">("chart")
    const [data, setData] = useState<Analytics | null>(null)
    const [error, setError] = useState("")
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        let cancelled = false
        getActivityAnalytics(days).then(result => {
            if (cancelled) return
            if ("activities" in result) {
                setData(result)
                setError("")
            } else {
                setError(result.detail)
            }
            setLoading(false)
        })
        return () => { cancelled = true }
    }, [days])

    function changeRange(next: number) {
        if (next === days) return
        setLoading(true)
        setDays(next)
    }

    //color follows the activity's slot in the full shared order (same as the kiosk's split bar), never which
    //activities happen to have data. Anything past the 8 palette slots folds into one "Other activities" series.
    const colorOrder = data?.colorOrder || []
    const hasSlot = (a: string) => { const i = colorOrder.indexOf(a); return i >= 0 && i < ACTIVITY_PALETTE.length }
    const withData = data?.activities || []
    const overflow = withData.filter(a => !hasSlot(a))
    const series = [...withData.filter(hasSlot), ...(overflow.length ? [OTHER] : [])]
    const colorOf = (name: string) => name === OTHER ? OTHER_COLOR : activityColor(name, colorOrder)
    const valueOf = (hours: Record<string, number>, name: string) => name === OTHER
        ? overflow.reduce((sum, a) => sum + (hours[a] || 0), 0)
        : hours[name] || 0
    const totals = series.map(name => ({name, hours: valueOf(data?.totals || {}, name)}))
    const grandTotal = totals.reduce((sum, t) => sum + t.hours, 0)

    return (
        <section className="bg-gray-800 rounded-2xl p-5 sm:p-6 mb-8">
            <div className="flex items-start justify-between gap-4 flex-wrap mb-4">
                <div>
                    <h2 className="text-2xl tracking-wide">Activity Hours</h2>
                    <p className="text-sm text-gray-400">What BESAs actually worked on, from the split they choose at clock-out.</p>
                </div>
                {/* filters live in one row above the chart */}
                <div className="flex items-center gap-2 flex-wrap">
                    <div className="flex rounded-full bg-gray-900 p-0.5" role="group" aria-label="Date range">
                        {RANGES.map(r => (
                            <button key={r} onClick={() => changeRange(r)} aria-pressed={days === r}
                                className={"px-3 py-1 rounded-full text-xs font-semibold " + (days === r ? "bg-gray-600 text-white" : "text-gray-400 hover:text-white")}>
                                {r}d
                            </button>
                        ))}
                    </div>
                    <div className="flex rounded-full bg-gray-900 p-0.5" role="group" aria-label="View">
                        {(["chart", "table"] as const).map(v => (
                            <button key={v} onClick={() => setView(v)} aria-pressed={view === v}
                                className={"px-3 py-1 rounded-full text-xs font-semibold capitalize " + (view === v ? "bg-gray-600 text-white" : "text-gray-400 hover:text-white")}>
                                {v}
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            {loading && !data ?
                <div className="flex justify-center py-16"><MoonLoader color="white" size={24}/></div>
                : error ?
                <p className="text-red-400 text-sm">{error}</p>
                : !data || grandTotal === 0 ?
                <p className="text-gray-500 italic text-sm py-8 text-center">
                    No activity logged in the last {days} days yet. It fills in as BESAs clock out and split their time.
                </p>
                :
                <>
                    {/* headline + legend that doubles as per-activity totals (identity never color-alone) */}
                    <div className="flex items-end gap-6 flex-wrap mb-4">
                        <div>
                            <p className="text-3xl font-semibold tabular-nums">{fmtHours(grandTotal)} <span className="text-base text-gray-400 font-normal">hrs</span></p>
                            <p className="text-xs text-gray-400">{shortDate(data.start)} – {shortDate(data.end)} · {data.visits} visit{data.visits === 1 ? "" : "s"}</p>
                        </div>
                        <ul className="flex flex-wrap gap-x-4 gap-y-1">
                            {totals.map(t => (
                                <li key={t.name} className="flex items-center gap-1.5 text-sm">
                                    <span className="w-3 h-3 rounded-sm" style={{backgroundColor: colorOf(t.name)}}/>
                                    <span className="text-gray-300">{t.name}</span>
                                    <span className="text-white font-semibold tabular-nums">{fmtHours(t.hours)}h</span>
                                </li>
                            ))}
                        </ul>
                    </div>

                    {view === "chart" ?
                        <SmallMultiples data={data} series={series} colorOf={colorOf} valueOf={valueOf}/>
                        :
                        <DayTable data={data} series={series} valueOf={valueOf}/>
                    }

                    {data.estimatedHours > 0 &&
                        <p className="text-xs text-gray-500 mt-3">
                            {fmtHours(data.estimatedHours)} of these hours are estimated - they come from automatic clock-outs (someone
                            forgot to clock out), which split evenly across the activities they clocked in for.
                        </p>
                    }
                </>
            }
        </section>
    )
}

function useWidth<T extends HTMLElement>(): [RefObject<T>, number] {
    const ref = useRef<T>(null)
    const [width, setWidth] = useState(0)
    useLayoutEffect(() => {
        if (!ref.current) return
        const observer = new ResizeObserver(entries => setWidth(entries[0].contentRect.width))
        observer.observe(ref.current)
        setWidth(ref.current.getBoundingClientRect().width)
        return () => observer.disconnect()
    }, [])
    return [ref, width]
}

//one row of daily bars per activity (small multiples) instead of one stacked chart: whichever activities have
//data that range end up side by side, and with more than three of them no palette keeps every pair
//distinguishable for colorblind readers - so each row is named in text and color is only a familiar accent
//(the same one as on the kiosk's split bar). The "All activities" row on top has its own scale; the activity
//rows share one so they compare directly.
function SmallMultiples({data, series, colorOf, valueOf}: {
    data: Analytics, series: string[], colorOf: (name: string) => string,
    valueOf: (hours: Record<string, number>, name: string) => number
}) {
    const [ref, width] = useWidth<HTMLDivElement>()
    const [hover, setHover] = useState<{row: number, day: number} | null>(null)

    const allValues = data.days.map(d => series.reduce((sum, s) => sum + valueOf(d.hours, s), 0))
    const rows = [
        {name: "All activities", color: TOTAL_COLOR, values: allValues},
        ...series.map(s => ({name: s, color: colorOf(s), values: data.days.map(d => valueOf(d.hours, s))})),
    ]
    const totalTop = niceScale(Math.max(...allValues)).top
    const activityTop = niceScale(Math.max(0, ...rows.slice(1).flatMap(r => r.values))).top

    const labelW = width < 480 ? 112 : LABEL_W
    const plotW = Math.max(0, width - labelW)
    const slot = data.days.length ? plotW / data.days.length : 0
    const barW = Math.max(2, Math.min(MAX_BAR, slot * 0.6))
    const labelEvery = Math.max(1, Math.ceil(data.days.length / Math.max(1, Math.floor(plotW / 56))))

    return (
        <div ref={ref} className="relative w-full" onPointerLeave={() => setHover(null)}>
            {width > 0 && rows.map((row, r) => {
                const top = r === 0 ? totalTop : activityTop
                const total = row.values.reduce((sum, v) => sum + v, 0)
                return (
                    <div key={row.name} className={"relative flex items-stretch " + (r === 0 ? "mb-3 pb-3 border-b border-gray-700" : "")}>
                        <div className="shrink-0 flex flex-col justify-center pr-3" style={{width: labelW}}>
                            <p className="text-sm text-gray-200 leading-tight flex items-center gap-1.5">
                                <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{backgroundColor: row.color}}/>
                                <span className="truncate" title={row.name}>{row.name}</span>
                            </p>
                            <p className="text-xs text-gray-400 tabular-nums pl-4">{fmtHours(total)}h total</p>
                        </div>
                        <svg width={plotW} height={ROW_H} role="img" className="shrink-0"
                            aria-label={`${row.name}: ${fmtHours(total)} hours from ${shortDate(data.start)} to ${shortDate(data.end)}. Switch to Table for each day's value.`}>
                            {/* recessive top gridline with the row's scale, plus the baseline */}
                            <line x1={0} x2={plotW} y1={ROW_PAD} y2={ROW_PAD} stroke="#374151" strokeWidth={1} strokeDasharray="2 3"/>
                            <text x={plotW - 2} y={ROW_PAD - 3} textAnchor="end" fontSize={10} fill="#6b7280">{fmtHours(top)}h</text>
                            {row.values.map((v, i) => {
                                const cx = slot * i + slot / 2
                                const h = top > 0 ? (v / top) * (ROW_H - ROW_PAD) : 0
                                const x0 = cx - barW / 2, y0 = ROW_H - h
                                const rad = Math.min(4, h, barW / 2)
                                const dim = hover !== null && !(hover.row === r && hover.day === i) && hover.day !== i
                                return (
                                    <g key={i}>
                                        {v > 0 &&
                                            //square at the baseline, 4px rounded data-end
                                            <path d={`M${x0},${ROW_H} V${y0 + rad} Q${x0},${y0} ${x0 + rad},${y0} H${x0 + barW - rad} Q${x0 + barW},${y0} ${x0 + barW},${y0 + rad} V${ROW_H} Z`}
                                                fill={row.color} opacity={dim ? 0.45 : 1}/>
                                        }
                                        {/* the whole day slot (taller and wider than the bar) is the hover/focus target */}
                                        <rect x={cx - slot / 2} y={0} width={slot} height={ROW_H} fill="transparent" tabIndex={0} className="outline-none"
                                            aria-label={`${row.name}, ${shortDate(data.days[i].date)}: ${fmtHours(v)} hours`}
                                            onPointerMove={() => setHover({row: r, day: i})} onFocus={() => setHover({row: r, day: i})}
                                            onBlur={() => setHover(null)}/>
                                    </g>
                                )
                            })}
                            <line x1={0} x2={plotW} y1={ROW_H - 0.5} y2={ROW_H - 0.5} stroke="#4b5563" strokeWidth={1}/>
                        </svg>
                        {/* tooltip, anchored just above this row: value leads, then the activity and date */}
                        {hover?.row === r &&
                            <div className="pointer-events-none absolute bottom-full mb-1 z-10 bg-gray-950/95 border border-gray-700 rounded-lg px-3 py-2 text-xs shadow-lg whitespace-nowrap"
                                style={{left: Math.min(Math.max(0, labelW + slot * hover.day + slot / 2 - 70), Math.max(0, width - 160))}}>
                                <p className="text-white font-semibold text-sm tabular-nums">{fmtHours(row.values[hover.day])} hrs</p>
                                <p className="text-gray-300">{row.name}</p>
                                <p className="text-gray-500">{fromDateKey(data.days[hover.day].date).toLocaleDateString("en-US", {weekday: "short", month: "short", day: "numeric"})}</p>
                            </div>
                        }
                    </div>
                )
            })}

            {/* shared date axis under the last row */}
            {width > 0 &&
                <div className="relative h-5" style={{marginLeft: labelW}}>
                    {data.days.map((d, i) => i % labelEvery === 0 &&
                        <span key={d.date} className="absolute text-[11px] text-gray-400 -translate-x-1/2 whitespace-nowrap"
                            style={{left: slot * i + slot / 2}}>{shortDate(d.date)}</span>
                    )}
                </div>
            }

        </div>
    )
}

function DayTable({data, series, valueOf}: {
    data: Analytics, series: string[], valueOf: (hours: Record<string, number>, name: string) => number
}) {
    const rows = data.days.filter(d => series.some(s => valueOf(d.hours, s) > 0))
    return (
        <div className="overflow-x-auto rounded-xl border border-gray-700">
            <table className="w-full text-sm">
                <thead className="bg-gray-900 text-gray-300">
                    <tr>
                        <th className="text-left p-2 px-3 font-semibold">Date</th>
                        {series.map(s => <th key={s} className="text-right p-2 px-3 font-semibold whitespace-nowrap">{s}</th>)}
                        <th className="text-right p-2 px-3 font-semibold">Total</th>
                    </tr>
                </thead>
                <tbody>
                    {rows.map((d, i) => {
                        const total = series.reduce((sum, s) => sum + valueOf(d.hours, s), 0)
                        return (
                            <tr key={d.date} className={i % 2 === 0 ? "bg-gray-800" : "bg-gray-800/60"}>
                                <td className="p-2 px-3 text-gray-300 whitespace-nowrap">{shortDate(d.date)}</td>
                                {series.map(s => (
                                    <td key={s} className="p-2 px-3 text-right tabular-nums text-gray-200">
                                        {valueOf(d.hours, s) > 0 ? fmtHours(valueOf(d.hours, s)) : <span className="text-gray-600">—</span>}
                                    </td>
                                ))}
                                <td className="p-2 px-3 text-right tabular-nums font-semibold">{fmtHours(total)}</td>
                            </tr>
                        )
                    })}
                </tbody>
            </table>
            {rows.length < data.days.length &&
                <p className="text-xs text-gray-500 p-2 px-3">Days with no activity logged aren't listed.</p>
            }
        </div>
    )
}
