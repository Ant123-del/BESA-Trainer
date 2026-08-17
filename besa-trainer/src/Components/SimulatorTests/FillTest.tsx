import { saveConfidence } from "../../Pages/Simulator"
import { db } from "../../Tools/firestore";
import { GradingControls, getFillingBlanks, isCloseMatch, renderCorrectAnswer } from "../../Tools/ScriptDecoder";
import { type Marker, type Progress, type User, type Fill } from "../../Tools/types"
import { doc, getDoc} from "firebase/firestore";
import { useEffect, useState } from "react";

type Filling = Fill["fillings"][number]

export function FillTest({floorId, section, progress, setProgress, userInfo, setUserInfo, onContinue, canExit, onExit}: {
    floorId: string,
    section: Marker,
    progress: Progress | null,
    setProgress: (p: Progress) => void,
    userInfo: User | null,
    setUserInfo: (u: User) => void,
    onContinue: () => void,
    canExit: boolean,
    onExit: () => void
}) {
    const [fill, setFill] = useState<Fill | null>(null)
    const [loading, setLoading] = useState(true)
    //one array of per-blank answers for every filling, since a single sentence can hold multiple blanks
    const [answers, setAnswers] = useState<string[][]>([])
    const [skipped, setSkipped] = useState<boolean[]>([])
    const [submitted, setSubmitted] = useState(false)

    useEffect(() => {
        setLoading(true)
        const fillRef = doc(db, "training_data", "data_root", "fills", floorId)
        getDoc(fillRef).then((data) => {
            setFill(data.exists() ? data.data() as Fill : null)
            setLoading(false)
        })
    }, [floorId])

    const sectionFillings = (fill?.fillings || []).filter(f => f.section.markTime === section.markTime)

    //fresh form whenever a new section comes up (or the fills finish loading)
    useEffect(() => {
        setAnswers(sectionFillings.map(f => getFillingBlanks(f).answers.map(() => "")))
        setSkipped(sectionFillings.map(() => false))
        setSubmitted(false)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [section.markTime, fill])

    function handleAnswerChange(i: number, blankIndex: number, value: string) {
        setAnswers(prev => prev.map((a, idx) => idx === i ? a.map((b, bIdx) => bIdx === blankIndex ? value : b) : a))
    }

    function handleSkipToggle(i: number) {
        setSkipped(prev => prev.map((s, idx) => idx === i ? !s : s))
        setAnswers(prev => prev.map((a, idx) => idx === i ? a.map(() => "") : a))
    }

    function handleTryAgain() {
        setAnswers(sectionFillings.map(f => getFillingBlanks(f).answers.map(() => "")))
        setSkipped(sectionFillings.map(() => false))
        setSubmitted(false)
    }

    async function handleConfidence(confidence: number) {
        if (!userInfo) {
            return
        }
        await saveConfidence({confidence, section, floorId, practiceType: "fill", progress, setProgress, userInfo, setUserInfo})
        onContinue()
    }

    //renders a sentence's own text with an inline input box standing in for each of its blanks.
    function renderFillingInputs(f: Filling, i: number) {
        const {parts} = getFillingBlanks(f)
        const rowAnswers = answers[i] || []
        const isSkipped = skipped[i] || false

        const nodes: React.ReactNode[] = []
        parts.forEach((part, pIdx) => {
            if (part) {
                nodes.push(<span key={"t" + pIdx}>{part}</span>)
            }
            if (pIdx < parts.length - 1) {
                nodes.push(
                    <input key={"i" + pIdx}
                        className={"w-32 px-2 py-1 rounded border-b-2 " + (isSkipped ? "bg-gray-800 text-gray-500 border-gray-700 cursor-not-allowed" : "bg-gray-700 text-white border-amber-500")}
                        value={rowAnswers[pIdx] || ""}
                        disabled={isSkipped}
                        onChange={(e) => handleAnswerChange(i, pIdx, e.target.value)}
                        placeholder="..."
                    />
                )
            }
        })
        return nodes
    }

    //shows what the user typed for every blank in a sentence, each colored by whether it matches that blank's answer.
    function renderUserAnswer(f: Filling, i: number) {
        if (skipped[i]) {
            return <span className="text-gray-500 italic">Skipped</span>
        }

        const {parts, answers: correctAnswers} = getFillingBlanks(f)
        const rowAnswers = answers[i] || []

        const nodes: React.ReactNode[] = []
        parts.forEach((part, pIdx) => {
            if (part) {
                nodes.push(<span key={"t" + pIdx}>{part}</span>)
            }
            if (pIdx < parts.length - 1) {
                const userAnswer = rowAnswers[pIdx] || ""
                const correct = isCloseMatch(userAnswer, correctAnswers[pIdx] || "")
                nodes.push(
                    <mark key={"m" + pIdx} className={"rounded px-1 " + (correct ? "bg-green-700/70 text-white" : "bg-red-700/70 text-white")}>
                        {userAnswer || <span className="italic text-gray-300">no answer</span>}
                    </mark>
                )
            }
        })
        return nodes
    }

    if (loading) {
        return <div className="p-5 bg-gray-900 rounded-2xl text-center text-gray-400 animate-pulse">Loading section...</div>
    }

    if (sectionFillings.length === 0) {
        return (
            <div className="p-5 bg-gray-900 rounded-2xl text-center">
                <p className="text-gray-400 mb-3">No fills for this section.</p>
                <button onClick={onContinue} className="p-2 px-6 rounded-full bg-blue-800 hover:bg-blue-900">Continue</button>
            </div>
        )
    }

    return (
        <div className="p-5 bg-gray-900 rounded-2xl">
            <h3 className="text-xl mb-4 text-center">Fill In The Blank</h3>
            {!submitted ?
                <div className="flex flex-col gap-4">
                    {sectionFillings.map((f, i) => (
                        <div key={i} className="flex flex-col gap-1.5">
                            <div className="flex flex-wrap items-center gap-2 p-3 rounded-lg bg-gray-800 text-gray-200 leading-loose">
                                {renderFillingInputs(f, i)}
                            </div>
                            <div className="flex justify-end">
                                <button type="button" onClick={() => handleSkipToggle(i)}
                                    className={"px-4 py-1 rounded-lg text-sm shrink-0 " + (skipped[i] ? "bg-amber-700 hover:bg-amber-800" : "bg-gray-700 hover:bg-gray-600")}>
                                    {skipped[i] ? "Skipped" : "Skip"}
                                </button>
                            </div>
                        </div>
                    ))}
                    <button onClick={() => setSubmitted(true)} className="p-2.5 rounded-full bg-blue-800 hover:bg-blue-900 mt-2">Submit</button>
                    {canExit &&
                        <button onClick={onExit} className="p-2.5 rounded-full border border-gray-400 hover:bg-gray-800">Exit</button>
                    }
                </div>
                :
                <div>
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <h4 className="text-sm text-gray-400 mb-2 text-center">Your Answer</h4>
                            {sectionFillings.map((f, i) => (
                                <p key={i} className={"p-3 rounded-lg mb-2 leading-loose " + (skipped[i] ? "bg-gray-800" : "bg-gray-700")}>
                                    {renderUserAnswer(f, i)}
                                </p>
                            ))}
                        </div>
                        <div>
                            <h4 className="text-sm text-gray-400 mb-2 text-center">Correct Answer</h4>
                            {sectionFillings.map((f, i) => (
                                <p key={i} className="p-3 rounded-lg mb-2 bg-gray-700">{renderCorrectAnswer(f)}</p>
                            ))}
                        </div>
                    </div>
                    <div className="mt-5">
                        <GradingControls onTryAgain={handleTryAgain} onConfidence={handleConfidence} canExit={canExit} onExit={onExit}/>
                    </div>
                </div>
            }
        </div>
    )
}
