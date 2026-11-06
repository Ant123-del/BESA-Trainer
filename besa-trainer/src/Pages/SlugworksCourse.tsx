import { useEffect, useState, type JSX } from "react"
import { FaCheck, FaChevronDown, FaChevronRight, FaEdit, FaRegFileAlt, FaRocket } from "react-icons/fa"
import { MoonLoader } from "react-spinners"
import Header from "../Components/Header"
import { checkCourseItems, getCourse, type Course, type CourseItem, type CourseModule } from "../Tools/Fetch"

const KIND_ICONS = {page: FaRegFileAlt, quiz: FaRocket, assignment: FaEdit}

function requiredIds(module: CourseModule): string[] {
    return module.items.filter(i => i.required).map(i => i.id)
}

function CheckCircle({done, partial, label, disabled, onClick}: {done: boolean, partial?: boolean, label: string, disabled: boolean, onClick: () => void}): JSX.Element {
    return (
        <button type="button" role="checkbox" aria-checked={partial ? "mixed" : done} aria-label={label} disabled={disabled} onClick={onClick}
            className={"w-7 h-7 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors disabled:opacity-60 " +
                (done ? "bg-green-600 border-green-600 text-white" : partial ? "border-amber-500 hover:bg-amber-50" : "border-gray-400 hover:bg-gray-100")}>
            {done ? <FaCheck className="w-3 h-3"/> : partial && <span className="w-3 h-0.5 bg-amber-500"></span>}
        </button>
    )
}

function ItemRow({item, done, busy, onToggle}: {item: CourseItem, done: boolean, busy: boolean, onToggle: () => void}): JSX.Element {
    const Icon = KIND_ICONS[item.kind]
    return (
        <li className="flex items-center gap-3 border-t border-gray-200 py-3 pr-4" style={{paddingLeft: `${1 + item.indent * 1.25}rem`}}>
            <Icon className="w-4 h-4 text-gray-500 shrink-0" aria-hidden/>
            <div className="flex-1 min-w-0">
                <p className={"text-sm sm:text-base font-semibold break-words " + (item.required ? "text-gray-900" : "text-gray-500")}>{item.title}</p>
                {item.points !== undefined && <p className="text-xs text-gray-500">{item.points} pts</p>}
            </div>
            {item.required && <CheckCircle done={done} label={`Mark ${item.title} done`} disabled={busy} onClick={onToggle}/>}
        </li>
    )
}

//a copy of the Slugworks Canvas modules page to keep track of the course with: tick each item as you finish it, or tick a
//module's circle for everything in it. Every required item done means certified.
export default function SlugworksCourse(): JSX.Element {
    const [course, setCourse] = useState<Course | null>(null)
    const [done, setDone] = useState<Record<string, string>>({})
    const [closed, setClosed] = useState<Record<string, boolean>>({})
    const [error, setError] = useState("")
    const [busy, setBusy] = useState(false)

    useEffect(() => {
        getCourse().then(result => {
            if (result.success) {
                setCourse(result.course)
                setDone(result.done)
            } else {
                setError(result.detail)
            }
        })
    }, [])

    async function set(itemIds: string[], value: boolean) {
        setBusy(true)
        setError("")
        const result = await checkCourseItems(itemIds, value)
        setBusy(false)
        if (result.success) {
            setDone(result.done)
        } else {
            setError(result.detail)
        }
    }

    const modules = course?.modules || []
    const certified = modules.filter(m => requiredIds(m).every(id => done[id]))

    return (
        <div className="bg-be-navy-darker w-full min-h-screen text-white font-sans">
            <Header/>
            <div className="h-20 relative top-0 left-0 w-full"></div>
            <div className="w-11/12 max-w-4xl mx-auto py-8">
                <h1 className="text-2xl sm:text-3xl md:text-4xl tracking-wider">Slugworks Course</h1>
                <p className="text-sm text-be-light-gray mt-1 mb-5">
                    Check things off as you finish them on Canvas. {course && `${certified.length} of ${modules.length} modules certified.`}
                </p>
                {error && <p className="text-sm text-red-400 mb-3">{error}</p>}
                {!course && !error && <div className="flex justify-center py-16"><MoonLoader color="white" size={36}/></div>}
                <div className="flex flex-col gap-5">
                    {modules.map(module => {
                        const ids = requiredIds(module)
                        const finished = ids.filter(id => done[id]).length
                        const complete = finished === ids.length
                        const open = !closed[module.id]
                        return (
                            <section key={module.id} className="rounded-lg overflow-hidden bg-white text-gray-900 shadow-md">
                                <div className="flex items-center gap-3 bg-gray-100 p-3 sm:p-4">
                                    <button type="button" aria-expanded={open} onClick={() => setClosed({...closed, [module.id]: open})}
                                        className="flex items-center gap-2 flex-1 min-w-0 text-left">
                                        {open ? <FaChevronDown className="w-3 h-3 shrink-0" aria-hidden/> : <FaChevronRight className="w-3 h-3 shrink-0" aria-hidden/>}
                                        <span className="min-w-0">
                                            <span className="block font-bold break-words">{module.title}</span>
                                            {module.prerequisites.length > 0 &&
                                                <span className="block text-xs text-gray-600">Prerequisites: {module.prerequisites.join(", ")}</span>
                                            }
                                        </span>
                                    </button>
                                    {complete ?
                                        <span className="text-xs font-bold px-2 py-1 rounded bg-green-600 text-white shrink-0">Certified</span>
                                        : <span className="text-xs text-gray-600 tabular-nums shrink-0">{finished}/{ids.length}</span>
                                    }
                                    <CheckCircle done={complete} partial={finished > 0} label={`Mark all of ${module.title} done`} disabled={busy}
                                        onClick={() => void set(ids, !complete)}/>
                                </div>
                                {open &&
                                    <ul>
                                        {module.items.map(item => (
                                            <ItemRow key={item.id} item={item} done={!!done[item.id]} busy={busy} onToggle={() => void set([item.id], !done[item.id])}/>
                                        ))}
                                    </ul>
                                }
                            </section>
                        )
                    })}
                </div>
            </div>
        </div>
    )
}
