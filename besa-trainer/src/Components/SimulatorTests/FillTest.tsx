import { saveConfidence } from "../../Pages/Simulator"
import { db } from "../../Tools/firestore";
import { GradingControls, getFillingBlanks, isCloseMatch, renderCorrectAnswer } from "../../Tools/ScriptDecoder";
import { type Marker, type Progress, type User, type Fill } from "../../Tools/types"
import { doc, getDoc} from "firebase/firestore";
import { useEffect, useState } from "react";

type Filling = Fill["fillings"][number]

export function FillTest({floorId, section, initialFill, progress, setProgress, userInfo, setUserInfo, onContinue, canExit, onExit}: {
    floorId: string,
    section: Marker,
    initialFill?: Fill | null,
    progress: Progress | null,
    setProgress: (p: Progress) => void,
    userInfo: User | null,
    setUserInfo: (u: User) => void,
    onContinue: () => void,
    canExit: boolean,
    onExit: () => void
}) {
    const [fill, setFill] = useState<Fill | null>(initialFill ?? null)
    const [loading, setLoading] = useState(initialFill === undefined)
    //one array of per-blank answers for every filling, since a single sentence can hold multiple blanks
    const [answers, setAnswers] = useState<string[][]>([])
    const [skipped, setSkipped] = useState<boolean[]>([])
    const [submitted, setSubmitted] = useState(false)

    useEffect(() => {
        if (initialFill !== undefined) {
            setFill(initialFill)
            setLoading(false)
            return
        }
        setLoading(true)
        const fillRef = doc(db, "training_data", "data_root", "fills", floorId)
        getDoc(fillRef).then((data) => {
            setFill(data.exists() ? data.data() as Fill : null)
            setLoading(false)
        })
    }, [floorId, initialFill])

    const sectionFillings = (fill?.fillings || []).filter(f => f.section.markTime === section.markTime)

    //if a section has no highlighted question, automatically skip over it
    useEffect(() => {
        if (!loading && sectionFillings.length === 0) {
            onContinue()
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [loading, section.markTime, sectionFillings.length])

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
                        className={"w-32 px-2 py-1 rounded border-b-2 " + (isSkipped ? "bg-be-navy-darker text-be-dark-gray border-be-dark-gray cursor-not-allowed" : "bg-be-navy text-white border-be-orange")}
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
            return <span className="text-be-light-gray italic">Skipped</span>
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
                        {userAnswer || <span className="italic text-be-light-gray">no answer</span>}
                    </mark>
                )
            }
        })
        return nodes
    }

    if (loading) {
        return <div className="p-5 bg-be-navy-darker rounded-2xl text-center text-be-light-gray animate-pulse">Loading section...</div>
    }

    if (sectionFillings.length === 0) {
        return null
    }

    return (
        <div className="p-5 bg-be-navy-darker rounded-2xl border border-be-orange/40">
            <h3 className="text-xl font-bold mb-4 text-center text-be-yellow">Fill In The Blank</h3>
            {!submitted ?
                <div className="flex flex-col gap-4">
                    {sectionFillings.map((f, i) => (
                        <div key={i} className="flex flex-col gap-1.5">
                            <div className="flex flex-wrap items-center gap-2 p-3 rounded-lg bg-be-navy-dark text-white leading-loose">
                                {renderFillingInputs(f, i)}
                            </div>
                            <div className="flex justify-end">
                                <button type="button" onClick={() => handleSkipToggle(i)}
                                    className={"px-4 py-1 rounded-lg text-sm font-bold shrink-0 transition-colors " + (skipped[i] ? "bg-be-orange text-black hover:bg-be-orange-dark" : "bg-be-navy text-white hover:bg-be-navy-dark")}>
                                    {skipped[i] ? "Skipped" : "Skip"}
                                </button>
                            </div>
                        </div>
                    ))}
                    <button onClick={() => setSubmitted(true)} className="p-2.5 rounded-full bg-be-orange hover:bg-be-orange-dark text-black font-bold mt-2 transition-colors">Submit</button>
                    {canExit &&
                        <button onClick={onExit} className="p-2.5 rounded-full border-2 border-be-light-gray hover:bg-be-navy font-bold transition-colors">Exit</button>
                    }
                </div>
                :
                <div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                            <h4 className="text-sm font-bold text-be-light-gray mb-2 text-center">Your Answer</h4>
                            {sectionFillings.map((f, i) => (
                                <p key={i} className={"p-3 rounded-lg mb-2 leading-loose " + (skipped[i] ? "bg-be-navy-dark" : "bg-be-navy")}>
                                    {renderUserAnswer(f, i)}
                                </p>
                            ))}
                        </div>
                        <div>
                            <h4 className="text-sm font-bold text-be-light-gray mb-2 text-center">Correct Answer</h4>
                            {sectionFillings.map((f, i) => (
                                <p key={i} className="p-3 rounded-lg mb-2 bg-be-navy">{renderCorrectAnswer(f)}</p>
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
