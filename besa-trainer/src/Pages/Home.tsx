import { Link, useLocation } from "react-router-dom";
import Header from "../Components/Header";
import type { JSX } from "react";
import Background from "../imgs/background.jpg"
import { FaPlay } from "react-icons/fa";
import {Carousel, IconButton} from "@material-tailwind/react"
import { FaChevronLeft } from "react-icons/fa";
import { FaChevronRight } from "react-icons/fa";

export default function Home() {
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
                                Simulate General Tour
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
                        <div className="absolute bottom-20 left-2/4 z-50 flex -translate-x-2/4 gap-2">
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
                        <Tour src={Background} to="/simulator/general?f=f1" name="First Floor"/>
                        <Tour src={Background} to="/simulator/general?f=f2" name="Second Floor"/>
                        <Tour src={Background} to="/simulator/general?f=f3" name="Third Floor"/>
                        <Tour src={Background} to="/simulator/general?f=b" name="Slugworks"/>
                    </Carousel>
                </div>
            </div>
        </>
    )
}

function Tour({src, to, name}: {src: string, to: string, name: string}) {
    return (
        <div className="w-full bg-white mx-auto rounded-2xl">
            <div className="relative w-full h-64">
                <img src={src} className="brightness-75 rounded-t-2xl object-cover h-64 w-full absolute top-0 right-0 z-0"/>
                <h2 className="bg-blue-800 p-3 z-10 relative rounded-xl w-2/4 top-16 left-5 text-3xl">{name}</h2>
            </div>
            <div className="bg-white text-black rounded-b-2xl p-3">
                <Link className="mx-auto bg-amber-500 p-3 bold flex justify-center items-center w-3/4 rounded-full shadow-light
                    hover:bg-amber-600 gap-4" to={to}>
                    <FaPlay/>
                    <span>Begin Practice</span>
                </Link>
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