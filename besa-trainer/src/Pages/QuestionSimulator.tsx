import { useEffect, useState } from "react"
import { Link, useParams } from "react-router-dom"
import { getAuth, onAuthStateChanged } from "firebase/auth"
import { doc, getDoc, updateDoc } from "firebase/firestore"
import { MoonLoader } from "react-spinners"
import { IoMdArrowRoundBack } from "react-icons/io"
import { Loading } from "../Components/SectionEditor/Edit"
import { db } from "../Tools/firestore"
import { toDate } from "./Simulator"
import { TextAnswerTest } from "../Components/QuestionTests/TextAnswerTest"
import MicrophoneAnswerTest from "../Components/QuestionTests/MicrophoneAnswerTest"
import { FillAnswerTest } from "../Components/QuestionTests/FillAnswerTest"
import type { CustomAnswer, PracticeTypes, Question, QuestionProgress, QuestionSet, User } from "../Tools/types"

//shared by every question-mode component - records a confidence rating for the question, keyed under
//whichever practiceType is currently active. Direct analogue of Simulator.tsx's exported saveConfidence.
export async function saveQuestionConfidence({confidence, questionId, setId, practiceType, questionProgress, setQuestionProgress, userInfo, setUserInfo}: {
    confidence: number,
    questionId: string,
    setId: string,
    practiceType: PracticeTypes,
    questionProgress: QuestionProgress | null,
    setQuestionProgress: (p: QuestionProgress) => void,
    userInfo: User,
    setUserInfo: (u: User) => void
}) {
    const newEntry = {confidence, questionId}
    const updatedProgress: QuestionProgress = questionProgress
        ? {...questionProgress, lastUpdated: new Date(), progress: [...questionProgress.progress.filter(p => p.questionId !== questionId), newEntry]}
        : {setId, practiceType, lastUpdated: new Date(), progress: [newEntry]}

    setQuestionProgress(updatedProgress)

    const otherProgress = (userInfo.questionProgress || []).filter(p => !(p.setId === setId && p.practiceType === practiceType))
    const newProgressList = [...otherProgress, updatedProgress]
    setUserInfo({...userInfo, questionProgress: newProgressList})

    const userD = doc(db, "training_data/data_root/users/" + userInfo.uid)
    await updateDoc(userD, {questionProgress: newProgressList})
}

function confidenceColor(confidence: number | undefined): string {
    if (confidence === 0) return "bg-red-600"
    if (confidence === 1) return "bg-yellow-500"
    if (confidence === 2) return "bg-green-600"
    return "bg-amber-600"
}

