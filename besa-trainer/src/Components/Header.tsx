import type { JSX } from "react"
import { useEffect, useRef, useState } from "react"
import type { User } from "firebase/auth"
import type { User as CustomUser } from "../types"
import { onAuthStateChanged, signOut } from "firebase/auth"
import { NavLink } from "react-router-dom"
import Logo from "../imgs/BE_logo.png"
import DefaultProfile from '../imgs/default.jpg'
import { getFirebaseAuth, isFirebaseConfigured } from "../firebase"

import { doc, getDoc } from "firebase/firestore"
import { db } from "../firestore"

import { CiLogout } from "react-icons/ci";
import { MdEdit } from "react-icons/md";

const navClass = "h-fit text-sm"

export default function Header({sticky}:{sticky:boolean}): JSX.Element {
    //The User type is defined by firebase auth, it contains the user's email, display name
    const [user, setUser] = useState<User | null>(null)
    const [popup, setPopup] = useState(false)
    const [userData, setUserData] = useState<CustomUser | null>(null)
    const ref = useRef<HTMLDivElement>(null)

    useEffect(() => {
        const auth = getFirebaseAuth()
        //unsub from the auth state changes so we dont have multiple subscriptions
        const unsub = onAuthStateChanged(auth, (firebaseUser) => {
            //sets both states
            setUser(firebaseUser)

            if (firebaseUser) {
                const docRef = doc(db, "training_data", "data_root", "users", firebaseUser.uid)
                getDoc(docRef).then((docSnap) => {
                    if(docSnap.exists()) {
                        //setting custom data from firestore
                        setUserData(docSnap.data() as CustomUser)
                    } else {
                        console.error("No user found with uid")
                    }
                })
            }
        })
        
        return unsub
    }, [])

    //handles click outside of popup
    useEffect(() => {
        if (!popup) return

        const handleClickOutside = (event: MouseEvent) => {
            // checking if any other click outside ref is registered
            if (ref.current && !ref.current.contains(event.target as Node)) {
                setPopup(false)
            }
        }
        document.addEventListener("mousedown", handleClickOutside)
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [popup])

    async function onSignOut(): Promise<void> {
        //always check need to check if firebase is configured before we try to do anything with it
        if (!isFirebaseConfigured()) return
        await signOut(getFirebaseAuth())
    }

    return (
        <header className={"flex h-16 w-screen items-center justify-around border-b-2 border-double border-gray-500 bg-white text-blue-900 top-0 " + (sticky ? "sticky" : "absolute")}>
        <div className="flex items-center justify-center gap-5 font-sans text-3xl font-semibold tracking-wide">
            <img src={Logo} className="w-10" alt="" width={40} height={40} />
            <span>BESA-Trainer</span>
        </div>
        <nav className="flex h-fit justify-center items-center gap-x-10 text-sm">
            <NavLink className={navClass} to="/">
            HOME
            </NavLink>
            {/* <div className="w-1 h-6 bg-blue-900"></div> */}
            {user ? (
                <div className="relative w-64" ref={ref}>
                    <img 
                    className="rounded-full w-8 border-gray-300 border-solid border-2 hover:brightness-75 mx-auto" 
                    src={user.photoURL || DefaultProfile}
                    onClick={() => setPopup((e:boolean) => !e)}
                    />
                    <div className={"absolute w-64 top-10 rounded-3xl border-2 border-solid border-gray-400 bg-white shadow-lg box-border p-3 " + (popup ? "" : "hidden")}>
                        {/* Profile settings */}
                        <button
                            className="flex justify-start items-center w-5/6 mx-auto my-3 gap-2 box-content p-3 rounded-full border-solid border-2 border-gray-400 hover:brightness-75 bg-white"
                            onClick={() => onSignOut()}
                            >
                            <CiLogout className="border-solid rounded-full border-2 border-gray-300 w-5 h-5 fill-blue-900 p-2 box-content"/>
                            <span className="block">Log Out</span>
                        </button>
                        <NavLink to={"/profile"} className={"flex justify-start items-center w-5/6 mx-auto my-3 gap-2 box-content p-3 rounded-full border-solid border-2 border-gray-400 hover:brightness-75 bg-white"}>
                            <img 
                                className="border-solid rounded-full border-2 border-gray-300 w-5 h-5 p-2 box-content" 
                                src={user.photoURL || DefaultProfile}/>
                            <span>Profile</span>
                        </NavLink>
                        {userData?.admin && (
                        <NavLink to={"/section-editor"} className={"flex justify-start items-center w-5/6 mx-auto my-3 gap-2 box-content p-3 rounded-full border-solid border-2 border-gray-400 hover:brightness-75 bg-white"}>
                            <MdEdit className="border-solid rounded-full border-2 border-gray-300 w-5 h-5 fill-blue-900 p-2 box-content"/>
                            <span>Edit Sections</span>
                        </NavLink>)}
                    </div>
                </div>
            // <button
            //     type="button"
            //     className={navClass + " cursor-pointer hover:underline"}
            //     onClick={() => void onSignOut()}
            // >
            //     SIGN OUT
            // </button>
            ) : (
            <>
                <NavLink className={navClass} to="/signin">
                SIGN IN
                </NavLink>
                <NavLink className={navClass} to="/signup">
                SIGN UP
                </NavLink>
            </>
            ) }
        </nav>
        </header>
    )
}
