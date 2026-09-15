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
import { db, ensurePersonalScript, removeCustomScript } from "../Tools/firestore"
import { getScript } from "../Tools/Fetch"
import { groupScriptBySections } from "../Tools/ScriptDecoder"
import { FLOOR_SEQUENCE, getNextFloorCode } from "./Simulator"
import type { CosScript, Floor, FloorCode, Script, User } from "../Tools/types"

type Source = "mine" | "default"

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

    const [source, setSource] = useState<Source>("mine")
    const [defaultScript, setDefaultScript] = useState<string | null>(null)
    const [cosScript, setCosScript] = useState<CosScript | null>(null)
    const [personalScript, setPersonalScript] = useState<string | null>(null)
    const [scriptLoading, setScriptLoading] = useState(false)

    const [creatingPersonal, setCreatingPersonal] = useState(false)
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

    //switching floors always lands back on "My Script" and clears whatever the previous floor loaded
    useEffect(() => {
        setSource("mine")
        setDefaultScript(null)
        setCosScript(null)
        setPersonalScript(null)
        setActionError("")
    }, [f])

    //personal copy is loaded (not auto-created) whenever it already exists - only actually creating
    //one is left as an explicit action, so "revert to default" doesn't just get silently reversed by
    //this same effect re-running.
    useEffect(() => {
        if (!floor || !userData) {
            return
        }
        const existing = userData.scriptPaths.find(s => s.floorCode === floor.floorCode)
        if (existing?.src) {
            setScriptLoading(true)
            getScript(existing.src).then((text) => {
                setCosScript(existing)
                setPersonalScript(text || "")
            }).finally(() => setScriptLoading(false))
        }
    }, [floor, userData])

    //default script is only fetched once it's actually needed (either the user picked that tab, or
    //there's no personal copy to fall back on).
    useEffect(() => {
        if (!floor || defaultScript !== null || (source !== "default" && cosScript)) {
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
    }, [floor, source, cosScript])

    async function handleCreatePersonal() {
        if (!floor || !userData) {
            return
        }
        setCreatingPersonal(true)
        setActionError("")
        try {
            const {cosScript: newCosScript, scriptText, scriptPaths} = await ensurePersonalScript(userData.uid, userData.scriptPaths, floor)
            setCosScript(newCosScript)
            setPersonalScript(scriptText)
            setUserData({...userData, scriptPaths})
        } catch (e) {
            console.error(e)
            setActionError("Couldn't create a personal copy right now. Please try again.")
        } finally {
            setCreatingPersonal(false)
        }
    }

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

    async function handleUseDefault() {
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
            setActionError("Couldn't revert that script right now. Please try again.")
        } finally {
            setRevertingPersonal(false)
        }
    }

    const nextFloorCode = getNextFloorCode(f)
    const text = source === "mine" ? (personalScript ?? "") : (defaultScript ?? "")
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
        <div className="bg-gray-900 w-full min-h-screen text-white">
            <Header/>
            <div className="h-16 relative top-0 left-0 w-full"></div>

            <header className="p-3 flex justify-between items-center border-b-2 border-b-solid border-b-gray-500">
                <h1 className="text-4xl tracking-wider">{floorNameDecoder(f)} Script</h1>
                <Link to="/" className="flex justify-center gap-2 items-center hover:text-gray-400 p-2">
                    <IoMdArrowRoundBack/>
                    <span>Back</span>
                </Link>
            </header>

            <div className="w-11/12 max-w-4xl mx-auto my-6 pb-20">
                {/* Floor tabs */}
                <div className="flex flex-wrap gap-2 mb-6">
                    {FLOOR_SEQUENCE.map((code) => (
                        <button key={code} onClick={() => setSearchParams({f: code})}
                            className={"px-4 py-2 rounded-full border-2 text-sm " + (f === code ? "bg-blue-800 border-blue-800" : "border-gray-600 hover:bg-gray-800")}>
                            {floorNameDecoder(code)}
                        </button>
                    ))}
                </div>

                {!floorChecked ?
                    <div className="flex justify-center py-20"><MoonLoader color="white" size={30}/></div>
                    : !floor ?
                    <p className="text-gray-500 italic text-center py-20">No video set up yet for this floor.</p>
                    :
                    <>
                        {/* My Script / Default toggle */}
                        <div className="flex justify-center gap-3 mb-5">
                            <button onClick={() => setSource("mine")}
                                className={"px-4 py-1.5 rounded-full border-2 " + (source === "mine" ? "bg-blue-800 border-blue-800" : "border-gray-600 hover:bg-gray-800")}>
                                My Script
                            </button>
                            <button onClick={() => setSource("default")}
                                className={"px-4 py-1.5 rounded-full border-2 " + (source === "default" ? "bg-blue-800 border-blue-800" : "border-gray-600 hover:bg-gray-800")}>
                                Default Script
                            </button>
                        </div>

                        {actionError && <p className="text-red-400 text-sm text-center mb-3">{actionError}</p>}

                        {/* Manage personal script */}
                        {source === "mine" &&
                            <div className="bg-gray-800 rounded-2xl p-4 mb-5 flex items-center justify-between gap-3 flex-wrap">
                                {cosScript ?
                                    <>
                                        <div>
                                            <span className="text-sm text-gray-300">This is your personal copy of the script.</span>
                                            {outOfDate &&
                                                <span className="block text-xs text-amber-400 mt-1">Out of date - doesn't match the current draft for this floor</span>
                                            }
                                        </div>
                                        <div className="flex items-center gap-2 shrink-0">
                                            {outOfDate &&
                                                <button onClick={handleUpdateToLatest} disabled={updatingPersonal}
                                                    className="p-2 px-4 rounded-full bg-amber-800 hover:bg-amber-900 text-xs disabled:opacity-50">
                                                    {updatingPersonal ? "Updating..." : "Update to Latest"}
                                                </button>
                                            }
                                            <button onClick={handleUseDefault} disabled={revertingPersonal}
                                                className="p-2 px-4 rounded-full border border-gray-400 hover:bg-gray-700 text-xs disabled:opacity-50">
                                                {revertingPersonal ? "Reverting..." : "Use Default Script"}
                                            </button>
                                        </div>
                                    </>
                                    :
                                    <>
                                        <span className="text-sm text-gray-300">
                                            {scriptLoading ? "Checking for a personal copy..." : "You don't have a personal copy of this floor's script yet."}
                                        </span>
                                        <button onClick={handleCreatePersonal} disabled={creatingPersonal || scriptLoading}
                                            className="p-2 px-4 rounded-full bg-blue-800 hover:bg-blue-900 text-xs disabled:opacity-50 shrink-0">
                                            {creatingPersonal ? "Creating..." : "Create From Default"}
                                        </button>
                                    </>
                                }
                            </div>
                        }

                        {/* Script text */}
                        <div className="bg-gray-800 rounded-2xl p-5 min-h-[20rem]">
                            {scriptLoading ?
                                <div className="flex justify-center py-10"><MoonLoader color="white" size={30}/></div>
                                : groups.length === 0 ?
                                <p className="text-gray-500 italic text-center py-10">
                                    {source === "mine" && !cosScript ? "Create a personal copy above to read it here." : "No script available yet."}
                                </p>
                                : groups.map((group, i) => (
                                    <div key={i} className="mb-6">
                                        <h4 className="text-amber-500 text-lg font-semibold tracking-wide mb-2">{group.title}</h4>
                                        {group.lines.map((line, j) => (
                                            <p key={j} className="text-gray-200 mb-2 leading-relaxed">{line.text}</p>
                                        ))}
                                    </div>
                                ))
                            }
                        </div>

                        <button onClick={handleNext}
                            className="w-full mt-5 p-3 rounded-full bg-amber-900 hover:bg-amber-950 text-sm font-semibold tracking-wide flex items-center justify-center gap-2">
                            {nextFloorCode ? `Next: ${floorNameDecoder(nextFloorCode)} Script` : "Back to Home"}
                            <FaArrowRight/>
                        </button>
                    </>
                }
            </div>
        </div>
    )
}
