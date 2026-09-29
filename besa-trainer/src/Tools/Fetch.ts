import { getAuth } from "firebase/auth"
import type { AccountType, SuccessResponse } from "./types"

//besa-api's base URL - defaults to local dev; set VITE_API_URL in the deployment environment to point
//at wherever besa-api is actually hosted (e.g. a Firebase Functions URL) once deployed.
const url = import.meta.env.VITE_API_URL || "http://127.0.0.1:8000/"

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

export type BesaSignupInfo = {besaName: string, studentId: string}

//creates the signed-in user's Firestore user doc - the backend is the only thing allowed to (see
//firestore.rules), and it decides the tier/admin flag from the roster itself. A no-op if the doc exists.
export async function createAccount(besa?: BesaSignupInfo): Promise<{success: true, created: boolean} | {success: false, detail: string}> {
    try {
        const user = getAuth().currentUser
        if (!user) {
            return {success: false, detail: "Not logged in."}
        }

        const idToken = await user.getIdToken()
        const response = await fetch(url + "create-account", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${idToken}`
            },
            body: JSON.stringify(besa ?? {})
        })
        const data = await response.json().catch(() => ({}))
        if (!response.ok) {
            return {success: false, detail: typeof data.detail === "string" ? data.detail : `Request failed (${response.status})`}
        }
        return data
    } catch (e) {
        console.error(e)
        return {success: false, detail: "Couldn't reach the server."}
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

//---- Root kiosk: clock in/out, current sessions, hours, activity types ----

//root only - looks up the besa/besaLead account with this studentId and starts their session.
export async function clockIn(studentId: string, activities: string[]): Promise<{success: boolean, besaName?: string, clockedInAt?: string, detail?: string} | void> {
    try {
        const auth = getAuth()
        const user = auth.currentUser
        if (!user) {
            return console.error("not logged in")
        }

        const idToken = await user.getIdToken()
        const response = await fetch(url + "clock-in", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${idToken}`
            },
            body: JSON.stringify({studentId, activities})
        })
        const data = await response.json() as {success: boolean, besaName?: string, clockedInAt?: string, detail?: string}
        if (!response.ok) {
            return {success: false, detail: data.detail || `Request failed (${response.status})`}
        }
        return data
    } catch (e) {
        console.error(e)
    }
}

