import { ClipLoader } from "react-spinners";
import { useState } from "react";

export default function DebugLoader() {
    const [initialLoading] = useState(true)
    return (
        <div className="bg-gray-900 w-full min-h-screen text-white">
            <div className="fixed bottom-0 right-0 p-3 flex justify-end items-center gap-3 text-2xl">
                <span className="flex justify-center gap-2 items-center">Continue to Training</span>
                <button
                className={"p-2 rounded-full" + (initialLoading ? " bg-blue-gray-400" : " bg-blue-800 hover:bg-blue-900")}
                disabled={initialLoading}>
                    {initialLoading ? <ClipLoader color="white" size={20}/> : <span>Lets Go!</span>}
                </button>
            </div>
        </div>
    )
}
