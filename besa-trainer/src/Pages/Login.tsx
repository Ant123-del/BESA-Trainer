import type { SyntheticEvent, JSX } from "react"
import React, { useEffect, useState } from "react"
import type { User as CustomUser } from "../types"
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  type User,
  type UserCredential,
} from "firebase/auth"
import { Link, useNavigate } from "react-router-dom"
import Header from "../Components/Header"
import GoogleSignInButton from "../Components/GoogleSignInButton"
import { mapFirebaseAuthError } from "../authErrors"
import { getFirebaseAuth, isFirebaseConfigured } from "../firebase"
import { createUserDoc } from "../firestore"

//login prop comes from the router, switches between sign in vs sign up form (see App.tsx)
export default function Login({ login }: { login: boolean }): JSX.Element {
    const navigate = useNavigate()

    useEffect(() => {
        //getting state of logged in and if logged in, back out
        const auth = getFirebaseAuth()
        const unsub = onAuthStateChanged(auth, (user: User | null) => {
            if (user?.uid) {
                navigate('/')
            }
        })
        return unsub
    }, [])

    return (
        <>
        <Header sticky={false}/>
        {/*I know code a little wobby sobby but bare with me*/}
        {login ? <EmailPasswordSignUp /> : <EmailPasswordSignIn />}
        </>
    )
}

//this one is the /signin route, firebase signInWithEmailAndPassword for people who already registered
function EmailPasswordSignIn(): JSX.Element {
    const navigate = useNavigate()
    const [email, setEmail] = useState("")
    const [password, setPassword] = useState("")
    const [error, setError] = useState<string | null>(null)
    const [busy, setBusy] = useState(false)

    async function onSubmit(e: SyntheticEvent<HTMLFormElement>): Promise<void> {
        e.preventDefault()
        setError(null)
        setBusy(true)
        try {
        const auth = getFirebaseAuth()
        //firebase email/password login
        await signInWithEmailAndPassword(auth, email.trim(), password)
        navigate("/")
        } catch (err) {
        setError(mapFirebaseAuthError(err))
        } finally {
        setBusy(false)
        }
    }

    return (
        <div className="w-screen h-screen flex items-center justify-center bg-gray-900">
        <form
            className="w-2/4 mx-auto bg-white rounded-2xl p-5 text-black"
            onSubmit={(e) => void onSubmit(e)}
        >
            <h2 className="mb-2 text-center text-3xl font-bold">Sign In</h2>
            <div className="w-3/4 mx-auto">
            {/*regular sign in inputs*/}
            <input
                type="email"
                name="email"
                autoComplete="email"
                required
                placeholder="Enter your email..."
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="block my-10 w-full p-3 rounded-xl bg-gray-600 focus:border-amber-500 focus:border-2 text-white"
            />
            <input
                type="password"
                name="password"
                autoComplete="current-password"
                required
                placeholder="Enter your password..."
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="block mb-10 w-full p-3 rounded-xl bg-gray-600 text-white"
            />
            </div>
            {error ? (
            <p className="mb-4 text-center text-sm text-red-600" role="alert">
                {error}
            </p>
            ) : null}
            <button
            type="submit"
            disabled={busy}
            className="py-5 px-2 my-5 bg-blue-900 rounded-2xl text-white font-[500] w-3/4 mx-auto block cursor-pointer hover:brightness-75 active:brightness-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
            {busy ? "Signing in…" : "Submit"}
            </button>
            <p className="text-center mb-5 text-gray-700">
            Don't have an account?
            <Link to="/signup" className="text-blue-900">
                Create one
            </Link>
            </p>
            <div className="separator">OR</div>
            {/*google auth in its own component*/}
            <GoogleSignInButton />
        </form>
        </div>
    )
}

//this one is the /signup route, firebase createUserWithEmailAndPassword for brand new accounts
function EmailPasswordSignUp(): JSX.Element {

    const navigate = useNavigate()
    const [email, setEmail] = useState("")
    const [password, setPassword] = useState("")
    const [error, setError] = useState<string | null>(null)
    const [busy, setBusy] = useState(false)

    async function onSubmit(e: SyntheticEvent<HTMLFormElement>): Promise<void> {
        e.preventDefault()
        setError(null)
        setBusy(true)
        try {
        const auth = getFirebaseAuth()
        //firebase email/password registration
        const userCredential:UserCredential = await createUserWithEmailAndPassword(auth, email.trim(), password)
            //after getting UID, create user account
        const user: CustomUser = {
            uid: userCredential.user.uid,
            sections: [],
            admin: false,
            progress: []
        }
        await createUserDoc(user)

        navigate("/")
        } catch (err) {
        setError(mapFirebaseAuthError(err))
        } finally {
        setBusy(false)
        }
    }

    return (
        <div className="w-screen h-screen flex items-center justify-center bg-gray-900">
        <form
            className="w-2/4 mx-auto bg-white rounded-2xl p-5 text-black"
            onSubmit={(e) => void onSubmit(e)}
        >
            <h2 className="mb-2 text-center text-3xl font-bold">Sign Up</h2>
            <p className="mb-2 text-center text-xs text-gray-600">
            Password must be at least 6 characters (Firebase default).
            </p>
            <div className="w-3/4 mx-auto">
            {/*sign up inputs*/}
            <input
                type="email"
                name="email"
                autoComplete="email"
                required
                placeholder="Enter your email..."
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="block my-10 w-full p-3 rounded-xl bg-gray-600 focus:border-amber-500 focus:border-2 text-white"
            />
            <input
                type="password"
                name="password"
                autoComplete="new-password"
                required
                minLength={6}
                placeholder="Choose a password (min. 6 characters)"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="block mb-10 w-full p-3 rounded-xl bg-gray-600 text-white"
            />
            </div>
            {error ? (
            <p className="mb-4 text-center text-sm text-red-600" role="alert">
                {error}
            </p>
            ) : null}
            <button
            type="submit"
            disabled={busy}
            className="py-5 px-2 my-5 bg-blue-900 rounded-2xl text-white font-[500] w-3/4 mx-auto block cursor-pointer hover:brightness-75 active:brightness-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
            {busy ? "Creating account…" : "Submit"}
            </button>
            <p className="text-center mb-5 text-gray-700">
            Have an account?{" "}
            <Link to="/signin" className="text-blue-900">
                Sign in
            </Link>
            </p>
            <div className="separator">OR</div>
            <GoogleSignInButton />
        </form>
        </div>
    )
}
