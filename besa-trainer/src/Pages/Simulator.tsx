import { useSearchParams, useParams, useNavigate, Link } from "react-router-dom";
import { IoMdArrowRoundBack } from "react-icons/io";
import { IoMdSettings } from "react-icons/io";
import { FaBook } from "react-icons/fa";
import { floorNameDecoder, Loading } from "../Components/SectionEditor/Edit";
import { useEffect, useRef, useState } from "react";
import { createPlayer, selectPlaybackRate, selectTime, selectVolume, videoFeatures } from "@videojs/react";
import { Video } from "@videojs/react/video";
import { collection, doc, getDoc, getDocs, limit, query, updateDoc, where } from "firebase/firestore";
import { getDownloadURL, getStorage, ref, uploadBytes } from "firebase/storage";
import { v4 as uuidv4 } from "uuid";
import { db, removeCustomScript } from "../Tools/firestore";
import { getScript } from "../Tools/Fetch";
import { type CosScript, type User, type Floor, type Marker, type Progress, type PracticeTypes, type FloorCode, type Fill, type Script } from "../Tools/types";
import { FaArrowRight, FaPause, FaLock } from "react-icons/fa";
import { FaPlay } from "react-icons/fa";
import { MoonLoader } from "react-spinners";
import ContentLoader from "react-content-loader";
import { AiFillMuted } from "react-icons/ai";
import { HiMiniSpeakerWave } from "react-icons/hi2";
import { formatTime } from "../Components/SectionEditor/VideoEditor";
import { getAuth, onAuthStateChanged } from "firebase/auth";
import { getPrecedingSectionBounds, getSectionBounds, getVtt, isLineInSection, type Line } from "../Tools/ScriptDecoder";
import MicrophoneTest from "../Components/SimulatorTests/MicrophoneTest";
import { FillTest } from "../Components/SimulatorTests/FillTest";
import { TextTest } from "../Components/SimulatorTests/TextTest";
import SimulatorInfo from "../Components/SimulatorTests/SimulatorInfo";
import ScriptViewer, { type ScriptSource } from "../Components/SimulatorTests/ScriptViewer";

const Player = createPlayer({features: videoFeatures})

export const VIDEO_SPEED_OPTIONS = [0.5, 0.75, 1, 1.5, 1.75, 2] as const

//checks whether a section marker actually has a test to complete under the active practice type.
//In "fill" mode, sections without any highlighted question are skipped over so trainees never get stuck.
export function isSectionTestable(
    marker: Marker,
    sections: Marker[],
    practiceType: PracticeTypes,
    fill: Fill | null,
    scriptText: string | null
): boolean {
    if (practiceType === "fill") {
        return (fill?.fillings || []).some(f => f.section.markTime === marker.markTime)
    }
    if (scriptText !== null) {
        const {lower, upper} = getPrecedingSectionBounds(sections, marker)
        const text = getVtt(scriptText).filter(l => isLineInSection(l, lower, upper)).map(l => l.text).join(" ")
        return text.trim().length > 0
    }
    return true
}

//Firestore stores Date fields as Timestamps and hands them back as such when a doc is read - not as
//plain Dates - so anything coming straight off a snapshot needs normalizing before calling .getTime() etc.
export function toDate(value: unknown): Date {
    if (value instanceof Date) {
        return value
    }
    if (value && typeof value === "object" && "toDate" in value && typeof (value as {toDate: unknown}).toDate === "function") {
        return (value as {toDate: () => Date}).toDate()
    }
    return new Date(value as string | number)
}

