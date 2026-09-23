import { useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { getAuth, onAuthStateChanged } from "firebase/auth"
import { doc, getDoc } from "firebase/firestore"
import { MoonLoader } from "react-spinners"
import Header from "../Components/Header"
import { db, getQuestionSets } from "../Tools/firestore"
import { toDate } from "./Simulator"
import type { PracticeTypes, QuestionProgress, QuestionSet, User } from "../Tools/types"

const PRACTICE_TYPES: PracticeTypes[] = ["fill", "text", "microphone"]

function practiceTypeLabel(type: PracticeTypes): string {
    switch (type) {
        case "fill": return "Fill In The Blank"
        case "text": return "Type The Answer"
        case "microphone": return "Speak The Answer"
    }
}

function confidenceColor(confidence: number | undefined): string {
    if (confidence === 0) return "bg-red-600"
    if (confidence === 1) return "bg-yellow-500"
    if (confidence === 2) return "bg-green-600"
    return "bg-amber-600"
}

//per-set practice history, structural twin of Progress.tsx but for question sets instead of a fixed
//floor list - fetches the dynamic (user-creatable) set list rather than iterating FLOOR_SEQUENCE.
export default function QuestionsProgress() {
    const [loading, setLoading] = useState(true)
    const [sets, setSets] = useState<QuestionSet[]>([])
    const [questionProgress, setQuestionProgress] = useState<QuestionProgress[]>([])

    useEffect(() => {
        const auth = getAuth()
        const unsub = onAuthStateChanged(auth, async (user) => {
            if (!user) {
                setLoading(false)
                return
            }
            try {
                const [userDoc, questionSets] = await Promise.all([
                    getDoc(doc(db, "training_data/data_root/users/" + user.uid)),
                    getQuestionSets(),
                ])
                const foundUser = userDoc.exists() ? userDoc.data() as User : null
                const progress = (foundUser?.questionProgress || []).map(p => ({...p, lastUpdated: toDate(p.lastUpdated)}))
                setQuestionProgress(progress)
                setSets(questionSets)
            } catch (e) {
                console.error(e)
            } finally {
                setLoading(false)
            }
        })
        return () => unsub()
    }, [])

    return (
        <div className="bg-gray-900 w-full min-h-screen text-white">
            <Header/>
            <div className="h-16 relative top-0 left-0 w-full"></div>
            <div className="w-11/12 md:w-5/6 mx-auto py-10">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 mb-2">
                    <h1 className="text-2xl sm:text-3xl md:text-4xl tracking-wider">My Question Progress</h1>
                    <Link to="/" className="p-2 px-6 rounded-full border border-gray-400 hover:bg-gray-800 shrink-0">Back to Home</Link>
                </div>
                <div className="flex flex-wrap items-center gap-4 text-xs text-gray-400 mb-8">
                    <LegendDot color="bg-green-600" label="Easy"/>
                    <LegendDot color="bg-yellow-500" label="Good"/>
                    <LegendDot color="bg-red-600" label="Hard"/>
                    <LegendDot color="bg-amber-600" label="Not attempted"/>
                </div>
                {loading ?
                    <div className="flex justify-center py-20"><MoonLoader color="white" size={30}/></div>
                    : sets.length === 0 ?
                    <p className="text-gray-500 italic">No question sets exist yet.</p>
                    :
                    <div className="flex flex-col gap-4">
                        {sets.map(set => (
                            <SetSummaryCard key={set.id} set={set} progressList={questionProgress.filter(p => p.setId === set.id)}/>
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

function SetSummaryCard({set, progressList}: {set: QuestionSet, progressList: QuestionProgress[]}) {
    return (
        <div className="bg-gray-800 rounded-2xl p-5">
            <div className="flex flex-wrap justify-between items-center mb-4 gap-3">
                <h2 className="text-2xl">{set.title}</h2>
                <Link to={`/questions/${set.id}`} className="p-2 px-6 rounded-full bg-amber-800 hover:bg-amber-900 text-sm shrink-0">
                    Practice
                </Link>
            </div>
            {set.questions.length === 0 ?
                <p className="text-gray-500 italic text-sm">This set has no questions yet.</p>
                :
                <div className="flex flex-col gap-4">
                    {PRACTICE_TYPES.map(type => (
                        <PracticeTypeRow key={type} type={type} set={set} progress={progressList.find(p => p.practiceType === type) || null}/>
                    ))}
                </div>
            }
        </div>
    )
}

function PracticeTypeRow({type, set, progress}: {type: PracticeTypes, set: QuestionSet, progress: QuestionProgress | null}) {
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
                <p className="text-gray-500 italic text-sm">No data yet - you haven't practiced this set this way.</p>
                :
                <div className="flex flex-wrap gap-4">
                    {set.questions.map((question, i) => {
                        const entry = progress?.progress.find(p => p.questionId === question.id)
                        return (
                            <div key={i} className="flex flex-col items-center gap-1 w-16" title={question.question}>
                                <span className={"w-5 h-5 rounded-full shrink-0 " + confidenceColor(entry?.confidence)}/>
                                <span className="text-[10px] text-gray-400 text-center truncate w-full">Q{i + 1}</span>
                            </div>
                        )
                    })}
                </div>
            }
        </div>
    )
}
