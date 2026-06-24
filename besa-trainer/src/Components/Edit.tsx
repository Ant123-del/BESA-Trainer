import { getAuth, onAuthStateChanged, type Auth } from "firebase/auth"
import { v4 as uuid4 } from "uuid" 
import { useEffect, useState, type ChangeEvent, type Dispatch, type DragEvent, type SetStateAction, type SubmitEvent } from "react"
import { useSearchParams } from "react-router-dom"
import { db } from "../firestore"
import { collection, doc, getDoc, getDocs, limit, query, setDoc, where } from "firebase/firestore"
import { getDownloadURL, getStorage, ref, uploadBytes } from "firebase/storage"
import type { Floor, FloorCode } from "../types"
import {PulseLoader} from 'react-spinners'

import { MdFileUpload } from "react-icons/md";
import { getFirebaseAuth } from "../firebase"

export default function Edit() {
    const [searchParam, setSearchParam] = useSearchParams()
    const [floorData, setFloorData] = useState<Floor | null>(null)
    const [otherVideos, setOtherVideos] = useState<Floor[]>([])
    const [uploaded, setUploaded] = useState(false)
    const f = searchParam.get("f")
    //uploaded when set to true, means the video has been uploaded and is ready to start editing. If set to false, need to upload video.

    useEffect(() => {
        //going to need to leave off from here but
        //Checking if there are any document uploaded for the floor
        const auth = getAuth()
        const unsub = onAuthStateChanged(auth, async (fireBaseUser) => {
            const floorsRef = collection(db, "training_data", "floors", f || "")
            const OtherDocs = await getDocs(floorsRef)

            const floors: Floor[] = []

            if (!OtherDocs.empty) {
                OtherDocs.forEach((docs) => {
                    floors.push(docs.data() as Floor)
                })
                setOtherVideos(floors)
                console.log(floors)
                setUploaded(true)
                const current = floors.find((doc:Floor) => doc.current == true)
                if (current) {
                    setFloorData(current)
                } else {
                    setFloorData(null)
                }
            } else {
                setOtherVideos([])
                setUploaded(false)
                setFloorData(null)
            }

        })
        return unsub
    }, [f])

    return (
        <div className="w-full">
            {uploaded ? <ManageVideo otherVideos={otherVideos} setUploaded={setUploaded}/> : <UploadVideo setUploaded={setUploaded} hasMoreVideos={otherVideos.length > 0}/>}
        </div>
    )
}

