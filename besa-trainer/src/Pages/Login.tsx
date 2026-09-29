import type { JSX } from "react"
import { useEffect } from "react"
import { onAuthStateChanged, type User } from "firebase/auth"
import { Link, useNavigate } from "react-router-dom"
import Header from "../Components/Header"
import GoogleSignInButton from "../Components/GoogleSignInButton"
import { getFirebaseAuth } from "../Tools/firebase"
import { isSignupInProgress } from "../Tools/signup"

//login prop comes from the router, switches between the /signup and /signin wording (see App.tsx).
//Google is the only way in - the same button signs in an existing account or creates a new one.
export default function Login({ login }: { login: boolean }): JSX.Element {
    const navigate = useNavigate()

    useEffect(() => {
        //getting state of logged in and if logged in, back out
        const auth = getFirebaseAuth()
        const unsub = onAuthStateChanged(auth, (user: User | null) => {
            if (user?.uid && !isSignupInProgress()) {
                navigate('/')
            }
        })
        return unsub
    }, [])

    return (
        <>
        <Header/>
        <div className="w-screen h-screen flex items-center justify-center bg-gray-900">
            <div className="w-11/12 sm:w-3/4 md:w-2/4 mx-auto bg-white rounded-2xl p-5 text-black">
                <h2 className="mb-2 text-center text-3xl font-bold">{login ? "Sign Up" : "Sign In"}</h2>
                <p className="mb-2 text-center text-xs text-gray-600">
                    {login ? "Create your account with your Google account." : "Sign in with your Google account."}
                </p>
                <GoogleSignInButton />
                <p className="text-center mt-8 mb-2 text-gray-700">
                    {login ? "Have an account? " : "Don't have an account? "}
                    <Link to={login ? "/signin" : "/signup"} className="text-blue-900">
                        {login ? "Sign in" : "Create one"}
                    </Link>
                </p>
                <p className="text-center mb-3 text-gray-700">
                    Are you a BESA?{" "}
                    <Link to="/signup-besa" className="text-blue-900 font-semibold">
                        Sign Up as BESA
                    </Link>
                </p>
            </div>
        </div>
        </>
    )
}
