export type User = {
    uid: string
    sections: string[] // Will have id's of the sections
    admin: boolean
    progress: string[] // Have have id's of the progress
}

export type Script = {
    id: string
    prompt: string // may match with script
    script: string
    isPublic: boolean
    ownerId: string
    markers?: string[]
}

export type Section = {
    id: string
    prompt: string // may match with script
    defaultScript: string // id of script
    scripts: string[] // all script id's relating to this section
    isQuestion: boolean
}

export type Floor = {
    id: string
    name: FloorCode//usually two character
    current: boolean // there will only be one per floor. 
    path: string //path to video within storage
    src: string //url to video
    markers: string[] // Where each section starts according to the video
    sections: string[] //section ids
}

export type Progress = {
    id: string // same id as section
    uid: string // progress that belongs to user.
    progress: number // will be one to three (one means don't get it, two means almost there, three means confident)
}

export type FloorCode = "f1" | "f2" | "f3" | "b" | "e" | ""