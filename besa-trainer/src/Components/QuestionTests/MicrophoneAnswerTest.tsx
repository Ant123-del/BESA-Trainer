import { useEffect, useRef, useState } from "react"
import { FaMicrophone, FaStop } from "react-icons/fa"
import { MoonLoader } from "react-spinners"
import { QuestionAnswerReview } from "./QuestionAnswerReview"
import { transcribeAudio } from "../../Tools/Fetch"
import { Loading } from "../SectionEditor/Edit"
import { saveQuestionConfidence } from "../../Pages/QuestionSimulator"
import type { Question, QuestionProgress, User, CustomAnswer } from "../../Tools/types"

type Stage = "idle" | "recording" | "transcribing" | "reviewing"

//tried in order - MediaRecorder only supports whatever the browser actually implements
const CANDIDATE_MIME_TYPES = ["audio/webm", "audio/mp4", "audio/ogg"]

function pickSupportedMimeType(): string {
    for (const type of CANDIDATE_MIME_TYPES) {
        if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(type)) {
            return type
        }
    }
    return ""
}

function formatSeconds(total: number): string {
    const m = Math.floor(total / 60).toString().padStart(2, "0")
    const s = (total % 60).toString().padStart(2, "0")
    return `${m}:${s}`
}

//speak-the-answer practice, direct analogue of the video Simulator's MicrophoneTest.
export default function MicrophoneAnswerTest({setId, question, effectiveAnswer, hasCustomAnswer, customAnswers, setCustomAnswers, questionProgress, setQuestionProgress, userInfo, setUserInfo, onContinue, canExit, onExit}: {
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
    const [stage, setStage] = useState<Stage>("idle")
    const [answer, setAnswer] = useState("")
    const [seconds, setSeconds] = useState(0)
    const [error, setError] = useState("")

    const mediaRecorderRef = useRef<MediaRecorder | null>(null)
    const chunksRef = useRef<Blob[]>([])
    const streamRef = useRef<MediaStream | null>(null)
    const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

    function stopStream() {
        if (timerRef.current) {
            clearInterval(timerRef.current)
            timerRef.current = null
        }
        streamRef.current?.getTracks().forEach(track => track.stop())
        streamRef.current = null
    }

    //fresh attempt whenever a new question comes up
    useEffect(() => {
        stopStream()
        setStage("idle")
        setAnswer("")
        setSeconds(0)
        setError("")
    }, [question.id])

    //stop the microphone stream/timer if the user navigates away mid-recording
    useEffect(() => stopStream, [])

    async function handleStartRecording() {
        setError("")
        try {
            const stream = await navigator.mediaDevices.getUserMedia({audio: true})
            streamRef.current = stream

            const mimeType = pickSupportedMimeType()
            const recorder = mimeType ? new MediaRecorder(stream, {mimeType}) : new MediaRecorder(stream)
            chunksRef.current = []

            recorder.ondataavailable = (e) => {
                if (e.data.size > 0) {
                    chunksRef.current.push(e.data)
                }
            }
            recorder.onstop = handleRecordingStopped

            mediaRecorderRef.current = recorder
            recorder.start()

            setSeconds(0)
            timerRef.current = setInterval(() => setSeconds(s => s + 1), 1000)
            setStage("recording")
        } catch (e) {
            console.error(e)
            setError("Microphone access was denied or is unavailable. Please allow microphone access and try again.")
        }
    }

    function handleFinishRecording() {
        mediaRecorderRef.current?.stop()
    }

    async function handleRecordingStopped() {
        stopStream()
        setStage("transcribing")
        try {
            const mimeType = mediaRecorderRef.current?.mimeType || "audio/webm"
            const audioBlob = new Blob(chunksRef.current, {type: mimeType})
            if (audioBlob.size === 0) {
                throw new Error("No audio was captured")
            }

            const text = await transcribeAudio(audioBlob)
            if (text === undefined) {
                throw new Error("Transcription request failed")
            }

            setAnswer(text)
            setStage("reviewing")
        } catch (e) {
            console.error(e)
            setError("Something went wrong transcribing your recording. Please try again.")
            setStage("idle")
        }
    }

    function handleTryAgain() {
        setAnswer("")
        setSeconds(0)
        setError("")
        setStage("idle")
    }

    async function handleConfidence(confidence: number) {
        await saveQuestionConfidence({confidence, questionId: question.id, setId, practiceType: "microphone", questionProgress, setQuestionProgress, userInfo, setUserInfo})
        onContinue()
    }

    return (
        <div className="p-5 bg-gray-900 rounded-2xl">
            {stage === "reviewing" ?
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
                :
                <div className="flex flex-col items-center gap-4 py-8">
                    <h3 className="text-xl mb-1 text-center">{question.question}</h3>
                    <p className="text-sm text-gray-400 text-center max-w-md">
                        Say your answer out loud, from memory. When you're done, hit finish and we'll transcribe what you said.
                    </p>
                    <button
                        onClick={stage === "recording" ? handleFinishRecording : handleStartRecording}
                        disabled={stage === "transcribing"}
                        className={"w-20 h-20 rounded-full flex items-center justify-center text-3xl transition-colors shrink-0 my-2 " +
                            (stage === "recording" ? "bg-red-700 hover:bg-red-800 animate-pulse" : "bg-blue-800 hover:bg-blue-900")}
                    >
                        {stage === "transcribing" ? <MoonLoader color="white" size={24}/> : stage === "recording" ? <FaStop/> : <FaMicrophone/>}
                    </button>
                    <span className="text-gray-400 text-sm">
                        {stage === "idle" && "Tap the microphone to start recording"}
                        {stage === "recording" && `Recording... ${formatSeconds(seconds)} - tap to finish`}
                    </span>
                    {error && <p className="text-red-400 text-sm text-center max-w-md">{error}</p>}
                    {canExit && stage === "idle" &&
                        <button onClick={onExit} className="p-2.5 px-6 rounded-full border border-gray-400 hover:bg-gray-800 mt-2">Exit</button>
                    }
                </div>
            }
            {stage === "transcribing" && <Loading text="Transcribing your recording..."/>}
        </div>
    )
}
