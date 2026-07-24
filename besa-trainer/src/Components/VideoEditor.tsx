import { type Marker, type Floor } from "../Tools/types";
import { createPlayer, CaptionsButton, selectTime, selectVolume, usePlayer } from "@videojs/react"
import { videoFeatures, Video } from "@videojs/react/video";
import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import ContentLoader from "react-content-loader";
import { FaPlay } from "react-icons/fa";
import { FaPause } from "react-icons/fa";
import { AiFillMuted } from "react-icons/ai";
import { HiMiniSpeakerWave } from "react-icons/hi2";
import { FaPlus } from "react-icons/fa";
import { FaDeleteLeft } from "react-icons/fa6";
import { doc, getDoc, updateDoc } from "firebase/firestore";
import { db } from "../Tools/firestore";
import { reconcileProgress } from "../Tools/Fetch";
import { useSearchParams } from "react-router-dom";
import { FaTrash } from "react-icons/fa";

const Player = createPlayer({features: videoFeatures})




export default function VideoEditor({floor, setFloor} : {floor: Floor, setFloor: Dispatch<SetStateAction<Floor | null>>}) {
    const [loaded, setLoaded] = useState(false)
    const [markers, setMarkers] = useState<Marker[]>([])

    return (
        <div className="w-full mx-auto mt-5 relative">
            <Player.Provider>
                <Player.Container>
                    { !loaded && <ContentLoader className="w-full rounded-2xl absolute top-0 left-0 box-border" backgroundColor="#F59E0B"><rect x="0" y="0" className="w-full h-36" height="200"/></ContentLoader>}
                    <Video src={floor.src} autoPlay muted className="rounded-2xl block mx-auto w-full h-96 object-cover" onLoadedData={() => setLoaded(true)}>

                    </Video>
                    <h2 className="tracking-wide text-center text-xl mt-5">Placing Markers For Sections</h2>
                    <CustomControls floor={floor} setFloor={setFloor} />
                </Player.Container>
            </Player.Provider>
        </div>
    )
}

