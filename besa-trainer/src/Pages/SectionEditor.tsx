import { NavLink, Outlet, useNavigate, useSearchParams } from "react-router-dom";
import Header from "../Components/Header";
import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { onAuthStateChanged, type User } from "firebase/auth";
import type { User as CustomUser } from "../types";
import { getFirebaseAuth } from "../firebase";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../firestore";

import { IoMdExit } from "react-icons/io";
import { LuNewspaper } from "react-icons/lu";
import { GiCoffeeCup } from "react-icons/gi";
import { HiBeaker } from "react-icons/hi";
import { FaTree } from "react-icons/fa";
import { FaTools } from "react-icons/fa";
import { FaHandshakeSimple } from "react-icons/fa6";



export default function SectionEditor() {
    const [user, setUser] = useState<User | null>(null)
    const [userData, setUserData] = useState<CustomUser | null>(null)
    const [expand, setExpand] = useState(true)
    
    const navigate = useNavigate()

    useEffect(() => {
        //getting information
        const auth = getFirebaseAuth()
        const unsub = onAuthStateChanged(auth, (firebaseUser) => {
            setUser(firebaseUser)
            if(firebaseUser) {
                const docRef = doc(db, "training_data", "data_root", "users", firebaseUser.uid)
                getDoc(docRef).then((docSnap) => {
                    if(docSnap.exists()) {
                        const data = docSnap.data() as CustomUser
                        //user needs admin privilages to be in section editor
                        if (!data.admin) {
                            navigate("/")
                        }
                        setUserData(data)
                    } else {
                        console.error("No user found with uuid")
                    }
                })
            }
        })
        return unsub
    }, [])

    return (
        <>
            <Header sticky={true}/>
            <div className="bg-gray-900 w-full h-screen flex justify-start">
                <SideBar expand={expand} setExpand={setExpand}/>
                {/* OtherSide */}
                <div className={"h-full" + (expand ? " w-3/4" : " w-full")}>
                    <Outlet/>
                </div>
            </div>
        </>
    )
}


export function SideBar({expand, setExpand}: {expand: boolean, setExpand: Dispatch<SetStateAction<boolean>>}) {
    const [navStyles, setNavStyles] = useState(Array(6).fill(false))
    const [searchParams, setSearchparams] = useSearchParams()
    const f = searchParams.get("f")
    const sidebarNavStyle = "flex items-center hover:bg-gray-800 p-3 rounded-full gap-3 my-3 mx-auto justify-" + (expand ? "start" : "center")

    useEffect(() => {
        switch(f) {
            case "f1":
                setNavStyles(() => {
                    let newStyle = Array(6).fill(false)
                    newStyle[1] = true
                    return newStyle
                })
                break
            case "f2":
                setNavStyles(() => {
                    let newStyle = Array(6).fill(false)
                    newStyle[2] = true
                    return newStyle
                })
                break
            case "f3":
                setNavStyles(() => {
                    let newStyle = Array(6).fill(false)
                    newStyle[3] = true
                    return newStyle
                })
                break
            case "b":
                setNavStyles(() => {
                    let newStyle = Array(6).fill(false)
                    newStyle[4] = true
                    return newStyle
                })
                break
            case "e":
                setNavStyles(() => {
                    let newStyle = Array(6).fill(false)
                    newStyle[5] = true
                    return newStyle
                })
                break
            default:
                setNavStyles(() => {
                    let newStyle = Array(6).fill(false)
                    newStyle[0] = true
                    return newStyle
                })
        }
    }, [f])
    return (
        <div className={"h-full bg-gray-700 box-border p-3 text-gray-200 border-r-2 border-solid border-r-gray-500 " + (expand ? "w-1/4 " : "")}>
            {/* Title / closing button */}
            <div className={"flex items-center hover:bg-gray-800 p-3 rounded-full " + (expand ? "justify-between " : "justify-center ")} onClick={() => setExpand((e:boolean) => !e)}>
                <h2 className={"text-3xl " + (expand ? "" : "hidden")}>Section Editor</h2>
                <IoMdExit className="w-8 h-8"/>
            </div>
            
            <hr className="w-full mt-3"/>

            {/* Tutorials if needed */}
            <NavLink to="getting-started" className={sidebarNavStyle + (navStyles[0] ? " bg-gray-800" : "")}>
                <LuNewspaper className="border-solid border-2 border-gray-200 p-2 box-content rounded-full w-6 h-6"/>
                <h4 className={"text-xl " + (expand ? "" : "hidden")}>Getting Started</h4>
            </NavLink>

            <hr className="w-3/4 mt-3 mx-auto bg-gray-100"/>

            <NavLink to="edit?f=f1" className={sidebarNavStyle + (navStyles[1] ? " bg-gray-800" : "")}>
                <GiCoffeeCup className="border-solid border-2 border-gray-200 p-2 box-content rounded-full w-6 h-6"/>
                <h4 className={"text-xl " + (expand ? "" : "hidden")}>First Floor</h4>
            </NavLink>
            <NavLink to="edit?f=f2" className={sidebarNavStyle + (navStyles[2] ? " bg-gray-800" : "")}>
                <HiBeaker className="border-solid border-2 border-gray-200 p-2 box-content rounded-full w-6 h-6"/>
                <h4 className={"text-xl " + (expand ? "" : "hidden")}>Second Floor</h4>
            </NavLink>
            <NavLink to="edit?f=f3" className={sidebarNavStyle + (navStyles[3] ? " bg-gray-800" : "")}>
                <FaTree className="border-solid border-2 border-gray-200 p-2 box-content rounded-full w-6 h-6"/>
                <h4 className={"text-xl " + (expand ? "" : "hidden")}>Third Floor</h4>
            </NavLink>
            <NavLink to="edit?f=b" className={sidebarNavStyle + (navStyles[4] ? " bg-gray-800" : "")}>
                <FaTools className="border-solid border-2 border-gray-200 p-2 box-content rounded-full w-6 h-6"/>
                <h4 className={"text-xl " + (expand ? "" : "hidden")}>Basement</h4>
            </NavLink>
            <NavLink to="edit?f=e" className={sidebarNavStyle + (navStyles[5] ? " bg-gray-800" : "")}>
                <FaHandshakeSimple className="border-solid border-2 border-gray-200 p-2 box-content rounded-full w-6 h-6"/>
                <h4 className={"text-xl " + (expand ? "" : "hidden")}>Exit</h4>
            </NavLink>
        </div>
    )
}