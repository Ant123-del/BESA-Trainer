import { getAuth } from "firebase/auth"
import type { AccountType, SuccessResponse } from "./types"

const url = "http://127.0.0.1:8000/"

export type RosterEntry = {
    name: string
    tier: Extract<AccountType, "besa" | "besaLead">
}

//the BESA names not already claimed by an account here - public/unauthenticated since it's needed
//before an account (and thus an ID token) exists yet, from the /signup-besa picker.
export async function getBesaRoster(): Promise<RosterEntry[] | void> {
    try {
        const response = await fetch(url + "besa-roster")
        if (!response.ok) {
            console.error(response.status)
            return
        }
        const data = await response.json() as {success: boolean, roster: RosterEntry[]}
        return data.roster
    } catch (e) {
        console.error(e)
    }
}

export type BesaAccount = {
    uid: string
    email: string
    besaName?: string
    accountType: AccountType
    admin: boolean
}

//BESA Lead only - every besa/besaLead account here, for the admin-management page.
export async function getBesaAccounts(): Promise<BesaAccount[] | void> {
    try {
        const auth = getAuth()
        const user = auth.currentUser
        if (!user) {
            return console.error("not logged in")
        }

        const idToken = await user.getIdToken()
        const response = await fetch(url + "besa-accounts", {
            headers: {"Authorization": `Bearer ${idToken}`}
        })
        if (!response.ok) {
            console.error(response.status)
            return
        }
        const data = await response.json() as {success: boolean, accounts: BesaAccount[]}
        return data.accounts
    } catch (e) {
        console.error(e)
    }
}

//BESA Lead only - grants or revokes admin on another besa/besaLead account.
export async function setAdminStatus(targetUid: string, admin: boolean): Promise<SuccessResponse | void> {
    try {
        const auth = getAuth()
        const user = auth.currentUser
        if (!user) {
            return console.error("not logged in")
        }

        const idToken = await user.getIdToken()
        const response = await fetch(url + "set-admin-status", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${idToken}`
            },
            body: JSON.stringify({targetUid, admin})
        })
        if (!response.ok) {
            console.error(response.status)
        }
        return await response.json() as SuccessResponse
    } catch (e) {
        console.error(e)
    }
}

export async function CreateScript(floorId: string, scriptId: string, aiModel: "chirp" | "gemini" = "chirp") {
    try {
        const auth = getAuth()
        const user = auth.currentUser
        if (!user) {
            return console.error("not logged in")
        }

        const idToken = await user.getIdToken()
        const response = await fetch(url + "make-script", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${idToken}`
            },
            body: JSON.stringify({floorId, scriptId, aiModel})
        })
        if (!response.ok) {
            console.error(response.status)
        }
        return await response.json() as SuccessResponse
    } catch (e) {
        console.error(e)
    }
}

//chunked so large recordings don't blow the call stack on String.fromCharCode(...bytes)
async function blobToBase64(blob: Blob): Promise<string> {
    const bytes = new Uint8Array(await blob.arrayBuffer())
    let binary = ""
    const chunkSize = 0x8000
    for (let i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
    }
    return btoa(binary)
}

export async function transcribeAudio(audioBlob: Blob): Promise<string | void> {
    try {
        const auth = getAuth()
        const user = auth.currentUser
        if (!user) {
            return console.error("not logged in")
        }

        const idToken = await user.getIdToken()
        const audioBase64 = await blobToBase64(audioBlob)

        const response = await fetch(url + "transcribe-audio", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${idToken}`
            },
            body: JSON.stringify({audioBase64, mimeType: audioBlob.type || "audio/webm"})
        })

        if (!response.ok) {
            console.error(response.status)
            return
        }

        const data = await response.json() as {success: boolean, text: string}
        return data.text
    } catch (e) {
        console.error(e)
    }
}

//after markers change for a floor, every account's saved progress for it may reference sectionTimes that
//no longer match a current marker - prunes those stale entries across all accounts (admin-only, backend
//uses the Firebase Admin SDK since this touches every user's document, not just the caller's own).
export async function reconcileProgress(floorId: string, markerTimes: number[]) {
    try {
        const auth = getAuth()
        const user = auth.currentUser
        if (!user) {
            return console.error("not logged in")
        }

        const idToken = await user.getIdToken()
        const response = await fetch(url + "reconcile-progress", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${idToken}`
            },
            body: JSON.stringify({floorId, markerTimes})
        })
        if (!response.ok) {
            console.error(response.status)
        }
        return await response.json() as SuccessResponse
    } catch (e) {
        console.error(e)
    }
}

export async function getScript(scriptSrc: string): Promise<string | void> {
    try {
        const auth = getAuth()
        const user = auth.currentUser
        if (!user) {
            return console.error("not logged in")
        }

        const idToken = await user.getIdToken()
        const data = await fetch(scriptSrc, {
            method: "GET",
            headers: {
                "Authorization": `Bearer ${idToken}`
            },
        })
        if (data.ok) {
            return await data.text()
        }
        return ""
    } catch (e) {
        console.error(e)
        return ""
    }

}