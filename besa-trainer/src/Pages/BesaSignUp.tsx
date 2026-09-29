import { useEffect, useState, type JSX } from "react"
import { onAuthStateChanged, type User } from "firebase/auth"
import { Link, useNavigate } from "react-router-dom"
import { MoonLoader } from "react-spinners"
import Header from "../Components/Header"
import GoogleSignInButton from "../Components/GoogleSignInButton"
import { getFirebaseAuth } from "../Tools/firebase"
import { isSignupInProgress } from "../Tools/signup"
import { getBesaRoster, type RosterEntry } from "../Tools/Fetch"

//the alternate signup area for BESA members - reachable from the regular /signup page. Loads the
//roster of not-yet-claimed BESA names from besa-api (which itself cross-references besa-app's roster
//against who's already claimed a name here), lets the signer pick theirs, then hands the pick off to
//GoogleSignInButton - Google is the only way to create an account.
export default function BesaSignUp(): JSX.Element {
    const navigate = useNavigate()
    const [roster, setRoster] = useState<RosterEntry[] | null>(null)
    const [rosterError, setRosterError] = useState(false)
    const [selectedName, setSelectedName] = useState("")
    const [studentId, setStudentId] = useState("")

    useEffect(() => {
        const auth = getFirebaseAuth()
        const unsub = onAuthStateChanged(auth, (user: User | null) => {
            if (user?.uid && !isSignupInProgress()) {
                navigate('/')
            }
        })
        return unsub
    }, [])

    useEffect(() => {
        getBesaRoster().then(result => {
            if (result) {
                setRoster(result)
            } else {
                setRosterError(true)
            }
        })
    }, [])

    const selected = roster?.find(r => r.name === selectedName) || null

    return (
        <>
        <Header/>
        <div className="w-screen min-h-screen flex items-center justify-center bg-gray-900 py-10">
            <div className="w-11/12 sm:w-3/4 md:w-2/4 mx-auto bg-white rounded-2xl p-5 text-black">
                <h2 className="mb-2 text-center text-3xl font-bold">Sign Up as BESA</h2>
                <p className="mb-5 text-center text-xs text-gray-600">
                    Pick your name from the BESA roster below to link your account to your BESA info.
                </p>

                <div className="w-full sm:w-3/4 mx-auto">
                    {roster === null && !rosterError &&
                        <div className="flex justify-center my-10"><MoonLoader color="#1e3a8a" size={24}/></div>
                    }
                    {rosterError &&
                        <p className="text-center text-sm text-red-600 my-5">
                            Couldn't load the BESA roster right now. Please try again later.
                        </p>
                    }
                    {roster && roster.length === 0 &&
                        <p className="text-center text-sm text-gray-600 my-5">
                            No unclaimed BESA names are available right now.
                        </p>
                    }
                    {roster && roster.length > 0 &&
                        <select
                            required
                            value={selectedName}
                            onChange={(e) => setSelectedName(e.target.value)}
                            className="block my-5 w-full p-3 rounded-xl bg-gray-600 text-white"
                        >
                            <option value="" disabled>Select your name...</option>
                            {roster.map(r => (
                                <option key={r.name} value={r.name}>
                                    {r.name}
                                </option>
                            ))}
                        </select>
                    }

                    <input
                        type="text"
                        name="studentId"
                        required
                        placeholder="Enter your school id..."
                        value={studentId}
                        onChange={(e) => setStudentId(e.target.value)}
                        className="block my-5 w-full p-3 rounded-xl bg-gray-600 focus:border-amber-500 focus:border-2 text-white"
                    />

                </div>
                {selected && studentId.trim() ?
                    <GoogleSignInButton besaSelection={{besaName: selected.name, studentId: studentId.trim()}}/>
                    :
                    <p className="text-center text-xs text-gray-500 mt-5">Select your name and enter your school id above to sign up with Google.</p>
                }
                <p className="text-center mt-5 text-gray-700">
                    Not a BESA?{" "}
                    <Link to="/signup" className="text-blue-900 font-semibold">
                        Sign up as a regular user
                    </Link>
                </p>
                <p className="text-center mt-5 text-gray-700">
                    Have an account?{" "}
                    <Link to="/signin" className="text-blue-900">
                        Sign in
                    </Link>
                </p>
            </div>
        </div>
        </>
    )
}