function CustomControls({floor, setFloor}: {floor: Floor, setFloor: Dispatch<SetStateAction<Floor | null>>}) {
    const isPaused = Player.usePlayer((state) => state.paused)
    const isMuted = Player.usePlayer((state) => state.muted)
    const duration = Player.usePlayer((state) => state.duration) || 1;
    const currentTime = Player.usePlayer((state) => state.currentTime) || 0;
    const playBack = Player.usePlayer(selectTime)
    const vol = Player.usePlayer(selectVolume)

    const [searchParam, setSearchParam] = useSearchParams()
    const f = searchParam.get("f")

    const [sound, setSound] = useState(false)
    const [onMarker, setOnMarker] = useState<null | Marker>(null)
    const [nameSection, setNameSection] = useState(f + "-" + (floor.markers.length + 1))
    
    // useEffect(() => {
    //     setMuted(isMuted)
    // }, [isMuted])

    const playerActions = Player.usePlayer();

    useEffect(() => {
        const markerWidth = duration * 0.03
        setOnMarker(floor.markers.find(mark => Math.abs(mark.markTime - currentTime) < markerWidth) || null)
    }, [currentTime])

    function togglePlay() {
        if (isPaused) {
            playerActions.play();
        } else {
            playerActions.pause();
        }
    }

    function handleScub( e: React.ChangeEvent<HTMLInputElement>) {
        const newTime = parseFloat(e.target.value)
        playBack?.seek(newTime)
    }

    async function handleAddMarker() {

        const floorRef = doc(db, "training_data", "floors", floor.floorCode, floor.id)
        const newMarker: Marker = {markerName: nameSection, markTime: currentTime}
        const updatedMarkers = [...floor.markers, newMarker]
        await updateDoc(floorRef, {markers: updatedMarkers})
        let newName = ""
        setFloor(prev => {
            let floorCopy = {...prev} as Floor
            if (floorCopy.markers) {
                floorCopy.markers = updatedMarkers
            } else {
                floorCopy.markers = [newMarker]
            }
            newName = f + "-" + (floorCopy.markers.length + 1)
            return floorCopy
        })
        setNameSection(newName)
        //adding a marker doesn't invalidate any existing sectionTimes, but every account's progress for
        //this floor still needs to line up with the current marker set - see reconcileProgress.
        reconcileProgress(floor.id, updatedMarkers.map(m => m.markTime))
    }

    async function handleDeleteMarker() {
        const floorRef = doc(db, "training_data", "floors", floor.floorCode, floor.id)
        if (onMarker && floor.markers) {
            const markerUpdated = floor.markers.filter(doc => doc.markerName != onMarker.markerName)
            await updateDoc(floorRef, {markers: markerUpdated})
            let newName = ""
            setFloor(prev => {
                let floorCopy = {...prev} as Floor
                floorCopy.markers = markerUpdated
                newName = f + "-" + (Math.max(floorCopy.markers.length + 1, 1))
                return floorCopy
            })
            setNameSection(newName)
            //this marker no longer exists, so any account's progress entry pointing at its old sectionTime
            //is now stale and would otherwise make that section look already-completed when it isn't.
            reconcileProgress(floor.id, markerUpdated.map(m => m.markTime))
        }
    }

    const progressPercentage = (currentTime / duration) * 100

    function generateMarkerGradient(markers: Marker[], duration: number): string[] {
        const thickness = 1
        const markerColor = "#F59E0B"
        const transparent = "#ffffff00"

        // Convert markers to pure percentages and sort them numerically
        const positions = markers
            .map(m => (m.markTime / duration) * 100)
            .sort((a, b) => a - b)

        // Start with your base transparent background
        const gradientStops: string[] = [`${transparent} 0%`]

        positions.forEach(pos => {
            // Create a hard stop by matching the transparent background right up to the marker start
            gradientStops.push(`${transparent} ${pos}%`);
            
            // Draw the marker
            gradientStops.push(`${markerColor} ${pos}%`);
            gradientStops.push(`${markerColor} ${pos + thickness}%`);
            
            // Create a hard stop back to transparent
            gradientStops.push(`${transparent} ${pos + thickness}%`);
        });

        // Seal the end of the gradient
        gradientStops.push(`${transparent} 100%`);

        return gradientStops;
    }

    const markerGradient = generateMarkerGradient(floor.markers, duration);



    return (
        <>
        <div className="bg-gray-500 rounded-2xl mt-3 text-center w-5/6 mx-auto">
            {/* progress bar */}
            <div className="w-full mx-auto p-2 relative">
                <span>{formatTime(currentTime)} / {formatTime(duration)}</span>
                <div className="w-full relative">
                    <div 
                        className="w-full z-0 absolute h-6 box-border p-2 top-0" 
                        style={{background: `linear-gradient(to right, ${markerGradient.join(" , ")})`, pointerEvents: "none"}}
                    />
                    <input
                        className="w-full bg-gray-600 rounded-full appearance-none cursor-pointer accent-amber-800 
                        hover:accent-amber-900 focus:outline-none [&::-webkit-slider-runnable-track]:bg-transparent z-50"
                        step={0.1}
                        min={0}
                        max={duration}
                        value={currentTime}
                        onChange={handleScub}
                        type="range"
                        style={{background: `linear-gradient(to right, #3b82f6 0%, #3b82f6 ${progressPercentage}%, #4b5562 ${progressPercentage}%, #4b5562 100%)`}}
                    />
                </div>
                <div className="flex justify-start items-center gap-3 mx-auto">
                    <div className="flex justify-center items-center gap-2">
                        {/* Play or pause */}
                        <button onClick={togglePlay} className="rounded-full bg-gray-700 p-2 hover:bg-gray-900">{isPaused ? <FaPlay/> : <FaPause/>}</button>
                        {/* Volume Controls */}
                        <div className="rounded-full p-2 bg-gray-700 cursor-pointer flex justify-start items-center 
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
                    {/* Adding markers */}
                    <div className="flex justify-end items-center w-full gap-2">
                        <button 
                            disabled={onMarker ? true : false}
                            onClick={handleAddMarker}
                            className={"bg-blue-800 hover:bg-blue-900 rounded-full flex justify-center items-center p-2 gap-1.5" + (onMarker ? " brightness-50" : "")}>
                            Add Marker 
                            <FaPlus/>
                        </button>
                        <button 
                            className={"bg-red-800 hover:bg-red-900 rounded-full flex justify-between items-center p-2 gap-1.5" + (onMarker ? "" : " brightness-50")}
                            disabled={onMarker ? false : true}
                            onClick={handleDeleteMarker}
                            >
                            Delete Marker 
                            <FaDeleteLeft/>
                        </button>
                    </div>
                </div>
                <div className="flex justify-around items-center my-3">
                    <span>
                        Name For New Section: 
                    </span>
                    <input type="text"
                        className="rounded-full bg-gray-800 border-blue-500 border-2 border-solid p-2"
                        value={nameSection}
                        onChange={({target}) => setNameSection(target.value)}
                        />
                </div>
                
            </div>
        </div>
            <h2 className="tracking-wide text-center text-xl mt-5">Sections</h2>
                    <Sections floor={floor} setFloor={setFloor} onMarker={onMarker} handleDelete={handleDeleteMarker}/>
        </>
    )
}

function Sections({floor, setFloor, onMarker, handleDelete}: {floor: Floor, setFloor: Dispatch<SetStateAction<Floor | null>>, onMarker: Marker | null, handleDelete: () => Promise<void>}) {
    
    return (
        <div className="bg-gray-500 w-5/6 mx-auto rounded-xl my-3 p-2">
            {floor.markers.length ? floor.markers.map((marker, i) => {
                return <Section marker={marker} key={i} on={(marker.markTime == onMarker?.markTime ? true : false)} handleDelete={handleDelete}/>
            }) : <span>Add Markers</span>}
        </div>
    )
}

function Section({marker, key, on, handleDelete}: {marker: Marker, key:number, on: boolean, handleDelete: () => Promise<void>}) {
    const playback = Player.usePlayer(selectTime)
    const playActions = Player.usePlayer()
    return (
        <div key={key} className={"rounded-xl p-2 my-2 hover:bg-gray-700 flex justify-around items-center" + (on ? " bg-gray-800" : " bg-gray-600")} 
            onClick={() => {
                playback?.seek(marker.markTime)
                playActions.pause()
                }}>
            <h3>{marker.markerName}: {formatTime(marker.markTime)}</h3>
            <FaTrash className="fill-red-500" onClick={() => handleDelete()}/>
        </div>
    )
}

export function formatTime(seconds: number): string {
    if (isNaN(seconds) || seconds === Infinity) return '0:00';
    
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);

    // Pad minutes with a leading zero ONLY if hours are displayed
    const formattedMins = hrs > 0 ? String(mins).padStart(2, '0') : String(mins);
    const formattedSecs = String(secs).padStart(2, '0');

    if (hrs > 0) {
        return `${hrs}:${formattedMins}:${formattedSecs}`; 
    }
    return `${formattedMins}:${formattedSecs}`;
}