export default function Simulator() {
    const {tour} = useParams()
    const [searchParams] = useSearchParams()
    const f = searchParams.get("f")
    const [BackWarning, setBackWarning] = useState(false)
    const [Draft, setDraft] = useState<null | Floor>(null)
    const [pauseState, setPauseState] = useState(false)
    const [videoLoaded, setVideoLoaded] = useState(false)
    //video controls
    const playerActions = Player.usePlayer()
    const isPaused = Player.usePlayer((state) => state.paused)
    const playBack = Player.usePlayer(selectTime)

    //for loading
    const [initialLoading, setInitalLoading] = useState(false)
    const [initalCheck, setInitalCheck] = useState(true)

    //personal userInfo
    const [userInfo, setUserInfo] = useState<User | null>(null)
    const [cosScript, setCosScript] = useState<CosScript | null>(null)
    const [defaultScript, setDefaultScript] = useState<string | null>(null)
    const [customScript, setCustomScript] = useState<string | null>(null)
    const [scriptSource, setScriptSource] = useState<ScriptSource>("default")
    const [deletingCustomScript, setDeletingCustomScript] = useState(false)
    const [fill, setFill] = useState<Fill | null>(null)
    const [practiceType, setPracticeType] = useState<PracticeTypes>("fill")
    const [progress, setProgress] = useState<Progress | null>(null)
    const [sectionLocked, setSectionLocked] = useState(false)
    const [currentSection, setCurrentSection] = useState<Marker | null>(null)
    const [needsPracticeTypeChoice, setNeedsPracticeTypeChoice] = useState(false)
    const [practiceTypePopup, setPracticeTypePopup] = useState(false)
    const [settingsPopup, setSettingsPopup] = useState(false)
    const [scriptViewerOpen, setScriptViewerOpen] = useState(false)
    const [pendingPracticeType, setPendingPracticeType] = useState<PracticeTypes>(practiceType)
    const [settingsSaving, setSettingsSaving] = useState(false)

    const hasCustomScript = !!cosScript
    const activeScriptSource: ScriptSource = hasCustomScript ? scriptSource : "default"
    const script = activeScriptSource === "custom" ? (customScript ?? defaultScript) : defaultScript

    //regular (non-BESA) accounts never practice/test - they just watch the tour, so there's no practice
    //type to choose and nothing below the video ever locks.
    const isBesaAccount = userInfo?.accountType === "besa" || userInfo?.accountType === "besaLead"

    //retrieves the floor's default script and any existing custom script for the signed-in user
    useEffect(() => {
        //script fetching needs Draft.defScriptId, so there is nothing to do until the floor doc has loaded
        if (!Draft) {
            setFill(null)
            setDefaultScript(null)
            setCustomScript(null)
            setCosScript(null)
            setScriptSource("default")
            return
        }
        const floor = Draft
        setScriptSource("default")
        setDefaultScript(null)
        setCustomScript(null)
        setCosScript(null)
        //retrieving user information from database
        setInitalLoading(true)
        const auth = getAuth()
        const unsubscribe = onAuthStateChanged(auth, async (user) => {
            try {
                // Always fetch from the floor's default script by default
                try {
                    const scriptDocSnap = await getDoc(doc(db, "training_data", "data_root", "scripts", floor.defScriptId))
                    if (scriptDocSnap.exists()) {
                        const scriptDoc = scriptDocSnap.data() as Script
                        const defText = await getScript(scriptDoc.src)
                        setDefaultScript(defText || "")
                    } else {
                        setDefaultScript("")
                    }
                } catch (e) {
                    console.error("Failed to fetch default script:", e)
                    setDefaultScript("")
                }

                try {
                    const fillSnap = await getDoc(doc(db, "training_data", "data_root", "fills", floor.id))
                    setFill(fillSnap.exists() ? fillSnap.data() as Fill : null)
                } catch {
                    setFill(null)
                }

                if (!user) {
                    return
                }

                const userPath = "training_data/data_root/users/" + user.uid
                const userD = doc(db, userPath)
                const userDoc = await getDoc(userD)

                if (!userDoc.exists()) {
                    return
                }

                const foundUser = userDoc.data() as User
                if (foundUser.progress) {
                    foundUser.progress = foundUser.progress.map(p => ({...p, lastUpdated: toDate(p.lastUpdated)}))
                }
                setUserInfo(foundUser)

                // Setting up Progress Data ----------

                const progress = foundUser.progress?.filter(p => p.floorId == Draft?.id)
                //Will determine which practice type currently going on based on the one that was done last.
                const latestProgress = progress && progress.length > 0
                    ? [...progress].sort((a, b) => b.lastUpdated.getTime() - a.lastUpdated.getTime())[0]
                    : null

                if (latestProgress) {
                    setPracticeType(latestProgress.practiceType)
                    setProgress(latestProgress)
                }

                //no sections have actually been completed yet for this floor, so the user needs to
                //pick which practice type to start with (asked once they hit "Continue")
                setNeedsPracticeTypeChoice(!latestProgress || latestProgress.progress.length === 0)

                // Only load an existing custom script if the user already has one for this floor
                // (never auto-create a custom script on load).
                const existing = foundUser.scriptPaths?.find(s => s.floorCode === floor.floorCode)
                if (existing?.src) {
                    const customText = await getScript(existing.src)
                    setCosScript(existing)
                    setCustomScript(customText || "")
                } else {
                    setCosScript(null)
                    setCustomScript(null)
                }
            } catch (e) {
                console.error(e)
            } finally {
                setInitalLoading(false)
            }
        })
        return () => unsubscribe()
    }, [f, Draft])

    //setting up document
    useEffect(() => {
        if(f) {
            const floorDoc = collection(db, "training_data/floors/" + f)
            getDocs(query(floorDoc, where("current", "==", true), limit(1))).then(data => {
                if (!data.empty) {
                   data.forEach((e) => {
                    setDraft(e.data() as Floor)
                   }) 
                } else {
                    setDraft(null)
                }
            })
        }
    }, [f])


    //moving to a different floor (via the script panel's nav button) needs to land on that floor's
    //welcome screen fresh, not whatever locked/paused state the previous floor was left in.
    useEffect(() => {
        setInitalCheck(true)
        setSectionLocked(false)
        setCurrentSection(null)
        setPauseState(false)
    }, [f])

    //a new video source needs its own loading placeholder shown again, rather than reusing whatever
    //loaded state the previous draft left behind.
    useEffect(() => {
        setVideoLoaded(false)
    }, [Draft?.src])

    //jumps playback to a marker and locks straight into its test - same behavior as clicking a marker
    //dot on the timeline. Used by the script panel's "go to next section" button. If a section has no
    //highlighted question (or isn't testable), it skips locking so the user is never stuck.
    function goToMarker(marker: Marker) {
        playBack?.seek(marker.markTime)
        if (isBesaAccount && Draft && isSectionTestable(marker, Draft.markers, practiceType, fill, script)) {
            playerActions.pause()
            setCurrentSection(marker)
            setSectionLocked(true)
        } else {
            setSectionLocked(false)
        }
    }

    function toTitleCase(str: string): string {
        return str.toLowerCase().split(" ").map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(" ")
    }

    function handleVideoHover() {
        setPauseState(true)
    }

    function handleToggle() {
        if (isPaused) {
            playerActions.play()
        } else {
            playerActions.pause()
        }
    }

    function handleContinue() {
        if (needsPracticeTypeChoice && isBesaAccount) {
            setPracticeTypePopup(true)
        } else {
            setInitalCheck(false)
        }
    }

    async function handleChoosePracticeType(type: PracticeTypes) {
        if (!userInfo || !Draft) {
            return
        }

        //each (floor, practice type) pair keeps its own progress history - reuse it if this type has
        //already been started on this floor, otherwise start fresh at zero.
        const existingEntry = (userInfo.progress || []).find(p => p.floorId === Draft.id && p.practiceType === type)
        const chosenProgress: Progress = existingEntry
            ? {...existingEntry, lastUpdated: new Date()}
            : {floorId: Draft.id, practiceType: type, lastUpdated: new Date(), progress: []}

        const otherProgress = (userInfo.progress || []).filter(p => !(p.floorId === Draft.id && p.practiceType === type))
        const newProgressList = [...otherProgress, chosenProgress]

        setPracticeType(type)
        setProgress(chosenProgress)
        setNeedsPracticeTypeChoice(false)
        setUserInfo({...userInfo, progress: newProgressList})

        const userD = doc(db, "training_data/data_root/users/" + userInfo.uid)
        await updateDoc(userD, {progress: newProgressList})

        setPracticeTypePopup(false)
        setInitalCheck(false)
    }

    function openSettings() {
        setPendingPracticeType(practiceType)
        setSettingsPopup(true)
    }

    async function handleSaveSettings() {
        if (!userInfo || !Draft || pendingPracticeType === practiceType) {
            return
        }

        setSettingsSaving(true)

        //same lookup as handleChoosePracticeType - switching types restores that type's own progress
        //if it exists, or resets to zero if this floor has never been practiced that way before.
        const existingEntry = (userInfo.progress || []).find(p => p.floorId === Draft.id && p.practiceType === pendingPracticeType)
        const switchedProgress: Progress = existingEntry
            ? {...existingEntry, lastUpdated: new Date()}
            : {floorId: Draft.id, practiceType: pendingPracticeType, lastUpdated: new Date(), progress: []}

        const otherProgress = (userInfo.progress || []).filter(p => !(p.floorId === Draft.id && p.practiceType === pendingPracticeType))
        const newProgressList = [...otherProgress, switchedProgress]

        setPracticeType(pendingPracticeType)
        setProgress(switchedProgress)
        setUserInfo({...userInfo, progress: newProgressList})

        const userD = doc(db, "training_data/data_root/users/" + userInfo.uid)
        await updateDoc(userD, {progress: newProgressList})

        setSettingsSaving(false)
        setSettingsPopup(false)
    }

    async function handleSaveCustomScript(newScriptText: string) {
        if (!Draft || !userInfo) {
            return
        }
        const storage = getStorage()
        if (cosScript) {
            const scriptRef = ref(storage, cosScript.path)
            await uploadBytes(scriptRef, new Blob([newScriptText], {type: "text/vtt"}))
            setCustomScript(newScriptText)
            setScriptSource("custom")
            return
        }

        const copyScriptId = uuidv4()
        const scriptPath = "scripts/" + copyScriptId
        const scriptRef = ref(storage, scriptPath)
        const snap = await uploadBytes(scriptRef, new Blob([newScriptText], {type: "text/vtt"}))
        const newCosScript: CosScript = {
            path: scriptPath,
            src: await getDownloadURL(snap.ref),
            floorCode: Draft.floorCode,
            id: copyScriptId,
            isPublic: false,
            scriptDeviationId: Draft.defScriptId
        }
        const newScriptPaths = [
            ...(userInfo.scriptPaths || []).filter(s => s.floorCode !== Draft.floorCode),
            newCosScript
        ]
        await updateDoc(doc(db, "training_data", "data_root", "users", userInfo.uid), {scriptPaths: newScriptPaths})
        setCosScript(newCosScript)
        setUserInfo({...userInfo, scriptPaths: newScriptPaths})
        setCustomScript(newScriptText)
        setScriptSource("custom")
    }

    async function handleDeleteCustomScript() {
        if (!userInfo || !cosScript || deletingCustomScript) {
            return
        }
        setDeletingCustomScript(true)
        try {
            const newScriptPaths = await removeCustomScript(userInfo.uid, userInfo.scriptPaths || [], cosScript)
            setUserInfo({...userInfo, scriptPaths: newScriptPaths})
            setCosScript(null)
            setCustomScript(null)
            setScriptSource("default")
        } catch (e) {
            console.error("Failed to delete custom script:", e)
        } finally {
            setDeletingCustomScript(false)
        }
    }

    return (
        <div className="bg-be-navy-darker w-full min-h-screen text-white font-sans">
            {/* custom header for the simulator */}
              <header className="p-3 px-5 flex flex-wrap justify-between items-center gap-3 border-b-4 border-b-solid border-b-be-orange bg-be-navy text-white">
                <div className="">
                    <h1
                        className="text-2xl sm:text-3xl md:text-4xl font-bold tracking-wider"
                    >{toTitleCase(tour as string)} Tour
                    </h1>
                </div>
                <div className="flex justify-between items-center gap-3 sm:gap-0 w-auto sm:w-1/6">
                    {/* Going to have to change back warning once progress is made, say that it wont save */}
                    <div onClick={() => setBackWarning(true)} className="flex justify-center gap-2 items-center hover:text-be-yellow font-medium p-2 cursor-pointer transition-colors">
                        <IoMdArrowRoundBack/>
                        <span>Back</span>
                    </div>
                    {Draft &&
                        <FaBook onClick={() => setScriptViewerOpen(true)} title="Script Viewer" className="fill-white hover:fill-be-yellow cursor-pointer w-4 h-4 mr-3 transition-colors"/>
                    }
                    {isBesaAccount &&
                        <IoMdSettings onClick={openSettings} className="fill-white hover:fill-be-yellow cursor-pointer w-5 h-5 mr-3 transition-colors"/>
                    }
                </div>
              </header>
              {/* Container for main simulator */}
              <div className="w-11/12 box-border mx-auto my-5 rounded-2xl bg-be-navy shadow-lg overflow-hidden">
                {!(initalCheck || initialLoading) ? 
                    Draft ? 
                    (<><Player.Container className="flex flex-col lg:flex-row justify-center items-center relative w-full">
                        <div className="relative w-full lg:w-4/6">
                            {!videoLoaded &&
                                <div className="absolute top-0 left-0 w-full h-96 rounded-t-2xl lg:rounded-t-none lg:rounded-tl-2xl bg-be-navy-dark z-20 overflow-hidden flex items-center justify-center">
                                    <ContentLoader className="w-full h-full" backgroundColor="#003c6c" foregroundColor="#f29813">
                                        <rect x="0" y="0" className="w-full h-full"/>
                                    </ContentLoader>
                                </div>
                            }
                            <Video src={Draft.src}  className="w-full h-96 object-cover rounded-t-2xl lg:rounded-t-none lg:rounded-tl-2xl z-10"
                            onMouseOver={handleVideoHover} onMouseMove={handleVideoHover} onMouseOut={() => setPauseState(false)}
                            onClick={handleToggle} onLoadedData={() => setVideoLoaded(true)}>
                            </Video>
                            <VideoControls
                                sections={Draft.markers}
                                progress={progress}
                                practiceType={practiceType}
                                fill={fill}
                                scriptText={script}
                                sectionLocked={sectionLocked}
                                currentSection={currentSection}
                                setSectionLocked={setSectionLocked}
                                setCurrentSection={setCurrentSection}
                                isBesaAccount={isBesaAccount}
                            />
                            {pauseState && <div className="transition-all absolute top-0 left-0 rounded-t-2xl lg:rounded-t-none lg:rounded-tl-2xl bg-black/40 w-full h-96 z-30" style={{pointerEvents: "none"}}>
                                {/* This is where the pause button will show when hovered over the video */}
                            </div>}
                        </div>
                        {/* Container for script / other  */}
                        <ScriptHandler
                            vttText={script || ""}
                            sections={Draft.markers}
                            practiceType={practiceType}
                            fill={fill}
                            sectionLocked={sectionLocked}
                            currentSection={currentSection}
                            progress={progress}
                            onGoToMarker={goToMarker}
                            isBesaAccount={isBesaAccount}
                            hasCustomScript={hasCustomScript}
                            scriptSource={activeScriptSource}
                            onScriptSourceChange={setScriptSource}
                            onDeleteCustomScript={handleDeleteCustomScript}
                            deletingCustomScript={deletingCustomScript}
                        />

                    </Player.Container>
                    {/* Below the video */}
                    {isBesaAccount &&
                        <div className="p-5 border-t border-be-navy-dark">
                            <h3 className="text-be-light-gray text-sm font-medium mb-2">Practice type: {practiceType}</h3>
                            {sectionLocked && currentSection &&
                                <SectionTest
                                    floorId={Draft.id}
                                    section={currentSection}
                                    sections={Draft.markers}
                                    scriptText={script || ""}
                                    customBaseScriptText={customScript ?? defaultScript ?? ""}
                                    fill={fill}
                                    cosScript={cosScript}
                                    onScriptUpdated={handleSaveCustomScript}
                                    practiceType={practiceType}
                                    progress={progress}
                                    setProgress={setProgress}
                                    userInfo={userInfo}
                                    setUserInfo={setUserInfo}
                                    setSectionLocked={setSectionLocked}
                                />
                            }
                        </div>
                    }
                    </>) :
                    // placeHolder
                    <p className="p-6 text-be-light-gray">No Video set up yet.</p> : 
                    //Placeholder for when things load up and start running
                    <div className="w-full bg-be-navy-darker p-4">
                        <h2 className="text-be-yellow font-bold text-3xl sm:text-4xl md:text-6xl tracking-wider my-10 px-4">Welcome to {floorNameDecoder(f || " the Simulation")}</h2>
                        <hr className="border-be-orange border-t-2"></hr>
                        {isBesaAccount ? <SimulatorInfo/> : <TourWelcomeInfo/>}
                        <div className="fixed bottom-0 right-0 p-4 flex justify-end items-center gap-4 text-xl sm:text-2xl bg-be-navy border-t-2 border-be-orange w-full z-40">
                            <span className="flex justify-center gap-2 items-center font-medium">{isBesaAccount ? "Continue to Training" : "Continue to Tour"} <FaArrowRight className="text-be-orange"/></span>
                            <button
                            className={"py-2 px-6 rounded-full font-bold inline transition-colors" + (initialLoading ? " bg-be-dark-gray text-white" : " bg-be-orange hover:bg-be-orange-dark text-black")}
                            disabled={initialLoading}
                            onClick={handleContinue}>
                                {initialLoading ? <MoonLoader color="white" size={20}/> : <span>Lets Go!</span>}
                            </button>
                        </div>
                    </div>}
                
              </div>


              {/* Popup for going back if there is progress */}
              {BackWarning && 
                <Loading>
                    <div className="bg-be-navy border-2 border-be-orange w-11/12 sm:w-2/3 md:w-1/4 max-w-sm p-5 rounded-2xl text-center shadow-xl">
                        <h3 className="text-2xl font-bold">
                            Are You Sure You Want to Exit?
                        </h3>
                        <hr className="w-3/4 border-be-light-gray/40 mx-auto my-2"/>
                        <p className="text-sm text-be-light-gray text-center">Exiting right now will not save progress</p>
                        <Link 
                        to={"/"}
                        className="block rounded-full w-3/4 mt-4 bg-red-600 text-white font-bold mx-auto hover:bg-red-700 p-2 transition-colors">Exit</Link>
                        <button onClick={() => setBackWarning(false)}
                        className="rounded-full w-3/4 mt-3 border-solid border-2 border-be-light-gray hover:bg-be-navy-dark font-bold mx-auto p-2 transition-colors">Cancel</button>
                    </div>
                </Loading>}

              {/* Popup for picking a practice type before starting, when none has been done yet on this floor */}
              {practiceTypePopup &&
                <Loading>
                    <div className="bg-be-navy border-2 border-be-orange w-11/12 sm:w-2/3 md:w-1/3 max-w-md p-6 rounded-2xl text-center shadow-xl">
                        <h3 className="text-2xl font-bold mb-1">
                            How Do You Want To Practice?
                        </h3>
                        <p className="text-sm text-be-light-gray">You haven't started this floor yet, pick a practice type to begin.</p>
                        <div className="flex flex-col gap-3 mt-5">
                            <button onClick={() => handleChoosePracticeType("fill")}
                            className="rounded-full w-full bg-be-orange hover:bg-be-orange-dark text-black font-bold p-2.5 transition-colors">Fill In The Blank</button>
                            <button onClick={() => handleChoosePracticeType("text")}
                            className="rounded-full w-full bg-be-orange hover:bg-be-orange-dark text-black font-bold p-2.5 transition-colors">Retype Script</button>
                            <button onClick={() => handleChoosePracticeType("microphone")}
                            className="rounded-full w-full bg-be-orange hover:bg-be-orange-dark text-black font-bold p-2.5 transition-colors">Speak Script</button>
                        </div>
                    </div>
                </Loading>}

              {/* Settings popup, exits via the X or by clicking outside of it */}
              {settingsPopup &&
                <Loading onClose={() => setSettingsPopup(false)}>
                    <div className="bg-be-navy border-2 border-be-orange w-11/12 sm:w-2/3 md:w-1/3 max-w-md p-6 rounded-2xl text-center relative shadow-xl">
                        <button onClick={() => setSettingsPopup(false)}
                        className="absolute top-3 right-3 text-be-light-gray hover:text-white text-xl leading-none">&times;</button>
                        <h3 className="text-2xl font-bold mb-1">Settings</h3>
                        <p className="text-sm text-be-light-gray">Choose how you want to practice.</p>
                        <div className="flex flex-col gap-3 mt-5">
                            {([["fill", "Fill In The Blank"], ["text", "Retype Script"], ["microphone", "Speak Script"]] as [PracticeTypes, string][]).map(([type, label]) => (
                                <button key={type} onClick={() => setPendingPracticeType(type)}
                                className={"rounded-full w-full p-2.5 border-2 font-bold transition-colors " + (pendingPracticeType === type ? "bg-be-orange text-black border-be-orange" : "border-be-light-gray text-white hover:bg-be-navy-dark")}>
                                    {label}
                                </button>
                            ))}
                        </div>
                        <button
                        onClick={handleSaveSettings}
                        disabled={pendingPracticeType === practiceType || settingsSaving}
                        className={"rounded-full w-full mt-5 p-2.5 font-bold transition-colors " + (pendingPracticeType === practiceType || settingsSaving ? "bg-be-dark-gray text-be-light-gray cursor-not-allowed" : "bg-be-orange hover:bg-be-orange-dark text-black")}>
                            {settingsSaving ? <MoonLoader color="white" size={20} className="m-auto"/> : "Save Changes"}
                        </button>
                    </div>
                </Loading>}

              {/* Script Viewer - a plain read-through of the script, exits via the X or by clicking outside of it */}
              {scriptViewerOpen && Draft &&
                <ScriptViewer
                    floor={Draft}
                    defaultScript={defaultScript}
                    customScript={customScript}
                    hasCustomScript={hasCustomScript}
                    scriptSource={activeScriptSource}
                    onScriptSourceChange={setScriptSource}
                    onDeleteCustomScript={handleDeleteCustomScript}
                    deletingCustomScript={deletingCustomScript}
                    onClose={() => setScriptViewerOpen(false)}
                />
              }
        </div>
    )
}


