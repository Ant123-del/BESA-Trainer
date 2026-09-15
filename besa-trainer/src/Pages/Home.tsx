import { Link, useLocation } from "react-router-dom";
import { useEffect, useState } from "react";
import { onAuthStateChanged, type User as FirebaseUser } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import Header from "../Components/Header";
import { getFirebaseAuth } from "../Tools/firebase";
import { db } from "../Tools/firestore";
import type { User as CustomUser } from "../Tools/types";
import type { JSX, ComponentType } from "react";
import Background from "../imgs/background.jpg"
import Background2 from "../imgs/background-2.jpg"
import Background3 from "../imgs/background-3.jpeg"
import Background4 from "../imgs/background-4.jpeg"
import { FaPlay, FaBook } from "react-icons/fa";
import {Carousel as CarouselUntyped, IconButton as IconButtonUntyped, type CarouselProps, type IconButtonProps} from "@material-tailwind/react"

//@material-tailwind/react's shipped .d.ts pins its forwardRef signature to an old @types/react
//snapshot that no longer matches, making every prop look "missing" even though the components work
//fine at runtime - recast to the library's own (correctly typed) prop interfaces instead.
const Carousel = CarouselUntyped as unknown as ComponentType<CarouselProps>
const IconButton = IconButtonUntyped as unknown as ComponentType<IconButtonProps>
import { FaChevronLeft } from "react-icons/fa";
import { FaChevronRight } from "react-icons/fa";
import { IoSchool } from "react-icons/io5";
import { FaMapMarkedAlt, FaComments, FaChartLine } from "react-icons/fa";

//logged out (or still loading) shows the public landing page - a general "come see what Baskin
//Engineering is about" pitch aimed at anyone curious about the school, not specifically at BESAs.
//Logged in swaps in a dashboard that differs by account: a regular user just gets a straightforward
//video tour to watch, while a besa/besaLead account gets the full practice/testing dashboard -
//branded "BESA Trainer" for besa/besaLead accounts or "BESA Resources" otherwise.
export default function Home() {
    const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null)
    const [userData, setUserData] = useState<CustomUser | null>(null)
    const [checking, setChecking] = useState(true)

    useEffect(() => {
        const auth = getFirebaseAuth()
        const unsub = onAuthStateChanged(auth, async (user) => {
            setFirebaseUser(user)
            if (user) {
                const docSnap = await getDoc(doc(db, "training_data", "data_root", "users", user.uid))
                setUserData(docSnap.exists() ? docSnap.data() as CustomUser : null)
            } else {
                setUserData(null)
            }
            setChecking(false)
        })
        return unsub
    }, [])

    const isBesa = userData?.accountType === "besa" || userData?.accountType === "besaLead"
    const brandName = isBesa ? "BESA Trainer" : "BESA Resources"

    if (checking) {
        return (
            <>
                <Header/>
                <div className="h-16 relative top-0 left-0 w-full"></div>
                <div className="w-full min-h-screen bg-gray-900"></div>
            </>
        )
    }

    if (!firebaseUser) {
        return <Landing/>
    }

    return isBesa ? <BesaDashboard brandName={brandName}/> : <UserDashboard brandName={brandName}/>
}

