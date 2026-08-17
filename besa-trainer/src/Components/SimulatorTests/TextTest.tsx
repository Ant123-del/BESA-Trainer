import { saveConfidence } from "../../Pages/Simulator"
import { AnswerReview, getPrecedingSectionBounds, getVtt, isLineInSection } from "../../Tools/ScriptDecoder";
import { type Marker, type Progress, type User, type CosScript} from "../../Tools/types"
import { useEffect, useRef, useState } from "react";

export function TextTest({floorId, section, sections, scriptText, cosScript, onScriptUpdated, progress, setProgress, userInfo, setUserInfo, onContinue, canExit, onExit}: {
    floorId: string,
    section: Marker,
    sections: Marker[],
    scriptText: string,
    cosScript: CosScript | null,
    onScriptUpdated: (newScriptText: string) => void,
    progress: Progress | null,
    setProgress: (p: Progress) => void,
    userInfo: User | null,
    setUserInfo: (u: User) => void,
    onContinue: () => void,
    canExit: boolean,
    onExit: () => void
}) {
    const [answer, setAnswer] = useState("")
    const [submitted, setSubmitted] = useState(false)
    
    const {lower, upper} = getPrecedingSectionBounds(sections, section)
    const correctText = getVtt(scriptText).filter(l => isLineInSection(l, lower, upper)).map(l => l.text).join(" ")

    //fresh form whenever a new section comes up
    useEffect(() => {
        setAnswer("")
        setSubmitted(false)
    }, [section.markTime])

    function handleTryAgain() {
        setAnswer("")
        setSubmitted(false)
    }

    async function handleConfidence(confidence: number) {
        if (!userInfo) {
            return
        }

        await saveConfidence({confidence, section, floorId, practiceType: "text", progress, setProgress, userInfo, setUserInfo})
        onContinue()
    }

    if (correctText.trim().length === 0) {
        return (
            <div className="p-5 bg-gray-900 rounded-2xl text-center">
                <p className="text-gray-400 mb-3">No script text for this section.</p>
                <button onClick={onContinue} className="p-2 px-6 rounded-full bg-blue-800 hover:bg-blue-900">Continue</button>
            </div>
        )
    }

    return (
        <div className="p-5 bg-gray-900 rounded-2xl">
            {!submitted ?
                <div className="flex flex-col gap-4">
                    <h3 className="text-xl mb-1 text-center">Retype The Script</h3>
                    <textarea
                        className="w-full h-48 p-4 rounded-lg bg-gray-700 text-white resize-none"
                        value={answer}
                        onChange={(e) => setAnswer(e.target.value)}
                        placeholder="Type out this section of the tour script from memory. Don't worry about matching it word-for-word - just get the key points down, then hit Submit to see how close you were."
                    />
                    <div className="flex justify-center gap-3">
                        <button onClick={() => setSubmitted(true)} className="p-2.5 px-6 rounded-full bg-blue-800 hover:bg-blue-900">Submit</button>
                        {canExit &&
                            <button onClick={onExit} className="p-2.5 px-6 rounded-full border border-gray-400 hover:bg-gray-800">Exit</button>
                        }
                    </div>
                </div>
                :
                <AnswerReview
                    answer={answer}
                    correctText={correctText}
                    section={section}
                    sections={sections}
                    scriptText={scriptText}
                    cosScript={cosScript}
                    onScriptUpdated={onScriptUpdated}
                    onTryAgain={handleTryAgain}
                    onConfidence={handleConfidence}
                    canExit={canExit}
                    onExit={onExit}
                />
            }
        </div>
    )
}
