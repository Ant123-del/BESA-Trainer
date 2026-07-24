import { useSearchParams, useParams, Link } from "react-router-dom";
import Header from "../Components/Header";
import { IoMdArrowRoundBack } from "react-icons/io";
import { IoMdSettings } from "react-icons/io";
import { floorNameDecoder, Loading } from "../Components/Edit";
import { useEffect, useRef, useState } from "react";
import { createPlayer, selectTime, selectVolume, videoFeatures } from "@videojs/react";
import { Video } from "@videojs/react/video";
import { collection, doc, getDoc, getDocs, limit, query, updateDoc, where } from "firebase/firestore";
import { db } from "../Tools/firestore";
import { type CosScript, type User, type Floor, type Marker, type Script, type Progress, type PracticeTypes, type Fill, type FloorCode } from "../Tools/types";
import { FaArrowRight, FaPause } from "react-icons/fa";
import { FaPlay } from "react-icons/fa";
import { MoonLoader } from "react-spinners";
import { AiFillMuted } from "react-icons/ai";
import { HiMiniSpeakerWave } from "react-icons/hi2";
import { formatTime } from "../Components/VideoEditor";
import { getAuth, onAuthStateChanged } from "firebase/auth";
import { v4 } from "uuid";
import { getDownloadURL, getStorage, ref, uploadBytes } from "firebase/storage";
import { getScript } from "../Tools/Fetch";
import { getVtt, type Line } from "../Tools/ScriptDecoder";
import MicrophoneTest from "../Components/MicrophoneTest";

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
    const [searchParams, setSearchParams] = useSearchParams()
    const f = searchParams.get("f")
    const [BackWarning, setBackWarning] = useState(false)
    const [Draft, setDraft] = useState<null | Floor>(null)
    const [pauseState, setPauseState] = useState(false)
    //video controls
    const playerActions = Player.usePlayer()
    const isPaused = Player.usePlayer((state) => state.paused)
    const isMuted = Player.usePlayer((state) => state.muted)
    const duration = Player.usePlayer((state) => state.duration) || 1
    const currentTime = Player.usePlayer((state) => state.currentTime) || 0
    const playBack = Player.usePlayer(selectTime)
    const vol = Player.usePlayer(selectVolume)

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
                    (<><Player.Container className="flex justify-center items-center relative">
                        <div className="relative w-4/6">
                            <Video src={Draft.src}  className="w-full h-96 object-cover rounded-tl-2xl z-10" 
                            onMouseOver={handleVideoHover} onMouseMove={handleVideoHover} onMouseOut={() => setPauseState(false)}
                            onClick={handleToggle}>
                            </Video>
                            <VideoControls sections={Draft.markers} progress={progress} sectionLocked={sectionLocked} setSectionLocked={setSectionLocked} setCurrentSection={setCurrentSection}/>
                            {pauseState && <div className="transition-all absolute top-0 left-0 rounded-tl-2xl bg-black/40 w-full h-96 z-30" style={{pointerEvents: "none"}}>
                                {/* This is where the pause button will show when hovered over the video */}
                            </div>}
                        </div>
                        {/* Container for script / other  */}
                        <ScriptHandler vttText={script || ""} sections={Draft.markers} sectionLocked={sectionLocked}/>
                        
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
                        <section className="p-5">
                            <h3 className="text-amber-500 text-3xl tracking-wide my-5">Using The Simulation</h3>
                            <p className="p-2 w-3/4">
                                You will be going through a walk through. There are many settings to configure to your liking of studying.
                                The different types of options include
                            </p>
                            <ul className="list-disc mx-10">
                                <li>Fill in the blank</li>
                                <li>Retype script</li>
                                <li>Speak script</li>
                            </ul>
                            <h3 className="text-amber-500 text-3xl tracking-wide my-5">Mindset When Touring</h3>
                            <p className="p-2">
                                You can think of a tour as a proper one-sided conversation, where you will do most of the talking :).
                                Within conversations, you want to actively engage with three things: active listening, respect, and empathy.  
                                <b> Active Listning/engaging</b> is mentioned even though you will do most of the talking because it is important to
                                remember that you are there to serve them. To understand their needs and questions. So when talking keep in mind
                                are you talking to get a response, or are you talking to help them understand the school.
                            </p>
                        </section>
                        <div className="fixed bottom-0 right-0 p-3 flex justify-end items-center gap-3 text-2xl">
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