//public marketing page for logged-out visitors - anyone curious about Baskin Engineering (prospective
//students, parents, visitors), not framed around training to become a tour guide.
function Landing() {
    return (
        <>
            <Header/>
            <div className="h-16 relative top-0 left-0 w-full"></div>
            <div className="w-full min-h-screen bg-gray-900 text-white">
                <div className="relative w-full h-[28rem] overflow-hidden">
                    <img src={Background} className="w-full h-full object-cover brightness-50" alt=""/>
                    <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-5">
                        <h1 className="text-5xl font-semibold tracking-wide mb-4">BESA Resources</h1>
                        <p className="text-lg text-gray-200 max-w-2xl mb-8">
                            Curious about Baskin Engineering? Take a video walk through each floor, get answers
                            to the questions students and parents ask most, and get a feel for the school
                            without having to schedule a visit.
                        </p>
                        <div className="flex gap-4">
                            <Link to="/signup" className="px-8 py-3 rounded-full bg-amber-500 hover:bg-amber-600 text-black font-semibold">
                                Get Started
                            </Link>
                            <Link to="/signin" className="px-8 py-3 rounded-full border-2 border-white hover:bg-white/10 font-semibold">
                                Sign In
                            </Link>
                        </div>
                    </div>
                </div>

                <div className="w-4/6 mx-auto py-16">
                    <h2 className="text-3xl tracking-wide text-center mb-10">What You Can Do Here</h2>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        <FeatureCard icon={<FaMapMarkedAlt className="w-8 h-8"/>} title="Take A Virtual Tour">
                            Watch real video walk-throughs of each floor - First Floor, Second Floor, Third
                            Floor, and Slugworks - at your own pace.
                        </FeatureCard>
                        <FeatureCard icon={<FaComments className="w-8 h-8"/>} title="Get Your Questions Answered">
                            Browse answers to the questions parents and prospective students most
                            commonly ask about the school.
                        </FeatureCard>
                        <FeatureCard icon={<FaChartLine className="w-8 h-8"/>} title="For BESAs: Practice Tools">
                            BESA members get an expanded dashboard with tour rehearsal, quizzes, and
                            progress tracking to prepare for leading real tours.
                        </FeatureCard>
                    </div>
                </div>

                <div className="w-full bg-gray-800 py-14">
                    <div className="w-4/6 mx-auto text-center">
                        <h2 className="text-2xl tracking-wide mb-3">Ready to take a look around?</h2>
                        <p className="text-gray-400 mb-6">Create a free account to start exploring.</p>
                        <Link to="/signup" className="px-8 py-3 rounded-full bg-amber-500 hover:bg-amber-600 text-black font-semibold">
                            Sign Up
                        </Link>
                        <p className="text-xs text-gray-500 mt-6">
                            Are you a BESA? <Link to="/signup-besa" className="text-amber-500 hover:underline">Sign up as BESA</Link> instead
                            to link your account to your BESA info.
                        </p>
                    </div>
                </div>
            </div>
        </>
    )
}

function FeatureCard({icon, title, children}: {icon: JSX.Element, title: string, children: string}) {
    return (
        <div className="bg-gray-800 rounded-2xl p-6 text-center">
            <div className="mx-auto mb-4 w-14 h-14 rounded-full bg-amber-500/20 text-amber-500 flex items-center justify-center">
                {icon}
            </div>
            <h3 className="text-xl font-semibold mb-2">{title}</h3>
            <p className="text-sm text-gray-400">{children}</p>
        </div>
    )
}

