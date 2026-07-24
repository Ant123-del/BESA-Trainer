import { getAuth, onAuthStateChanged, type Auth } from "firebase/auth"
import { v4 as uuid4 } from "uuid" 
import { useEffect, useState, type ChangeEvent, type Dispatch, type DragEvent, type JSX, type SetStateAction, type SubmitEvent } from "react"
import { useSearchParams } from "react-router-dom"
<<<<<<< HEAD
import { db, deleteDraftFloor, setCurrentFloorDraft } from "../Tools/firestore"
=======
import { db, setCurrentFloorDraft } from "../firestore"
>>>>>>> 0e2f316100aecfed54d1717f6c9d2f5af4bc50c6
import { collection, doc, getDoc, getDocs, limit, query, setDoc, where } from "firebase/firestore"
import { getDownloadURL, getStorage, ref, uploadBytes } from "firebase/storage"
import type { Floor, FloorCode, Script } from "../Tools/types"
import {PulseLoader} from 'react-spinners'
import ContentLoader from 'react-content-loader'

import { MdFileUpload } from "react-icons/md";
import { getFirebaseAuth } from "../Tools/firebase"
import VideoEditor from "./VideoEditor"
import EditScript from "./EditScript"

export default function Edit() {
    const [searchParam, setSearchParam] = useSearchParams()
    const [floorData, setFloorData] = useState<Floor | null>(null)
    const [otherVideos, setOtherVideos] = useState<Floor[]>([])
    const [uploaded, setUploaded] = useState(false)
    const [uploading, setUploading] = useState(false)
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
<<<<<<< HEAD
            {uploaded || uploading ? <ManageVideo otherVideos={otherVideos} setUploaded={setUploaded} setOtherVideos={setOtherVideos}/> : <UploadVideo setUploaded={setUploaded} hasMoreVideos={otherVideos?.length > 0} setOtherVideos={setOtherVideos} setUploading={setUploading}/>}
            {uploading && <Loading text="Uploading..."/>}
=======
            {uploaded ? <ManageVideo otherVideos={otherVideos} setUploaded={setUploaded}/> : <UploadVideo setUploaded={setUploaded} hasMoreVideos={otherVideos.length > 0} setOtherVideos={setOtherVideos}/>}
>>>>>>> 0e2f316100aecfed54d1717f6c9d2f5af4bc50c6
        </div>
    )
}

<<<<<<< HEAD
function UploadVideo({setUploaded, hasMoreVideos, setOtherVideos, setUploading}: {setUploaded: Dispatch<SetStateAction<boolean>>, hasMoreVideos: boolean, setOtherVideos: Dispatch<SetStateAction<Floor[]>>, setUploading: Dispatch<SetStateAction<boolean>>}) {
=======
function UploadVideo({setUploaded, hasMoreVideos, setOtherVideos}: {setUploaded: Dispatch<SetStateAction<boolean>>, hasMoreVideos: boolean, setOtherVideos: Dispatch<SetStateAction<Floor[]>>}) {
>>>>>>> 0e2f316100aecfed54d1717f6c9d2f5af4bc50c6
    const [vid, setVideo] = useState<File | null>(null)
    const [vidsrc, setVidSrc] = useState("")
    const [isDragging, setIsDragging] = useState(false)
    const [current, setCurrent] = useState(true)
    const [searchParam, setSearchParam] = useSearchParams()
    const [draftName, setDraftName] = useState("")
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
            setDraftName(file.name)
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
        const id = uuid4()
        const scriptId = uuid4()
        const storage = getStorage()
        const path = "videos/" + id
        const scriptPath = "scripts/" + scriptId
        const vidRef = ref(storage, path)
        const scriptRef = ref(storage, scriptPath)

        //This is for loading screen
        setUploading(true)

        try {
                //blank .vtt file
                const scriptBlob = new Blob([""], {type: "text/vtt"})
                //For script uploading
                uploadBytes(scriptRef, scriptBlob).then(async (otherSnap) => {
                    const scriptRef = doc(db, "training_data", "data_root", "scripts", scriptId)
                    const newScript: Script = {
                        src: await getDownloadURL(otherSnap.ref),
                        id: scriptId,
                        floorCode: f as FloorCode,
                        path: "scripts/" + scriptId,
                        draftId: id
                    }
<<<<<<< HEAD
                    await setDoc(scriptRef, newScript, {merge:true})
                })
                // for video uploading
                uploadBytes(vidRef, vid).then(async (snapshot) => {
                    setUploaded(true)
                    console.log("Uploaded Video")
                    // This is for database
                    if (f) {
                        const docRef = doc(db, "training_data", "floors", f, snapshot.metadata.name)
                        
                        const floor:Floor = {
                            id: id,
                            path: path,
                            floorCode: f as FloorCode,
                            current: current,
                            draftName: draftName,
                            src: await getDownloadURL(snapshot.ref),
                            markers: [],
                            defScriptId: scriptId
                        }
                        setOtherVideos(prev => {
                            if (!current) return [...prev, floor]
                            let copy = [...prev, floor].map(doc => {
                                let newDoc = {...doc}
                                newDoc.current = false
                                return newDoc
                            }) as Floor[]
                            const index = copy.findIndex(doc => doc.id == floor.id)
                            copy[index].current = true
                            return copy
                        })
                        await setDoc(docRef, floor, {merge: true})
                        if (current) {
                            await setCurrentFloorDraft(floor)
                        }
                        setUploading(false)
                    }
                setUploading(false)    
    
                })
=======
                    setOtherVideos(prev => [...prev, floor])
                    await setDoc(docRef, floor, {merge: true})
                    if (current) {
                        await setCurrentFloorDraft(floor)
                    }
                    setUploading(false)
                }
                
                

            })
