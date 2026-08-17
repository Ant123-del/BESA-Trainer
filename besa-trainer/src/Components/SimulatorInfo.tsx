import { FaHandshake, FaHeadphones, FaHeart, FaKeyboard, FaMicrophone } from "react-icons/fa"
import { IoMdSettings } from "react-icons/io"

export default function SimulatorInfo() {
    return (
        
        <section className="p-5 pb-24 max-w-3/4 mx-auto">
            <h3 className="text-amber-500 text-3xl tracking-wide my-5">Using The Simulation</h3>
            <p className="p-2">
                The tour video plays in short sections. Each time you reach a marker, playback pauses and you're
                tested on what was just said before you can move on to the next part - you can watch the upcoming
                section, but you can't skip its test. Pick whichever of these three practice types fits how you
                learn best (and switch anytime from the <IoMdSettings className="inline mb-1"/> settings icon):
            </p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 my-5">
                <div className="bg-gray-800 rounded-2xl p-4">
                    <div className="bg-gray-700 rounded-lg p-2 text-sm mb-3">
                        Welcome to the <span className="inline-block bg-gray-600 rounded px-4 py-0.5 align-middle">&nbsp;</span>, my name is Sam.
                    </div>
                    <h4 className="font-semibold">Fill In The Blank</h4>
                    <p className="text-sm text-gray-400">Type in the missing word(s) from a sentence you just heard.</p>
                </div>
                <div className="bg-gray-800 rounded-2xl p-4">
                    <div className="bg-gray-700 rounded-lg p-2 mb-3 flex justify-center">
                        <FaKeyboard className="w-6 h-6 text-gray-300"/>
                    </div>
                    <h4 className="font-semibold">Retype Script</h4>
                    <p className="text-sm text-gray-400">Type out the whole section from memory, then compare it to the real thing.</p>
                </div>
                <div className="bg-gray-800 rounded-2xl p-4">
                    <div className="bg-gray-700 rounded-lg p-2 mb-3 flex justify-center">
                        <FaMicrophone className="w-6 h-6 text-gray-300"/>
                    </div>
                    <h4 className="font-semibold">Speak Script</h4>
                    <p className="text-sm text-gray-400">Say the section out loud and have it transcribed for comparison.</p>
                </div>
            </div>
            <p className="p-2">
                After each test, rate how it went - the colored dots on the video's progress bar keep track for you:
            </p>
            <div className="flex items-center gap-6 p-2 text-sm text-gray-300">
                <span className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-amber-600 inline-block"/>Not tested yet</span>
                <span className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-red-600 inline-block"/>Hard</span>
                <span className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-yellow-500 inline-block"/>Good</span>
                <span className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-green-600 inline-block"/>Easy</span>
            </div>

            <h3 className="text-amber-500 text-3xl tracking-wide my-5">Mindset When Touring</h3>
            <p className="p-2">
                Think of a tour as a one-sided conversation - you'll be doing most of the talking, but that
                doesn't mean it's a monologue. Keep these three things in mind while you speak:
            </p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 my-5">
                <div className="bg-gray-800 rounded-2xl p-4 text-center">
                    <FaHeadphones className="w-6 h-6 mx-auto mb-2 text-gray-300"/>
                    <h4 className="font-semibold">Active Listening</h4>
                    <p className="text-sm text-gray-400">Even while you're talking, stay tuned in to reactions and questions from the group.</p>
                </div>
                <div className="bg-gray-800 rounded-2xl p-4 text-center">
                    <FaHandshake className="w-6 h-6 mx-auto mb-2 text-gray-300"/>
                    <h4 className="font-semibold">Respect</h4>
                    <p className="text-sm text-gray-400">Every group is different - meet them where they are instead of running one fixed script.</p>
                </div>
                <div className="bg-gray-800 rounded-2xl p-4 text-center">
                    <FaHeart className="w-6 h-6 mx-auto mb-2 text-gray-300"/>
                    <h4 className="font-semibold">Empathy</h4>
                    <p className="text-sm text-gray-400">You're there to help them understand the school, not just to get through your lines.</p>
                </div>
            </div>
        </section>
    )
}