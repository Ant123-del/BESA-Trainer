import { useEffect, useState } from "react"
import { Link, useNavigate, useSearchParams } from "react-router-dom"
import { onAuthStateChanged } from "firebase/auth"
import { collection, doc, getDoc, getDocs, limit, query, updateDoc, where } from "firebase/firestore"
import { getStorage, ref, uploadBytes } from "firebase/storage"
import { MoonLoader } from "react-spinners"
import { IoMdArrowRoundBack } from "react-icons/io"
import { FaArrowRight } from "react-icons/fa"
import Header from "../Components/Header"
import { floorNameDecoder } from "../Components/SectionEditor/Edit"
import { getFirebaseAuth } from "../Tools/firebase"
import { db, removeCustomScript } from "../Tools/firestore"
import { getScript } from "../Tools/Fetch"
import { groupScriptBySections } from "../Tools/ScriptDecoder"
import { FLOOR_SEQUENCE, getNextFloorCode } from "./Simulator"
import type { CosScript, Floor, FloorCode, Script, User } from "../Tools/types"

type Source = "default" | "custom"

//a dedicated, read-only walkthrough of a floor's script - no video, no testing, just the words in
//order under each section's title. Lives next to "Begin Practice" on the BESA dashboard, and doubles
//as where a BESA manages their personal (possibly edited) copy of each floor's script - that used to
//live on the Profile page, but it makes a lot more sense sitting right next to the script itself.
export default function ReadScript() {
    const navigate = useNavigate()
    const [searchParams, setSearchParams] = useSearchParams()
    const f = (searchParams.get("f") || FLOOR_SEQUENCE[0]) as FloorCode

    const [userData, setUserData] = useState<User | null>(null)
    const [floor, setFloor] = useState<Floor | null>(null)
    const [floorChecked, setFloorChecked] = useState(false)

    const [source, setSource] = useState<Source>("default")
    const [defaultScript, setDefaultScript] = useState<string | null>(null)
    const [cosScript, setCosScript] = useState<CosScript | null>(null)
    const [personalScript, setPersonalScript] = useState<string | null>(null)
    const [scriptLoading, setScriptLoading] = useState(false)

    const [updatingPersonal, setUpdatingPersonal] = useState(false)
    const [revertingPersonal, setRevertingPersonal] = useState(false)
    const [actionError, setActionError] = useState("")

    //signed-in user's doc, kept live for scriptPaths - RequireAccess already guarantees this is a
    //besa/besaLead account before this page ever renders.
    useEffect(() => {
        const auth = getFirebaseAuth()
        const unsub = onAuthStateChanged(auth, async (fbUser) => {
            if (!fbUser) {
                navigate("/")
                return
            }
            const docSnap = await getDoc(doc(db, "training_data", "data_root", "users", fbUser.uid))
            setUserData(docSnap.exists() ? docSnap.data() as User : null)
        })
        return unsub
    }, [])

    //current draft for whichever floor is selected
    useEffect(() => {
        setFloor(null)
        setFloorChecked(false)
        const floorDocs = collection(db, "training_data/floors/" + f)
        getDocs(query(floorDocs, where("current", "==", true), limit(1))).then((data) => {
            setFloor(data.empty ? null : data.docs[0].data() as Floor)
            setFloorChecked(true)
        })
    }, [f])

    //switching floors always lands back on "Default Script" and clears whatever the previous floor loaded
    useEffect(() => {
        setSource("default")
        setDefaultScript(null)
        setCosScript(null)
        setPersonalScript(null)
        setActionError("")
    }, [f])

    //personal copy is loaded (not auto-created) whenever it already exists
    useEffect(() => {
        if (!floor || !userData) {
            return
        }
        const existing = userData.scriptPaths?.find(s => s.floorCode === floor.floorCode)
        if (existing?.src) {
            getScript(existing.src).then((text) => {
                setCosScript(existing)
                setPersonalScript(text || "")
            })
        } else {
            setCosScript(null)
            setPersonalScript(null)
        }
    }, [floor, userData])

    //always fetch default script when floor loads
    useEffect(() => {
        if (!floor || defaultScript !== null) {
            return
        }
        setScriptLoading(true)
        getDoc(doc(db, "training_data", "data_root", "scripts", floor.defScriptId)).then(async (data) => {
            if (data.exists()) {
                const s = data.data() as Script
                setDefaultScript(await getScript(s.src) || "")
            } else {
                setDefaultScript("")
            }
        }).finally(() => setScriptLoading(false))
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [floor])

    async function handleUpdateToLatest() {
        if (!floor || !userData || !cosScript) {
            return
        }
        setUpdatingPersonal(true)
        setActionError("")
        try {
            const scriptDoc = (await getDoc(doc(db, "training_data/data_root/scripts/" + floor.defScriptId))).data() as Script
            const newText = await getScript(scriptDoc.src) || ""
            const storage = getStorage()
            await uploadBytes(ref(storage, cosScript.path), new Blob([newText], {type: "text/vtt"}))

            const updatedEntry: CosScript = {...cosScript, scriptDeviationId: floor.defScriptId}
            const newScriptPaths = userData.scriptPaths.map(s => s.id === cosScript.id ? updatedEntry : s)
            await updateDoc(doc(db, "training_data/data_root/users/" + userData.uid), {scriptPaths: newScriptPaths})

            setUserData({...userData, scriptPaths: newScriptPaths})
            setCosScript(updatedEntry)
            setPersonalScript(newText)
        } catch (e) {
            console.error(e)
            setActionError("Couldn't update that script right now. Please try again.")
        } finally {
            setUpdatingPersonal(false)
        }
    }

    async function handleDeleteCustom() {
        if (!userData || !cosScript) {
            return
        }
        setRevertingPersonal(true)
        setActionError("")
        try {
            const newScriptPaths = await removeCustomScript(userData.uid, userData.scriptPaths, cosScript)
            setUserData({...userData, scriptPaths: newScriptPaths})
            setCosScript(null)
            setPersonalScript(null)
            setSource("default")
        } catch (e) {
            console.error(e)
            setActionError("Couldn't delete that script right now. Please try again.")
        } finally {
            setRevertingPersonal(false)
        }
    }

    const nextFloorCode = getNextFloorCode(f)
    const activeSource: Source = cosScript ? source : "default"
    const text = activeSource === "custom" ? (personalScript ?? defaultScript ?? "") : (defaultScript ?? "")
    const groups = floor ? groupScriptBySections(text, floor.markers) : []
    const outOfDate = !!floor && !!cosScript && cosScript.scriptDeviationId !== floor.defScriptId

    function handleNext() {
        if (nextFloorCode) {
            setSearchParams({f: nextFloorCode})
        } else {
            navigate("/")
        }
    }

    return (
        <div className="bg-be-navy-darker w-full min-h-screen text-white font-sans">
            <Header/>
            <div className="h-20 relative top-0 left-0 w-full"></div>

            <header className="p-3 px-5 flex flex-wrap justify-between items-center gap-3 border-b-4 border-b-solid border-b-be-orange bg-be-navy">
                <h1 className="text-2xl sm:text-3xl md:text-4xl font-bold tracking-wider">{floorNameDecoder(f)} Script</h1>
                <Link to="/" className="flex justify-center gap-2 items-center hover:text-be-yellow font-medium p-2 transition-colors">
                    <IoMdArrowRoundBack/>
                    <span>Back</span>
                </Link>
            </header>

            <div className="w-11/12 max-w-4xl mx-auto my-6 pb-20">
                {/* Floor tabs */}
                <div className="flex flex-wrap gap-2 mb-6">
                    {FLOOR_SEQUENCE.map((code) => (
                        <button key={code} onClick={() => setSearchParams({f: code})}
                            className={"px-4 py-2 rounded-full border-2 text-sm font-bold transition-colors " + (f === code ? "bg-be-orange text-black border-be-orange" : "border-be-light-gray text-white hover:bg-be-navy")}>
                            {floorNameDecoder(code)}
                        </button>
                    ))}
                </div>

                {!floorChecked ?
                    <div className="flex justify-center py-20"><MoonLoader color="white" size={30}/></div>
                    : !floor ?
                    <p className="text-be-light-gray italic text-center py-20">No video set up yet for this floor.</p>
                    :
                    <>
                        {actionError && <p className="text-red-400 text-sm text-center mb-3">{actionError}</p>}

                        {/* Script text panel with top-right Default/Custom toggle slider */}
                        <div className="bg-be-navy rounded-2xl p-5 min-h-[20rem] border-2 border-be-orange/50 shadow-lg">
                            <div className="flex items-center justify-between gap-3 flex-wrap mb-4 pb-3 border-b border-be-navy-dark">
                                <h2 className="text-xl font-bold text-be-yellow tracking-wide">{floorNameDecoder(f)}</h2>
                                {cosScript && (
                                    <div className="flex items-center gap-2 ml-auto flex-wrap">
                                        <div className="inline-flex items-center bg-be-navy-darker p-1 rounded-full border border-be-orange/60">
                                            <button
                                                type="button"
                                                onClick={() => setSource("default")}
                                                className={"px-3 py-1 rounded-full text-xs font-bold transition-all " +
                                                    (activeSource === "default" ? "bg-be-orange text-black shadow" : "text-be-light-gray hover:text-white")}
                                            >
                                                Default Script
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => setSource("custom")}
                                                className={"px-3 py-1 rounded-full text-xs font-bold transition-all " +
                                                    (activeSource === "custom" ? "bg-be-orange text-black shadow" : "text-be-light-gray hover:text-white")}
                                            >
                                                Custom Script
                                            </button>
                                        </div>
                                        {activeSource === "custom" && (
                                            <>
                                                {outOfDate && (
                                                    <button
                                                        type="button"
                                                        onClick={handleUpdateToLatest}
                                                        disabled={updatingPersonal}
                                                        className="px-3 py-1 rounded-full bg-be-yellow hover:bg-amber-400 text-black font-bold text-xs transition-colors disabled:opacity-50"
                                                    >
                                                        {updatingPersonal ? "Updating..." : "Update to Latest"}
                                                    </button>
                                                )}
                                                <button
                                                    type="button"
                                                    onClick={handleDeleteCustom}
                                                    disabled={revertingPersonal}
                                                    className="px-3 py-1 rounded-full bg-red-600 hover:bg-red-700 text-white font-bold text-xs transition-colors disabled:opacity-50"
                                                >
                                                    {revertingPersonal ? "Deleting..." : "Delete"}
                                                </button>
                                            </>
                                        )}
                                    </div>
                                )}
                            </div>

                            {scriptLoading ?
                                <div className="flex justify-center py-10"><MoonLoader color="white" size={30}/></div>
                                : groups.length === 0 ?
                                <p className="text-be-light-gray italic text-center py-10">No script available yet.</p>
                                : groups.map((group, i) => (
                                    <div key={i} className="mb-6">
                                        <h4 className="text-be-yellow text-lg font-bold tracking-wide mb-2">{group.title}</h4>
                                        {group.lines.map((line, j) => (
                                            <p key={j} className="text-white mb-2 leading-relaxed">{line.text}</p>
                                        ))}
                                    </div>
                                ))
                            }
                        </div>

                        <button onClick={handleNext}
                            className="w-full mt-5 p-3 rounded-full bg-be-orange hover:bg-be-orange-dark text-black text-sm font-bold tracking-wide flex items-center justify-center gap-2 transition-colors">
                            {nextFloorCode ? `Next: ${floorNameDecoder(nextFloorCode)} Script` : "Back to Home"}
                            <FaArrowRight/>
                        </button>
                    </>
                }
            </div>
        </div>
    )
}