>>>>>>> 0e2f316100aecfed54d1717f6c9d2f5af4bc50c6
        } catch (e) {
            console.error(e)
        }
    }

    return (
        <form className="w-full min-h-[calc(100vh-4rem)] flex justify-center items-center" onSubmit={handleSubmit}>
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

                    <video key={vidsrc} controls className="w-full h-96 object-cover rounded-3xl">
                        {vidsrc && <source src={vidsrc} type={vid.type}/>}
                    </video>
                    <div className="mx-auto text-center mt-3 flex justify-between items-center p-3 box-border">
                        <span>Name Your Draft (No Duplicates Please): </span>
                        <input type="text" placeholder="Draft Name..." value={draftName} onChange={({target}) => setDraftName(target.value)}
                            className="w-1/2 p-2 rounded-full border-blue-300 border-solid border-2"/>
                    </div>
                    {/* Check box for indicating current state */}
                    <div className="flex justify-between items-center gap-3 mb-3 p-3">
                        <span>Show As Default (can only pick one): </span>
                        <input type="checkbox" disabled={!hasMoreVideos} name="current-box" checked={current} onChange={({target}) => setCurrent(target.checked)}
                            className="w-1/2"/>
                    </div>
                    <button type="button" className="bg-gray-600 my-3 text-white p-3 w-full rounded-full hover:bg-gray-800" onClick={chooseAnotherFile}>Choose Another File</button>
                    <input className="bg-blue-800 text-white p-3 w-full rounded-full hover:bg-blue-900" type="submit" value={"Continue"}/>
                </div>
            )}
        </form>
    )
}

export function Loading({text, children, onClose}:{text?:string, children?:JSX.Element, onClose?: () => void}) {
    return (
        <div
        onClick={(e) => { if (e.target === e.currentTarget) onClose?.() }}
        className="z-[100] fixed w-screen h-screen bg-gray-600/50 top-0 right-0 flex justify-center items-center">
            {children ? children :
            <div>
                <h2 className="text-amber-600 text-3xl text-center mb-3">{text}</h2>
                <PulseLoader color="#F59E0B" size={30} className="m-auto block text-center"/>
            </div> }
        </div>
    )
}


