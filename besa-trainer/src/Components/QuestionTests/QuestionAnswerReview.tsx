import { useState } from "react"
import { computeMatchScore, GradingControls } from "../../Tools/ScriptDecoder"
import { setCustomAnswer, removeCustomAnswer } from "../../Tools/firestore"
import type { CustomAnswer } from "../../Tools/types"

//shared results view for question-set practice (text/microphone modes) - the score, side-by-side
//comparison, "Set as My Answer"/"Revert to Original", and the grading footer. Direct analogue of
//ScriptDecoder's AnswerReview, but the override is a plain text field on the user doc (no Storage blob).
export function QuestionAnswerReview({uid, setId, questionId, answer, correctAnswer, hasCustomAnswer, customAnswers, setCustomAnswers, onTryAgain, onConfidence, canExit, onExit}: {
    uid: string,
    setId: string,
    questionId: string,
    answer: string,
    correctAnswer: string,
    hasCustomAnswer: boolean,
    customAnswers: CustomAnswer[],
    setCustomAnswers: (a: CustomAnswer[]) => void,
    onTryAgain: () => void,
    onConfidence: (confidence: number) => void,
    canExit: boolean,
    onExit: () => void
}) {
    const [saving, setSaving] = useState(false)
    const [justSaved, setJustSaved] = useState(false)

    const score = computeMatchScore(answer, correctAnswer)

    async function handleSetAsAnswer() {
        setSaving(true)
        try {
            const updated = await setCustomAnswer(uid, customAnswers, setId, questionId, answer)
            setCustomAnswers(updated)
            setJustSaved(true)
        } catch (e) {
            console.error(e)
        } finally {
            setSaving(false)
        }
    }

    async function handleRevert() {
        setSaving(true)
        try {
            const updated = await removeCustomAnswer(uid, customAnswers, setId, questionId)
            setCustomAnswers(updated)
        } catch (e) {
            console.error(e)
        } finally {
            setSaving(false)
        }
    }

    function handleTryAgain() {
        setJustSaved(false)
        onTryAgain()
    }

    return (
        <div>
            <div className="flex justify-between items-start mb-5 gap-3">
                <div className="flex items-center gap-2 flex-wrap">
                    <div className="relative group inline-block">
                        <button onClick={handleSetAsAnswer} disabled={saving || justSaved}
                            className={"text-sm px-4 py-2 rounded-full border shrink-0 " + (justSaved ? "border-green-600 text-green-500 cursor-default" : "border-amber-500 text-amber-400 hover:bg-amber-500/10")}>
                            {justSaved ? "Answer Saved" : "Set as My Answer"}
                        </button>
                        <div className="absolute left-0 top-full mt-2 w-72 p-4 rounded-lg bg-black text-xs text-gray-200 opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none z-50">
                            Saves what you just answered as your own preferred answer for this question -
                            shown (and graded against) instead of the set's answer until you revert it.
                        </div>
                    </div>
                    {hasCustomAnswer &&
                        <button onClick={handleRevert} disabled={saving}
                            className="text-sm px-4 py-2 rounded-full border border-gray-500 text-gray-300 hover:bg-gray-800 disabled:opacity-50 shrink-0">
                            Revert to Original
                        </button>
                    }
                </div>
                <div className="text-right shrink-0">
                    <span className="text-2xl font-bold">{score}%</span>
                    <span className="block text-xs text-gray-400">Match Score</span>
                </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                    <h4 className="text-sm text-gray-400 mb-2 text-center">Your Answer</h4>
                    <p className="p-3 rounded-lg bg-gray-700 whitespace-pre-wrap">{answer || <span className="text-gray-500 italic">No answer</span>}</p>
                </div>
                <div>
                    <h4 className="text-sm text-gray-400 mb-2 text-center">{hasCustomAnswer ? "Your Saved Answer" : "Answer"}</h4>
                    <p className="p-3 rounded-lg bg-gray-700 whitespace-pre-wrap">{correctAnswer}</p>
                </div>
            </div>
            <div className="mt-5">
                <GradingControls onTryAgain={handleTryAgain} onConfidence={onConfidence} canExit={canExit} onExit={onExit}/>
            </div>
        </div>
    )
}
