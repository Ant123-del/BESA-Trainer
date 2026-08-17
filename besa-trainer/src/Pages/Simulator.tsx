import { useSearchParams, useParams, useNavigate, Link } from "react-router-dom";
import { IoMdArrowRoundBack } from "react-icons/io";
import { IoMdSettings } from "react-icons/io";
import { floorNameDecoder, Loading } from "../Components/Edit";
import { useEffect, useRef, useState } from "react";
import { createPlayer, selectTime, selectVolume, videoFeatures } from "@videojs/react";
import { Video } from "@videojs/react/video";
import { collection, doc, getDoc, getDocs, limit, query, updateDoc, where } from "firebase/firestore";
import { db } from "../Tools/firestore";
import { type CosScript, type User, type Floor, type Marker, type Script, type Progress, type PracticeTypes, type FloorCode } from "../Tools/types";
import { FaArrowRight, FaPause, FaLock } from "react-icons/fa";
import { FaPlay } from "react-icons/fa";
import { MoonLoader } from "react-spinners";
import ContentLoader from "react-content-loader";
import { AiFillMuted } from "react-icons/ai";
import { HiMiniSpeakerWave } from "react-icons/hi2";
import { formatTime } from "../Components/VideoEditor";
import { getAuth, onAuthStateChanged } from "firebase/auth";
import { v4 } from "uuid";
import { getDownloadURL, getStorage, ref, uploadBytes } from "firebase/storage";
import { getScript } from "../Tools/Fetch";
import { getSectionBounds, getVtt, isLineInSection, type Line } from "../Tools/ScriptDecoder";
import MicrophoneTest from "../Components/SimulatorTests/MicrophoneTest";
import { FillTest } from "../Components/SimulatorTests/FillTest";
import { TextTest } from "../Components/SimulatorTests/TextTest";
import SimulatorInfo from "../Components/SimulatorInfo";