function ManageVideo({otherVideos, setUploaded, setOtherVideos}: {otherVideos:Floor[], setUploaded: Dispatch<SetStateAction<boolean>>, setOtherVideos: Dispatch<SetStateAction<Floor[]>>}) {
    const [searchParam, setSearchParam] = useSearchParams()
    const f = searchParam.get("f")
    const current = otherVideos.find((doc:Floor) => doc.current)
    const [selected, setSelected] = useState<Floor | null>(current || null)
    const [deletePopup, setDeletePopup] = useState(false)
    const [loading, setLoading] = useState(false)
    const [startSelect, setStartSelect] = useState(false)
    const [loadingCurrent, setLoadingCurrent] = useState(false)
    const [hasScript, setHasScript] = useState(true)

    useEffect(() => {
        setStartSelect(true)
    }, [f])

    useEffect(() => {

    }, [selected])

    useEffect(() => {
        if(startSelect) {
            const NewCurrent = otherVideos.find((doc:Floor) => doc.current)
            setSelected(NewCurrent || null)
            setStartSelect(false)
        }
    }, [otherVideos])


    async function handleDelete() {
        setDeletePopup(false)
        setLoading(true)
        if (selected) {
            await deleteDraftFloor(selected)
            setOtherVideos((prev) => {
                const filtered = prev.filter(doc => doc.id != selected.id)

                if(filtered.length >= 1) {
                    setSelected(filtered[0])
                    setLoading(false)
                    handleSetCurrent(filtered[0]).then(() => {})
                } else {
                    setSelected(null)
                }
                return filtered
            })
        }
        setLoading(false)
    }

    async function handleSetCurrent(chosen=selected) {
        setLoadingCurrent(true)

        if(chosen) {
            await setCurrentFloorDraft(chosen)
            //updates state
            setOtherVideos((prev:Floor[]) => {
                //Sets up such that all current states are false
                if (!prev.length) return prev
                const og = [...prev]
                let copy = [...prev].map(doc => {
                    let newDoc = {...doc}
                    newDoc.current = false
                    return newDoc
                })
                //sets the correct one to be true
                const index = og.findIndex(doc => doc.id == chosen.id)
                if(index >= 0) copy[index].current = true
                return copy
            })
            setSelected(prev => {
                let copy = {...prev} as Floor
                copy.current = true
                return copy
            })
        }
        setLoadingCurrent(false)
    }

    return (
        <div className="w-full text-gray-300">
            <div className="flex justify-between pl-4 pt-4 items-center">
                <h1 className="text-2xl tracking-wider">Edit {f ? floorNameDecoder(f) : "Floor"}</h1>
                <button className={"p-3 mr-4 rounded-full bg-blue-900 hover:bg-blue-800" + (otherVideos.length >= 2 ? " brightness-50" : "brightness-100")} 
                    onClick={() => setUploaded(false)}
                    disabled={otherVideos.length >= 2}>
                    Make New Draft
                </button>
            </div>
            <div className="bg-gray-700 rounded-2xl w-5/6 my-5 mx-auto p-3">
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
                        return <DraftCard floorInfo={floor} key={i} selected={selected} setSelected={setSelected}/>
                    })}
                </div>
            </div>
            <hr className="w-3/4 mx-auto my-10"/>
            {selected ? (<div>
                {/* If document has been selected */}
                <div className="rounded-2xl bg-gray-700 p-2 w-5/6 mx-auto">
                    <div className="flex justify-between items-center">
                        <h2 className="tracking-wide">
                            Selected Draft 🎥: {selected.draftName}
                        </h2>
                        <div className="flex justify-between items-center">
                            <button onClick={() => setDeletePopup(true)} className="bg-red-800 p-2 hover:bg-red-900 rounded-full mx-3">
                                Delete Draft
                            </button>
                            <button onClick={() => handleSetCurrent()} disabled={selected.current} className={"bg-blue-800 p-2 hover:bg-blue-900 rounded-full mx-3" + (selected.current ? " brightness-50" : "")}>
                                Set Default Video
                            </button>
                        </div>
                    </div>
                    
                    {selected && <VideoEditor floor={selected} setFloor={(setSelected)}/>}
                    {/* This is the section where script editing will be held */}
                    <EditScript selected={selected}/>
                </div>

            </div>) : (<div>
                {/* If document hasnt been selected */}
            </div>)}
            {/* Popup message confirmation deleting draft */}
            {deletePopup && 
            <div className="z-[100] fixed w-screen h-screen bg-gray-600/50 top-0 right-0 flex justify-center items-center">
                <div className="bg-white w-1/4 rounded-2xl">
                    <h2 className="text-red-500 text-3xl text-center my-3">Are you sure you want to delete this draft?</h2>
                    <p className="mx-auto my-3 text-black text-center">This action cannot be undone</p>
                    <button className="text-white block rounded-full bg-red-800 p-3 mx-auto my-3 w-3/4 hover:bg-red-900" onClick={() => handleDelete()}>Yes I am sure</button>
                    <button className="text-white block rounded-full bg-blue-800 p-3 mx-auto my-3 w-3/4 hover:bg-blue-900" onClick={() => setDeletePopup(false)}>Cancel</button>
                </div>
            </div>}
            {loading && <Loading text="Deleting Draft..."/>}
            {loadingCurrent && <Loading text="Upading Default..."/>}
        </div>
    )
}

function DraftCard({floorInfo, key, selected, setSelected} : {floorInfo:Floor, key:number, selected: Floor | null, setSelected: Dispatch<SetStateAction<Floor | null>>}) {
    const [loaded, setLoaded] = useState(false)

    return (
        <div className={"bg-gray-600 rounded-2xl w-1/2 p-2 hover:brightness-75 text-gray-200 relative" + (selected?.id && selected.id == floorInfo.id ? " brightness-50" : "")} key={key} onClick={() => setSelected(floorInfo)}>
            <video className="w-full h-96 rounded-2xl object-cover border-b-amber-700 border-b-4 border-b-solid" src={floorInfo.src} preload="metadata" onLoadedData={() => setLoaded(true)}/>
            { !loaded && <ContentLoader className="w-full rounded-2xl absolute top-0 left-0 p-2 box-border" backgroundColor="#F59E0B"><rect x="0" y="0" className="w-full h-36" height="200"/></ContentLoader>}
            <div className="flex mt-3 justify-between items-center">
                <h2 className="text-lg">{floorInfo.draftName}</h2>
                {floorInfo.current ? <p className="p-1 bg-amber-800 rounded-full">Default</p> : <p></p>}
            </div>
        </div>
    )
}

export function floorNameDecoder(code: string): string {
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