//root only - closes the besa/besaLead account's session with this studentId and records the hours.
export async function clockOut(studentId: string): Promise<{success: boolean, besaName?: string, hoursThisSession?: number, detail?: string} | void> {
    try {
        const auth = getAuth()
        const user = auth.currentUser
        if (!user) {
            return console.error("not logged in")
        }

        const idToken = await user.getIdToken()
        const response = await fetch(url + "clock-out", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${idToken}`
            },
            body: JSON.stringify({studentId})
        })
        const data = await response.json() as {success: boolean, besaName?: string, hoursThisSession?: number, detail?: string}
        if (!response.ok) {
            return {success: false, detail: data.detail || `Request failed (${response.status})`}
        }
        return data
    } catch (e) {
        console.error(e)
    }
}

export type KioskSession = {
    uid: string
    besaName?: string
    activities: string[]
    clockedInAt: string
}

//root only - everyone currently clocked in, for the Clock Out panel's "Current Sessions" list.
export async function getCurrentSessions(): Promise<KioskSession[] | void> {
    try {
        const auth = getAuth()
        const user = auth.currentUser
        if (!user) {
            return console.error("not logged in")
        }

        const idToken = await user.getIdToken()
        const response = await fetch(url + "current-sessions", {
            headers: {"Authorization": `Bearer ${idToken}`}
        })
        if (!response.ok) {
            console.error(response.status)
            return
        }
        const data = await response.json() as {success: boolean, sessions: KioskSession[]}
        return data.sessions
    } catch (e) {
        console.error(e)
    }
}

export type MemberHours = {
    uid: string
    besaName?: string
    studentId?: string
    hours: {date: string, hours: number, activities: string[], autoClockedOut?: boolean}[]
}

//---- Root admin login: passcode-gated session on top of the signed-in root kiosk account ----

//the short-lived session token /root-admin/login hands back - kept in sessionStorage (not localStorage)
//so it dies with the tab, and dropped client-side once expired so the UI re-prompts for the passcode.
const ROOT_ADMIN_TOKEN_KEY = "rootAdminSession"

export function getRootAdminToken(): string | null {
    try {
        const raw = sessionStorage.getItem(ROOT_ADMIN_TOKEN_KEY)
        if (!raw) return null
        const {token, expiresAt} = JSON.parse(raw) as {token: string, expiresAt: string}
        if (new Date(expiresAt) <= new Date()) {
            sessionStorage.removeItem(ROOT_ADMIN_TOKEN_KEY)
            return null
        }
        return token
    } catch {
        return null
    }
}

export function clearRootAdminToken() {
    try {
        sessionStorage.removeItem(ROOT_ADMIN_TOKEN_KEY)
    } catch { /* storage unavailable - nothing to clear */ }
}

function saveRootAdminToken(token: string, expiresAt: string) {
    try {
        sessionStorage.setItem(ROOT_ADMIN_TOKEN_KEY, JSON.stringify({token, expiresAt}))
    } catch { /* storage unavailable - session just won't survive a reload */ }
}

//shared by every root-admin call - attaches both the Firebase ID token and the admin session token,
//and turns any non-2xx into {success: false, detail} (a 403 also means the session expired server-side).
async function rootAdminRequest<T>(path: string, init: {method?: string, body?: unknown} = {}): Promise<(T & {success: true}) | {success: false, detail: string, status?: number}> {
    try {
        const user = getAuth().currentUser
        if (!user) {
            return {success: false, detail: "Not logged in."}
        }

        const idToken = await user.getIdToken()
        const headers: Record<string, string> = {"Authorization": `Bearer ${idToken}`}
        const adminToken = getRootAdminToken()
        if (adminToken) headers["X-Root-Admin-Token"] = adminToken
        if (init.body !== undefined) headers["Content-Type"] = "application/json"

        const response = await fetch(url + path, {
            method: init.method || "GET",
            headers,
            body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
        })
        const data = await response.json().catch(() => ({}))
        if (!response.ok) {
            if (response.status === 403) clearRootAdminToken()
            const detail = typeof data.detail === "string" ? data.detail : `Request failed (${response.status})`
            return {success: false, detail, status: response.status}
        }
        if (data.adminToken && data.expiresAt) saveRootAdminToken(data.adminToken, data.expiresAt)
        return data
    } catch (e) {
        console.error(e)
        return {success: false, detail: "Couldn't reach the server."}
    }
}

//root only - whether this root account has set up its admin passcode yet.
export function getRootAdminStatus() {
    return rootAdminRequest<{passcodeSet: boolean}>("root-admin/status")
}

//root only - first-time passcode setup (fails if one already exists); starts an admin session.
export function setupRootAdminPasscode(passcode: string) {
    return rootAdminRequest<{adminToken: string, expiresAt: string}>("root-admin/setup", {method: "POST", body: {passcode}})
}

//root only - checks the passcode and starts an admin session.
export function rootAdminLogin(passcode: string) {
    return rootAdminRequest<{adminToken: string, expiresAt: string}>("root-admin/login", {method: "POST", body: {passcode}})
}

//root only - ends the admin session on both sides.
export async function rootAdminLogout() {
    await rootAdminRequest("root-admin/logout", {method: "POST"})
    clearRootAdminToken()
}

//root admin only - replaces the passcode (the current admin session proves they knew the old one).
export function changeRootAdminPasscode(newPasscode: string) {
    return rootAdminRequest<{adminToken: string, expiresAt: string}>("root-admin/change", {method: "POST", body: {newPasscode}})
}

//root admin only - deletes the root account (and its passcode) server-side.
export async function deleteRootAccount() {
    const result = await rootAdminRequest("root-admin/delete-account", {method: "POST"})
    if (result.success) clearRootAdminToken()
    return result
}

//root admin only - overwrites one day's hours for a member (0 hours + no activities clears the day).
export function setMemberDayHours(targetUid: string, date: string, hours: number, activities: string[]) {
    return rootAdminRequest<{hours: MemberHours["hours"]}>("root-admin/set-day-hours", {method: "POST", body: {targetUid, date, hours, activities}})
}

//root admin only - every besa/besaLead member's current-week hours, for root's Profile view.
export function getAllHours() {
    return rootAdminRequest<{members: MemberHours[]}>("all-hours")
}

//any signed-in account - the shared list of activity names the kiosk's Clock In chips are built from.
export async function getActivityTypes(): Promise<string[] | void> {
    try {
        const auth = getAuth()
        const user = auth.currentUser
        if (!user) {
            return console.error("not logged in")
        }

        const idToken = await user.getIdToken()
        const response = await fetch(url + "activity-types", {
            headers: {"Authorization": `Bearer ${idToken}`}
        })
        if (!response.ok) {
            console.error(response.status)
            return
        }
        const data = await response.json() as {success: boolean, activityTypes: string[]}
        return data.activityTypes
    } catch (e) {
        console.error(e)
    }
}

//root only - adds a new activity type to the shared list, returning the updated list.
export async function addActivityType(name: string): Promise<string[] | void> {
    try {
        const auth = getAuth()
        const user = auth.currentUser
        if (!user) {
            return console.error("not logged in")
        }

        const idToken = await user.getIdToken()
        const response = await fetch(url + "activity-types/add", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${idToken}`
            },
            body: JSON.stringify({name})
        })
        if (!response.ok) {
            console.error(response.status)
            return
        }
        const data = await response.json() as {success: boolean, activityTypes: string[]}
        return data.activityTypes
    } catch (e) {
        console.error(e)
    }
}

//root only - removes an activity type from the shared list, returning the updated list.
export async function removeActivityType(name: string): Promise<string[] | void> {
    try {
        const auth = getAuth()
        const user = auth.currentUser
        if (!user) {
            return console.error("not logged in")
        }

        const idToken = await user.getIdToken()
        const response = await fetch(url + "activity-types/remove", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${idToken}`
            },
            body: JSON.stringify({name})
        })
        if (!response.ok) {
            console.error(response.status)
            return
        }
        const data = await response.json() as {success: boolean, activityTypes: string[]}
        return data.activityTypes
    } catch (e) {
        console.error(e)
    }
}

//any signed-in besa/besaLead account - checks whether THIS account forgot to clock out and it's now
//past their 8pm auto-clockout window, closing the session (crediting hours via their besa-app office
//hours schedule) if so. Called from Profile.tsx on load so a member sees an up-to-date week even if
//nobody ever hit the root kiosk's Current Sessions/all-hours views after they forgot to clock out.
export async function checkAutoClockout(): Promise<{success: boolean, biWeeklyHours: {date: string, hours: number, activities: string[], autoClockedOut?: boolean}[]} | void> {
    try {
        const auth = getAuth()
        const user = auth.currentUser
        if (!user) {
            return console.error("not logged in")
        }

        const idToken = await user.getIdToken()
        const response = await fetch(url + "check-auto-clockout", {
            method: "POST",
            headers: {"Authorization": `Bearer ${idToken}`}
        })
        if (!response.ok) {
            console.error(response.status)
            return
        }
        return await response.json() as {success: boolean, biWeeklyHours: {date: string, hours: number, activities: string[], autoClockedOut?: boolean}[]}
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