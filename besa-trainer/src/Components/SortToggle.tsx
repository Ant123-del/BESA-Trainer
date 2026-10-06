import type { JSX } from "react"

//"default" keeps the shared activity-type order (same as the kiosk); the others order by hours
export type SortOrder = "default" | "desc" | "asc"

const OPTIONS: {value: SortOrder, label: string}[] = [
    {value: "default", label: "Default"},
    {value: "desc", label: "Most hours"},
    {value: "asc", label: "Fewest hours"},
]

//a segmented control for ordering a chart's activities by hours - shared by the Manage Admins charts
export default function SortToggle({value, onChange}: {value: SortOrder, onChange: (next: SortOrder) => void}): JSX.Element {
    return (
        <div className="flex rounded-full bg-gray-900 p-0.5" role="group" aria-label="Sort by hours">
            {OPTIONS.map(o => (
                <button key={o.value} onClick={() => onChange(o.value)} aria-pressed={value === o.value}
                    className={"px-3 py-1 rounded-full text-xs font-semibold whitespace-nowrap " + (value === o.value ? "bg-gray-600 text-white" : "text-gray-400 hover:text-white")}>
                    {o.label}
                </button>
            ))}
        </div>
    )
}