function UploadVideo({setUploaded, hasMoreVideos}: {setUploaded: Dispatch<SetStateAction<boolean>>, hasMoreVideos: boolean}) {
    const [vid, setVideo] = useState<File | null>(null)
    const [vidsrc, setVidSrc] = useState("")
    const [uploading, setUploading] = useState(false)
    const [isDragging, setIsDragging] = useState(false)
    const [current, setCurrent] = useState(true)
    const [searchParam, setSearchParam] = useSearchParams()
    const f = searchParam.get("f")

    useEffect(() => {
        if (!vid) {
            setVidSrc("")
            return
        }

        const url = URL.createObjectURL(vid)
        setVidSrc(url)

        return () => URL.revokeObjectURL(url)
    }, [vid])

    function handleFileChange(e: ChangeEvent<HTMLInputElement>):void {
        const file = e.target.files?.[0]
        if (file) {
            setVideo(file)
        }
        //reset input so picking the same file again still fires onChange
        e.target.value = ""
    }

    function chooseAnotherFile(): void {
        setVideo(null)
        const fileInput = document.getElementById("upload-video") as HTMLInputElement | null
        if (fileInput) {
            fileInput.value = ""
        }
    }

    function handleDragOver(e: DragEvent<HTMLLabelElement>) {
        e.preventDefault()
        setIsDragging(true)
    }

    function handleDragLeave() {
        setIsDragging(false)
    }

    function handleDrop(e: DragEvent<HTMLLabelElement>) {
        e.preventDefault()
        setIsDragging(false)

        if (e.dataTransfer.files && e.dataTransfer.files[0]) {
            const droppedFile = e.dataTransfer.files[0]
            setVideo(droppedFile)

            const fileInput = document.getElementById('upload-video') as HTMLInputElement
            if (fileInput) {
                fileInput.files = e.dataTransfer.files
            }
        }
    }

    function handleSubmit(e: SubmitEvent<HTMLFormElement>) {
        e.preventDefault()
        if (!vid) return null
        const storage = getStorage()
        const vidRef = ref(storage, vid.name)

        //This is for loading screen
        setUploading(true)

        try {
        
            uploadBytes(vidRef, vid).then(async (snapshot) => {
                setUploaded(true)
                console.log("Uploaded Video")
                
                // This is for database
                if (f) {
                    const docRef = doc(db, "training_data", "floors", f, snapshot.metadata.name)
                    const floor:Floor = {
                        id: uuid4(),
                        name: f as FloorCode,
                        current: current,
                        path: snapshot.metadata.fullPath,
                        src: await getDownloadURL(snapshot.ref),
                        markers: [],
                        sections: [],
                    }
                    await setDoc(docRef, floor, {merge: true})
                    setUploading(false)
                }
                
                

            })
        } catch (e) {
            console.error(e)
        }
    }

    return (
        <form className="w-full h-screen flex justify-center items-center" onSubmit={handleSubmit}>
            {/* Two sections, Insert video button and confirmation of video. */}
            {!vid ? (<label className="text-white border-dashed border-4 border-blue-900 rounded-2xl px-40 py-10 cursor-pointer text-center hover:border-blue-700 "
             htmlFor="upload-video"
             onDragOver={handleDragOver}
             onDragLeave={handleDragLeave}
             onDrop={handleDrop}>
                <h3>Drop Or Upload File right here</h3>
                <MdFileUpload className="w-8 h-8 mx-auto my-4"/>
                <h4 className="text-gray-400">.mp4 files are accepted only</h4>
                <input type="file" id="upload-video" className="hidden" onChange={handleFileChange} accept=".mp4"/>
            </label>) : 
            (
                <div className="text-black bg-white px-24 py-10 rounded-2xl">
                    <h2 className="text-xl my-4 text-center">Inserting: {vid.name}</h2>

                    <video key={vidsrc} controls className="w-full rounded-3xl">
                        {vidsrc && <source src={vidsrc} type={vid.type}/>}
                    </video>
                    <button type="button" className="bg-gray-600 my-3 text-white p-3 w-full rounded-full hover:bg-gray-800" onClick={chooseAnotherFile}>Choose Another File</button>
                    {/* Check box for indicating current state */}
                    <div className="flex justify-center items-center gap-3 mb-3">
                        <span>Show As Default (can only pick one): </span>
                        <input type="checkbox" disabled={!hasMoreVideos} name="current-box" checked={current} onChange={({target}) => setCurrent(target.checked)}/>
                    </div>
                    <input className="bg-blue-800 text-white p-3 w-full rounded-full hover:bg-blue-900" type="submit" value={"Continue"}/>
                </div>
            )}
            {/* For loading screen */}
            {uploading && 
            <div className="z-100 fixed w-screen h-screen bg-gray-600/50 top-0 right-0 flex justify-center items-center">
                <div>
                    <h2 className="text-amber-600 text-3xl text-center mb-3">Uploading...</h2>
                    <PulseLoader color="#F59E0B" size={30} className="m-auto block text-center"/>
                </div>
            </div>}
        </form>
    )
}

function ManageVideo({otherVideos, setUploaded}: {otherVideos:Floor[], setUploaded: Dispatch<SetStateAction<boolean>>}) {
    const [searchParam, setSearchParam] = useSearchParams()
    const f = searchParam.get("f")

    return (
        <div className="w-full h-screen text-gray-300">
            <div className="flex justify-between pl-4 pt-4 items-center">
                <h1 className="text-2xl tracking-wider">Edit {f ? floorNameDecoder(f) : "Floor"}</h1>
                <button className={"p-3 mr-4 rounded-full bg-blue-900 hover:bg-blue-800" + (otherVideos.length >= 2 ? " brightness-50" : "brightness-100")} 
                    onClick={() => setUploaded(false)}
                    disabled={otherVideos.length >= 2}>
                    Make New Draft
                </button>
            </div>
            <div className="bg-gray-700 rounded-2xl w-3/4 my-5 mx-auto p-3">
                <div className="flex justify-between items-center mb-3">
                    <h2 className="text-xl tracking-wide">
                        Drafts (Only Two at a Time)
                    </h2>
                    <h3 className="text-sm text-gray-400 text-center">
                        Click One To Start Editing
                    </h3>
                </div>
                <div className="flex gap-3 justify-around items-center">
                    {otherVideos.map((floor:Floor, i) => {
                        return <DraftCard floorInfo={floor} key={i}/>
                    })}
                </div>
            </div>
        </div>
    )
}

function DraftCard({floorInfo, key} : {floorInfo:Floor, key:number}) {
    console.log(floorInfo.src)
    return (
        <div className="bg-gray-600 rounded-2xl w-1/2 p-2 hover:brightness-75 text-gray-200" key={key}>
            <video className="w-full rounded-2xl object-cover" src={floorInfo.src} preload="metadata"/>
            <div className="flex mt-3 justify-between items-center">
                <h2 className="text-lg">{floorInfo.path}</h2>
                {floorInfo.current ? <p className="p-1 bg-amber-800 rounded-full">Default</p> : <p></p>}
            </div>
        </div>
    )
}

function floorNameDecoder(code: string): string {
    switch (code) {
        case "f1":
            return "Floor 1"
        case "f2":
            return "Floor 2"
        case "f3":
            return "Floor 3"
        case "b":
            return "Basement"
        case "e":
            return "Exit"
        default:
            return "Unkown Section"
    }
}