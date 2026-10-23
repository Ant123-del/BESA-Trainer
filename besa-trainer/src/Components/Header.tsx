import type { JSX } from "react"
import { useEffect, useRef, useState } from "react"
import type { User } from "firebase/auth"
import type { User as CustomUser } from "../Tools/types"
import { onAuthStateChanged, signOut } from "firebase/auth"
import { NavLink } from "react-router-dom"
import Logo from "../imgs/BE_logo.png"
import DefaultProfile from '../imgs/default.jpg'
import { getFirebaseAuth, isFirebaseConfigured } from "../Tools/firebase"

import { doc, getDoc } from "firebase/firestore"
import { db } from "../Tools/firestore"

import { CiLogout } from "react-icons/ci";
import { MdEdit } from "react-icons/md";
import { FaClipboardList, FaUserShield } from "react-icons/fa";

const navClass = "h-fit text-sm font-medium text-be-navy hover:text-be-orange transition-colors"

export default function Header(): JSX.Element {
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

    //BESA/BESA Lead accounts see the "BESA Trainer" brand; the root kiosk sees "BESA Root"; everyone
    //else (logged out, or a regular user account) sees "BESA Resources" - matches Home's title split.
    const brandName = userData?.accountType === "root"
        ? "BESA Root"
        : userData && (userData.accountType === "besa" || userData.accountType === "besaLead")
        ? "BESA Trainer"
        : "BESA Resources"

    return (
        <header className={"flex h-20 w-screen items-center justify-between sm:justify-around px-4 sm:px-0 border-b-4 border-solid border-be-orange bg-white text-be-navy top-0 z-50 fixed font-sans"}>
        <div className="flex items-center justify-center gap-6 sm:gap-7 text-lg sm:text-2xl md:text-3xl font-bold tracking-wide min-w-0 py-2">
            <img src={Logo} className="w-[50px] h-[50px] shrink-0 object-contain" alt="Baskin Engineering" width={50} height={50} />
            <span className="truncate text-be-navy">{brandName}</span>
        </div>
        <nav className="flex h-fit justify-center items-center gap-x-4 sm:gap-x-10 text-sm shrink-0">
            <NavLink className={navClass} to="/">
            HOME
            </NavLink>
            {/* <div className="w-1 h-6 bg-blue-900"></div> */}
            {user ? (
                <div className="relative w-64" ref={ref}>
                    <img 
                    className="rounded-full w-9 h-9 border-be-navy border-solid border-2 hover:brightness-90 mx-auto cursor-pointer" 
                    src={user.photoURL || DefaultProfile}
                    alt="Profile"
                    onClick={() => setPopup((e:boolean) => !e)}
                    />
                    <div className={"absolute w-64 top-12 rounded-2xl border-2 border-solid border-be-light-gray bg-white text-be-navy shadow-lg box-border p-3 " + (popup ? "" : "hidden")}>
                        {/* Profile settings */}
                        <button
                            className="flex justify-start items-center w-5/6 mx-auto my-3 gap-2 box-content p-3 rounded-full border-solid border-2 border-be-navy text-be-navy font-medium hover:bg-be-light-gray/40 bg-white transition-colors"
                            onClick={() => onSignOut()}
                            >
                            <CiLogout className="border-solid rounded-full border-2 border-be-light-gray w-5 h-5 fill-be-navy p-2 box-content"/>
                            <span className="block">Log Out</span>
                        </button>
                        <NavLink to={"/profile"} className={"flex justify-start items-center w-5/6 mx-auto my-3 gap-2 box-content p-3 rounded-full border-solid border-2 border-be-navy text-be-navy font-medium hover:bg-be-light-gray/40 bg-white transition-colors"}>
                            <img 
                                className="border-solid rounded-full border-2 border-be-light-gray w-5 h-5 p-2 box-content" 
                                src={user.photoURL || DefaultProfile}
                                alt=""/>
                            <span>Profile</span>
                        </NavLink>
                        {userData?.admin && (
                        <NavLink to={"/section-editor/getting-started"} className={"flex justify-start items-center w-5/6 mx-auto my-3 gap-2 box-content p-3 rounded-full border-solid border-2 border-be-navy text-be-navy font-medium hover:bg-be-light-gray/40 bg-white transition-colors"}>
                            <MdEdit className="border-solid rounded-full border-2 border-be-light-gray w-5 h-5 fill-be-navy p-2 box-content"/>
                            <span>Edit Sections</span>
                        </NavLink>)}
                        {userData?.accountType === "besaLead" && (
                        <NavLink to={"/manage-admins"} className={"flex justify-start items-center w-5/6 mx-auto my-3 gap-2 box-content p-3 rounded-full border-solid border-2 border-be-navy text-be-navy font-medium hover:bg-be-light-gray/40 bg-white transition-colors"}>
                            <FaUserShield className="border-solid rounded-full border-2 border-be-light-gray w-5 h-5 fill-be-navy p-2 box-content"/>
                            <span>Manage Admins</span>
                        </NavLink>)}
                        {userData?.accountType === "besaLead" && (
                        <NavLink to={"/assign-tasks"} className={"flex justify-start items-center w-5/6 mx-auto my-3 gap-2 box-content p-3 rounded-full border-solid border-2 border-be-navy text-be-navy font-medium hover:bg-be-light-gray/40 bg-white transition-colors"}>
                            <FaClipboardList className="border-solid rounded-full border-2 border-be-light-gray w-5 h-5 fill-be-navy p-2 box-content"/>
                            <span>Assign Tasks</span>
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
                <NavLink className="h-fit text-sm font-bold px-4 py-2 rounded-full bg-be-orange text-black hover:bg-be-orange-dark transition-colors" to="/signup">
                SIGN UP
                </NavLink>
            </>
            ) }
        </nav>
        </header>
    )
}
