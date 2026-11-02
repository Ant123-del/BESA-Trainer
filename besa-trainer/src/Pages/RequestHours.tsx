import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import Header from "../Components/Header"
import HoursRequestPanel from "../Components/HoursRequestPanel"

//nobody's touched the page this long - whoever was here walked off, so hand the kiosk back to the dashboard
const IDLE_RESET_MS = 3 * 60_000

//the kiosk's Request Hours tab (root only) - a member types their School Id and gets the same Request Hours
//panel as on their Profile. Once they send, it goes back to the dashboard, ready for the next person.
export default function RequestHours() {
    const navigate = useNavigate()
    const [studentId, setStudentId] = useState("")
    const [activeId, setActiveId] = useState<string | null>(null)

    useEffect(() => {
        if (!activeId) return
        let timer = setTimeout(() => navigate("/"), IDLE_RESET_MS)
        const bump = () => {
            clearTimeout(timer)
            timer = setTimeout(() => navigate("/"), IDLE_RESET_MS)
        }
        const events = ["pointerdown", "keydown", "wheel", "touchstart"] as const
        events.forEach(e => window.addEventListener(e, bump))
        return () => {
            clearTimeout(timer)
            events.forEach(e => window.removeEventListener(e, bump))
        }
    }, [activeId, navigate])

    function start() {
        const id = studentId.trim()
        if (id) setActiveId(id)
    }

    function reset() {
        setActiveId(null)
        setStudentId("")
    }

    return (
        <div className="bg-be-navy-darker w-full min-h-screen text-white font-sans">
            <Header/>
            <div className="h-20 relative top-0 left-0 w-full"></div>
            <div className="w-11/12 max-w-5xl mx-auto py-10 flex flex-col gap-6">
                <section className="bg-be-navy rounded-2xl p-6 border-t-4 border-be-orange shadow-md">
                    <h2 className="text-2xl font-bold tracking-wide mb-4 text-center">Request Missing Hours</h2>
                    <label className="block text-sm text-be-light-gray mb-1 font-medium">Enter School Id</label>
                    <div className="flex gap-2">
                        <input
                            value={studentId}
                            onChange={(e) => setStudentId(e.target.value)}
                            onKeyDown={(e) => { if (e.key === "Enter" && !activeId) start() }}
                            disabled={!!activeId}
                            autoFocus
                            placeholder="Ex: 1234567"
                            className="flex-1 min-w-0 p-3 rounded-xl bg-be-navy-darker text-white border border-be-light-gray/30 disabled:opacity-60"
                        />
                        {activeId ?
                            <button onClick={reset}
                                className="px-5 py-2 rounded-full border-solid border-2 border-be-light-gray hover:bg-be-navy-dark font-bold transition-colors">
                                Cancel
                            </button>
                            :
                            <button onClick={start} disabled={!studentId.trim()}
                                className="px-5 py-2 rounded-full bg-be-orange hover:bg-be-orange-dark text-black font-bold disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                                Next
                            </button>
                        }
                    </div>
                </section>
                {activeId &&
                    <HoursRequestPanel key={activeId} studentId={activeId}
                        onSent={(message) => navigate("/", {state: {notice: message}})}/>
                }
            </div>
        </div>
    )
}