//shown to regular (non-BESA) accounts instead of SimulatorInfo's practice-type breakdown - they're just
//here to watch, not be tested.
function TourWelcomeInfo() {
    return (
        <section className="p-5 pb-24 max-w-3/4 mx-auto text-center px-4">
            <h3 className="text-be-orange font-bold text-3xl tracking-wide my-5">Take A Look Around</h3>
            <p className="p-2 text-be-light-gray leading-relaxed">
                Sit back and watch the tour play through. Use the markers on the timeline below the video to
                jump to any part you're curious about, and open the <FaBook className="inline mb-1 text-be-yellow"/> script
                panel any time if you'd rather read along with what's being said.
            </p>
        </section>
    )
}

//the single source of truth for "how far is this user actually allowed to go": the earliest testable section
//that hasn't been completed yet under the given progress record. Any section without a highlighted question
//(in fill mode) or without script text is automatically skipped over so trainees never get stuck on it.
function getIncompleteBoundary(
    sections: Marker[],
    progress: Progress | null,
    practiceType: PracticeTypes,
    fill: Fill | null,
    scriptText: string | null
): Marker | undefined {
    if (sections.length === 0) {
        return undefined
    }

    const completedTimes = new Set(progress?.progress.map(p => p.sectionTime) ?? [])
    const sortedSections = [...sections].sort((a, b) => a.markTime - b.markTime)
    return sortedSections.find(m =>
        isSectionTestable(m, sections, practiceType, fill, scriptText) && !completedTimes.has(m.markTime)
    )
}

