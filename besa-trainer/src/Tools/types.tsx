//"user" is a regular trainee account. "besa"/"besaLead" are claimed off the external BESA roster at
//signup (see /signup-besa) - besaLead additionally always has admin privileges, and is the only tier
//that can promote/demote other besa/besaLead accounts' admin status (see /manage-admins). "root" is the
//shared kiosk account - there's only ever one, and it's created by hand-editing Firestore directly
//(no signup flow) since it's a physical always-logged-in computer, not a person's account.
export type AccountType = "user" | "besa" | "besaLead" | "root"

export type User = {
    uid: string
    scriptPaths: CosScript[] // personalized scripts.
    admin: boolean
    progress: Progress[]// Have have id's of the progress
    accountType: AccountType
    besaName?: string // the roster name claimed at signup - only set when accountType isn't "user"
    studentId?: string // collected at BESA signup - the kiosk lookup key for clock in/out
    biWeeklyHours?: DayHours[] // current week (Sun-Sat) only - pruned on every clock-out
    lastCheckedIn?: Date | null // set by the root kiosk on clock-in, cleared on clock-out
    lastCheckedInActivities?: string[] // activities picked at clock-in - always set/cleared together with lastCheckedIn
}

//one calendar day's worked hours, recorded via the root kiosk's clock in/out flow.
export type DayHours = {
    hours: number // in 0.5 increments
    activities: string[] // activity type names worked that day
    date: Date // the calendar day this entry is for (clock-in date, not clock-out date)
    autoClockedOut?: boolean // true if this day's hours (or part of them) came from a forgotten-checkout auto-clockout, not a manual one
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