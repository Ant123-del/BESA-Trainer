import { useEffect, useState } from "react"
import { MoonLoader } from "react-spinners"
import Header from "../Components/Header"
import { getBesaAccounts, setAdminStatus, type BesaAccount } from "../Tools/Fetch"

//BESA Lead only (gated by RequireAccess in App.tsx) - lists every besa/besaLead account and lets a
//lead flip each one's admin status. accountType itself (whether someone is besa vs besaLead) isn't
//editable here - that's fixed by whatever tier they claimed off the roster at signup.
export default function ManageAdmins() {
    const [accounts, setAccounts] = useState<BesaAccount[] | null>(null)
    const [updatingUid, setUpdatingUid] = useState<string | null>(null)
    const [error, setError] = useState("")

    useEffect(() => {
        getBesaAccounts().then(result => setAccounts(result || []))
    }, [])

    async function handleToggle(account: BesaAccount) {
        setError("")
        setUpdatingUid(account.uid)
        const response = await setAdminStatus(account.uid, !account.admin)
        if (response?.success) {
            setAccounts(prev => prev && prev.map(a => a.uid === account.uid ? {...a, admin: !a.admin} : a))
        } else {
            setError("Something went wrong updating that account. Please try again.")
        }
        setUpdatingUid(null)
    }

    return (
        <div className="bg-gray-900 w-full min-h-screen text-white">
            <Header/>
            <div className="h-16 relative top-0 left-0 w-full"></div>
            <div className="w-5/6 mx-auto py-10">
                <h1 className="text-4xl tracking-wider mb-1">Manage Admins</h1>
                <p className="text-gray-400 text-sm mb-8">Grant or revoke admin access for BESA accounts. BESA Leads always have admin access.</p>

                {error && <p className="text-red-400 text-sm mb-4">{error}</p>}

                {accounts === null ?
                    <div className="flex justify-center py-20"><MoonLoader color="white" size={30}/></div>
                    : accounts.length === 0 ?
                    <p className="text-gray-500 italic">No BESA accounts yet.</p>
                    :
                    <div className="flex flex-col gap-3">
                        {accounts.map(account => (
                            <div key={account.uid} className="bg-gray-800 rounded-2xl p-4 flex items-center justify-between gap-3">
                                <div>
                                    <p className="font-semibold">{account.besaName || "(no name on file)"}</p>
                                    <p className="text-sm text-gray-400">{account.email}</p>
                                    <span className="inline-block mt-1 text-xs px-2 py-0.5 rounded-full bg-gray-700 text-gray-300">
                                        {account.accountType === "besaLead" ? "BESA Lead" : "BESA"}
                                    </span>
                                </div>
                                <button
                                    onClick={() => handleToggle(account)}
                                    disabled={account.accountType === "besaLead" || updatingUid === account.uid}
                                    title={account.accountType === "besaLead" ? "BESA Leads always have admin access" : undefined}
                                    className={"px-4 py-2 rounded-full text-sm font-semibold shrink-0 " +
                                        (account.accountType === "besaLead" ? "bg-gray-700 text-gray-400 cursor-not-allowed" :
                                        account.admin ? "bg-red-800 hover:bg-red-900" : "bg-blue-800 hover:bg-blue-900")}
                                >
                                    {updatingUid === account.uid ? <MoonLoader color="white" size={16}/> :
                                        account.accountType === "besaLead" ? "Admin (Lead)" :
                                        account.admin ? "Revoke Admin" : "Make Admin"}
                                </button>
                            </div>
                        ))}
                    </div>
                }
            </div>
        </div>
    )
}
