import { GiCoffeeCup } from "react-icons/gi";
import { HiBeaker } from "react-icons/hi";
import { FaTree, FaTools, FaPlay, FaPlus, FaTrash } from "react-icons/fa";
import { FaHandshakeSimple } from "react-icons/fa6";
import { MdFileUpload } from "react-icons/md";
import { LuNewspaper } from "react-icons/lu";

//a small step-number badge used to key each instruction to its visual.
function StepBadge({n}: {n: number}) {
    return (
        <span className="shrink-0 w-8 h-8 rounded-full bg-amber-600 text-gray-950 font-bold flex items-center justify-center">
            {n}
        </span>
    )
}

//wraps a mockup so every visual sits inside the same dark "screenshot-like" frame.
function VisualFrame({children, label}: {children: React.ReactNode, label: string}) {
    return (
        <div className="bg-gray-950 border border-gray-700 rounded-xl p-4 w-full max-w-md">
            {children}
            <p className="text-xs text-gray-500 text-center mt-3">{label}</p>
        </div>
    )
}

function Step({n, title, children, visual}: {n: number, title: string, children: React.ReactNode, visual: React.ReactNode}) {
    return (
        <div className="flex flex-col md:flex-row gap-6 items-start bg-gray-800/60 rounded-2xl p-5">
            <div className="flex-1">
                <div className="flex items-center gap-3 mb-2">
                    <StepBadge n={n}/>
                    <h4 className="text-xl tracking-wide text-white">{title}</h4>
                </div>
                <div className="text-gray-300 text-sm leading-relaxed pl-11">
                    {children}
                </div>
            </div>
            <div className="flex justify-center w-full md:w-auto">
                {visual}
            </div>
        </div>
    )
}