const Player = createPlayer({features: videoFeatures})

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
    const [script, setScript] = useState<string | null>(null)
    const [practiceType, setPracticeType] = useState<PracticeTypes>("fill")
    const [progress, setProgress] = useState<Progress | null>(null)
    const [sectionLocked, setSectionLocked] = useState(false)
    const [currentSection, setCurrentSection] = useState<Marker | null>(null)
    const [needsPracticeTypeChoice, setNeedsPracticeTypeChoice] = useState(false)
    const [practiceTypePopup, setPracticeTypePopup] = useState(false)
    const [settingsPopup, setSettingsPopup] = useState(false)
    const [pendingPracticeType, setPendingPracticeType] = useState<PracticeTypes>(practiceType)
    const [settingsSaving, setSettingsSaving] = useState(false)

    //retrives user data and tries to implement custom script
    useEffect(() => {
        //script fetching needs Draft.defScriptId, so there is nothing to do until the floor doc has loaded
        if (!Draft) {
            return
        }
        //retrieving user information from database
        setInitalLoading(true)
        const auth = getAuth()
        const unsubscribe = onAuthStateChanged(auth, async (user) => {
            if (!user) {
                setInitalLoading(false)
                return
            }

            //wraps every awaited step below - any of them failing (permission error, network hiccup,
            //missing script, etc.) used to leave initialLoading stuck true forever, which is why the
            //"Lets Go!" button would spin indefinitely. The finally guarantees it always clears.
            try {
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

                //retrieving original script doc ------------
                let scriptDoc = (await getDoc(doc(db, "training_data/data_root/scripts/" + Draft?.defScriptId))).data() as Script

                //Checking if there is an associated cosScript with this draft
                if (scriptDoc && foundUser.scriptPaths) {
                    const path = foundUser.scriptPaths.find(s => {
                        return f == s.floorCode
                    })
                    //if there is a custom script
                    if (path?.src) {
                        console.log("ran")
                        setCosScript(path)
                        setScript(await getScript(path.src) || "")
                    } else if (path) {
                        console.error("Custom script path found with no src, leaving default script in place")
                    } else {
                        console.log("creation")
                        // if no custom script was made, then we will make a new one.
                        const newScriptPaths = [...foundUser.scriptPaths]
                        const copyScriptId = v4()
                        const storage = getStorage()
                        const ScriptPath = "scripts/" + copyScriptId
                        const scriptRef = ref(storage, ScriptPath)

                        //copying original script blob
                        //retriving original scirpt
                        let copy = await getScript(scriptDoc.src) as string

                        setScript(copy)
                        //writing into file
                        const copyBlob = new Blob([copy], {type: "text/vtt"})
                        const snap = await uploadBytes(scriptRef, copyBlob)
                        console.log("copy made")
                        //create firebase file first of the copy.
                        newScriptPaths.push({
                            path: ScriptPath,
                            src: await getDownloadURL(snap.ref),
                            floorCode: Draft?.floorCode,
                            id: copyScriptId,
                            isPublic: false,
                            scriptDeviationId: scriptDoc.id
                        } as CosScript)
                        await updateDoc(userD, {scriptPaths: newScriptPaths})
                    }
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
    //dot on the timeline. Used by the script panel's "go to next section" button.
    function goToMarker(marker: Marker) {
        playBack?.seek(marker.markTime)
        playerActions.pause()
        setCurrentSection(marker)
        setSectionLocked(true)
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
        if (needsPracticeTypeChoice) {
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

    return (
        <div className="bg-gray-900 w-full min-h-screen text-white">
            {/* custom header for the simulator */}
              <header className="p-3 flex justify-between items-center border-b-2 border-b-solid border-b-gray-500">
                <div className="">
                    <h1
                        className="text-4xl tracking-wider"
                    >{toTitleCase(tour as string)} Tour
                    </h1>
                </div>
                <div className="flex justify-between items-center w-1/6">
                    {/* Going to have to change back warning once progress is made, say that it wont save */}
                    <div onClick={() => setBackWarning(true)} className="flex justify-center gap-2 items-center hover:text-gray-400 p-2 cursor-pointer ">
                        <IoMdArrowRoundBack/>
                        <span>Back</span>
                    </div>
                    <IoMdSettings onClick={openSettings} className="fill-white hover:fill-gray-400 cursor-pointer w-5 h-5 mr-3"/>
                </div>
              </header>
              {/* Container for main simulator */}
              <div className="w-11/12 box-border mx-auto my-3 rounded-2xl bg-gray-800">
                {!(initalCheck || initialLoading) ? 
                    Draft ? 
                    (<><Player.Container className="flex justify-center items-center relative w-full">
                        <div className="relative w-4/6">
                            {!videoLoaded &&
                                <div className="absolute top-0 left-0 w-full h-96 rounded-tl-2xl bg-gray-800 z-20 overflow-hidden flex items-center justify-center">
                                    <ContentLoader className="w-full h-full" backgroundColor="#374151" foregroundColor="#F59E0B">
                                        <rect x="0" y="0" className="w-full h-full"/>
                                    </ContentLoader>
                                </div>
                            }
                            <Video src={Draft.src}  className="w-full h-96 object-cover rounded-tl-2xl z-10"
                            onMouseOver={handleVideoHover} onMouseMove={handleVideoHover} onMouseOut={() => setPauseState(false)}
                            onClick={handleToggle} onLoadedData={() => setVideoLoaded(true)}>
                            </Video>
                            <VideoControls sections={Draft.markers} progress={progress} sectionLocked={sectionLocked} currentSection={currentSection} setSectionLocked={setSectionLocked} setCurrentSection={setCurrentSection}/>
                            {pauseState && <div className="transition-all absolute top-0 left-0 rounded-tl-2xl bg-black/40 w-full h-96 z-30" style={{pointerEvents: "none"}}>
                                {/* This is where the pause button will show when hovered over the video */}
                            </div>}
                        </div>
                        {/* Container for script / other  */}
                        <ScriptHandler vttText={script || ""} sections={Draft.markers} sectionLocked={sectionLocked} currentSection={currentSection} progress={progress} onGoToMarker={goToMarker}/>
                        
                    </Player.Container>
                    {/* Below the video */}
                    <div className="p-5">
                        <h3 className="text-gray-500 text-sm mb-2">Practice type: {practiceType}</h3>
                        {sectionLocked && currentSection &&
                            <SectionTest
                                floorId={Draft.id}
                                section={currentSection}
                                sections={Draft.markers}
                                scriptText={script || ""}
                                cosScript={cosScript}
                                onScriptUpdated={setScript}
                                practiceType={practiceType}
                                progress={progress}
                                setProgress={setProgress}
                                userInfo={userInfo}
                                setUserInfo={setUserInfo}
                                setSectionLocked={setSectionLocked}
                            />
                        }
                    </div>
                    </>) :
                    // placeHolder
                    <p>No Video set up yet.</p> : 
                    //Placeholder for when things load up and start running
                    <div className="w-full bg-gray-900">
                        <h2 className="text-light-blue-300 text-6xl tracking-wider my-10">Welcome to {floorNameDecoder(f || " the Simulation")}</h2>
                        <hr></hr>
                        <SimulatorInfo/>
                        <div className="fixed bottom-0 right-0 p-3 flex justify-end items-center gap-3 text-2xl bg-gray-900 w-full">
                            <span className="flex justify-center gap-2 items-center">Continue to Training <FaArrowRight/></span>
                            <button
                            className={"p-2 rounded-full" + (initialLoading ? " bg-blue-gray-400" : " bg-blue-800 hover:bg-blue-900")}
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
                    <div className="bg-gray-900 w-1/4 p-3 rounded-2xl text-center">
                        <h3 className="text-2xl">
                            Are You Sure You Want to Exit?
                        </h3>
                        <hr className="w-3/4 fill-gray-400 mx-auto my-2"/>
                        <p className="text-sm text-gray-400 text-center">Exiting right now will not save progress</p>
                        <Link 
                        to={"/"}
                        className="block rounded-full w-3/4 mt-3 bg-red-500 mx-auto hover:bg-red-400 p-2">Exit</Link>
                        <button onClick={() => setBackWarning(false)}
                        className="rounded-full w-3/4 mt-3 border-solid border-2 border-gray-400 hover:bg-gray-800 mx-auto p-2">Cancel</button>
                    </div>
                </Loading>}

              {/* Popup for picking a practice type before starting, when none has been done yet on this floor */}
              {practiceTypePopup &&
                <Loading>
                    <div className="bg-gray-900 w-1/3 p-5 rounded-2xl text-center">
                        <h3 className="text-2xl mb-1">
                            How Do You Want To Practice?
                        </h3>
                        <p className="text-sm text-gray-400">You haven't started this floor yet, pick a practice type to begin.</p>
                        <div className="flex flex-col gap-3 mt-5">
                            <button onClick={() => handleChoosePracticeType("fill")}
                            className="rounded-full w-full bg-blue-800 hover:bg-blue-900 p-2">Fill In The Blank</button>
                            <button onClick={() => handleChoosePracticeType("text")}
                            className="rounded-full w-full bg-blue-800 hover:bg-blue-900 p-2">Retype Script</button>
                            <button onClick={() => handleChoosePracticeType("microphone")}
                            className="rounded-full w-full bg-blue-800 hover:bg-blue-900 p-2">Speak Script</button>
                        </div>
                    </div>
                </Loading>}

              {/* Settings popup, exits via the X or by clicking outside of it */}
              {settingsPopup &&
                <Loading onClose={() => setSettingsPopup(false)}>
                    <div className="bg-gray-900 w-1/3 p-5 rounded-2xl text-center relative">
                        <button onClick={() => setSettingsPopup(false)}
                        className="absolute top-3 right-3 text-gray-400 hover:text-white text-xl leading-none">&times;</button>
                        <h3 className="text-2xl mb-1">Settings</h3>
                        <p className="text-sm text-gray-400">Choose how you want to practice.</p>
                        <div className="flex flex-col gap-3 mt-5">
                            {([["fill", "Fill In The Blank"], ["text", "Retype Script"], ["microphone", "Speak Script"]] as [PracticeTypes, string][]).map(([type, label]) => (
                                <button key={type} onClick={() => setPendingPracticeType(type)}
                                className={"rounded-full w-full p-2 border-2 " + (pendingPracticeType === type ? "bg-blue-800 border-blue-800" : "border-gray-600 hover:bg-gray-800")}>
                                    {label}
                                </button>
                            ))}
                        </div>
                        <button
                        onClick={handleSaveSettings}
                        disabled={pendingPracticeType === practiceType || settingsSaving}
                        className={"rounded-full w-full mt-5 p-2 " + (pendingPracticeType === practiceType || settingsSaving ? "bg-blue-gray-400 cursor-not-allowed" : "bg-blue-800 hover:bg-blue-900")}>
                            {settingsSaving ? <MoonLoader color="white" size={20} className="m-auto"/> : "Save Changes"}
                        </button>
                    </div>
                </Loading>}
        </div>
    )
}


//the single source of truth for "how far is this user actually allowed to go": the earliest section
//that hasn't been completed yet under the given progress record. Nothing at or beyond this marker can
//be watched, tested, or jumped to (via the scrubber, a marker click, or the script panel's goto button)
//until it's cleared - every one of those controls has to agree on this same boundary, or a bypass opens.
function getIncompleteBoundary(sections: Marker[], progress: Progress | null): Marker | undefined {
    if (sections.length === 0) {
        return undefined
    }

    //exact-match against each marker's own current markTime (same check ShowSections/handleMarkerClick
    const completedTimes = new Set(progress?.progress.map(p => p.sectionTime) ?? [])
    const sortedSections = [...sections].sort((a, b) => a.markTime - b.markTime)
    return sortedSections.find(m => !completedTimes.has(m.markTime))
}

function VideoControls({sections, progress, sectionLocked, currentSection, setSectionLocked, setCurrentSection}:{sections: Marker[], progress: Progress | null, sectionLocked: boolean, currentSection: Marker | null, setSectionLocked: (locked: boolean) => void, setCurrentSection: (section: Marker | null) => void}) {
    const playerActions = Player.usePlayer()
    const isPaused = Player.usePlayer((state) => state.paused)
    const isMuted = Player.usePlayer((state) => state.muted)
    const isLoading = Player.usePlayer((state) => state.waiting)
    const duration = Player.usePlayer((state) => state.duration) || 1
    const currentTime = Player.usePlayer((state) => state.currentTime) || 0
    const playBack = Player.usePlayer(selectTime)
    const vol = Player.usePlayer(selectVolume)

    const progressPercentage = (currentTime / duration) * 100

    const [sound, setSound] = useState(false)

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

    function getNextMarker(): Marker | undefined {
        return getIncompleteBoundary(sections, progress)
    }

    //clicking a completed marker (to review it) or the next marker (to jump straight into it) locks the
    //player into that section's test. anything further ahead than "next" can't be jumped to.
    function handleMarkerClick(marker: Marker) {
        const nextMarker = getNextMarker()
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

    //ensures that will not go past the progress.
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
    //which can mean the playhead is now sitting past that type's next unanswered marker).
    useEffect(() => {
        const nextMarker = getNextMarker()
        if (nextMarker && currentTime >= nextMarker.markTime) {
            playBack?.seek(nextMarker.markTime)
            playerActions.pause()
            setSectionLocked(true)
            setCurrentSection(nextMarker)
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
    }, [currentTime, progress, currentSection])

    return (
        <>
        {sectionLocked &&
            <div className="absolute top-0 left-0 w-full h-96 z-40 rounded-tl-2xl bg-black/60 flex items-center justify-center">
                <p className="text-xl font-semibold tracking-wide text-center px-6">Please answer this Section Down Below</p>
            </div>
        }
        <div className="absolute bottom-0 left-0 right-0 w-11/12 mx-auto bg-black/20 h-10 z-30 flex items-center justify-between gap-3 box-border p-2 rounded-full">
            <div className="flex items-center justify-center gap-3">
                <div onClick={handleToggle} className={"hover:text-gray-400 bg-black/50 p-2 rounded-full" + (sectionLocked ? " opacity-50 cursor-not-allowed" : "")}>
                    {!isLoading ? isPaused ? <FaPlay/> : <FaPause/> : <MoonLoader color="white" size={20}/>}
                </div>
                <div className="rounded-full p-2 bg-black/50 cursor-pointer flex justify-start items-center 
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
                        className={"transition-all duration-200 transition-normal overflow-x-hidden " + (sound ? "w-4/6 ml-1.5" : "w-0 mr-0")}
                        disabled={isMuted}
                        onChange={({target}) => vol?.setVolume(parseFloat(target.value))}
                        />
                </div>
            </div>
            {/* Progress Bar */}
             <div className="w-4/6 mx-auto p-2 relative">
                <span>{formatTime(currentTime)} / {formatTime(duration)}</span>
                <div className="w-full relative">
                    {/* Markers and points */}
                    <ShowSections sections={sections} progress={progress} nextMarker={getNextMarker()} onMarkerClick={handleMarkerClick}/>
                    <input
                        className="w-full h-3 bg-gray-600 rounded-full appearance-none cursor-pointer accent-amber-800 
                        hover:accent-amber-900 focus:outline-none [&::-webkit-slider-runnable-track]:bg-transparent z-30"
                        step={0.1}
                        min={0}
                        max={duration}
                        value={currentTime}
                        onChange={handleScub}
                        type="range"
                        style={{background: `linear-gradient(to right, #000000CC 0%, #000000CC ${progressPercentage}%, #FFFFFF80 ${progressPercentage}%, #FFFFFF80 100%)`}}
                    />
                </div>
            </div>
            <div>

            </div>
        </div>
        </>
    )
}

function ShowSections({sections, progress, nextMarker, onMarkerClick}: {sections: Marker[], progress: Progress | null, nextMarker: Marker | undefined, onMarkerClick: (m: Marker) => void}) {
    const duration = Player.usePlayer((state) => state.duration) || 1
    const currentTime = Player.usePlayer((state) => state.currentTime) || 0
    const [onMarker, setOnMarker] = useState<Marker | null>(null)

    function isClickable(m: Marker): boolean {
        const completed = progress?.progress.some(p => p.sectionTime === m.markTime) ?? false
        return completed || nextMarker?.markTime === m.markTime
    }

    //detecting if it is on the marker
    useEffect(() => {
        const markerWidth = duration * 0.03
        setOnMarker(sections.find(mark => Math.abs(mark.markTime - currentTime) < markerWidth) || null)
    }, [currentTime])

    //hard = red, good = yellow, easy = green. no answer yet keeps the default amber.
    function getMarkerColor(m: Marker): string {
        if (onMarker?.markTime == m.markTime) {
            return "bg-white/70"
        }

        const entry = progress?.progress.find(p => p.sectionTime === m.markTime)
        if (!entry) {
            return "bg-amber-600"
        }

        if (entry.confidence === 0) {
            return "bg-red-600"
        }
        if (entry.confidence === 1) {
            return "bg-yellow-500"
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
                    onClick={clickable ? () => onMarkerClick(m) : undefined}
                    className=
                    {"w-5 h-5 top-0 bottom-0 absolute transition-all rounded-full group hover:w-5 hover:bg-white " + getMarkerColor(m) + (clickable ? " cursor-pointer" : " cursor-default")}
                    style={{left: percentage + "%", pointerEvents: "all"}}
                    >
                    <div className="absolute bottom-full w-max left-1/2 -translate-x-1/2 mb-2 px-3 py-1 bg-black/70 text-white text-sm rounded opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none">
                        {m.markerName}
                    </div>
                </div>)
            })}
        </div>
    )
}

//routes to the right quiz UI for the practice type currently in use, once a section has locked playback.
function SectionTest({floorId, section, sections, scriptText, cosScript, onScriptUpdated, practiceType, progress, setProgress, userInfo, setUserInfo, setSectionLocked}: {
    floorId: string,
    section: Marker,
    sections: Marker[],
    scriptText: string,
    cosScript: CosScript | null,
    onScriptUpdated: (newScriptText: string) => void,
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


function ScriptHandler({vttText, sections, sectionLocked, currentSection, progress, onGoToMarker}: {vttText: string, sections: Marker[], sectionLocked: boolean, currentSection: Marker | null, progress: Progress | null, onGoToMarker: (marker: Marker) => void}) {
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

    //the button's target normally tracks wherever playback currently is - the next marker chronologically
    //ahead of currentTime, whether that section's already been completed (reviewing) or not (the real next
    //test). But it can never point past the mandatory boundary (the earliest not-yet-completed section) -
    //without that cap, a momentary desync between sectionLocked and currentTime (eg. from scrubbing) would
    //let this button jump straight over a required, unfinished section.
    const boundary = getIncompleteBoundary(sections, progress)
    const rawNext = [...sections].sort((a, b) => a.markTime - b.markTime).find(m => m.markTime > currentTime)
    const nextMarker = boundary && (!rawNext || rawNext.markTime > boundary.markTime) ? boundary : rawNext
    const nextFloorCode = f ? getNextFloorCode(f) : null

    //locked on the mandatory boundary itself, which hasn't been completed - there's nothing left for this
    //button to legitimately do until that test is finished (it's disabled rather than exiting/skipping it).
    const disabled = sectionLocked && !!currentSection && !!boundary && currentSection.markTime === boundary.markTime

    function handleNavClick() {
        if (disabled) {
            return
        }
        if (nextMarker) {
            onGoToMarker(nextMarker)
        } else if (nextFloorCode) {
            setSearchParams({f: nextFloorCode})
        } else {
            navigate(`/progress/${tour}`)
        }
    }

    const navLabel = disabled
        ? "Finish This Section First"
        : nextMarker
            ? `Go To: ${nextMarker.markerName}`
            : nextFloorCode
                ? `Finish & Continue to ${floorNameDecoder(nextFloorCode)}`
                : "Finish & View My Progress"

    return (
        <div style={{background: "linear-gradient(180deg, #C65B11 0%, var(--t-orange, #F97316) 50%, #93440D 100%)"}} className="w-2/6 h-96 rounded-tr-2xl p-5 relative flex flex-col">
            <div className="relative flex-1 min-h-0 flex flex-col">
                <h1 className="tracking-wider text-3xl font-bold shrink-0">{floorNameDecoder(f || "")}</h1>
                <div className="overflow-y-scroll flex-1 min-h-0 w-full my-2">
                    {lines ? visibleLines.map((line, i) => {
                        return <ScriptLine currentTime={currentTime} key={i} line={line}/>
                    }) : <div className="h-full animate-pulse bg-gray-500/50 rounded-lg"/>}
                </div>
                {sectionLocked &&
                    <div className="absolute inset-0 rounded-tr-2xl bg-gray-950/95 backdrop-blur-sm flex items-center justify-center text-center p-5 z-40">
                        <p className="text-xl font-semibold tracking-wide">Answer this section down below to reveal the next part of the script</p>
                    </div>
                }
            </div>
            <button onClick={handleNavClick} disabled={disabled} title={disabled ? "Complete this section's test below before moving on" : undefined}
                className={"shrink-0 w-full mt-2 p-2.5 rounded-full text-sm font-semibold tracking-wide transition-colors flex items-center justify-center gap-2 " +
                    (disabled ? "bg-gray-700 text-gray-400 cursor-not-allowed" : "bg-amber-900 hover:bg-amber-950")}>
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
        className={"text-xl hover:text-gray-100/100 transition-all px-3 py-3 cursor-pointer" + (active ? " text-white" : " text-gray-100/50")}
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