function VideoControls({
    sections,
    progress,
    practiceType,
    fill,
    scriptText,
    sectionLocked,
    currentSection,
    setSectionLocked,
    setCurrentSection,
    isBesaAccount
}: {
    sections: Marker[],
    progress: Progress | null,
    practiceType: PracticeTypes,
    fill: Fill | null,
    scriptText: string | null,
    sectionLocked: boolean,
    currentSection: Marker | null,
    setSectionLocked: (locked: boolean) => void,
    setCurrentSection: (section: Marker | null) => void,
    isBesaAccount: boolean
}) {
    const playerActions = Player.usePlayer()
    const isPaused = Player.usePlayer((state) => state.paused)
    const isMuted = Player.usePlayer((state) => state.muted)
    const isLoading = Player.usePlayer((state) => state.waiting)
    const duration = Player.usePlayer((state) => state.duration) || 1
    const currentTime = Player.usePlayer((state) => state.currentTime) || 0
    const playBack = Player.usePlayer(selectTime)
    const vol = Player.usePlayer(selectVolume)
    const rateControl = Player.usePlayer(selectPlaybackRate)
    const currentRate = rateControl?.playbackRate ?? 1

    const progressPercentage = (currentTime / duration) * 100

    const [sound, setSound] = useState(false)
    const [speedMenuOpen, setSpeedMenuOpen] = useState(false)
    const speedMenuRef = useRef<HTMLDivElement>(null)

    function handleToggle() {
        if (sectionLocked) {
            return
        }
        if (isPaused) {
            playerActions.play()
        } else {
            playerActions.pause()
        }
    }

    //regular accounts have nothing mandatory to complete, so there's no boundary to enforce.
    function getNextMarker(): Marker | undefined {
        return isBesaAccount ? getIncompleteBoundary(sections, progress, practiceType, fill, scriptText) : undefined
    }

    //close the speed settings bar when clicking outside of it
    useEffect(() => {
        if (!speedMenuOpen) return
        function handleClickOutside(e: MouseEvent) {
            if (speedMenuRef.current && !speedMenuRef.current.contains(e.target as Node)) {
                setSpeedMenuOpen(false)
            }
        }
        document.addEventListener("mousedown", handleClickOutside)
        return () => document.removeEventListener("mousedown", handleClickOutside)
    }, [speedMenuOpen])

    //keyboard controls: Space pauses/plays, Left/Right arrow keys skip 5 seconds backward/forward
    useEffect(() => {
        function handleKeyDown(e: KeyboardEvent) {
            const target = e.target as HTMLElement | null
            if (
                target &&
                (target.tagName === "TEXTAREA" ||
                 target.isContentEditable ||
                 (target.tagName === "INPUT" && (target as HTMLInputElement).type !== "range"))
            ) {
                return
            }

            if (e.key === " " || e.code === "Space") {
                if (sectionLocked) {
                    return
                }
                e.preventDefault()
                if (isPaused) {
                    playerActions.play()
                } else {
                    playerActions.pause()
                }
                return
            }

            if (e.key === "ArrowLeft") {
                e.preventDefault()
                const newTime = Math.max(0, currentTime - 5)
                playBack?.seek(newTime)
                if (sectionLocked && currentSection && newTime !== currentSection.markTime) {
                    setSectionLocked(false)
                }
                return
            }

            if (e.key === "ArrowRight") {
                e.preventDefault()
                const desiredTime = Math.min(duration, currentTime + 5)
                const nextMarker = getNextMarker()
                const targetTime = (!nextMarker || nextMarker.markTime >= desiredTime) ? desiredTime : nextMarker.markTime
                playBack?.seek(targetTime)
                if (nextMarker && targetTime >= nextMarker.markTime) {
                    playerActions.pause()
                    setCurrentSection(nextMarker)
                    setSectionLocked(true)
                } else if (sectionLocked && currentSection && targetTime !== currentSection.markTime) {
                    setSectionLocked(false)
                }
            }
        }

        window.addEventListener("keydown", handleKeyDown)
        return () => window.removeEventListener("keydown", handleKeyDown)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentTime, duration, isPaused, sectionLocked, currentSection, progress, practiceType, fill, scriptText, isBesaAccount])

    //clicking a completed marker (to review it) or the next marker (to jump straight into it) locks the
    //player into that section's test. anything further ahead than "next" can't be jumped to. Regular
    //accounts can jump to any marker freely - there's no test to lock into.
    function handleMarkerClick(marker: Marker) {
        if (!isBesaAccount) {
            playBack?.seek(marker.markTime)
            return
        }

        const testable = isSectionTestable(marker, sections, practiceType, fill, scriptText)
        const nextMarker = getNextMarker()

        if (!testable) {
            if (!nextMarker || marker.markTime <= nextMarker.markTime) {
                playBack?.seek(marker.markTime)
                setSectionLocked(false)
            }
            return
        }

        const completed = progress?.progress.some(p => p.sectionTime === marker.markTime) ?? false
        const isNext = nextMarker?.markTime === marker.markTime
        if (!completed && !isNext) {
            return
        }

        playBack?.seek(marker.markTime)
        playerActions.pause()
        setCurrentSection(marker)
        setSectionLocked(true)
    }

    //ensures that will not go past the progress. Regular accounts can scrub anywhere.
    function handleScub( e: React.ChangeEvent<HTMLInputElement>) {
        const newTime = parseFloat(e.target.value)
        const nextMarker = getNextMarker()
        const target = (!nextMarker || nextMarker.markTime >= newTime) ? newTime : nextMarker.markTime
        playBack?.seek(target)

        //dragging away from whatever's currently locked (the mandatory boundary, or a reactivated review)
        //closes the overlay so the user can freely browse - currentSection doesn't track the scrubber on
        //its own, so this has to be handled explicitly rather than left to the currentTime effect.
        if (sectionLocked && currentSection && target !== currentSection.markTime) {
            setSectionLocked(false)
        }
    }

    //ensures video doesnt play beyond nextmarker, but if undefined, then it is okay. Also re-checked whenever
    //progress itself changes (eg. switching practice type mid-session swaps in a different completion history,
    //which can mean the playhead is now sitting past that type's next unanswered marker). Regular accounts
    //never lock at all - they're just watching, not being tested.
    useEffect(() => {
        if (!isBesaAccount) {
            return
        }
        const nextMarker = getNextMarker()
        if (nextMarker && currentTime >= nextMarker.markTime) {
            playBack?.seek(nextMarker.markTime)
            playerActions.pause()
            setSectionLocked(true)
            setCurrentSection(nextMarker)
            return
        }

        //if the currently locked section isn't testable under the current practice type (eg. no highlighted
        //question in fill mode), unlock immediately so playback skips right over it.
        if (currentSection && !isSectionTestable(currentSection, sections, practiceType, fill, scriptText)) {
            setSectionLocked(false)
            return
        }

        //don't auto-unlock a deliberate review of an already-completed section (eg. reactivated via the
        //script panel's goto button) just because it isn't the mandatory next-up boundary - only currentTime
        //drifting below the boundary for some other reason (a manual backward scrub, a stale lock left over
        //from before a practice-type switch, etc) should clear it.
        const isDeliberateReview = !!currentSection && (progress?.progress.some(p => p.sectionTime === currentSection.markTime) ?? false)
        if (!isDeliberateReview) {
            setSectionLocked(false)
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentTime, progress, currentSection, isBesaAccount, practiceType, fill, scriptText])

    return (
        <>
        {sectionLocked &&
            <div className="absolute top-0 left-0 w-full h-96 z-40 rounded-t-2xl lg:rounded-t-none lg:rounded-tl-2xl bg-be-navy-darker/85 flex items-center justify-center">
                <p className="text-xl font-bold tracking-wide text-center px-6 text-white">Please answer this Section Down Below</p>
            </div>
        }
        <div className="absolute bottom-2 left-0 right-0 w-11/12 mx-auto bg-be-navy-darker/80 h-12 z-30 flex items-center justify-between gap-3 box-border px-3 py-2 rounded-full border border-be-light-gray/20">
            <div className="flex items-center justify-center gap-2 shrink-0">
                <div onClick={handleToggle} title="Play / Pause (Space)" className={"hover:text-be-orange bg-be-navy p-2 rounded-full cursor-pointer transition-colors" + (sectionLocked ? " opacity-50 cursor-not-allowed" : "")}>
                    {!isLoading ? isPaused ? <FaPlay/> : <FaPause/> : <MoonLoader color="white" size={18}/>}
                </div>
                <div className="rounded-full p-2 bg-be-navy cursor-pointer flex justify-start items-center 
                    transition-all duration-200 transition-normal" 
                    onMouseOver={() => setSound(true)} onMouseLeave={() => setSound(false)}>
                    <div onClick={() => vol?.toggleMuted()} >
                        {isMuted ? <AiFillMuted className="w-4"/> : <HiMiniSpeakerWave className="w-4"/>}
                    </div>
                    <input type="range"
                        value={vol?.volume}
                        min={0}
                        step={0.1}
                        max={1}
                        className={"transition-all duration-200 transition-normal overflow-x-hidden accent-be-orange " + (sound ? "w-16 sm:w-20 ml-1.5" : "w-0 mr-0")}
                        disabled={isMuted}
                        onChange={({target}) => vol?.setVolume(parseFloat(target.value))}
                        />
                </div>
            </div>
            {/* Progress Bar */}
             <div className="flex-1 mx-2 relative">
                <span className="text-xs font-medium text-white block mb-0.5">{formatTime(currentTime)} / {formatTime(duration)}</span>
                <div className="w-full relative">
                    {/* Markers and points */}
                    <ShowSections sections={sections} progress={progress} nextMarker={getNextMarker()} onMarkerClick={handleMarkerClick} isBesaAccount={isBesaAccount}/>
                    <input
                        className="w-full h-3 bg-be-dark-gray rounded-full appearance-none cursor-pointer accent-be-orange 
                        hover:accent-be-yellow focus:outline-none [&::-webkit-slider-runnable-track]:bg-transparent z-30"
                        step={0.1}
                        min={0}
                        max={duration}
                        value={currentTime}
                        onChange={handleScub}
                        type="range"
                        style={{background: `linear-gradient(to right, #003c6c 0%, #003c6c ${progressPercentage}%, #d0d0ce80 ${progressPercentage}%, #d0d0ce80 100%)`}}
                    />
                </div>
            </div>
            {/* Video Speed Settings Bar */}
            <div className="relative shrink-0" ref={speedMenuRef}>
                <button
                    type="button"
                    onClick={() => setSpeedMenuOpen(open => !open)}
                    title="Playback Speed"
                    className="flex items-center gap-1.5 bg-be-navy hover:bg-be-navy-dark text-white text-xs font-bold px-3 py-1.5 rounded-full border border-be-orange transition-colors"
                >
                    <IoMdSettings className="w-4 h-4 text-be-orange"/>
                    <span>{currentRate}x</span>
                </button>
                {speedMenuOpen && (
                    <div
                        role="menu"
                        aria-label="Playback Speed"
                        className="absolute bottom-full right-0 mb-2 bg-be-navy-darker border-2 border-be-orange rounded-xl p-1.5 shadow-xl flex flex-col gap-1 min-w-[9.5rem] z-50"
                    >
                        <span className="text-[11px] font-bold uppercase tracking-wider text-be-yellow px-2.5 py-1 border-b border-be-navy">
                            Playback Speed
                        </span>
                        {VIDEO_SPEED_OPTIONS.map((rate) => {
                            const isCurrent = Math.abs(currentRate - rate) < 0.01
                            return (
                                <button
                                    key={rate}
                                    type="button"
                                    role="menuitemradio"
                                    aria-checked={isCurrent}
                                    onClick={() => {
                                        rateControl?.setPlaybackRate(rate)
                                        setSpeedMenuOpen(false)
                                    }}
                                    className={"text-left text-xs px-3 py-1.5 rounded-lg font-bold transition-colors " +
                                        (isCurrent ? "bg-be-orange text-black" : "text-white hover:bg-be-navy")}
                                >
                                    {rate}x{isCurrent ? " (current)" : ""}
                                </button>
                            )
                        })}
                    </div>
                )}
            </div>
        </div>
        </>
    )
}

function ShowSections({sections, progress, nextMarker, onMarkerClick, isBesaAccount}: {sections: Marker[], progress: Progress | null, nextMarker: Marker | undefined, onMarkerClick: (m: Marker) => void, isBesaAccount: boolean}) {
    const duration = Player.usePlayer((state) => state.duration) || 1
    const currentTime = Player.usePlayer((state) => state.currentTime) || 0
    const [onMarker, setOnMarker] = useState<Marker | null>(null)

    //regular accounts can jump to any marker - only BESA accounts have a mandatory, in-order progression.
    function isClickable(m: Marker): boolean {
        if (!isBesaAccount) {
            return true
        }
        const completed = progress?.progress.some(p => p.sectionTime === m.markTime) ?? false
        return completed || !nextMarker || m.markTime <= nextMarker.markTime
    }

    //detecting if it is on the marker
    useEffect(() => {
        const markerWidth = duration * 0.03
        setOnMarker(sections.find(mark => Math.abs(mark.markTime - currentTime) < markerWidth) || null)
    }, [currentTime])

    //hard = red, good = yellow, easy = green. no answer yet keeps the default orange.
    function getMarkerColor(m: Marker): string {
        if (onMarker?.markTime == m.markTime) {
            return "bg-white"
        }

        const entry = progress?.progress.find(p => p.sectionTime === m.markTime)
        if (!entry) {
            return "bg-be-orange"
        }

        if (entry.confidence === 0) {
            return "bg-red-600"
        }
        if (entry.confidence === 1) {
            return "bg-be-yellow"
        }
        return "bg-green-600"
    }

    return (
        <div className="w-full h-3 absolute z-40" style={{pointerEvents: "none"}}>
            {sections.map((m) => {
                const percentage = (m.markTime / duration) * 100
                const clickable = isClickable(m)
                return (
                    // Marker
                <div
                    key={m.markTime}
                    onClick={clickable ? () => onMarkerClick(m) : undefined}
                    className=
                    {"w-5 h-5 top-0 bottom-0 absolute transition-all rounded-full group hover:w-5 hover:bg-white " + getMarkerColor(m) + (clickable ? " cursor-pointer" : " cursor-default")}
                    style={{left: percentage + "%", pointerEvents: "all"}}
                    >
                    <div className="absolute bottom-full w-max left-1/2 -translate-x-1/2 mb-2 px-3 py-1 bg-be-navy-darker text-white text-sm font-medium rounded border border-be-orange opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none">
                        {m.markerName}
                    </div>
                </div>)
            })}
        </div>
    )
}

//routes to the right quiz UI for the practice type currently in use, once a section has locked playback.
function SectionTest({floorId, section, sections, scriptText, customBaseScriptText, fill, cosScript, onScriptUpdated, practiceType, progress, setProgress, userInfo, setUserInfo, setSectionLocked}: {
    floorId: string,
    section: Marker,
    sections: Marker[],
    scriptText: string,
    customBaseScriptText: string,
    fill: Fill | null,
    cosScript: CosScript | null,
    onScriptUpdated: (newScriptText: string) => Promise<void> | void,
    practiceType: PracticeTypes,
    progress: Progress | null,
    setProgress: (p: Progress) => void,
    userInfo: User | null,
    setUserInfo: (u: User) => void,
    setSectionLocked: (locked: boolean) => void
}) {
    const playerActions = Player.usePlayer()

    function handleContinue() {
        setSectionLocked(false)
        playerActions.play()
    }

    function handleExit() {
        setSectionLocked(false)
    }

    //reviewing a section that's already been passed by (something later is already completed) shouldn't
    //trap the user into re-grading it - only the actual next-up section forces that.
    const canExit = progress?.progress.some(p => p.sectionTime > section.markTime) ?? false

    if (practiceType === "fill") {
        return (
            <FillTest
                floorId={floorId}
                section={section}
                initialFill={fill}
                progress={progress}
                setProgress={setProgress}
                userInfo={userInfo}
                setUserInfo={setUserInfo}
                onContinue={handleContinue}
                canExit={canExit}
                onExit={handleExit}
            />
        )
    }

    if (practiceType === "text") {
        return (
            <TextTest
                floorId={floorId}
                section={section}
                sections={sections}
                scriptText={scriptText}
                customBaseScriptText={customBaseScriptText}
                cosScript={cosScript}
                onScriptUpdated={onScriptUpdated}
                progress={progress}
                setProgress={setProgress}
                userInfo={userInfo}
                setUserInfo={setUserInfo}
                onContinue={handleContinue}
                canExit={canExit}
                onExit={handleExit}
            />
        )
    }

    return (
        <MicrophoneTest
            floorId={floorId}
            section={section}
            sections={sections}
            scriptText={scriptText}
            customBaseScriptText={customBaseScriptText}
            cosScript={cosScript}
            onScriptUpdated={onScriptUpdated}
            progress={progress}
            setProgress={setProgress}
            userInfo={userInfo}
            setUserInfo={setUserInfo}
            onContinue={handleContinue}
            canExit={canExit}
            onExit={handleExit}
        />
    )
}


//shared by every practice type - records a confidence rating for the section, keyed under whichever
//practiceType is currently active, so switching types keeps separate progress histories.
export async function saveConfidence({confidence, section, floorId, practiceType, progress, setProgress, userInfo, setUserInfo}: {
    confidence: number,
    section: Marker,
    floorId: string,
    practiceType: PracticeTypes,
    progress: Progress | null,
    setProgress: (p: Progress) => void,
    userInfo: User,
    setUserInfo: (u: User) => void
}) {
    const newEntry = {confidence, sectionTime: section.markTime}
    const updatedProgress: Progress = progress
        ? {...progress, lastUpdated: new Date(), progress: [...progress.progress.filter(p => p.sectionTime !== section.markTime), newEntry]}
        : {floorId, practiceType, lastUpdated: new Date(), progress: [newEntry]}

    setProgress(updatedProgress)

    //only replace this floor+practiceType's own entry - other practice types on the same floor keep their history
    const otherProgress = (userInfo.progress || []).filter(p => !(p.floorId === floorId && p.practiceType === practiceType))
    const newProgressList = [...otherProgress, updatedProgress]
    setUserInfo({...userInfo, progress: newProgressList})

    const userD = doc(db, "training_data/data_root/users/" + userInfo.uid)
    await updateDoc(userD, {progress: newProgressList})
}


function ScriptHandler({
    vttText,
    sections,
    practiceType,
    fill,
    sectionLocked,
    currentSection,
    progress,
    onGoToMarker,
    isBesaAccount,
    hasCustomScript,
    scriptSource,
    onScriptSourceChange,
    onDeleteCustomScript,
    deletingCustomScript
}: {
    vttText: string,
    sections: Marker[],
    practiceType: PracticeTypes,
    fill: Fill | null,
    sectionLocked: boolean,
    currentSection: Marker | null,
    progress: Progress | null,
    onGoToMarker: (marker: Marker) => void,
    isBesaAccount: boolean,
    hasCustomScript: boolean,
    scriptSource: ScriptSource,
    onScriptSourceChange: (source: ScriptSource) => void,
    onDeleteCustomScript: () => void,
    deletingCustomScript: boolean
}) {
    const [searchParams, setSearchParams] = useSearchParams()
    const {tour} = useParams()
    const navigate = useNavigate()
    const f = searchParams.get("f")

    const currentTime = Player.usePlayer((state) => state.currentTime) || 0
    const [lines, setLines] = useState<Line[]>([])

    //re-parses whenever the underlying script text changes too (eg. after "Set as Script" in text practice),
    //so the updated wording shows immediately instead of only after a reload.
    useEffect(() => {
        setLines(getVtt(vttText))
    }, [vttText])
    
    const {lower, upper} = getSectionBounds(sections, currentTime)
    const visibleLines = lines.filter(line => isLineInSection(line, lower, upper))

    //the button's target normally tracks wherever playback currently is - the next testable marker chronologically
    //ahead of currentTime, whether that section's already been completed (reviewing) or not (the real next
    //test). Sections without a highlighted question (in fill mode) are skipped over so the user can always
    //advance through the simulator.
    const boundary = isBesaAccount ? getIncompleteBoundary(sections, progress, practiceType, fill, vttText) : undefined
    const rawNext = [...sections]
        .sort((a, b) => a.markTime - b.markTime)
        .find(m => m.markTime > currentTime && (!isBesaAccount || isSectionTestable(m, sections, practiceType, fill, vttText)))
    const nextMarker = boundary && (!rawNext || rawNext.markTime > boundary.markTime) ? boundary : rawNext
    const nextFloorCode = f ? getNextFloorCode(f) : null

    //locked on the mandatory boundary itself, which hasn't been completed - there's nothing left for this
    //button to legitimately do until that test is finished (it's disabled rather than exiting/skipping it).
    //Never applies to regular accounts - nothing they do ever locks.
    const disabled = isBesaAccount && sectionLocked && !!currentSection && !!boundary && currentSection.markTime === boundary.markTime

    function handleNavClick() {
        if (disabled) {
            return
        }
        if (nextMarker) {
            onGoToMarker(nextMarker)
        } else if (nextFloorCode) {
            setSearchParams({f: nextFloorCode})
        } else if (isBesaAccount) {
            navigate(`/progress/${tour}`)
        } else {
            navigate("/")
        }
    }

    const navLabel = disabled
        ? "Finish This Section First"
        : nextMarker
            ? `Go To: ${nextMarker.markerName}`
            : nextFloorCode
                ? `Finish & Continue to ${floorNameDecoder(nextFloorCode)}`
                : isBesaAccount
                    ? "Finish & View My Progress"
                    : "Finish Tour"

    return (
        <div className="w-full lg:w-2/6 h-96 rounded-b-2xl lg:rounded-b-none lg:rounded-tr-2xl p-5 relative flex flex-col bg-be-navy-dark border-t-4 lg:border-t-0 lg:border-l-4 border-be-orange">
            <div className="flex items-center justify-between gap-2 shrink-0 flex-wrap mb-1 z-50">
                <h1 className="tracking-wider text-2xl xl:text-3xl font-bold shrink-0 text-be-yellow">{floorNameDecoder(f || "")}</h1>
                {hasCustomScript && (
                    <div className="flex items-center gap-1.5 ml-auto">
                        <div
                            role="group"
                            aria-label="Script Source Toggle"
                            className="inline-flex items-center bg-be-navy-darker p-1 rounded-full border border-be-orange/60"
                        >
                            <button
                                type="button"
                                onClick={() => onScriptSourceChange("default")}
                                className={"px-2.5 py-1 rounded-full text-[11px] font-bold transition-all " +
                                    (scriptSource === "default"
                                        ? "bg-be-orange text-black shadow"
                                        : "text-be-light-gray hover:text-white")}
                            >
                                Default Script
                            </button>
                            <button
                                type="button"
                                onClick={() => onScriptSourceChange("custom")}
                                className={"px-2.5 py-1 rounded-full text-[11px] font-bold transition-all " +
                                    (scriptSource === "custom"
                                        ? "bg-be-orange text-black shadow"
                                        : "text-be-light-gray hover:text-white")}
                            >
                                Custom Script
                            </button>
                        </div>
                        {scriptSource === "custom" && (
                            <button
                                type="button"
                                onClick={onDeleteCustomScript}
                                disabled={deletingCustomScript}
                                title="Delete custom script"
                                className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-red-600 hover:bg-red-700 text-white transition-colors disabled:opacity-50 shrink-0"
                            >
                                {deletingCustomScript ? "Deleting..." : "Delete"}
                            </button>
                        )}
                    </div>
                )}
            </div>
            <div className="relative flex-1 min-h-0 flex flex-col">
                <div className="overflow-y-scroll flex-1 min-h-0 w-full my-2">
                    {lines ? visibleLines.map((line, i) => {
                        return <ScriptLine currentTime={currentTime} key={i} line={line}/>
                    }) : <div className="h-full animate-pulse bg-be-navy rounded-lg"/>}
                </div>
                {sectionLocked &&
                    <div className="absolute inset-0 rounded-xl bg-be-navy-darker/95 backdrop-blur-sm flex items-center justify-center text-center p-5 z-40">
                        <p className="text-xl font-bold tracking-wide text-white">Answer this section down below to reveal the next part of the script</p>
                    </div>
                }
            </div>
            <button onClick={handleNavClick} disabled={disabled} title={disabled ? "Complete this section's test below before moving on" : undefined}
                className={"shrink-0 w-full mt-2 p-2.5 rounded-full text-sm font-bold tracking-wide transition-colors flex items-center justify-center gap-2 " +
                    (disabled ? "bg-be-dark-gray text-be-light-gray cursor-not-allowed" : "bg-be-orange hover:bg-be-orange-dark text-black")}>
                {disabled && <FaLock className="text-xs"/>}
                {navLabel}
            </button>
        </div>
    )
}

function ScriptLine({line, currentTime, key}: {line: Line, currentTime: number, key: number}) {
    //will be used to scroll into view
    const ref = useRef<HTMLDivElement>(null)
    const [active, setActive] = useState(false)
    const playBack = Player.usePlayer(selectTime)

    //setting active
    useEffect(() => {
        if (currentTime >= line.start && currentTime <= line.end) {
            setActive(true)
        } else {
            setActive(false)
        }
    }, [currentTime])

    useEffect(() => {
        if (active) {
            ref.current?.scrollIntoView({behavior: "smooth"})
        }
    }, [active])

    //once clicked it will come right here.
    function handleClick() {
        playBack?.seek(line.start)
    }

    return (
        <h2 ref={ref} key={key}
        className={"text-xl hover:text-white transition-all px-3 py-3 cursor-pointer " + (active ? "text-be-yellow font-bold" : "text-be-light-gray font-normal")}
        onClick={handleClick}
        >
        {line.text}
        </h2>
    )
}
//the order floors are worked through in - matches the carousel on the Home page. "b" (Slugworks) is the
//last stop; anything else (eg. "e") isn't part of the guided progression.
export const FLOOR_SEQUENCE: FloorCode[] = ["f1", "f2", "f3", "b"]

export function getNextFloorCode(current: string): FloorCode | null {
    const idx = FLOOR_SEQUENCE.indexOf(current as FloorCode)
    if (idx === -1 || idx === FLOOR_SEQUENCE.length - 1) {
        return null
    }
    return FLOOR_SEQUENCE[idx + 1]
}