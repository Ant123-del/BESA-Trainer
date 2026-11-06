import type { JSX } from "react"
import Header from "../Components/Header"
import CourseChecklist from "../Components/CourseChecklist"

export default function SlugworksCourse(): JSX.Element {
    return (
        <div className="bg-be-navy-darker w-full min-h-screen text-white font-sans">
            <Header/>
            <div className="h-20 relative top-0 left-0 w-full"></div>
            <div className="w-11/12 max-w-4xl mx-auto py-8">
                <h1 className="text-2xl sm:text-3xl md:text-4xl tracking-wider mb-1">Slugworks Course</h1>
                <CourseChecklist/>
            </div>
        </div>
    )
}
