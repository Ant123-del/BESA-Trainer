import { useEffect, useState } from "react"
import { QuestionAnswerReview } from "./QuestionAnswerReview"
import { saveQuestionConfidence } from "../../Pages/QuestionSimulator"
import type { Question, QuestionProgress, User, CustomAnswer } from "../../Tools/types"

//retype-the-answer-from-memory practice, direct analogue of the video Simulator's TextTest.
export function TextAnswerTest({setId, question, effectiveAnswer, hasCustomAnswer, customAnswers, setCustomAnswers, questionProgress, setQuestionProgress, userInfo, setUserInfo, onContinue, canExit, onExit}: {
    setId: string,
    question: Question,
    effectiveAnswer: string,
    hasCustomAnswer: boolean,
    customAnswers: CustomAnswer[],
    setCustomAnswers: (a: CustomAnswer[]) => void,
    questionProgress: QuestionProgress | null,
    setQuestionProgress: (p: QuestionProgress) => void,
    userInfo: User,
    setUserInfo: (u: User) => void,
    onContinue: () => void,
    canExit: boolean,
    onExit: () => void
}) {
    const [answer, setAnswer] = useState("")
    const [submitted, setSubmitted] = useState(false)

    //fresh form whenever a new question comes up
    useEffect(() => {
        setAnswer("")
        setSubmitted(false)
    }, [question.id])

    function handleTryAgain() {
        setAnswer("")
        setSubmitted(false)
    }

    async function handleConfidence(confidence: number) {
        await saveQuestionConfidence({confidence, questionId: question.id, setId, practiceType: "text", questionProgress, setQuestionProgress, userInfo, setUserInfo})
        onContinue()
    }

    return (
        <div className="p-5 bg-gray-900 rounded-2xl">
            {!submitted ?
                <div className="flex flex-col gap-4">
                    <h3 className="text-xl mb-1 text-center">{question.question}</h3>
                    <textarea
                        className="w-full h-40 p-4 rounded-lg bg-gray-700 text-white resize-none"
                        value={answer}
                        onChange={(e) => setAnswer(e.target.value)}
                        placeholder="Type your answer from memory, then hit Submit to see how close you were."
                    />
                    <div className="flex justify-center gap-3">
                        <button onClick={() => setSubmitted(true)} className="p-2.5 px-6 rounded-full bg-blue-800 hover:bg-blue-900">Submit</button>
                        {canExit &&
                            <button onClick={onExit} className="p-2.5 px-6 rounded-full border border-gray-400 hover:bg-gray-800">Exit</button>
                        }
                    </div>
                </div>
                :
                <QuestionAnswerReview
                    uid={userInfo.uid}
                    setId={setId}
                    questionId={question.id}
                    answer={answer}
                    correctAnswer={effectiveAnswer}
                    hasCustomAnswer={hasCustomAnswer}
                    customAnswers={customAnswers}
                    setCustomAnswers={setCustomAnswers}
                    onTryAgain={handleTryAgain}
                    onConfidence={handleConfidence}
                    canExit={canExit}
                    onExit={onExit}
                />
            }
        </div>
    )
}