//a regular user's dashboard - no testing, no progress tracking, just a straightforward tour to watch.
//Simulator itself already renders a simplified, untested viewing experience for non-BESA accounts, so
//this only has to point at it.
function UserDashboard({brandName}: {brandName: string}) {
    return (
        <>
            <Header/>
            <div className="h-16 relative top-0 left-0 w-full"></div>
            <div className="w-full min-h-screen bg-gray-900 flex justify-center items-start relative text-white gap-4">
                <div className="sticky top-0 right-0 w-1/6 mt-16 border-r-solid border-r-gray-600 border-r-2 py-10 px-3">
                    <h3 className="text-2xl tracking-wider">Explore</h3>
                    <hr className="w-2/4 mx-auto my-5"></hr>

                    <SideBarElement to="#general-tour">
                        <h4>Take A Tour</h4>
                    </SideBarElement>
                    <SideBarElement to="#q-a">
                        <h4>Common Questions</h4>
                    </SideBarElement>
                </div>
                <div className="w-4/6 mt-16">
                    <div>
                        <h1 className="text-2xl tracking-wider">
                            Welcome to {brandName}
                        </h1>
                        <p className="text-xs text-gray-500 mb-2">
                            Take a look around Baskin Engineering - pick a floor below to start watching.
                        </p>
                    </div>
                    <Carousel className="rounded-xl"
                        prevArrow={({handlePrev}) => {
                            return (
                                <IconButton
                                className={"!absolute bottom-0 left-4 -translate-y-2/4 bg-black/30 hover:bg-black/50 rounded-full"}
                                onClick={handlePrev}>
                                    <FaChevronLeft className="fill-black"/>
                                </IconButton>
                            )
                        }}
                        nextArrow={({handleNext}) => {
                            return (
                                <IconButton
                                className={"!absolute bottom-0 right-4 -translate-y-2/4 bg-black/30 hover:bg-black/50 rounded-full"}
                                onClick={handleNext}>
                                    <FaChevronRight className="fill-black"/>
                                </IconButton>
                            )
                        }}
                        navigation={({ setActiveIndex, activeIndex, length }) => (
                        <div className="absolute bottom-0 left-2/4 z-50 flex -translate-x-2/4 gap-2">
                            {new Array(length).fill("").map((_, i) => (
                            <span
                                key={i}
                                className={`block h-1 cursor-pointer rounded-2xl transition-all content-[''] ${
                                activeIndex === i ? "w-4 bg-white" : "w-4 bg-white/50"
                                }`}
                                onClick={() => setActiveIndex(i)}
                            />
                            ))}
                        </div>
                        )}>
                        <Tour src={Background} to="/simulator/general?f=f1" name="First Floor" cta="Watch Tour"/>
                        <Tour src={Background2} to="/simulator/general?f=f2" name="Second Floor" cta="Watch Tour"/>
                        <Tour src={Background3} to="/simulator/general?f=f3" name="Third Floor" cta="Watch Tour"/>
                        <Tour src={Background4} to="/simulator/general?f=b" name="Slugworks" cta="Watch Tour"/>
                    </Carousel>

                    <div id="questions">
                        <div className="mt-5">
                            <h1 className="text-2xl tracking-wider">
                                Common Questions
                            </h1>
                            <p className="text-xs text-gray-500 mb-2">
                                Things parents and prospective students often ask about the school.
                            </p>
                        </div>
                        <div className="flex justify-center items-center gap-5">
                            <Card to="/questions/student-life" title="Student Life">
                                <IoSchool className="mx-auto my-5 box-border w-16 h-16"/>
                                <p>
                                    See answers to common questions about student life at Baskin Engineering.
                                </p>
                            </Card>
                        </div>
                    </div>
                </div>
            </div>
        </>
    )
}

