import { useEffect, useState, type JSX } from "react"
import { FaTimes } from "react-icons/fa"
import { getWorkIdentity, setWorkIdentity } from "../Tools/Fetch"

//commits and Google edits are matched to members by email, then name. This covers any account that wouldn't match.
export default function WorkAccounts(): JSX.Element {
    const [emails, setEmails] = useState("")
    const [username, setUsername] = useState("")
    const [accounts, setAccounts] = useState<string[]>([])
    const [busy, setBusy] = useState(false)
    const [message, setMessage] = useState<{text: string, error: boolean} | null>(null)

    useEffect(() => {
        getWorkIdentity().then(result => {
            if (result.success) {
                setEmails(result.emails.join(", "))
                setUsername(result.githubUsername)
                setAccounts(result.accounts)
            }
        })
    }, [])

    async function handleSave() {
        setBusy(true)
        setMessage(null)
        const result = await setWorkIdentity(emails.split(/[\s,]+/).filter(Boolean), username, accounts)
        setBusy(false)
        setMessage(result.success ? {text: "Saved.", error: false} : {text: result.detail, error: true})
    }

    return (
        <section className="bg-gray-800 rounded-2xl p-3 sm:p-6">
            <h2 className="text-2xl tracking-wide mb-1">Work Accounts</h2>
            <p className="text-sm text-gray-400 mb-4">
                So your commits and Google edits get counted as yours. Add any email your git commits or Google account use that isn't the one you sign in with.
            </p>
            <label htmlFor="work-emails" className="block text-sm mb-1">Other emails</label>
            <input id="work-emails" value={emails} onChange={(e) => setEmails(e.target.value)} placeholder="me@ucsc.edu, me@gmail.com"
                className="w-full p-2.5 rounded-lg bg-gray-900 border border-gray-600 mb-3"/>
            <label htmlFor="work-github" className="block text-sm mb-1">GitHub username</label>
            <input id="work-github" value={username} onChange={(e) => setUsername(e.target.value)}
                className="w-full p-2.5 rounded-lg bg-gray-900 border border-gray-600 mb-3"/>
            {accounts.length > 0 &&
                <div className="mb-3">
                    <p className="text-sm mb-1">Remembered from clock-out</p>
                    <ul className="flex flex-wrap gap-2">
                        {accounts.map(account => (
                            <li key={account} className="flex items-center gap-2 rounded-full bg-gray-900 border border-gray-600 pl-3 pr-1 py-1 text-sm">
                                <span className="break-all">{account}</span>
                                <button type="button" aria-label={`Forget ${account}`} onClick={() => setAccounts(accounts.filter(a => a !== account))}
                                    className="p-1 text-gray-400 hover:text-red-400">
                                    <FaTimes className="w-3 h-3"/>
                                </button>
                            </li>
                        ))}
                    </ul>
                    <p className="text-xs text-gray-400 mt-1">Picked the wrong one? Remove it and press Save.</p>
                </div>
            }
            {message && <p className={"text-sm mb-2 " + (message.error ? "text-red-400" : "text-green-400")}>{message.text}</p>}
            <button onClick={() => void handleSave()} disabled={busy} className="px-5 py-2 rounded-full bg-blue-800 hover:bg-blue-900 text-sm disabled:opacity-40">
                Save
            </button>
        </section>
    )
}
