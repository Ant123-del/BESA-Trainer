import { useEffect, useState } from "react"
import { saveQuestionConfidence } from "../../Pages/QuestionSimulator"
import { GradingControls, isCloseMatch } from "../../Tools/ScriptDecoder"
import { generateFillBlanks } from "../../Tools/QuestionDecoder"
import type { Question, QuestionProgress, User } from "../../Tools/types"

//fill-in-the-blank practice - unlike the video Simulator's FillTest (which needs hand-authored blanks),
//blanks here are generated procedurally from the answer text (see QuestionDecoder.generateFillBlanks).
export function FillAnswerTest({setId, question, effectiveAnswer, questionProgress, setQuestionProgress, userInfo, setUserInfo, onContinue, canExit, onExit}: {
    setId: string,
    question: Question,
    effectiveAnswer: string,
    questionProgress: QuestionProgress | null,
    setQuestionProgress: (p: QuestionProgress) => void,
    userInfo: User,
    setUserInfo: (u: User) => void,
    onContinue: () => void,
    canExit: boolean,
    onExit: () => void
}) {
    const {parts, answers: correctAnswers} = generateFillBlanks(effectiveAnswer)
    const [answers, setAnswers] = useState<string[]>(correctAnswers.map(() => ""))
    const [submitted, setSubmitted] = useState(false)

    //fresh form whenever a new question comes up
    useEffect(() => {
        setAnswers(correctAnswers.map(() => ""))
        setSubmitted(false)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [question.id])

    function handleAnswerChange(i: number, value: string) {
        setAnswers(prev => prev.map((a, idx) => idx === i ? value : a))
    }

    function handleTryAgain() {
        setAnswers(correctAnswers.map(() => ""))
        setSubmitted(false)
    }

    async function handleConfidence(confidence: number) {
        await saveQuestionConfidence({confidence, questionId: question.id, setId, practiceType: "fill", questionProgress, setQuestionProgress, userInfo, setUserInfo})
        onContinue()
    }

    //renders the answer text with an inline input box standing in for each blank.
    function renderInputs() {
        const nodes: React.ReactNode[] = []
        parts.forEach((part, pIdx) => {
            if (part) {
                nodes.push(<span key={"t" + pIdx}>{part}</span>)
            }
            if (pIdx < parts.length - 1) {
                nodes.push(
                    <input key={"i" + pIdx}
                        className="w-32 px-2 py-1 rounded border-b-2 bg-gray-700 text-white border-amber-500"
                        value={answers[pIdx] || ""}
                        onChange={(e) => handleAnswerChange(pIdx, e.target.value)}
                        placeholder="..."
                    />
                )
            }
        })
        return nodes
    }

    //shows what the user typed for every blank, colored by whether it matches that blank's answer.
    function renderUserAnswer() {
        const nodes: React.ReactNode[] = []
        parts.forEach((part, pIdx) => {
            if (part) {
                nodes.push(<span key={"t" + pIdx}>{part}</span>)
            }
            if (pIdx < parts.length - 1) {
                const userAnswer = answers[pIdx] || ""
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

    if (correctAnswers.length === 0) {
        return (
            <div className="p-5 bg-gray-900 rounded-2xl text-center">
                <p className="text-gray-400 mb-3">This answer's too short for a fill-in-the-blank - try another mode.</p>
                <button onClick={onContinue} className="p-2 px-6 rounded-full bg-blue-800 hover:bg-blue-900">Continue</button>
            </div>
        )
    }

    return (
        <div className="p-5 bg-gray-900 rounded-2xl">
            <h3 className="text-xl mb-4 text-center">{question.question}</h3>
            {!submitted ?
                <div className="flex flex-col gap-4">
                    <div className="flex flex-wrap items-center gap-2 p-3 rounded-lg bg-gray-800 text-gray-200 leading-loose">
                        {renderInputs()}
                    </div>
                    <button onClick={() => setSubmitted(true)} className="p-2.5 rounded-full bg-blue-800 hover:bg-blue-900 mt-2">Submit</button>
                    {canExit &&
                        <button onClick={onExit} className="p-2.5 rounded-full border border-gray-400 hover:bg-gray-800">Exit</button>
                    }
                </div>
                :
                <div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                            <h4 className="text-sm text-gray-400 mb-2 text-center">Your Answer</h4>
                            <p className="p-3 rounded-lg bg-gray-700 leading-loose">{renderUserAnswer()}</p>
                        </div>
                        <div>
                            <h4 className="text-sm text-gray-400 mb-2 text-center">Full Answer</h4>
                            <p className="p-3 rounded-lg bg-gray-700">{effectiveAnswer}</p>
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
