//This function will decode a vtt script into something it can understand
import { WebVTTParser } from "webvtt-parser"
import { type CosScript, type Marker } from "./types"
import { Loading } from "../Components/Edit"
import { getStorage, ref, uploadBytes } from "firebase/storage"
import { useState } from "react"

export type Line = {
    start: number //contains starting time (from string converted into number seconds)
    end: number // contains ending time (from string converted into number seconds)
    text: string //contains actual line text.
}

export function getVtt(text: string): Line[] {
    const parser = new WebVTTParser()
    const tree = parser.parse(text)

    return tree.cues.map((cue) => ({
        start: cue.startTime,
        end: cue.endTime,
        text: cue.text.trim(),
    }))
}

//finds the [lower, upper) marker times that bound the section currentTime is currently in.
//no markers at all, or no marker left after currentTime, results in an open (-Infinity/Infinity) bound.
export function getSectionBounds(sections: Marker[], currentTime: number): {lower: number, upper: number} {
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
export function pad(n: number, len = 2): string {
    return Math.max(0, Math.floor(n)).toString().padStart(len, "0")
}

export function formatVttTime(totalSeconds: number): string {
    const hours = Math.floor(totalSeconds / 3600)
    const minutes = Math.floor((totalSeconds % 3600) / 60)
    const seconds = Math.floor(totalSeconds % 60)
    const millis = Math.round((totalSeconds - Math.floor(totalSeconds)) * 1000)
    return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}.${pad(millis, 3)}`
}

export function linesToVtt(lines: Line[]): string {
    const sorted = [...lines].sort((a, b) => a.start - b.start)
    return "WEBVTT\n\n" + sorted.map(l => `${formatVttTime(l.start)} --> ${formatVttTime(l.end)}\n${l.text}\n`).join("\n")
}

//collapses every cue within the given section into a single new cue holding the retyped text, spanning
//from the earliest cue's start to the latest cue's end, and leaves every other section's cues untouched.
export function buildUpdatedScript(fullVttText: string, sections: Marker[], section: Marker, newSectionText: string): string {
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
export function computeMatchScore(userAnswer: string, correct: string): number {
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

//normalized equality just to give a rough auto-check hint - the actual grading is the user's own Hard/Good/Easy call.
function editDistance(a: string, b: string): number {
    const matrix = Array.from({ length: a.length + 1 }, () => 
        Array(b.length + 1).fill(0)
    );

    for (let i = 0; i <= a.length; i++) matrix[i][0] = i;
    for (let j = 0; j <= b.length; j++) matrix[0][j] = j;

    for (let i = 1; i <= a.length; i++) {
        for (let j = 1; j <= b.length; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        matrix[i][j] = Math.min(
            matrix[i - 1][j] + 1,      // deletion
            matrix[i][j - 1] + 1,      // insertion
            matrix[i - 1][j - 1] + cost // substitution
        );
        }
    }
    return matrix[a.length][b.length];
}

export function isCloseMatch(userAnswer: string, correct: string): boolean {
    console.log(userAnswer, correct)
    const normalize = (s: string) => 
        s.trim()
        .toLowerCase()
        .replace(/[^\w\s]/g, "")
        .replace(/\s+/g, " ");

    const cleanUser = normalize(userAnswer);
    const cleanCorrect = normalize(correct);

    if (!cleanUser) return false;

    // Allow 1 typo for short answers (<= 5 chars), 2 for medium, 3+ for long ones
    const maxAllowedDistance = Math.floor(cleanCorrect.length / 4) + 1;
    const distance = editDistance(cleanUser, cleanCorrect);

    return distance <= maxAllowedDistance;
}

export const BLANK_PLACEHOLDER = "_____"

//finds each blank's character range within the filled sentence, in left-to-right order, by using the
//literal (non-blanked) text segments in the blanked version as anchors between the blanks. Supports any
//number of blanks per sentence (a single blank is just the n=1 case).
export function locateBlankRanges(filling: {vttSectionSentenceBlank: string, vttSectionSentenceFilled: string}): {start: number, end: number}[] | null {
    const segments = filling.vttSectionSentenceBlank.split(BLANK_PLACEHOLDER)
    const filled = filling.vttSectionSentenceFilled

    if (segments.length === 1 || !filled.startsWith(segments[0])) {
        return null
    }

    const ranges: {start: number, end: number}[] = []
    let pos = segments[0].length
    for (let i = 1; i < segments.length; i++) {
        const seg = segments[i]
        const isLast = i === segments.length - 1
        const idx = (isLast && seg === "") ? filled.length : filled.indexOf(seg, pos)
        if (idx === -1 || idx < pos) {
            return null
        }
        ranges.push({start: pos, end: idx})
        pos = idx + seg.length
    }
    return ranges
}

//splits a filling into the literal text segments around its blanks (parts.length === answers.length + 1)
//plus the correct answer text for each blank, in order - used to render one input per blank inline.
export function getFillingBlanks(filling: {vttSectionSentenceBlank: string, vttSectionSentenceFilled: string}): {parts: string[], answers: string[]} {
    const parts = filling.vttSectionSentenceBlank.split(BLANK_PLACEHOLDER)
    const ranges = locateBlankRanges(filling)
    const answers = ranges ? ranges.map(r => filling.vttSectionSentenceFilled.slice(r.start, r.end)) : parts.slice(1).map(() => "")
    return {parts, answers}
}

//marks the part(s) of the full sentence that were blanked out.
export function renderCorrectAnswer(filling: {vttSectionSentenceBlank: string, vttSectionSentenceFilled: string}) {
    const filled = filling.vttSectionSentenceFilled
    const ranges = locateBlankRanges(filling)

    if (!ranges || ranges.length === 0) {
        return filled
    }

    const nodes: React.ReactNode[] = []
    let cursor = 0
    ranges.forEach((r, i) => {
        nodes.push(filled.slice(cursor, r.start))
        nodes.push(<mark key={i} className="bg-amber-400/70 text-black rounded px-0.5">{filled.slice(r.start, r.end)}</mark>)
        cursor = r.end
    })
    nodes.push(filled.slice(cursor))

    return <>{nodes}</>
}

//shared grading footer - reused by every practice type once an answer has been submitted.
export function GradingControls({onTryAgain, onConfidence, canExit, onExit}: {
    onTryAgain: () => void,
    onConfidence: (confidence: number) => void,
    canExit: boolean,
    onExit: () => void
}) {
    return (
        <div>
            <p className="text-gray-500 text-center">How did you feel about answering these questions? Choose one to move on!</p>
            <div className="flex justify-center gap-4 mt-4 w-full">
                <button onClick={() => onConfidence(0)} className="p-2.5 px-6 w-3/12 rounded-full bg-red-700 hover:bg-red-800">Hard</button>
                <button onClick={() => onConfidence(1)} className="p-2.5 px-6 w-3/12 rounded-full bg-yellow-600 hover:bg-yellow-700">Good</button>
                <button onClick={() => onConfidence(2)} className="p-2.5 px-6 w-3/12 rounded-full bg-green-700 hover:bg-green-800">Easy</button>
            </div>
            <div className="flex justify-center mt-4">
                <button onClick={onTryAgain} className="p-2.5 px-6 rounded-full border border-gray-400 hover:bg-gray-800">Try Again</button>
            </div>
            {canExit &&
                <div className="flex justify-center mt-4">
                    <button onClick={onExit} className="p-2.5 px-6 rounded-full border border-gray-400 hover:bg-gray-800">Exit</button>
                </div>
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
            <div className="flex justify-between items-start mb-5 gap-3">
                <div className="relative group inline-block">
                    <button onClick={handleSetAsScript} disabled={settingScript || scriptSet}
                        className={"text-sm px-4 py-2 rounded-full border shrink-0 " + (scriptSet ? "border-green-600 text-green-500 cursor-default" : "border-amber-500 text-amber-400 hover:bg-amber-500/10")}>
                        {scriptSet ? "Script Updated" : "Set as Script"}
                    </button>
                    <div className="absolute left-0 top-full mt-2 w-72 p-4 rounded-lg bg-black text-xs text-gray-200 opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none z-50">
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
            <div className="grid grid-cols-2 gap-4">
                <div>
                    <h4 className="text-sm text-gray-400 mb-2 text-center">Your Answer</h4>
                    <p className="p-3 rounded-lg bg-gray-700 whitespace-pre-wrap">{answer || <span className="text-gray-500 italic">No answer</span>}</p>
                </div>
                <div>
                    <h4 className="text-sm text-gray-400 mb-2 text-center">Script</h4>
                    <p className="p-3 rounded-lg bg-gray-700 whitespace-pre-wrap">{correctText}</p>
                </div>
            </div>
            <div className="mt-5">
                <GradingControls onTryAgain={handleTryAgain} onConfidence={onConfidence} canExit={canExit} onExit={onExit}/>
            </div>
            {settingScript && <Loading text="Updating script..."/>}
        </div>
    )
}