function VideoControls({sections, progress, sectionLocked, setSectionLocked, setCurrentSection}:{sections: Marker[], progress: Progress | null, sectionLocked: boolean, setSectionLocked: (locked: boolean) => void, setCurrentSection: (section: Marker | null) => void}) {
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

    function getLastProgress() {
        if (progress) {
            return [...progress.progress].sort((a, b) => b.sectionTime - a.sectionTime)[0]
        } 
        return undefined
    }

    function getNextMarker(): Marker | undefined {
        if (sections.length === 0) {
            return undefined
        }

        const sortedSections = [...sections].sort((a, b) => a.markTime - b.markTime)
        const lastProgress = getLastProgress()

        //no progress made yet, so the next marker is the very first one
        if (!lastProgress) {
            return sortedSections[0]
        }

        const nextMarker = sortedSections.find(m => m.markTime > lastProgress.sectionTime)

        //already on the last marker, so return the one associated with the last progress
        if (!nextMarker) {
            return undefined
        }

        return nextMarker
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
        if (!nextMarker || nextMarker.markTime >= newTime) {
            playBack?.seek(newTime)
        } else {
            playBack?.seek(nextMarker.markTime)
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
        } else {
            setSectionLocked(false)
        }
    }, [currentTime, progress])

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

//normalized equality just to give a rough auto-check hint - the actual grading is the user's own Hard/Good/Easy call.
function isCloseMatch(userAnswer: string, correct: string): boolean {
    const normalize = (s: string) => s.trim().toLowerCase().replace(/[^\w\s]/g, "")
    return userAnswer.trim().length > 0 && normalize(userAnswer) === normalize(correct)
}

