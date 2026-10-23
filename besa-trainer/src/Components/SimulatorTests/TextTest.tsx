import { saveConfidence } from "../../Pages/Simulator"
import { AnswerReview, getPrecedingSectionBounds, getVtt, isLineInSection } from "../../Tools/ScriptDecoder";
import { type Marker, type Progress, type User, type CosScript} from "../../Tools/types"
import { useEffect, useState } from "react";

export function TextTest({floorId, section, sections, scriptText, customBaseScriptText, cosScript, onScriptUpdated, progress, setProgress, userInfo, setUserInfo, onContinue, canExit, onExit}: {
    floorId: string,
    section: Marker,
    sections: Marker[],
    scriptText: string,
    customBaseScriptText?: string,
    cosScript: CosScript | null,
    onScriptUpdated: (newScriptText: string) => Promise<void> | void,
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

    useEffect(() => {
        if (correctText.trim().length === 0) {
            onContinue()
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [section.markTime, correctText])

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
        return null
    }

    return (
        <div className="p-5 bg-be-navy-darker rounded-2xl border border-be-orange/40">
            {!submitted ?
                <div className="flex flex-col gap-4">
                    <h3 className="text-xl font-bold mb-1 text-center text-be-yellow">Retype The Script</h3>
                    <textarea
                        className="w-full h-48 p-4 rounded-lg bg-be-navy-dark text-white border border-be-light-gray/30 resize-none"
                        value={answer}
                        onChange={(e) => setAnswer(e.target.value)}
                        placeholder="Type out this section of the tour script from memory. Don't worry about matching it word-for-word - just get the key points down, then hit Submit to see how close you were."
                    />
                    <div className="flex justify-center gap-3">
                        <button onClick={() => setSubmitted(true)} className="p-2.5 px-6 rounded-full bg-be-orange hover:bg-be-orange-dark text-black font-bold transition-colors">Submit</button>
                        {canExit &&
                            <button onClick={onExit} className="p-2.5 px-6 rounded-full border-2 border-be-light-gray hover:bg-be-navy font-bold transition-colors">Exit</button>
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
                    customBaseScriptText={customBaseScriptText}
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
