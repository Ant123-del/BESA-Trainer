import { FaKeyboard, FaMicrophone } from "react-icons/fa"
import { IoMdSettings } from "react-icons/io"

export default function SimulatorInfo() {
    return (
        
        <section className="p-5 pb-24 max-w-3/4 mx-auto px-4 font-sans">
            <h3 className="text-be-orange font-bold text-2xl sm:text-3xl tracking-wide my-5">Using The Simulation</h3>
            <p className="p-2 text-be-light-gray leading-relaxed">
                The tour video plays in short sections. Each time you reach a marker, playback pauses and you're
                tested on what was just said before you can move on to the next part - you can watch the upcoming
                section, but you can't skip its test. Pick whichever of these three practice types fits how you
                learn best (and switch anytime from the <IoMdSettings className="inline mb-1 text-be-yellow"/> settings icon):
            </p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 my-5">
                <div className="bg-be-navy rounded-2xl p-4 border-t-4 border-be-orange">
                    <div className="bg-be-navy-darker rounded-lg p-2 text-sm mb-3">
                        Welcome to the <span className="inline-block bg-be-navy-dark border-b-2 border-be-orange rounded px-4 py-0.5 align-middle">&nbsp;</span>, my name is Sam.
                    </div>
                    <h4 className="font-bold text-white">Fill In The Blank</h4>
                    <p className="text-sm text-be-light-gray">Type in the missing word(s) from a sentence you just heard.</p>
                </div>
                <div className="bg-be-navy rounded-2xl p-4 border-t-4 border-be-orange">
                    <div className="bg-be-navy-darker rounded-lg p-2 mb-3 flex justify-center">
                        <FaKeyboard className="w-6 h-6 text-be-yellow"/>
                    </div>
                    <h4 className="font-bold text-white">Retype Script</h4>
                    <p className="text-sm text-be-light-gray">Type out the whole section from memory, then compare it to the real thing.</p>
                </div>
                <div className="bg-be-navy rounded-2xl p-4 border-t-4 border-be-orange">
                    <div className="bg-be-navy-darker rounded-lg p-2 mb-3 flex justify-center">
                        <FaMicrophone className="w-6 h-6 text-be-yellow"/>
                    </div>
                    <h4 className="font-bold text-white">Speak Script</h4>
                    <p className="text-sm text-be-light-gray">Say the section out loud and have it transcribed for comparison.</p>
                </div>
            </div>
            <p className="p-2 text-be-light-gray">
                After each test, rate how it went - the colored dots on the video's progress bar keep track for you:
            </p>
            <div className="flex flex-wrap items-center gap-3 sm:gap-6 p-2 text-sm text-white font-medium">
                <span className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-be-orange inline-block"/>Not tested yet</span>
                <span className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-red-600 inline-block"/>Hard</span>
                <span className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-be-yellow inline-block"/>Good</span>
                <span className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-green-600 inline-block"/>Easy</span>
            </div>
        </section>
    )
}