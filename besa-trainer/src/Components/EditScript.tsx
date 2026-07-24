import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Fill, Floor, Marker, Script, SuccessResponse } from "../Tools/types";
import { doc, getDoc, setDoc, updateDoc } from "firebase/firestore";
import { db } from "../Tools/firestore";
import { CreateScript, getScript } from "../Tools/Fetch";
import { getStorage, ref, uploadBytes } from "firebase/storage";
import { PulseLoader } from "react-spinners";
import { getVtt, type Line } from "../Tools/ScriptDecoder";

const BLANK_PLACEHOLDER = "_____"

type Filling = Fill["fillings"][number]

//finds where each vtt cue's sentence lands within the raw textarea text, in appearance order.
function locateLines(text: string, lines: Line[]): {line: Line, start: number, end: number}[] {
    let searchFrom = 0
    const located: {line: Line, start: number, end: number}[] = []
    for (const line of lines) {
        const trimmed = line.text.trim()
        if (!trimmed) {
            continue
        }
        const idx = text.indexOf(trimmed, searchFrom)
        if (idx === -1) {
            continue
        }
        located.push({line, start: idx, end: idx + trimmed.length})
        searchFrom = idx + trimmed.length
    }
    return located
}

//the highlighted word(s) are whatever differs between the filled sentence and its blanked version.
function locateHighlight(text: string, filling: Filling): {start: number, end: number} | null {
    const idx = text.indexOf(filling.vttSectionSentenceFilled)
    if (idx === -1) {
        return null
    }

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

    return {start: idx + prefixLen, end: idx + (filled.length - suffixLen)}
}

//the section a fill belongs to is the next marker after the sentence starts - that's when the
//quiz for it will actually show up. no upcoming marker (or no markers at all) means it can never be tested.
function getFillSection(sentenceStart: number, markers: Marker[]): Marker | undefined {
    if (markers.length === 0) {
        return undefined
    }
    return [...markers].sort((a, b) => a.markTime - b.markTime).find(m => m.markTime > sentenceStart)
}