export default function QuestionSimulator() {
    const {setId} = useParams()

    const [loading, setLoading] = useState(true)
    const [set, setSet] = useState<QuestionSet | null>(null)
    const [userInfo, setUserInfo] = useState<User | null>(null)
    const [customAnswers, setCustomAnswers] = useState<CustomAnswer[]>([])

    const [practiceType, setPracticeType] = useState<PracticeTypes>("text")
    const [questionProgress, setQuestionProgress] = useState<QuestionProgress | null>(null)
    const [currentIndex, setCurrentIndex] = useState(0)

    const [welcomeScreen, setWelcomeScreen] = useState(true)
    const [needsPracticeTypeChoice, setNeedsPracticeTypeChoice] = useState(false)
    const [practiceTypePopup, setPracticeTypePopup] = useState(false)
    const [settingsPopup, setSettingsPopup] = useState(false)
    const [pendingPracticeType, setPendingPracticeType] = useState<PracticeTypes>("text")
    const [settingsSaving, setSettingsSaving] = useState(false)

    const isBesaAccount = userInfo?.accountType === "besa" || userInfo?.accountType === "besaLead"

    useEffect(() => {
        if (!setId) {
            return
        }
        setLoading(true)
        getDoc(doc(db, "training_data", "data_root", "question_sets", setId)).then(snap => {
            setSet(snap.exists() ? snap.data() as QuestionSet : null)
        })

        const auth = getAuth()
        const unsub = onAuthStateChanged(auth, async (user) => {
            if (!user) {
                setLoading(false)
                return
            }
            try {
                const userDoc = await getDoc(doc(db, "training_data/data_root/users/" + user.uid))
                if (!userDoc.exists()) {
                    return
                }
                const foundUser = userDoc.data() as User
                if (foundUser.questionProgress) {
                    foundUser.questionProgress = foundUser.questionProgress.map(p => ({...p, lastUpdated: toDate(p.lastUpdated)}))
                }
                setUserInfo(foundUser)
                setCustomAnswers(foundUser.customAnswers || [])

                const relevantProgress = (foundUser.questionProgress || []).filter(p => p.setId === setId)
                const latestProgress = relevantProgress.length > 0
                    ? [...relevantProgress].sort((a, b) => b.lastUpdated.getTime() - a.lastUpdated.getTime())[0]
                    : null

                if (latestProgress) {
                    setPracticeType(latestProgress.practiceType)
                    setQuestionProgress(latestProgress)
                }
                setNeedsPracticeTypeChoice(!latestProgress || latestProgress.progress.length === 0)
            } catch (e) {
                console.error(e)
            } finally {
                setLoading(false)
            }
        })
        return () => unsub()
    }, [setId])

    //lands on the first not-yet-rated question whenever the active practice type (or its progress) changes
    useEffect(() => {
        const completedIds = new Set(questionProgress?.progress.map(p => p.questionId) ?? [])
        const firstIncomplete = (set?.questions || []).findIndex(q => !completedIds.has(q.id))
        setCurrentIndex(firstIncomplete === -1 ? (set?.questions.length || 0) : firstIncomplete)
    }, [practiceType, questionProgress, set])

    function handleContinueToSet() {
        if (needsPracticeTypeChoice && isBesaAccount) {
            setPracticeTypePopup(true)
        } else {
            setWelcomeScreen(false)
        }
    }

    async function handleChoosePracticeType(type: PracticeTypes) {
        if (!userInfo || !setId) {
            return
        }
        const existingEntry = (userInfo.questionProgress || []).find(p => p.setId === setId && p.practiceType === type)
        const chosenProgress: QuestionProgress = existingEntry
            ? {...existingEntry, lastUpdated: new Date()}
            : {setId, practiceType: type, lastUpdated: new Date(), progress: []}

        const otherProgress = (userInfo.questionProgress || []).filter(p => !(p.setId === setId && p.practiceType === type))
        const newProgressList = [...otherProgress, chosenProgress]

        setPracticeType(type)
        setQuestionProgress(chosenProgress)
        setNeedsPracticeTypeChoice(false)
        setUserInfo({...userInfo, questionProgress: newProgressList})
        await updateDoc(doc(db, "training_data/data_root/users/" + userInfo.uid), {questionProgress: newProgressList})

        setPracticeTypePopup(false)
        setWelcomeScreen(false)
    }

    function openSettings() {
        setPendingPracticeType(practiceType)
        setSettingsPopup(true)
    }

    async function handleSaveSettings() {
        if (!userInfo || !setId || pendingPracticeType === practiceType) {
            return
        }
        setSettingsSaving(true)
        const existingEntry = (userInfo.questionProgress || []).find(p => p.setId === setId && p.practiceType === pendingPracticeType)
        const switchedProgress: QuestionProgress = existingEntry
            ? {...existingEntry, lastUpdated: new Date()}
            : {setId, practiceType: pendingPracticeType, lastUpdated: new Date(), progress: []}

        const otherProgress = (userInfo.questionProgress || []).filter(p => !(p.setId === setId && p.practiceType === pendingPracticeType))
        const newProgressList = [...otherProgress, switchedProgress]

        setPracticeType(pendingPracticeType)
        setQuestionProgress(switchedProgress)
        setUserInfo({...userInfo, questionProgress: newProgressList})
        await updateDoc(doc(db, "training_data/data_root/users/" + userInfo.uid), {questionProgress: newProgressList})

        setSettingsSaving(false)
        setSettingsPopup(false)
    }

    function handleContinueAfterAnswer() {
        setCurrentIndex(i => i + 1)
    }

    if (loading) {
        return (
            <div className="bg-gray-900 w-full min-h-screen text-white flex items-center justify-center">
                <MoonLoader color="white" size={40}/>
            </div>
        )
    }

    if (!set) {
        return (
            <div className="bg-gray-900 w-full min-h-screen text-white flex flex-col items-center justify-center gap-3">
                <p className="text-gray-400">This question set doesn't exist (or was deleted).</p>
                <Link to="/" className="p-2 px-6 rounded-full bg-blue-800 hover:bg-blue-900">Back to Home</Link>
            </div>
        )
    }

    const currentQuestion: Question | undefined = set.questions[currentIndex]
    const customForCurrent = currentQuestion
        ? customAnswers.find(a => a.setId === set.id && a.questionId === currentQuestion.id)
        : undefined
    const effectiveAnswer = customForCurrent?.answer ?? currentQuestion?.answer ?? ""

    return (
        <div className="bg-gray-900 w-full min-h-screen text-white">
            <header className="p-3 flex flex-wrap justify-between items-center gap-3 border-b-2 border-b-solid border-b-gray-500">
                <h1 className="text-2xl sm:text-3xl md:text-4xl tracking-wider">{set.title}</h1>
                <div className="flex justify-between items-center gap-3">
                    <Link to="/" className="flex justify-center gap-2 items-center hover:text-gray-400 p-2 cursor-pointer">
                        <IoMdArrowRoundBack/>
                        <span>Back</span>
                    </Link>
                    {isBesaAccount && !welcomeScreen &&
                        <button onClick={openSettings} className="text-sm px-4 py-2 rounded-full border border-gray-500 hover:bg-gray-800">Settings</button>
                    }
                </div>
            </header>

            <div className="w-11/12 max-w-3xl box-border mx-auto my-6 rounded-2xl bg-gray-800 p-6">
                {welcomeScreen ?
                    <div className="text-center py-10">
                        <h2 className="text-3xl tracking-wide mb-3">{set.title}</h2>
                        <p className="text-gray-400 mb-6">{set.questions.length} question{set.questions.length === 1 ? "" : "s"} in this set.</p>
                        {isBesaAccount ?
                            <button onClick={handleContinueToSet} className="p-2.5 px-8 rounded-full bg-blue-800 hover:bg-blue-900">Let's Go!</button>
                            :
                            <div className="flex flex-col gap-4 text-left mt-6">
                                {set.questions.map(q => (
                                    <div key={q.id} className="bg-gray-900 rounded-xl p-4">
                                        <p className="font-semibold mb-1">{q.question}</p>
                                        <p className="text-gray-400 text-sm">{q.answer}</p>
                                    </div>
                                ))}
                            </div>
                        }
                    </div>
                    :
                    <>
                        {set.questions.length > 0 &&
                            <div className="flex flex-wrap gap-2 mb-5 justify-center">
                                {set.questions.map((q, i) => {
                                    const entry = questionProgress?.progress.find(p => p.questionId === q.id)
                                    return (
                                        <button key={q.id} onClick={() => setCurrentIndex(i)} title={q.question}
                                            className={"w-6 h-6 rounded-full shrink-0 " + confidenceColor(entry?.confidence) + (i === currentIndex ? " ring-2 ring-white" : "")}/>
                                    )
                                })}
                            </div>
                        }
                        {!currentQuestion ?
                            <div className="text-center py-10">
                                <h2 className="text-3xl tracking-wide mb-3 text-amber-400">Set Complete!</h2>
                                <p className="text-gray-400 mb-6">You've rated every question in this set for this practice type.</p>
                                <div className="flex justify-center gap-3">
                                    <button onClick={() => setCurrentIndex(0)} className="p-2.5 px-6 rounded-full bg-blue-800 hover:bg-blue-900">Review From Start</button>
                                    <Link to="/questions-progress" className="p-2.5 px-6 rounded-full border border-gray-400 hover:bg-gray-800">My Progress</Link>
                                </div>
                            </div>
                            : practiceType === "fill" ?
                            <FillAnswerTest
                                setId={set.id}
                                question={currentQuestion}
                                effectiveAnswer={effectiveAnswer}
                                questionProgress={questionProgress}
                                setQuestionProgress={setQuestionProgress}
                                userInfo={userInfo as User}
                                setUserInfo={setUserInfo}
                                onContinue={handleContinueAfterAnswer}
                                canExit={currentIndex > 0}
                                onExit={() => setWelcomeScreen(true)}
                            />
                            : practiceType === "text" ?
                            <TextAnswerTest
                                setId={set.id}
                                question={currentQuestion}
                                effectiveAnswer={effectiveAnswer}
                                hasCustomAnswer={!!customForCurrent}
                                customAnswers={customAnswers}
                                setCustomAnswers={setCustomAnswers}
                                questionProgress={questionProgress}
                                setQuestionProgress={setQuestionProgress}
                                userInfo={userInfo as User}
                                setUserInfo={setUserInfo}
                                onContinue={handleContinueAfterAnswer}
                                canExit={currentIndex > 0}
                                onExit={() => setWelcomeScreen(true)}
                            />
                            :
                            <MicrophoneAnswerTest
                                setId={set.id}
                                question={currentQuestion}
                                effectiveAnswer={effectiveAnswer}
                                hasCustomAnswer={!!customForCurrent}
                                customAnswers={customAnswers}
                                setCustomAnswers={setCustomAnswers}
                                questionProgress={questionProgress}
                                setQuestionProgress={setQuestionProgress}
                                userInfo={userInfo as User}
                                setUserInfo={setUserInfo}
                                onContinue={handleContinueAfterAnswer}
                                canExit={currentIndex > 0}
                                onExit={() => setWelcomeScreen(true)}
                            />
                        }
                    </>
                }
            </div>

            {practiceTypePopup &&
                <Loading>
                    <div className="bg-gray-900 w-11/12 sm:w-2/3 md:w-1/3 max-w-md p-5 rounded-2xl text-center">
                        <h3 className="text-2xl mb-1">How Do You Want To Practice?</h3>
                        <p className="text-sm text-gray-400">Pick a practice type to begin this set.</p>
                        <div className="flex flex-col gap-3 mt-5">
                            <button onClick={() => handleChoosePracticeType("fill")} className="rounded-full w-full bg-blue-800 hover:bg-blue-900 p-2">Fill In The Blank</button>
                            <button onClick={() => handleChoosePracticeType("text")} className="rounded-full w-full bg-blue-800 hover:bg-blue-900 p-2">Type The Answer</button>
                            <button onClick={() => handleChoosePracticeType("microphone")} className="rounded-full w-full bg-blue-800 hover:bg-blue-900 p-2">Speak The Answer</button>
                        </div>
                    </div>
                </Loading>}

            {settingsPopup &&
                <Loading onClose={() => setSettingsPopup(false)}>
                    <div className="bg-gray-900 w-11/12 sm:w-2/3 md:w-1/3 max-w-md p-5 rounded-2xl text-center relative">
                        <button onClick={() => setSettingsPopup(false)} className="absolute top-3 right-3 text-gray-400 hover:text-white text-xl leading-none">&times;</button>
                        <h3 className="text-2xl mb-1">Settings</h3>
                        <p className="text-sm text-gray-400">Choose how you want to practice.</p>
                        <div className="flex flex-col gap-3 mt-5">
                            {([["fill", "Fill In The Blank"], ["text", "Type The Answer"], ["microphone", "Speak The Answer"]] as [PracticeTypes, string][]).map(([type, label]) => (
                                <button key={type} onClick={() => setPendingPracticeType(type)}
                                    className={"rounded-full w-full p-2 border-2 " + (pendingPracticeType === type ? "bg-blue-800 border-blue-800" : "border-gray-600 hover:bg-gray-800")}>
                                    {label}
                                </button>
                            ))}
                        </div>
                        <button onClick={handleSaveSettings} disabled={pendingPracticeType === practiceType || settingsSaving}
                            className={"rounded-full w-full mt-5 p-2 " + (pendingPracticeType === practiceType || settingsSaving ? "bg-blue-gray-400 cursor-not-allowed" : "bg-blue-800 hover:bg-blue-900")}>
                            {settingsSaving ? <MoonLoader color="white" size={20} className="m-auto"/> : "Save Changes"}
                        </button>
                    </div>
                </Loading>}
        </div>
    )
}
