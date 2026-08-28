import { Link } from "react-router-dom"
import Header from "../Components/Header"

//shown in place of a gated page's content when the visitor isn't allowed to see it - not logged in
//for a login-gated page, or logged in without the required tier for an admin/besaLead-gated one.
export default function NoPermission({message}: {message?: string}) {
    return (
        <div className="bg-gray-900 w-full min-h-screen text-white">
            <Header/>
            <div className="h-16 relative top-0 left-0 w-full"></div>
            <div className="w-full flex flex-col items-center justify-center text-center gap-4 py-32 px-5">
                <h1 className="text-4xl tracking-wider">You Don't Have Permission To View This Page</h1>
                <p className="text-gray-400 max-w-md">{message || "If you think this is a mistake, make sure you're signed in with the right account."}</p>
                <Link to="/" className="p-2 px-6 rounded-full bg-amber-800 hover:bg-amber-900 mt-3">Back to Home</Link>
            </div>
        </div>
    )
}
