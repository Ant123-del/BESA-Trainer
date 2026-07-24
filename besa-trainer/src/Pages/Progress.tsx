import { useEffect, useState } from "react"
import { Link, useParams } from "react-router-dom"
import { getAuth, onAuthStateChanged } from "firebase/auth"
import { collection, doc, getDoc, getDocs, limit, query, where } from "firebase/firestore"
import { db } from "../Tools/firestore"
import { MoonLoader } from "react-spinners"
import Header from "../Components/Header"
import { floorNameDecoder } from "../Components/Edit"
import { FLOOR_SEQUENCE, toDate } from "./Simulator"
import type { Floor, FloorCode, PracticeTypes, Progress as ProgressEntry, User } from "../Tools/types"

type FloorSummary = {
    floorCode: FloorCode
    floor: Floor | null
    progressList: ProgressEntry[]
}

//every practice type gets its own row, shown in this order regardless of which was attempted most recently
const PRACTICE_TYPES: PracticeTypes[] = ["fill", "text", "microphone"]

function practiceTypeLabel(type: PracticeTypes): string {
    switch (type) {
        case "fill":
            return "Fill In The Blank"
        case "text":
            return "Retype Script"
        case "microphone":
            return "Speak Script"
    }
}

//hard = red, good = yellow, easy = green, matches the video timeline's marker colors. Amber means the
//floor has been started but this particular section hasn't been attempted yet.
function confidenceColor(confidence: number | undefined): string {
    if (confidence === 0) {
        return "bg-red-600"
    }
    if (confidence === 1) {
        return "bg-yellow-500"
    }
    if (confidence === 2) {
        return "bg-green-600"
    }
    return "bg-amber-600"
}

//the results/progress page reached once every floor in FLOOR_SEQUENCE has been finished, also reachable
//any time from the Home page - shows how each floor went, lets you restart any of them, or head home.
export default function MyProgress() {
    const {tour} = useParams()
    const [loading, setLoading] = useState(true)
    const [summaries, setSummaries] = useState<FloorSummary[]>([])

    useEffect(() => {
        const auth = getAuth()
        const unsubscribe = onAuthStateChanged(auth, async (user) => {
            if (!user) {
                setLoading(false)
                return
            }

            try {
                const userD = doc(db, "training_data/data_root/users/" + user.uid)
                const userDoc = await getDoc(userD)
                const foundUser = userDoc.exists() ? userDoc.data() as User : null
                if (foundUser?.progress) {
                    foundUser.progress = foundUser.progress.map(p => ({...p, lastUpdated: toDate(p.lastUpdated)}))
                }

                const results = await Promise.all(FLOOR_SEQUENCE.map(async (floorCode: FloorCode): Promise<FloorSummary> => {
                    const floorDocs = await getDocs(query(
                        collection(db, "training_data/floors/" + floorCode),
                        where("current", "==", true),
                        limit(1)
                    ))
                    const floor = floorDocs.empty ? null : floorDocs.docs[0].data() as Floor

                    const floorProgress = (floor && foundUser?.progress)
                        ? foundUser.progress.filter(p => p.floorId === floor.id)
                        : []

                    return {floorCode, floor, progressList: floorProgress}
                }))

                setSummaries(results)
            } catch (e) {
                console.error(e)
            } finally {
                setLoading(false)
            }
        })
        return () => unsubscribe()
    }, [])

    return (
        <div className="bg-gray-900 w-full min-h-screen text-white">
            <Header/>
            <div className="h-16 relative top-0 left-0 w-full"></div>
            <div className="w-5/6 mx-auto py-10">
                <div className="flex justify-between items-center mb-2">
                    <h1 className="text-4xl tracking-wider">My Progress</h1>
                    <Link to="/" className="p-2 px-6 rounded-full border border-gray-400 hover:bg-gray-800 shrink-0">Back to Home</Link>
                </div>
                <div className="flex items-center gap-4 text-xs text-gray-400 mb-8">
                    <LegendDot color="bg-green-600" label="Easy"/>
                    <LegendDot color="bg-yellow-500" label="Good"/>
                    <LegendDot color="bg-red-600" label="Hard"/>
                    <LegendDot color="bg-amber-600" label="Not attempted"/>
                </div>
                {loading ?
                    <div className="flex justify-center py-20"><MoonLoader color="white" size={30}/></div>
                    :
                    <div className="flex flex-col gap-4">
                        {summaries.map(summary => (
                            <FloorSummaryCard key={summary.floorCode} summary={summary} tour={tour || "general"}/>
                        ))}
                    </div>
                }
            </div>
        </div>
    )
}

function LegendDot({color, label}: {color: string, label: string}) {
    return (
        <span className="flex items-center gap-1.5">
            <span className={"w-3 h-3 rounded-full " + color}/>
            {label}
        </span>
    )
}

function FloorSummaryCard({summary, tour}: {summary: FloorSummary, tour: string}) {
    const {floorCode, floor, progressList} = summary

    return (
        <div className="bg-gray-800 rounded-2xl p-5">
            <div className="flex justify-between items-center mb-4 gap-3">
                <h2 className="text-2xl">{floorNameDecoder(floorCode)}</h2>
                <Link to={`/simulator/${tour}?f=${floorCode}`}
                    className="p-2 px-6 rounded-full bg-amber-800 hover:bg-amber-900 text-sm shrink-0">
                    Start Over
                </Link>
            </div>
            {!floor || floor.markers.length === 0 ?
                <p className="text-gray-500 italic text-sm">No data yet - this floor hasn't been set up.</p>
                :
                <div className="flex flex-col gap-4">
                    {PRACTICE_TYPES.map(type => (
                        <PracticeTypeRow key={type} type={type} floor={floor}
                            progress={progressList.find(p => p.practiceType === type) || null}/>
                    ))}
                </div>
            }
        </div>
    )
}

function PracticeTypeRow({type, floor, progress}: {type: PracticeTypes, floor: Floor, progress: ProgressEntry | null}) {
    const hasBeenStarted = !!progress && progress.progress.length > 0

    return (
        <div className="bg-gray-900/60 rounded-xl p-3">
            <div className="flex justify-between items-center mb-2 gap-3">
                <h3 className="text-sm font-semibold text-gray-200">{practiceTypeLabel(type)}</h3>
                {progress &&
                    <p className="text-xs text-gray-400 shrink-0">Last practiced {progress.lastUpdated.toLocaleDateString()}</p>
                }
            </div>
            {!hasBeenStarted ?
                <p className="text-gray-500 italic text-sm">No data yet - you haven't practiced this floor this way.</p>
                :
                <div className="flex flex-wrap gap-4">
                    {[...floor.markers].sort((a, b) => a.markTime - b.markTime).map((marker, i) => {
                        const entry = progress?.progress.find(p => p.sectionTime === marker.markTime)
                        return (
                            <div key={i} className="flex flex-col items-center gap-1 w-16" title={marker.markerName}>
                                <span className={"w-5 h-5 rounded-full shrink-0 " + confidenceColor(entry?.confidence)}/>
                                <span className="text-[10px] text-gray-400 text-center truncate w-full">{marker.markerName}</span>
                            </div>
                        )
                    })}
                </div>
            }
        </div>
    )
}


