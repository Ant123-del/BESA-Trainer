export type User = {
    uid: string
    scriptPaths: CosScript[] // personalized scripts.
    admin: boolean
    progress: Progress[]// Have have id's of the progress
}

//will be used to keep track of personalized vll scripts
//each person when interacting with the interface will get a individualized copy of vll, they can share their script if they want with others.
export type CosScript = {
    id: string
    path: string //path towards .vtt file
    src: string //link to .vtt file
    floorCode: FloorCode
    isPublic: boolean
    scriptDeviationId: string
}

//will be used to keep track of default vll scripts
export type Script = {
    id: string,
    draftId: string,
    floorCode: FloorCode
    path: string // firebase storage path scripts/name.vll
    src: string
}

export type Fill = {
    floorId: string, //associated with draft.
    fillings: {vttSectionSentenceBlank: string, vttSectionSentenceFilled: string, section: Marker}[]
}

//will need to see usecase later down the road 
export type Marker = {
    markerName: string // may match with script
    markTime: number
}

//contains address of drafts, which one is the default, and so on.
export type Floor = {
    id: string
    path: string
    floorCode: FloorCode//usually two character
    current: boolean // there will only be one per floor. 
    draftName: string //path to video within storage
    src: string //url to video
    markers: Marker[] // Where each section starts according to the video
    defScriptId: string // lead to Script belonging to draft.
}

// will initiate when user loads training
export type Progress = {
    floorId: string, // associated with the floor done
    practiceType: PracticeTypes,
    lastUpdated: Date,
    progress: {confidence: number, sectionTime: number}[] //associated with every new progress. Will be saved every time pass a new section. 
    //confidence is a 0-2 so 0 is low confidence, 1 is learning, 2 is mastered. 
}

export type PracticeTypes = "fill" | "text" | "microphone"

export type SuccessResponse = {
    success: boolean,
    floorId: string,
    messsage: string
}

export type FloorCode = "f1" | "f2" | "f3" | "b" | "e" | ""