//marks the part of the full sentence that was blanked out, by diffing it against the blanked version.
function renderCorrectAnswer(filling: {vttSectionSentenceBlank: string, vttSectionSentenceFilled: string}) {
    const filled = filling.vttSectionSentenceFilled
    const blank = filling.vttSectionSentenceBlank

    let prefixLen = 0
    while (prefixLen < blank.length && prefixLen < filled.length && blank[prefixLen] === filled[prefixLen]) {
        prefixLen++
    }

    let suffixLen = 0
    const blankRest = blank.length - prefixLen
    const filledRest = filled.length - prefixLen
    while (
        suffixLen < Math.min(blankRest, filledRest) &&
        blank[blank.length - 1 - suffixLen] === filled[filled.length - 1 - suffixLen]
    ) {
        suffixLen++
    }

    const highlightStart = prefixLen
    const highlightEnd = filled.length - suffixLen

    if (highlightStart >= highlightEnd) {
        return filled
    }

    return (
        <>
            {filled.slice(0, highlightStart)}
            <mark className="bg-amber-400/70 text-black rounded px-0.5">{filled.slice(highlightStart, highlightEnd)}</mark>
            {filled.slice(highlightEnd)}
        </>
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

//shared grading footer - reused by every practice type once an answer has been submitted.
function GradingControls({onTryAgain, onConfidence, canExit, onExit}: {
    onTryAgain: () => void,
    onConfidence: (confidence: number) => void,
    canExit: boolean,
    onExit: () => void
}) {
    return (
        <div>
            <p className="text-gray-500 text-center">How did you feel about answering these questions? Choose one to move on!</p>
            <div className="flex justify-center gap-3 mt-4 w-full">
                <button onClick={() => onConfidence(0)} className="p-2 px-6 w-3/12 rounded-full bg-red-700 hover:bg-red-800">Hard</button>
                <button onClick={() => onConfidence(1)} className="p-2 px-6 w-3/12 rounded-full bg-yellow-600 hover:bg-yellow-700">Good</button>
                <button onClick={() => onConfidence(2)} className="p-2 px-6 w-3/12 rounded-full bg-green-700 hover:bg-green-800">Easy</button>
            </div>
            <div className="flex justify-center mt-3">
                <button onClick={onTryAgain} className="p-2 px-6 rounded-full border border-gray-400 hover:bg-gray-800">Try Again</button>
            </div>
            {canExit &&
                <div className="flex justify-center mt-3">
                    <button onClick={onExit} className="p-2 px-6 rounded-full border border-gray-400 hover:bg-gray-800">Exit</button>
                </div>
            }
        </div>
    )
}

function FillTest({floorId, section, progress, setProgress, userInfo, setUserInfo, onContinue, canExit, onExit}: {
    floorId: string,
    section: Marker,
    progress: Progress | null,
    setProgress: (p: Progress) => void,
    userInfo: User | null,
    setUserInfo: (u: User) => void,
    onContinue: () => void,
    canExit: boolean,
    onExit: () => void
}) {
    const [fill, setFill] = useState<Fill | null>(null)
    const [loading, setLoading] = useState(true)
    const [answers, setAnswers] = useState<string[]>([])
    const [skipped, setSkipped] = useState<boolean[]>([])
    const [submitted, setSubmitted] = useState(false)

    useEffect(() => {
        setLoading(true)
        const fillRef = doc(db, "training_data", "data_root", "fills", floorId)
        getDoc(fillRef).then((data) => {
            setFill(data.exists() ? data.data() as Fill : null)
            setLoading(false)
        })
    }, [floorId])

    const sectionFillings = (fill?.fillings || []).filter(f => f.section.markTime === section.markTime)

    //fresh form whenever a new section comes up (or the fills finish loading)
    useEffect(() => {
        setAnswers(sectionFillings.map(() => ""))
        setSkipped(sectionFillings.map(() => false))
        setSubmitted(false)
    }, [section.markTime, fill])

    function handleAnswerChange(i: number, value: string) {
        setAnswers(prev => prev.map((a, idx) => idx === i ? value : a))
    }

    function handleSkipToggle(i: number) {
        setSkipped(prev => prev.map((s, idx) => idx === i ? !s : s))
        setAnswers(prev => prev.map((a, idx) => idx === i ? "" : a))
    }

    function handleTryAgain() {
        setAnswers(sectionFillings.map(() => ""))
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

    if (loading) {
        return <div className="p-5 bg-gray-900 rounded-2xl text-center text-gray-400 animate-pulse">Loading section...</div>
    }

    if (sectionFillings.length === 0) {
        return (
            <div className="p-5 bg-gray-900 rounded-2xl text-center">
                <p className="text-gray-400 mb-3">No fills for this section.</p>
                <button onClick={onContinue} className="p-2 px-6 rounded-full bg-blue-800 hover:bg-blue-900">Continue</button>
            </div>
        )
    }

    return (
        <div className="p-5 bg-gray-900 rounded-2xl">
            <h3 className="text-xl mb-3 text-center">Fill In The Blank</h3>
            {!submitted ?
                <div className="flex flex-col gap-3">
                    {sectionFillings.map((f, i) => (
                        <div key={i} className="flex flex-col gap-1">
                            <label className="text-sm text-gray-400">{f.vttSectionSentenceBlank}</label>
                            <div className="flex gap-2">
                                <input
                                    className={"w-full p-2 rounded-lg " + (skipped[i] ? "bg-gray-800 text-gray-500 cursor-not-allowed" : "bg-gray-700 text-white")}
                                    value={answers[i] || ""}
                                    disabled={skipped[i]}
                                    onChange={(e) => handleAnswerChange(i, e.target.value)}
                                    placeholder="Type your answer..."
                                />
                                <button type="button" onClick={() => handleSkipToggle(i)}
                                    className={"px-3 rounded-lg text-sm shrink-0 " + (skipped[i] ? "bg-amber-700 hover:bg-amber-800" : "bg-gray-700 hover:bg-gray-600")}>
                                    {skipped[i] ? "Skipped" : "Skip"}
                                </button>
                            </div>
                        </div>
                    ))}
                    <button onClick={() => setSubmitted(true)} className="p-2 rounded-full bg-blue-800 hover:bg-blue-900 mt-2">Submit</button>
                    {canExit &&
                        <button onClick={onExit} className="p-2 rounded-full border border-gray-400 hover:bg-gray-800">Exit</button>
                    }
                </div>
                :
                <div>
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <h4 className="text-sm text-gray-400 mb-2 text-center">Your Answer</h4>
                            {sectionFillings.map((f, i) => (
                                <p key={i} className={"p-2 rounded-lg mb-2 " + (skipped[i] ? "bg-gray-800" : isCloseMatch(answers[i] || "", f.vttSectionSentenceFilled) ? "bg-green-900/60" : "bg-red-900/60")}>
                                    {skipped[i]
                                        ? <span className="text-gray-500 italic">Skipped</span>
                                        : answers[i] || <span className="text-gray-500 italic">No answer</span>}
                                </p>
                            ))}
                        </div>
                        <div>
                            <h4 className="text-sm text-gray-400 mb-2 text-center">Correct Answer</h4>
                            {sectionFillings.map((f, i) => (
                                <p key={i} className="p-2 rounded-lg mb-2 bg-gray-700">{renderCorrectAnswer(f)}</p>
                            ))}
                        </div>
                    </div>
                    <GradingControls onTryAgain={handleTryAgain} onConfidence={handleConfidence} canExit={canExit} onExit={onExit}/>
                </div>
            }
        </div>
    )
}

function TextTest({floorId, section, sections, scriptText, cosScript, onScriptUpdated, progress, setProgress, userInfo, setUserInfo, onContinue, canExit, onExit}: {
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
                <div className="flex flex-col gap-3">
                    <h3 className="text-xl mb-1 text-center">Retype The Script</h3>
                    <textarea
                        className="w-full h-48 p-3 rounded-lg bg-gray-700 text-white resize-none"
                        value={answer}
                        onChange={(e) => setAnswer(e.target.value)}
                        placeholder="Type out this section of the tour script from memory. Don't worry about matching it word-for-word - just get the key points down, then hit Submit to see how close you were."
                    />
                    <div className="flex justify-center gap-3">
                        <button onClick={() => setSubmitted(true)} className="p-2 rounded-full bg-blue-800 hover:bg-blue-900">Submit</button>
                        {canExit &&
                            <button onClick={onExit} className="p-2 rounded-full border border-gray-400 hover:bg-gray-800">Exit</button>
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

//shared results view once an answer (typed or transcribed) has been submitted - the score, the
//side-by-side comparison, "Set as Script", and the grading footer. Used by both Text and Microphone practice.
export function AnswerReview({answer, correctText, section, sections, scriptText, cosScript, onScriptUpdated, onTryAgain, onConfidence, canExit, onExit}: {
    answer: string,
    correctText: string,
    section: Marker,
    sections: Marker[],
    scriptText: string,
    cosScript: CosScript | null,
    onScriptUpdated: (newScriptText: string) => void,
    onTryAgain: () => void,
    onConfidence: (confidence: number) => void,
    canExit: boolean,
    onExit: () => void
}) {
    const [settingScript, setSettingScript] = useState(false)
    const [scriptSet, setScriptSet] = useState(false)

    const score = computeMatchScore(answer, correctText)

    async function handleSetAsScript() {
        if (!cosScript) {
            return
        }

        setSettingScript(true)
        try {
            const newScriptText = buildUpdatedScript(scriptText, sections, section, answer)
            const storage = getStorage()
            const scriptRef = ref(storage, cosScript.path)
            const blob = new Blob([newScriptText], {type: "text/vtt"})
            await uploadBytes(scriptRef, blob)
            onScriptUpdated(newScriptText)
            setScriptSet(true)
        } catch (e) {
            console.error(e)
        } finally {
            setSettingScript(false)
        }
    }

    function handleTryAgain() {
        setScriptSet(false)
        onTryAgain()
    }

    return (
        <div>
            <div className="flex justify-between items-start mb-3 gap-3">
                <div className="relative group inline-block">
                    <button onClick={handleSetAsScript} disabled={settingScript || scriptSet}
                        className={"text-sm px-3 py-1.5 rounded-full border shrink-0 " + (scriptSet ? "border-green-600 text-green-500 cursor-default" : "border-amber-500 text-amber-400 hover:bg-amber-500/10")}>
                        {scriptSet ? "Script Updated" : "Set as Script"}
                    </button>
                    <div className="absolute left-0 top-full mt-2 w-72 p-3 rounded-lg bg-black text-xs text-gray-200 opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none z-50">
                        Replaces this section of the tour script with what you just said/typed, so it's what shows for next time.
                        <span className="block mt-1 text-amber-400 font-semibold">Warning: this action cannot be undone.</span>
                        To go back to the default script, that has to be done from Settings.
                    </div>
                </div>
                <div className="text-right shrink-0">
                    <span className="text-2xl font-bold">{score}%</span>
                    <span className="block text-xs text-gray-400">Match Score</span>
                </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
                <div>
                    <h4 className="text-sm text-gray-400 mb-2 text-center">Your Answer</h4>
                    <p className="p-2 rounded-lg bg-gray-700 whitespace-pre-wrap">{answer || <span className="text-gray-500 italic">No answer</span>}</p>
                </div>
                <div>
                    <h4 className="text-sm text-gray-400 mb-2 text-center">Script</h4>
                    <p className="p-2 rounded-lg bg-gray-700 whitespace-pre-wrap">{correctText}</p>
                </div>
            </div>
            <GradingControls onTryAgain={handleTryAgain} onConfidence={onConfidence} canExit={canExit} onExit={onExit}/>
            {settingScript && <Loading text="Updating script..."/>}
        </div>
    )
}

//finds the [lower, upper) marker times that bound the section currentTime is currently in.
//no markers at all, or no marker left after currentTime, results in an open (-Infinity/Infinity) bound.
function getSectionBounds(sections: Marker[], currentTime: number): {lower: number, upper: number} {
    if (sections.length === 0) {
        return {lower: -Infinity, upper: Infinity}
    }

    const sortedSections = [...sections].sort((a, b) => a.markTime - b.markTime)
    const passedSections = sortedSections.filter(m => m.markTime <= currentTime)
    const nextSection = sortedSections.find(m => m.markTime > currentTime)

    return {
        lower: passedSections.length > 0 ? passedSections[passedSections.length - 1].markTime : -Infinity,
        upper: nextSection ? nextSection.markTime : Infinity
    }
}

//a marker's quiz covers what was just watched to reach it - from the previous marker (or the very start
//of the video, if there isn't one) up to this marker - not the section coming up next.
export function getPrecedingSectionBounds(sections: Marker[], section: Marker): {lower: number, upper: number} {
    const sortedSections = [...sections].sort((a, b) => a.markTime - b.markTime)
    const idx = sortedSections.findIndex(m => m.markTime === section.markTime)
    const previous = idx > 0 ? sortedSections[idx - 1] : undefined

    return {
        lower: previous ? previous.markTime : -Infinity,
        upper: section.markTime
    }
}

//since sentence timing doesn't line up with section markers, a sentence that straddles the
//boundary is assigned to whichever section holds the majority of its duration.
export function isLineInSection(line: Line, lower: number, upper: number): boolean {
    const overlap = Math.min(line.end, upper) - Math.max(line.start, lower)
    if (overlap <= 0) {
        return false
    }

    const lineDuration = line.end - line.start
    return lineDuration <= 0 || overlap >= lineDuration / 2
}

//pads a VTT cue timestamp component - eg pad(4) -> "04", pad(4, 3) -> "004"
function pad(n: number, len = 2): string {
    return Math.max(0, Math.floor(n)).toString().padStart(len, "0")
}

function formatVttTime(totalSeconds: number): string {
    const hours = Math.floor(totalSeconds / 3600)
    const minutes = Math.floor((totalSeconds % 3600) / 60)
    const seconds = Math.floor(totalSeconds % 60)
    const millis = Math.round((totalSeconds - Math.floor(totalSeconds)) * 1000)
    return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}.${pad(millis, 3)}`
}

function linesToVtt(lines: Line[]): string {
    const sorted = [...lines].sort((a, b) => a.start - b.start)
    return "WEBVTT\n\n" + sorted.map(l => `${formatVttTime(l.start)} --> ${formatVttTime(l.end)}\n${l.text}\n`).join("\n")
}

//collapses every cue within the given section into a single new cue holding the retyped text, spanning
//from the earliest cue's start to the latest cue's end, and leaves every other section's cues untouched.
function buildUpdatedScript(fullVttText: string, sections: Marker[], section: Marker, newSectionText: string): string {
    const lines = getVtt(fullVttText)
    const {lower, upper} = getPrecedingSectionBounds(sections, section)
    const sectionLines = lines.filter(l => isLineInSection(l, lower, upper))
    const outsideLines = lines.filter(l => !isLineInSection(l, lower, upper))

    if (sectionLines.length === 0) {
        return fullVttText
    }

    const mergedLine: Line = {
        start: Math.min(...sectionLines.map(l => l.start)),
        end: Math.max(...sectionLines.map(l => l.end)),
        text: newSectionText.trim()
    }

    return linesToVtt([...outsideLines, mergedLine])
}

function normalizeWords(text: string): string[] {
    return text.toLowerCase().replace(/[^\w\s]/g, "").split(/\s+/).filter(Boolean)
}

//longest-common-subsequence of words against the script text, as a percentage of the script's word count -
//out-of-order or missing words are penalized, but the exact phrasing/punctuation doesn't need to match.
function computeMatchScore(userAnswer: string, correct: string): number {
    const correctWords = normalizeWords(correct)
    const userWords = normalizeWords(userAnswer)

    if (correctWords.length === 0) {
        return 100
    }

    const dp: number[][] = Array.from({length: userWords.length + 1}, () => new Array(correctWords.length + 1).fill(0))
    for (let i = 1; i <= userWords.length; i++) {
        for (let j = 1; j <= correctWords.length; j++) {
            dp[i][j] = userWords[i - 1] === correctWords[j - 1]
                ? dp[i - 1][j - 1] + 1
                : Math.max(dp[i - 1][j], dp[i][j - 1])
        }
    }

    return Math.round((dp[userWords.length][correctWords.length] / correctWords.length) * 100)
}

function ScriptHandler({vttText, sections, sectionLocked}: {vttText: string, sections: Marker[], sectionLocked: boolean}) {
    const [searchParams, setSearchpParams] = useSearchParams()
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

    return (
        <div style={{background: "linear-gradient(180deg, #C65B11 0%, var(--t-orange, #F97316) 50%, #93440D 100%)"}} className="w-2/6 h-96 rounded-tr-2xl p-5 relative">
            <h1 className="tracking-wider text-3xl font-bold">{floorNameDecoder(f || "")}</h1>
            <div className="overflow-y-scroll h-64 w-full">
                {lines ? visibleLines.map((line, i) => {
                    return <ScriptLine currentTime={currentTime} key={i} line={line}/>
                }) : <div className="h-64 animate-pulse bg-gray-500/50 rounded-lg"/>}
            </div>
            {sectionLocked &&
                <div className="absolute inset-0 rounded-tr-2xl bg-gray-950/95 backdrop-blur-sm flex items-center justify-center text-center p-5 z-40">
                    <p className="text-xl font-semibold tracking-wide">Answer this section down below to reveal the next part of the script</p>
                </div>
            }
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
export const FLOOR_SEQUENCE: FloorCode[] = ["f1", "f2", "f3", "b"]