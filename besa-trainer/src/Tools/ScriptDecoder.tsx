//This function will decode a vtt script into something it can understand
import { WebVTTParser } from "webvtt-parser"

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