//a BESA/BESA Lead's dashboard - the full practice experience (rehearsal, quizzes, progress tracking).
function BesaDashboard({brandName}: {brandName: string}) {
    return (
        <>
            <Header/>
            <div className="h-16 relative top-0 left-0 w-full"></div>
            <div className="w-full min-h-screen bg-gray-900 flex justify-center items-start relative text-white gap-4">
                <div className="sticky top-0 right-0 w-1/6 mt-16 border-r-solid border-r-gray-600 border-r-2 py-10 px-3">
                    {/* This is the nav bar */}
                    <h3 className="text-2xl tracking-wider">Practice</h3>
                    <hr className="w-2/4 mx-auto my-5"></hr>

                    <SideBarElement to="#general-tour">
                        <h4>Practice Tours</h4>
                    </SideBarElement>
                    <SideBarElement to="#q-a">
                        <h4>Practice Questions</h4>
                    </SideBarElement>
                </div>
                <div className="w-4/6 mt-16">
                    <div className="flex justify-between items-start">
                        <div>
                            <h1 className="text-2xl tracking-wider">
                                Welcome to {brandName}
                            </h1>
                            <p className="text-xs text-gray-500 mb-2">
                                This is the general Baskin Engineering tour most commonly given
                            </p>
                        </div>
                        <Link to="/progress/general"
                            className="p-2 px-6 rounded-full bg-amber-500 hover:bg-amber-600 text-black text-sm font-semibold shrink-0">
                            My Progress
                        </Link>
                    </div>
                    <Carousel className="rounded-xl"
                        prevArrow={({handlePrev}) => {
                            return (
                                <IconButton
                                className={"!absolute bottom-0 left-4 -translate-y-2/4 bg-black/30 hover:bg-black/50 rounded-full"}
                                onClick={handlePrev}>
                                    <FaChevronLeft className="fill-black"/>
                                </IconButton>
                            )
                        }}
                        nextArrow={({handleNext}) => {
                            return (
                                <IconButton
                                className={"!absolute bottom-0 right-4 -translate-y-2/4 bg-black/30 hover:bg-black/50 rounded-full"}
                                onClick={handleNext}>
                                    <FaChevronRight className="fill-black"/>
                                </IconButton>
                            )
                        }}
                        navigation={({ setActiveIndex, activeIndex, length }) => (
                        <div className="absolute bottom-36 left-2/4 z-50 flex -translate-x-2/4 gap-2">
                            {new Array(length).fill("").map((_, i) => (
                            <span
                                key={i}
                                className={`block h-1 cursor-pointer rounded-2xl transition-all content-[''] ${
                                activeIndex === i ? "w-4 bg-white" : "w-4 bg-white/50"
                                }`}
                                onClick={() => setActiveIndex(i)}
                            />
                            ))}
                        </div>
                        )}>
                        {/* Backgrounds */}
                        <Tour src={Background} to="/simulator/general?f=f1" name="First Floor" cta="Begin Practice"
                            secondaryTo="/read-script/general?f=f1" secondaryCta="Read Script"/>
                        <Tour src={Background2} to="/simulator/general?f=f2" name="Second Floor" cta="Begin Practice"
                            secondaryTo="/read-script/general?f=f2" secondaryCta="Read Script"/>
                        <Tour src={Background3} to="/simulator/general?f=f3" name="Third Floor" cta="Begin Practice"
                            secondaryTo="/read-script/general?f=f3" secondaryCta="Read Script"/>
                        <Tour src={Background4} to="/simulator/general?f=b" name="Slugworks" cta="Begin Practice"
                            secondaryTo="/read-script/general?f=b" secondaryCta="Read Script"/>
                    </Carousel>

                {/* This is the divider for the other section of practing questions parents may ask: */}
                    <div id="questions">
                        <div className="mt-5">
                            <h1 className="text-2xl tracking-wider">
                                Practicing General Questions
                            </h1>
                            <p className="text-xs text-gray-500 mb-2">
                                Parents or students may ask general questions.
                            </p>
                        </div>
                        <div className="flex justify-center items-center gap-5">
                            <Card to="/questions/student-life" title="Student Life">
                                <IoSchool className="mx-auto my-5 box-border w-16 h-16"/>
                                <p>
                                    Practice answering questions that frequently come up from parents and future students!
                                </p>
                            </Card>
                        </div>
                    </div>
                </div>
            </div>
        </>
    )
}

function Tour({src, to, name, cta, secondaryTo, secondaryCta}: {src: string, to: string, name: string, cta: string, secondaryTo?: string, secondaryCta?: string}) {
    return (
        <div className="w-full bg-white mx-auto rounded-2xl">
            <div className="relative w-full h-64">
                <img src={src} className="brightness-75 rounded-t-2xl object-cover h-64 w-full absolute top-0 right-0 z-0"/>
                <h2 className="bg-blue-800 p-3 z-10 relative rounded-xl w-2/4 top-16 left-5 text-3xl">{name}</h2>
            </div>
            <div className="bg-white text-black rounded-b-2xl p-3 flex flex-col gap-2">
                <Link className="mx-auto bg-amber-500 p-3 bold flex justify-center items-center w-3/4 rounded-full shadow-light
                    hover:bg-amber-600 gap-4" to={to}>
                    <FaPlay/>
                    <span>{cta}</span>
                </Link>
                {secondaryTo && secondaryCta &&
                    <Link className="mx-auto bg-gray-800 text-white p-3 bold flex justify-center items-center w-3/4 rounded-full shadow-light
                        hover:bg-gray-900 gap-4" to={secondaryTo}>
                        <FaBook/>
                        <span>{secondaryCta}</span>
                    </Link>
                }
            </div>
        </div>
    )
}

function SideBarElement({children, to}: {children: JSX.Element, to: string}) {
    const {hash} = useLocation()
    return (
        <Link to={to} className={"flex justify-start items-center p-2 my-5" + (hash == to ? " bg-blue-900 border-l-solid border-l-2 border-l-amber-600" : "")}>
            {children}
        </Link>
    )
}


function Card({children, title, to}: {children:JSX.Element[], title: string, to: string}) {

    return (
        <Link to={to} className="w-4/12 rounded-2xl bg-amber-700 text-white p-3 text-center hover:bg-amber-800">
            <h3 className="text-2xl">{title}</h3>
            {children}
        </Link>
    )
}