export default function GettingStarted() {
    return (
        <div className="text-white p-6 max-w-5xl mx-auto">
            <h2 className="text-4xl tracking-wide mb-1">Getting Started</h2>
            <p className="text-gray-400 mb-8">A quick walkthrough of how to build out a floor's tour from scratch.</p>

            <div className="flex flex-col gap-6">
                {/* Step 1 - pick a floor */}
                <Step n={1} title="Pick A Floor From The Sidebar"
                    visual={
                        <VisualFrame label="Sidebar - click a floor to start editing it">
                            <div className="flex flex-col gap-2">
                                {[
                                    {icon: <LuNewspaper/>, label: "Getting Started", active: false},
                                    {icon: <GiCoffeeCup/>, label: "First Floor", active: true},
                                    {icon: <HiBeaker/>, label: "Second Floor", active: false},
                                    {icon: <FaTree/>, label: "Third Floor", active: false},
                                    {icon: <FaTools/>, label: "Basement", active: false},
                                    {icon: <FaHandshakeSimple/>, label: "Exit", active: false},
                                ].map((row, i) => (
                                    <div key={i} className={"flex items-center gap-3 p-2 rounded-full text-sm " + (row.active ? "bg-gray-700" : "")}>
                                        <span className="border-2 border-gray-300 p-1.5 rounded-full">{row.icon}</span>
                                        {row.label}
                                    </div>
                                ))}
                            </div>
                        </VisualFrame>
                    }
                >
                    Every floor (First Floor, Second Floor, Third Floor, Basement) has its own tour, built independently.
                    Click one in the sidebar to open its editor.
                </Step>

                {/* Step 2 - upload/select a draft */}
                <Step n={2} title="Upload Or Select A Video Draft"
                    visual={
                        <VisualFrame label="Up to two drafts per floor - the amber pill marks the default">
                            <div className="flex gap-3">
                                <div className="flex-1 border-dashed border-2 border-blue-800 rounded-xl p-4 text-center text-gray-400">
                                    <MdFileUpload className="w-6 h-6 mx-auto mb-1"/>
                                    <span className="text-xs">Drop .mp4</span>
                                </div>
                                <div className="flex-1 bg-gray-700 rounded-xl p-2">
                                    <div className="bg-gray-600 rounded-lg h-14 mb-2 flex items-center justify-center text-gray-400">
                                        <FaPlay/>
                                    </div>
                                    <div className="flex justify-between items-center text-xs">
                                        <span>Draft A</span>
                                        <span className="bg-amber-800 rounded-full px-2 py-0.5">Default</span>
                                    </div>
                                </div>
                            </div>
                        </VisualFrame>
                    }
                >
                    If a floor has no video yet, drag and drop an .mp4 to create its first draft. A floor can hold up to
                    two drafts at once (handy for trying out a re-shoot) - click a draft card to select it for editing,
                    and use <span className="text-amber-400">Set Default Video</span> to choose which one trainees actually see.
                </Step>

                {/* Step 3 - place markers */}
                <Step n={3} title="Place Section Markers On The Video"
                    visual={
                        <VisualFrame label="Markers split the video into the sections trainees are quizzed on">
                            <div className="bg-gray-700 rounded-2xl p-3">
                                <div className="bg-gray-600 rounded-lg h-16 mb-3 flex items-center justify-center text-gray-400">
                                    <FaPlay/>
                                </div>
                                <div className="relative h-3 bg-gray-600 rounded-full">
                                    <div className="absolute -top-1 w-4 h-4 bg-amber-500 rounded-full" style={{left: "20%"}}/>
                                    <div className="absolute -top-1 w-4 h-4 bg-amber-500 rounded-full" style={{left: "55%"}}/>
                                    <div className="absolute -top-1 w-4 h-4 bg-amber-500 rounded-full" style={{left: "85%"}}/>
                                </div>
                                <div className="flex justify-center gap-4 mt-3 text-gray-300">
                                    <span className="bg-gray-600 rounded-full p-2"><FaPlus/></span>
                                    <span className="bg-gray-600 rounded-full p-2"><FaTrash/></span>
                                </div>
                            </div>
                        </VisualFrame>
                    }
                >
                    While the draft is playing, use the <FaPlus className="inline"/> button to drop a marker at the
                    current timestamp - this is where a new quiz section begins. Give it a name, and remove one with
                    the <FaTrash className="inline"/> button if it's in the wrong spot.
                </Step>

                {/* Step 4 - script + highlighter */}
                <Step n={4} title="Edit The Script & Highlight Fill-In-The-Blanks"
                    visual={
                        <VisualFrame label="Highlighter mode - highlight one or more words per sentence">
                            <div className="bg-gray-700 rounded-xl p-3 text-sm leading-loose">
                                Welcome to the <mark className="bg-amber-400/70 text-black rounded px-1">tour</mark>, my name
                                is <mark className="bg-amber-400/70 text-black rounded px-1">Sam</mark> and I'll be your guide today.
                            </div>
                            <div className="flex justify-center mt-3">
                                <span className="text-xs px-3 py-1 rounded-full bg-amber-600 text-gray-950 font-semibold">Highlighter: On</span>
                            </div>
                        </VisualFrame>
                    }
                >
                    Below the video, the script for the selected draft can be retyped directly. Turn on
                    <span className="text-amber-400"> Highlighter</span> mode and select any piece of text within a
                    sentence to turn it into a blank - a single sentence can have several separate blanks highlighted
                    this way. Click a highlight again to remove just that blank. Editing a sentence's wording later
                    automatically clears out any blanks that no longer match, so stale questions never pile up.
                </Step>
            </div>

            <div className="mt-8 bg-gray-800/60 border border-amber-700/50 rounded-2xl p-5">
                <h4 className="text-amber-500 text-lg tracking-wide mb-2">Tips</h4>
                <ul className="list-disc mx-6 text-sm text-gray-300 space-y-1">
                    <li>Every marker needs at least one highlighted blank after it, or that section won't have a fill-in-the-blank question.</li>
                    <li>Saving script changes uploads the new text right away - trainees mid-tour will see it the next time they load that section.</li>
                    <li>Deleting a draft cannot be undone, so double check which one is selected first.</li>
                </ul>
            </div>
        </div>
    )
}
