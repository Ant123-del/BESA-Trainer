import { useEffect, useState, type FormEvent, type JSX } from "react"
import { MoonLoader } from "react-spinners"
import { getRootAdminStatus, rootAdminLogin, setupRootAdminPasscode } from "../Tools/Fetch"

const MIN_PASSCODE_LENGTH = 6

//the root kiosk stays signed in all day, so its Profile (account deletion, everyone's hours) sits behind
//a second "admin login" - the root owner's passcode. A root account with no passcode yet (brand new, or
//recreated after the old one was deleted) gets a one-time setup form instead.
export default function RootAdminLogin({onUnlocked, notice}: {onUnlocked: () => void, notice?: string}): JSX.Element {
    const [passcodeSet, setPasscodeSet] = useState<boolean | null>(null)
    const [passcode, setPasscode] = useState("")
    const [confirm, setConfirm] = useState("")
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState("")

    useEffect(() => {
        getRootAdminStatus().then(result => {
            if (result.success) {
                setPasscodeSet(result.passcodeSet)
            } else {
                setError(result.detail)
            }
        })
    }, [])

    const settingUp = passcodeSet === false
    const canSubmit = settingUp
        ? passcode.length >= MIN_PASSCODE_LENGTH && passcode === confirm
        : passcode.length > 0

    async function handleSubmit(e: FormEvent) {
        e.preventDefault()
        if (!canSubmit || busy) return
        setBusy(true)
        setError("")
        const result = settingUp ? await setupRootAdminPasscode(passcode) : await rootAdminLogin(passcode)
        setBusy(false)
        if (result.success) {
            onUnlocked()
            return
        }
        setError(result.detail)
        setPasscode("")
        setConfirm("")
        //someone else finished setup first - fall back to the normal login form
        if (result.status === 409) setPasscodeSet(true)
    }

    if (passcodeSet === null) {
        return (
            <section className="bg-gray-800 rounded-2xl p-6 flex flex-col items-center gap-3">
                {error ? <p className="text-red-400 text-sm">{error}</p> : <MoonLoader color="white" size={24}/>}
            </section>
        )
    }

    return (
        <section className="bg-gray-800 rounded-2xl p-6 max-w-md w-full mx-auto">
            <h2 className="text-2xl tracking-wide mb-2 text-center">{settingUp ? "Set Up Admin Passcode" : "Admin Login"}</h2>
            <p className="text-sm text-gray-400 text-center mb-5">
                {settingUp
                    ? "This root account doesn't have an admin passcode yet. Choose one only the BESA root owner will know - it's needed to manage this account and everyone's hours."
                    : "Enter the BESA root owner's admin passcode to manage this account and everyone's hours."}
            </p>
            {notice && <p className="text-sm text-yellow-400 text-center mb-3">{notice}</p>}
            <form onSubmit={(e) => void handleSubmit(e)} className="flex flex-col gap-3">
                <input
                    type="password"
                    autoComplete={settingUp ? "new-password" : "current-password"}
                    value={passcode}
                    onChange={(e) => setPasscode(e.target.value)}
                    disabled={busy}
                    placeholder={settingUp ? `New passcode (${MIN_PASSCODE_LENGTH}+ characters)` : "Passcode"}
                    className="w-full p-3 rounded-xl bg-gray-700 text-white"
                    autoFocus
                />
                {settingUp &&
                    <input
                        type="password"
                        autoComplete="new-password"
                        value={confirm}
                        onChange={(e) => setConfirm(e.target.value)}
                        disabled={busy}
                        placeholder="Confirm passcode"
                        className="w-full p-3 rounded-xl bg-gray-700 text-white"
                    />
                }
                {settingUp && confirm.length > 0 && passcode !== confirm &&
                    <p className="text-red-400 text-sm text-center">Passcodes don't match.</p>
                }
                {error && <p className="text-red-400 text-sm text-center">{error}</p>}
                <button type="submit" disabled={busy || !canSubmit}
                    className="w-full py-3 rounded-full bg-blue-800 hover:bg-blue-900 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2">
                    {busy && <MoonLoader color="white" size={16}/>}
                    {settingUp ? "Save Passcode" : "Unlock"}
                </button>
            </form>
        </section>
    )
}
