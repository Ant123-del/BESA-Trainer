import { useState } from "react";
import { IoMdArrowRoundBack, IoMdSettings } from "react-icons/io";
import { useNavigate, useParams } from "react-router-dom";

export default function QuestionSimulator() {
    const [, setSettings] = useState(false)
    const navigate = useNavigate()
    const {type} = useParams()


    function toTitleCase(str: string): string {
        return str.toLowerCase().split(" ").map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(" ")
    }

    return (
        <div className="bg-gray-900 w-full min-h-screen text-white">
        {/* custom header for the simulator */}
            <header className="p-3 flex justify-between items-center border-b-2 border-b-solid border-b-gray-500">
            <div className="">
                <h1
                    className="text-4xl tracking-wider"
                >{toTitleCase(type as string)} Questions
                </h1>
            </div>
            <div className="flex justify-between items-center w-1/6">
                {/* Going to have to change back warning once progress is made, say that it wont save */}
                <div onClick={() => navigate(-1)} className="flex justify-center gap-2 items-center hover:text-gray-400 p-2 cursor-pointer ">
                    <IoMdArrowRoundBack/>
                    <span>Back</span>
                </div>
                <IoMdSettings onClick={() => setSettings(true)} className="fill-white hover:fill-gray-400 cursor-pointer w-5 h-5 mr-3"/>
            </div>
            </header>
            {/* Container for main simulator */}
            <div className="w-11/12 box-border mx-auto my-3 rounded-2xl bg-gray-800 p-3">
                
            </div>
        </div>
    )
}