export default function EditScript ({selected} : {selected:Floor}) {
    const [script, setScript] = useState<Script | null>(null)
    const [initialScript, setInitialScript] = useState("")
    const [textArea, setTextArea] = useState("")
    const [aiLoading, setAILoading] = useState(false)
    const [changeLoading, setChangeLoading] = useState(false)

    //fill (highlighter) editor mode
    const [fill, setFill] = useState<Fill | null>(null)
    const [fillMode, setFillMode] = useState(false)
    const [fillMessage, setFillMessage] = useState("")
    const textAreaRef = useRef<HTMLTextAreaElement>(null)
    const highlightRef = useRef<HTMLDivElement>(null)
    const measureRef = useRef<HTMLDivElement>(null)
    const [scrollTop, setScrollTop] = useState(0)
    const [sectionDividers, setSectionDividers] = useState<{marker: Marker, top: number}[]>([])

    //Checking if there is already a script. If there is already a script, there wont be a need to generate
    useEffect(() => {
        const scriptRef = doc(db, "training_data", "data_root", "scripts", selected.defScriptId)
        getDoc(scriptRef).then((data) => {
            if (data.exists()) {
                //TODO: Develop after inserting file to see what data we are using
                const e = data.data() as Script
                setScript(e)
                getScript(e.src).then(text => {
                    setInitialScript(text || "")
                    setTextArea(text || "")
                })
            } else {
                setScript(null)
            }
        })
    }, [selected])

    //loading up any fill (blank) questions already made for this draft
    useEffect(() => {
        const fillRef = doc(db, "training_data", "data_root", "fills", selected.id)
        getDoc(fillRef).then((data) => {
            setFill(data.exists() ? data.data() as Fill : null)
        })
    }, [selected])

    //figures out where each floor marker falls in the raw text - right on the blank line that sits
    //above the next cue's timestamp - then measures that offset's pixel position with a hidden mirror
    //element so a divider can be drawn there.
    useLayoutEffect(() => {
        const mirror = measureRef.current
        if (!mirror || selected.markers.length === 0) {
            setSectionDividers([])
            return
        }

        const located = locateLines(textArea, getVtt(textArea))

        const positions = selected.markers.map(marker => {
            const before = located.filter(l => l.line.end <= marker.markTime)
            let offset = 0
            if (before.length > 0) {
                //drop onto the start of the next raw line, off of the previous sentence's own line
                const afterSentence = before[before.length - 1].end
                const nextNewline = textArea.indexOf("\n", afterSentence)
                offset = nextNewline === -1 ? textArea.length : nextNewline + 1
            }

            mirror.textContent = ""
            mirror.appendChild(document.createTextNode(textArea.slice(0, offset)))
            const markerSpan = document.createElement("span")
            markerSpan.textContent = "\u200b"
            mirror.appendChild(markerSpan)
            mirror.appendChild(document.createTextNode(textArea.slice(offset)))

            return {marker, top: markerSpan.offsetTop}
        })

        setSectionDividers(positions)
    }, [textArea, selected.markers])

    async function handleGenerate() {
        if (script) {
            setAILoading(true)
            const response: SuccessResponse | void = await CreateScript(selected.id, script?.id)
            if (response) {
                const newText = await getScript(script.src) || ""
                setTextArea(newText)
                setInitialScript(newText)
            }
            setAILoading(false)
        }

    }
    //false if no change has been made

    async function handleChanges() {
        setChangeLoading(true)
        try {
            const storage = getStorage()
            const scriptRef = ref(storage, "scripts/" + script?.id)
            const scriptBlob = new Blob([textArea], {type: "text/vtt"})
            await uploadBytes(scriptRef, scriptBlob)
            setInitialScript(textArea)
        } catch (e) {
            console.error(e)
        } finally {
            setChangeLoading(false)
        }
    }

    //creates a fill entry out of the current selection, or deletes one if the caret lands on an existing highlight.
    async function handleTextAreaMouseUp() {
        if (!fillMode || !textAreaRef.current) {
            return
        }

        const {selectionStart, selectionEnd} = textAreaRef.current
        setFillMessage("")

        if (selectionStart === selectionEnd) {
            const hit = fill?.fillings.find(filling => {
                const range = locateHighlight(textArea, filling)
                return range && selectionStart >= range.start && selectionStart < range.end
            })
            if (hit) {
                await handleDeleteFill(hit)
            }
            return
        }

        await handleCreateFill(selectionStart, selectionEnd)
    }

    async function handleCreateFill(selStart: number, selEnd: number) {
        const located = locateLines(textArea, getVtt(textArea))
        const target = located.find(l => selStart >= l.start && selEnd <= l.end)
        if (!target) {
            setFillMessage("Please highlight text within a single sentence.")
            return
        }

        const section = getFillSection(target.line.start, selected.markers)
        if (!section) {
            setFillMessage("This sentence has no upcoming section, so it can't be tested and won't be saved.")
            return
        }

        const sentence = target.line.text.trim()
        const relStart = selStart - target.start
        const relEnd = selEnd - target.start
        const newFilling: Filling = {
            vttSectionSentenceFilled: sentence,
            vttSectionSentenceBlank: sentence.slice(0, relStart) + BLANK_PLACEHOLDER + sentence.slice(relEnd),
            section
        }

        const fillRef = doc(db, "training_data", "data_root", "fills", selected.id)
        if (fill) {
            const fillings = [...fill.fillings, newFilling]
            await updateDoc(fillRef, {fillings})
            setFill({...fill, fillings})
        } else {
            const newFill: Fill = {floorId: selected.id, fillings: [newFilling]}
            await setDoc(fillRef, newFill)
            setFill(newFill)
        }
    }

    async function handleDeleteFill(target: Filling) {
        if (!fill) {
            return
        }
        const fillings = fill.fillings.filter(f => f !== target)
        const fillRef = doc(db, "training_data", "data_root", "fills", selected.id)
        await updateDoc(fillRef, {fillings})
        setFill({...fill, fillings})
    }

    function handleTextAreaScroll() {
        if (highlightRef.current && textAreaRef.current) {
            highlightRef.current.scrollTop = textAreaRef.current.scrollTop
            highlightRef.current.scrollLeft = textAreaRef.current.scrollLeft
        }
        if (textAreaRef.current) {
            setScrollTop(textAreaRef.current.scrollTop)
        }
    }

    //renders the raw text with existing fill highlights marked, so it lines up behind the (transparent) textarea.
    function renderHighlighted() {
        if (!fill) {
            return textArea
        }

        const ranges = fill.fillings
            .map(f => locateHighlight(textArea, f))
            .filter((r): r is {start: number, end: number} => r !== null)
            .sort((a, b) => a.start - b.start)

        const nodes: React.ReactNode[] = []
        let cursor = 0
        ranges.forEach((r, i) => {
            if (r.start < cursor) {
                return
            }
            nodes.push(textArea.slice(cursor, r.start))
            nodes.push(<mark key={i} className="bg-amber-400/60 text-transparent">{textArea.slice(r.start, r.end)}</mark>)
            cursor = r.end
        })
        nodes.push(textArea.slice(cursor))

        return nodes
    }

    const changed = initialScript == textArea

    return (
        <div className="w-5/6 mx-auto">
            <h2 className="tracking-wide text-xl text-center mt-5">Editing Script</h2>
            <div className="p-3 my-3 w-full mx-auto rounded-2xl bg-gray-500">
                <div className="flex justify-between items-center">
                {script == null ? <span>It appears a script has not been made yet: </span> : <span>Edit Script: </span>}
                <div className="flex items-center gap-2">
                    <button
                        className={"p-2 rounded-full shadow-lg" + (fillMode ? " bg-amber-600 hover:bg-amber-700" : " bg-gray-700 hover:bg-gray-800")}
                        onClick={() => {
                            setFillMode(!fillMode)
                            setFillMessage("")
                        }}
                    >
                        {fillMode ? "Highlighter: On" : "Highlighter: Off"}
                    </button>
                    <button disabled={setScript == null} className="p-2 bg-blue-800 rounded-full shadow-lg hover:bg-blue-900" onClick={handleGenerate}>
                        Generate Script with AI
                    </button>
                    <span className="block text-center text-sm">Warning! Will reset file</span>
                </div>
                </div>
                {fillMode &&
                    <p className="text-sm text-gray-200 mt-2">
                        Highlight a piece of a sentence to turn it into a fill-in-the-blank question. Click on an existing highlight to remove it.
                        {fillMessage && <span className="block text-amber-300">{fillMessage}</span>}
                    </p>
                }
                <div className="relative w-full mt-3">
                    <div
                        ref={highlightRef}
                        aria-hidden="true"
                        className={"absolute inset-0 w-full h-64 rounded-2xl p-3 overflow-auto whitespace-pre-wrap break-words pointer-events-none text-transparent" + (fillMode ? "" : " invisible")}
                    >
                        {renderHighlighted()}
                    </div>
                    <textarea ref={textAreaRef}
                    className={"w-full h-64 rounded-2xl p-3 relative z-10 whitespace-pre-wrap break-words" + (script ? "" : " animate-pulse") + (fillMode ? " bg-transparent text-white caret-white" : " bg-gray-800")}
                    placeholder="Script goes here..." value={textArea}
                    onChange={({target}) => setTextArea(target.value)}
                    onMouseUp={handleTextAreaMouseUp}
                    onScroll={handleTextAreaScroll}>

                    </textarea>
                    {/* off-screen twin of the textarea's text, used only to measure where each marker's pixel position lands */}
                    <div
                        ref={measureRef}
                        aria-hidden="true"
                        className="absolute top-0 left-0 w-full p-3 whitespace-pre-wrap break-words invisible pointer-events-none"
                    />
                    {/* section-boundary dividers - shown in both highlighter and regular mode */}
                    <div className="absolute inset-0 w-full h-64 overflow-hidden pointer-events-none rounded-2xl z-20">
                        {sectionDividers.map(({marker, top}, i) => (
                            <div key={i} className="absolute left-0 right-0 flex items-center gap-2 px-2" style={{top: top - scrollTop}}>
                                <span className="flex-1 border-t-2 border-amber-400"/>
                                <span className="text-amber-400 text-xs font-bold tracking-wide whitespace-nowrap bg-gray-900/80 px-2 py-0.5 rounded-full">New Section: {marker.markerName}</span>
                                <span className="flex-1 border-t-2 border-amber-400"/>
                            </div>
                        ))}
                    </div>
                </div>
                <button className={"p-2 w-full bg-blue-800 mt-2 rounded-full hover:bg-blue-900" + (changed ? " brightness-50" : "")}
                    disabled={changed}
                    onClick={handleChanges}
                >Save Changes To Script</button>
            </div>
            {aiLoading && <Loading text="Script is forming..."/>}
            {changeLoading && <Loading text="Changes are being made..."/>}
        </div>
    )
}


function Loading({text}:{text:string}) {
    return (
        <div className="z-[100] fixed w-screen h-screen bg-gray-600/50 top-0 right-0 flex justify-center items-center">
            <div>
                <h2 className="text-amber-600 text-3xl text-center mb-3">{text}</h2>
                <PulseLoader color="#F59E0B" size={30} className="m-auto block text-center"/>
            </div>
        </div>
    )
}
