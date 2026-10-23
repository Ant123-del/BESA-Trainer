import { Link, useLocation } from "react-router-dom";
import { useEffect, useState } from "react";
import { onAuthStateChanged, type User as FirebaseUser } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import Header from "../Components/Header";
import RootDashboard from "./RootDashboard";
import { getFirebaseAuth } from "../Tools/firebase";
import { db, getQuestionSets } from "../Tools/firestore";
import type { User as CustomUser, QuestionSet } from "../Tools/types";
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
import { FaMapMarkedAlt, FaComments } from "react-icons/fa";

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
                <div className="h-20 relative top-0 left-0 w-full"></div>
                <div className="w-full min-h-screen bg-be-navy-darker"></div>
            </>
        )
    }

    if (!firebaseUser) {
        return <Landing/>
    }

    if (userData?.accountType === "root") {
        return <RootDashboard/>
    }

    return isBesa ? <BesaDashboard brandName={brandName}/> : <UserDashboard brandName={brandName}/>
}

//public marketing page for logged-out visitors - anyone curious about Baskin Engineering (prospective
//students, parents, visitors), not framed around training to become a tour guide.
function Landing() {
    return (
        <>
            <Header/>
            <div className="h-20 relative top-0 left-0 w-full"></div>
            <div className="w-full min-h-screen bg-white text-black font-sans">
                <div className="relative w-full h-[28rem] overflow-hidden bg-be-navy">
                    <img src={Background} className="w-full h-full object-cover brightness-50" alt="Baskin Engineering campus"/>
                    <div className="absolute inset-0 bg-be-navy/60 flex flex-col items-center justify-center text-center px-5">
                        <span className="text-xs sm:text-sm uppercase tracking-widest font-bold text-be-yellow mb-2">
                            Jack Baskin School of Engineering
                        </span>
                        <h1 className="text-3xl sm:text-4xl md:text-5xl font-bold tracking-wide text-white mb-4">BESA Resources</h1>
                        <p className="text-base sm:text-lg text-white max-w-2xl mb-8 font-normal">
                            Curious about Baskin Engineering? Take a video walk through each floor, get answers
                            to the questions students and parents ask most, and get a feel for the school
                            without having to schedule a visit.
                        </p>
                        <div className="flex gap-4">
                            <Link to="/signup" className="px-8 py-3 rounded-full bg-be-orange hover:bg-be-orange-dark text-black font-bold transition-colors">
                                Get Started
                            </Link>
                            <Link to="/signin" className="px-8 py-3 rounded-full border-2 border-white text-white hover:bg-white hover:text-be-navy font-bold transition-colors">
                                Sign In
                            </Link>
                        </div>
                    </div>
                </div>

                <div className="w-11/12 md:w-4/6 mx-auto py-16">
                    <h2 className="text-2xl sm:text-3xl font-bold tracking-wide text-center text-be-navy mb-10">What You Can Do Here</h2>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                        <FeatureCard icon={<FaMapMarkedAlt className="w-8 h-8"/>} title="Take A Virtual Tour">
                            Watch real video walk-throughs of each floor - First Floor, Second Floor, Third
                            Floor, and Slugworks - at your own pace.
                        </FeatureCard>
                        <FeatureCard icon={<FaComments className="w-8 h-8"/>} title="Get Your Questions Answered">
                            Browse answers to the questions parents and prospective students most
                            commonly ask about the school.
                        </FeatureCard>
                    </div>
                </div>

                <div className="w-full bg-be-navy text-white py-16 border-t-4 border-be-orange">
                    <div className="w-11/12 md:w-4/6 mx-auto text-center">
                        <h2 className="text-2xl sm:text-3xl font-bold tracking-wide mb-3">Ready to take a look around?</h2>
                        <p className="text-be-light-gray mb-6">Create a free account to start exploring Baskin Engineering.</p>
                        <Link to="/signup" className="inline-block px-8 py-3 rounded-full bg-be-orange hover:bg-be-orange-dark text-black font-bold transition-colors">
                            Sign Up
                        </Link>
                        <p className="text-xs text-be-light-gray mt-6">
                            Are you a BESA? <Link to="/signup-besa" className="text-be-yellow font-bold hover:underline">Sign up as BESA</Link> instead
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
        <div className="bg-be-navy text-white rounded-2xl p-8 text-center border-b-4 border-be-orange shadow-md">
            <div className="mx-auto mb-4 w-14 h-14 rounded-full bg-be-orange text-black flex items-center justify-center">
                {icon}
            </div>
            <h3 className="text-xl font-bold mb-2 text-white">{title}</h3>
            <p className="text-sm text-be-light-gray leading-relaxed">{children}</p>
        </div>
    )
}

