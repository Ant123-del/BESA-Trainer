//Unlike the video Simulator's Fill mode (which needs hand-authored blanks per section, stored in the
//Fill collection), question-set answers don't have an editor for authoring blanks - so this generates
//them procedurally from the answer text: every 3rd "significant" (4+ letter) word gets blanked. It's
//deterministic (same answer text always blanks the same words), so re-visiting a question in fill mode
//is consistent without needing to store anything extra per question.

export type GeneratedBlanks = {
    parts: string[] //parts.length === answers.length + 1, same shape ScriptDecoder's getFillingBlanks uses
    answers: string[]
}

export function generateFillBlanks(answer: string): GeneratedBlanks {
    //split on whitespace while keeping the whitespace itself as its own token, so blanking a word never
    //disturbs spacing when the parts get rejoined around inline inputs.
    const tokens = answer.split(/(\s+)/)
    const significantIndices = tokens
        .map((token, i) => ({token, i}))
        .filter(({token}) => /^[A-Za-z]{4,}$/.test(token))
        .map(({i}) => i)

    const blankIndices = new Set(significantIndices.filter((_, idx) => idx % 3 === 0))

    if (blankIndices.size === 0) {
        return {parts: [answer], answers: []}
    }

    const parts: string[] = []
    const answers: string[] = []
    let currentPart = ""
    tokens.forEach((token, i) => {
        if (blankIndices.has(i)) {
            parts.push(currentPart)
            currentPart = ""
            answers.push(token)
        } else {
            currentPart += token
        }
    })
    parts.push(currentPart)

    return {parts, answers}
}
