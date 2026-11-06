import { useEffect, useState, type JSX } from "react"
import { getScreenshotUrl, type WorkGrade } from "../Tools/Fetch"

export const GRADE_LABELS: Record<WorkGrade, string> = {
    A: "Good enough!",
    B: "Slightly suspicious with time",
    C: "Very suspicious with time",
}

const GRADE_COLORS: Record<WorkGrade, string> = {
    A: "bg-green-600 text-white",
    B: "bg-amber-400 text-black",
    C: "bg-red-500 text-white",
}

export default function GradeBadge({grade, large}: {grade: WorkGrade, large?: boolean}): JSX.Element {
    return (
        <span title={GRADE_LABELS[grade]} className={"inline-flex items-center justify-center rounded-full font-bold shrink-0 " + GRADE_COLORS[grade] +
            (large ? " w-20 h-20 text-5xl" : " w-8 h-8 text-base")}>
            {grade}
        </span>
    )
}

//a sent screenshot - they aren't public, so it's fetched with the viewer's token (see getScreenshotUrl)
export function Screenshot({id, label}: {id: string, label: string}): JSX.Element {
    const [src, setSrc] = useState<string | null>(null)

    useEffect(() => {
        let cancelled = false
        let created: string | null = null
        getScreenshotUrl(id).then(result => {
            if (cancelled) {
                if (result) URL.revokeObjectURL(result)
                return
            }
            created = result
            setSrc(result)
        })
        return () => {
            cancelled = true
            if (created) URL.revokeObjectURL(created)
        }
    }, [id])

    return (
        <figure className="flex-1 min-w-0">
            <figcaption className="text-xs text-gray-400 mb-1">{label}</figcaption>
            {src ?
                <a href={src} target="_blank" rel="noreferrer">
                    <img src={src} alt={`${label} screenshot`} className="w-full max-h-48 object-contain rounded-lg bg-black"/>
                </a>
                : <div className="w-full h-24 rounded-lg bg-black/40"></div>
            }
        </figure>
    )
}