//a regular user's dashboard - no testing, no progress tracking, just a straightforward tour to watch.
//Simulator itself already renders a simplified, untested viewing experience for non-BESA accounts, so
//this only has to point at it.
function UserDashboard({brandName}: {brandName: string}) {
    const [questionSets, setQuestionSets] = useState<QuestionSet[]>([])

    useEffect(() => {
        getQuestionSets().then(result => setQuestionSets(result))
    }, [])

    return (
        <>
            <Header/>
            <div className="h-20 relative top-0 left-0 w-full"></div>
            <div className="w-full min-h-screen bg-be-navy-darker flex flex-col md:flex-row justify-center items-stretch md:items-start relative text-white gap-6 font-sans pb-16">
                <div className="static md:sticky top-20 right-0 w-full md:w-1/6 mt-6 md:mt-16 border-b-2 md:border-b-0 border-r-solid md:border-r-be-navy md:border-r-2 border-be-navy py-5 md:py-10 px-4">
                    <h3 className="text-2xl font-bold tracking-wider text-be-yellow">Explore</h3>
                    <hr className="w-2/4 my-4 border-be-orange"></hr>

                    <div className="flex md:block gap-2 flex-wrap">
                        <SideBarElement to="#general-tour">
                            <h4 className="font-medium">Take A Tour</h4>
                        </SideBarElement>
                        <SideBarElement to="#questions">
                            <h4 className="font-medium">Common Questions</h4>
                        </SideBarElement>
                    </div>
                </div>
                <div className="w-11/12 md:w-4/6 mx-auto md:mx-0 mt-6 md:mt-16">
                    <div id="general-tour" className="scroll-mt-24 mb-4">
                        <h1 className="text-2xl sm:text-3xl font-bold tracking-wider text-white">
                            Welcome to {brandName}
                        </h1>
                        <p className="text-sm text-be-light-gray mt-1 mb-3">
                            Take a look around Baskin Engineering - pick a floor below to start watching.
                        </p>
                    </div>
                    <Carousel className="rounded-2xl shadow-lg"
                        prevArrow={({handlePrev}) => {
                            return (
                                <IconButton
                                className={"!absolute bottom-0 left-4 -translate-y-2/4 bg-be-navy/80 hover:bg-be-navy text-white rounded-full"}
                                onClick={handlePrev}>
                                    <FaChevronLeft className="fill-white"/>
                                </IconButton>
                            )
                        }}
                        nextArrow={({handleNext}) => {
                            return (
                                <IconButton
                                className={"!absolute bottom-0 right-4 -translate-y-2/4 bg-be-navy/80 hover:bg-be-navy text-white rounded-full"}
                                onClick={handleNext}>
                                    <FaChevronRight className="fill-white"/>
                                </IconButton>
                            )
                        }}
                        navigation={({ setActiveIndex, activeIndex, length }) => (
                        <div className="absolute bottom-0 left-2/4 z-50 flex -translate-x-2/4 gap-2">
                            {new Array(length).fill("").map((_, i) => (
                            <span
                                key={i}
                                className={`block h-1.5 cursor-pointer rounded-2xl transition-all content-[''] ${
                                activeIndex === i ? "w-6 bg-be-orange" : "w-4 bg-be-light-gray/60"
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

                    <hr className="w-3/4 mx-auto mt-16 border-be-navy"/>
                    <div id="questions" className="scroll-mt-24">
                        <div className="mt-10 mb-4">
                            <h1 className="text-2xl sm:text-3xl font-bold tracking-wider text-white">
                                Common Questions
                            </h1>
                            <p className="text-sm text-be-light-gray mt-1 mb-3">
                                Things parents and prospective students often ask about Baskin Engineering.
                            </p>
                        </div>
                        <div className="flex justify-center items-center gap-5 flex-wrap">
                            {questionSets.length === 0 ?
                                <p className="text-be-light-gray italic text-sm">No question sets yet.</p>
                                : questionSets.map(set => (
                                <Card key={set.id} to={`/questions/${set.id}`} title={set.title}>
                                    <IoSchool className="mx-auto my-5 box-border w-16 h-16 text-be-orange"/>
                                    <p className="text-be-light-gray font-medium">
                                        {set.questions.length} question{set.questions.length === 1 ? "" : "s"}
                                    </p>
                                </Card>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        </>
    )
}

//a BESA/BESA Lead's dashboard - the full practice experience (rehearsal, quizzes, progress tracking).
function BesaDashboard({brandName}: {brandName: string}) {
    const [questionSets, setQuestionSets] = useState<QuestionSet[]>([])

    useEffect(() => {
        getQuestionSets().then(result => setQuestionSets(result))
    }, [])

    return (
        <>
            <Header/>
            <div className="h-20 relative top-0 left-0 w-full"></div>
            <div className="w-full min-h-screen bg-be-navy-darker flex flex-col md:flex-row justify-center items-stretch md:items-start relative text-white gap-6 font-sans pb-16">
                <div className="static md:sticky top-20 right-0 w-full md:w-1/6 mt-6 md:mt-16 border-b-2 md:border-b-0 border-r-solid md:border-r-be-navy md:border-r-2 border-be-navy py-5 md:py-10 px-4">
                    {/* This is the nav bar */}
                    <h3 className="text-2xl font-bold tracking-wider text-be-yellow">Practice</h3>
                    <hr className="w-2/4 my-4 border-be-orange"></hr>

                    <div className="flex md:block gap-2 flex-wrap">
                        <SideBarElement to="#general-tour">
                            <h4 className="font-medium">Practice Tours</h4>
                        </SideBarElement>
                        <SideBarElement to="#questions">
                            <h4 className="font-medium">Practice Questions</h4>
                        </SideBarElement>
                    </div>
                </div>
                <div className="w-11/12 md:w-4/6 mx-auto md:mx-0 mt-6 md:mt-16">
                    <div id="general-tour" className="flex flex-col sm:flex-row justify-between items-start gap-3 scroll-mt-24 mb-4">
                        <div>
                            <h1 className="text-2xl sm:text-3xl font-bold tracking-wider text-white">
                                Welcome to {brandName}
                            </h1>
                            <p className="text-sm text-be-light-gray mt-1 mb-2">
                                This is the general Baskin Engineering tour most commonly given
                            </p>
                        </div>
                        <Link to="/progress/general"
                            className="p-2.5 px-6 rounded-full bg-be-orange hover:bg-be-orange-dark text-black text-sm font-bold shrink-0 transition-colors">
                            My Progress
                        </Link>
                    </div>
                    <Carousel className="rounded-2xl shadow-lg"
                        prevArrow={({handlePrev}) => {
                            return (
                                <IconButton
                                className={"!absolute bottom-0 left-4 -translate-y-2/4 bg-be-navy/80 hover:bg-be-navy text-white rounded-full"}
                                onClick={handlePrev}>
                                    <FaChevronLeft className="fill-white"/>
                                </IconButton>
                            )
                        }}
                        nextArrow={({handleNext}) => {
                            return (
                                <IconButton
                                className={"!absolute bottom-0 right-4 -translate-y-2/4 bg-be-navy/80 hover:bg-be-navy text-white rounded-full"}
                                onClick={handleNext}>
                                    <FaChevronRight className="fill-white"/>
                                </IconButton>
                            )
                        }}
                        navigation={({ setActiveIndex, activeIndex, length }) => (
                        <div className="absolute bottom-36 left-2/4 z-50 flex -translate-x-2/4 gap-2">
                            {new Array(length).fill("").map((_, i) => (
                            <span
                                key={i}
                                className={`block h-1.5 cursor-pointer rounded-2xl transition-all content-[''] ${
                                activeIndex === i ? "w-6 bg-be-orange" : "w-4 bg-be-light-gray/60"
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

                {/* Divider for the other section of practicing questions parents may ask: */}
                    <hr className="w-3/4 mx-auto mt-16 border-be-navy"/>
                    <div id="questions" className="scroll-mt-24">
                        <div className="mt-10 mb-4 flex flex-col sm:flex-row justify-between items-start gap-3">
                            <div>
                                <h1 className="text-2xl sm:text-3xl font-bold tracking-wider text-white">
                                    Practicing General Questions
                                </h1>
                                <p className="text-sm text-be-light-gray mt-1 mb-2">
                                    Parents or students may ask general questions about Baskin Engineering.
                                </p>
                            </div>
                            <div className="flex gap-2 shrink-0 flex-wrap">
                                <Link to="/questions-editor"
                                    className="p-2.5 px-6 rounded-full bg-be-orange hover:bg-be-orange-dark text-black text-sm font-bold transition-colors">
                                    Question Editor
                                </Link>
                                <Link to="/questions-progress"
                                    className="p-2.5 px-6 rounded-full border-2 border-be-light-gray text-white hover:bg-be-navy text-sm font-bold transition-colors">
                                    My Progress
                                </Link>
                            </div>
                        </div>
                        <div className="flex justify-center items-center gap-5 flex-wrap">
                            {questionSets.length === 0 ?
                                <p className="text-be-light-gray italic text-sm">No question sets yet - use Question Editor to create one.</p>
                                : questionSets.map(set => (
                                <Card key={set.id} to={`/questions/${set.id}`} title={set.title}>
                                    <IoSchool className="mx-auto my-5 box-border w-16 h-16 text-be-orange"/>
                                    <p className="text-be-light-gray font-medium">
                                        {set.questions.length} question{set.questions.length === 1 ? "" : "s"}
                                    </p>
                                </Card>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        </>
    )
}

function Tour({src, to, name, cta, secondaryTo, secondaryCta}: {src: string, to: string, name: string, cta: string, secondaryTo?: string, secondaryCta?: string}) {
    return (
        <div className="w-full bg-white mx-auto rounded-2xl overflow-hidden">
            <div className="relative w-full h-64">
                <img src={src} alt={name} className="brightness-75 rounded-t-2xl object-cover h-64 w-full absolute top-0 right-0 z-0"/>
                <h2 className="bg-be-navy text-white font-bold p-3 px-5 z-10 relative rounded-xl w-3/4 sm:w-2/4 top-16 left-5 text-xl sm:text-2xl md:text-3xl border-l-4 border-be-orange shadow-md">{name}</h2>
            </div>
            <div className="bg-white text-black rounded-b-2xl p-4 flex flex-col gap-2.5">
                <Link className="mx-auto bg-be-orange text-black p-3 font-bold flex justify-center items-center w-3/4 rounded-full shadow-sm
                    hover:bg-be-orange-dark transition-colors gap-3" to={to}>
                    <FaPlay/>
                    <span>{cta}</span>
                </Link>
                {secondaryTo && secondaryCta &&
                    <Link className="mx-auto bg-be-navy text-white p-3 font-bold flex justify-center items-center w-3/4 rounded-full shadow-sm
                        hover:bg-be-navy-dark transition-colors gap-3" to={secondaryTo}>
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
        <Link to={to} className={"flex justify-start items-center p-2.5 my-3 rounded-r-lg transition-colors" + (hash == to ? " bg-be-navy border-l-solid border-l-4 border-l-be-orange text-white font-bold" : " text-be-light-gray hover:bg-be-navy/60 hover:text-white")}>
            {children}
        </Link>
    )
}


function Card({children, title, to}: {children:JSX.Element[], title: string, to: string}) {

    return (
        <Link to={to} className="w-full sm:w-5/12 md:w-4/12 rounded-2xl bg-be-navy border-b-4 border-be-orange text-white p-5 text-center hover:bg-be-navy-dark transition-colors shadow-md">
            <h3 className="text-2xl font-bold">{title}</h3>
            {children}
        </Link>
    )
}
