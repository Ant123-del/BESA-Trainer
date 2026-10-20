import { useEffect, useState } from "react"
import { MoonLoader } from "react-spinners"
import { FaPlus, FaRegStickyNote, FaTrash } from "react-icons/fa"
import Header from "../Components/Header"
import TaskNoteCard from "../Components/TaskNoteCard"
import { addActivityType, assignTasks, getActivityTypes, getBesaAccounts, setTaskNote, type BesaAccount, type TaskNote } from "../Tools/Fetch"

const TASK_NAME_MAX_LENGTH = 40 // same cap as the backend's TASK_NAME_MAX_LENGTH
//same caps as the backend's TASK_NOTE_* limits
const NOTE_DESCRIPTION_MAX_LENGTH = 1000
const NOTE_ITEM_MAX_LENGTH = 200
const NOTE_MAX_ITEMS = 20

//BESA Lead only (gated by RequireAccess in App.tsx) - picks which activities each BESA and BESA Lead (leads
//included, themselves too) can clock in for. The kiosk's Clock In only offers someone their assigned tasks (anyone
//with none yet sees every activity). Clock-out still offers every activity, for anything extra they worked on.
//Each assigned task can also carry a note for that person - a description plus checkboxes they tick off - which
//shows at the kiosk when they clock in, in Current Sessions, and on their Profile.
export default function AssignTasks() {
    const [accounts, setAccounts] = useState<BesaAccount[] | null>(null)
    const [tasks, setTasks] = useState<string[] | null>(null)
    const [savingUids, setSavingUids] = useState<string[]>([])
    const [search, setSearch] = useState("")
    const [newTask, setNewTask] = useState("")
    const [addingTask, setAddingTask] = useState(false)
    const [bulkTask, setBulkTask] = useState<string | null>(null)
    const [error, setError] = useState("")

    useEffect(() => {
        getBesaAccounts().then(result => setAccounts(result || []))
        getActivityTypes().then(result => setTasks(result || []))
    }, [])

    async function save(account: BesaAccount, wanted: string[]): Promise<boolean> {
        //a task removed from the list at the kiosk would be refused, so it's dropped here
        const next = wanted.filter(t => tasks?.includes(t))
        setSavingUids(prev => [...prev, account.uid])
        const result = await assignTasks(account.uid, next)
        setSavingUids(prev => prev.filter(uid => uid !== account.uid))
        if (result.success) {
            setAccounts(prev => prev && prev.map(a => a.uid === account.uid ? {...a, assignedTasks: result.assignedTasks || next} : a))
            return true
        }
        setError(`Couldn't update ${account.besaName || "that account"}: ${result.detail || "something went wrong."}`)
        return false
    }

    function toggle(account: BesaAccount, task: string) {
        setError("")
        const has = account.assignedTasks.includes(task)
        void save(account, has ? account.assignedTasks.filter(t => t !== task) : [...account.assignedTasks, task])
    }

    //hands one task to everyone who doesn't have it yet - handy for something everybody does (e.g. Tours)
    async function giveEveryone(task: string) {
        if (!accounts) return
        const missing = accounts.filter(a => !a.assignedTasks.includes(task))
        if (missing.length === 0 || !window.confirm(`Assign "${task}" to ${missing.length === 1 ? "1 more person" : `${missing.length} more people`}?`)) return
        setError("")
        setBulkTask(task)
        await Promise.all(missing.map(a => save(a, [...a.assignedTasks, task])))
        setBulkTask(null)
    }

    async function handleAddTask() {
        const name = newTask.trim()
        if (!name) return
        setAddingTask(true)
        setError("")
        const result = await addActivityType(name)
        setAddingTask(false)
        if (result) {
            setTasks(result)
            setNewTask("")
        } else {
            setError("Couldn't add that task. Please try again.")
        }
    }

    //leads first (they have to give themselves tasks too), then by name
    const shown = (accounts || [])
        .filter(a => (a.besaName || "").toLowerCase().includes(search.trim().toLowerCase()))
        .sort((a, b) => Number(b.accountType === "besaLead") - Number(a.accountType === "besaLead") || (a.besaName || "").localeCompare(b.besaName || ""))
    const unassigned = (accounts || []).filter(a => a.assignedTasks.filter(t => tasks?.includes(t)).length === 0)

    return (
        <div className="bg-gray-900 w-full min-h-screen text-white">
            <Header/>
            <div className="h-16 relative top-0 left-0 w-full"></div>
            <div className="w-11/12 md:w-5/6 max-w-5xl mx-auto py-10">
                <h1 className="text-2xl sm:text-3xl md:text-4xl tracking-wider mb-1">Assign Tasks</h1>
                <p className="text-gray-400 text-sm mb-6">
                    Choose what each BESA can clock in for - the kiosk's Clock In only shows someone the tasks assigned to them here.
                    BESA Leads need tasks too, including your own. Clocking out still lists every activity, so anything extra can be recorded.
                </p>

                {accounts === null || tasks === null ?
                    <div className="flex justify-center py-20"><MoonLoader color="white" size={30}/></div>
                    :
                    <div className="flex flex-col gap-6">
                        {unassigned.length > 0 &&
                            <div className="rounded-xl bg-amber-900/40 border border-amber-600 p-3 text-sm text-amber-100">
                                <span className="font-semibold">{unassigned.length === 1 ? "1 person has" : `${unassigned.length} people have`} no tasks yet, so they see every activity at clock-in:</span>{" "}
                                {unassigned.map(a => a.besaName || "(no name on file)").join(", ")}
                            </div>
                        }

                        <section className="bg-gray-800 rounded-2xl p-4 sm:p-6">
                            <h2 className="text-xl tracking-wide mb-1">Tasks</h2>
                            <p className="text-sm text-gray-400 mb-3">Tap a task to give it to everyone who doesn't have it yet. New tasks are added to the kiosk's activity list.</p>
                            <div className="flex flex-wrap gap-2 mb-4">
                                {tasks.map(task => {
                                    const count = accounts.filter(a => a.assignedTasks.includes(task)).length
                                    return (
                                        <button key={task} onClick={() => void giveEveryone(task)} disabled={bulkTask !== null}
                                            title={`${count} of ${accounts.length} assigned - tap to give it to everyone`}
                                            className="px-3 py-1.5 rounded-full text-sm bg-gray-700 hover:bg-gray-600 disabled:opacity-50 flex items-center gap-2">
                                            {bulkTask === task && <MoonLoader color="white" size={12}/>}
                                            {task}
                                            <span className="text-xs text-gray-400 tabular-nums">{count}/{accounts.length}</span>
                                        </button>
                                    )
                                })}
                            </div>
                            <div className="flex gap-2">
                                <input value={newTask} maxLength={TASK_NAME_MAX_LENGTH} disabled={addingTask}
                                    onChange={(e) => setNewTask(e.target.value)}
                                    onKeyDown={(e) => { if (e.key === "Enter") void handleAddTask() }}
                                    placeholder="New task name"
                                    className="flex-1 min-w-0 p-2 px-3 rounded-xl bg-gray-700 text-white"/>
                                <button onClick={() => void handleAddTask()} disabled={addingTask || !newTask.trim() || tasks.includes(newTask.trim())}
                                    className="px-4 rounded-full bg-blue-800 hover:bg-blue-900 disabled:opacity-40 flex items-center gap-2 text-sm">
                                    {addingTask ? <MoonLoader color="white" size={14}/> : <FaPlus size={11}/>}
                                    Add Task
                                </button>
                            </div>
                        </section>

                        {error && <p className="text-red-400 text-sm">{error}</p>}

                        <section className="flex flex-col gap-3">
                            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name"
                                className="w-full sm:w-72 p-2 px-3 rounded-xl bg-gray-800 border border-gray-700 text-white"/>
                            {shown.length === 0 ?
                                <p className="text-gray-500 italic text-sm">{accounts.length === 0 ? "No BESA accounts yet." : "Nobody matches that name."}</p>
                                : shown.map(account => {
                                    const saving = savingUids.includes(account.uid)
                                    const assigned = account.assignedTasks.filter(t => tasks.includes(t))
                                    return (
                                        <div key={account.uid} className={"bg-gray-800 rounded-2xl p-4 border " + (assigned.length === 0 ? "border-amber-600/70" : "border-transparent")}>
                                            <div className="flex items-center gap-2 mb-3 flex-wrap">
                                                <p className="font-semibold">{account.besaName || "(no name on file)"}</p>
                                                <span className="text-xs px-2 py-0.5 rounded-full bg-gray-700 text-gray-300">
                                                    {account.accountType === "besaLead" ? "BESA Lead" : "BESA"}
                                                </span>
                                                <span className="text-xs text-gray-400">
                                                    {assigned.length === 0 ? "No tasks - sees every activity" : `${assigned.length} task${assigned.length === 1 ? "" : "s"}`}
                                                </span>
                                                {saving && <MoonLoader color="white" size={14}/>}
                                            </div>
                                            <div className="flex flex-wrap gap-2 mb-3">
                                                {tasks.map(task => {
                                                    const selected = assigned.includes(task)
                                                    return (
                                                        <button key={task} type="button" disabled={saving} aria-pressed={selected}
                                                            onClick={() => toggle(account, task)}
                                                            className={"px-3 py-1.5 rounded-full text-sm font-semibold disabled:opacity-60 " +
                                                                (selected ? "bg-amber-500 text-black" : "bg-gray-700 text-gray-200 hover:bg-gray-600")}>
                                                            {task}
                                                        </button>
                                                    )
                                                })}
                                            </div>
                                            {assigned.length > 0 &&
                                                <MemberTaskNotes account={account} tasks={assigned}
                                                    onSaved={(taskNotes) => setAccounts(prev => prev && prev.map(a => a.uid === account.uid ? {...a, taskNotes} : a))}/>
                                            }
                                        </div>
                                    )
                                })
                            }
                        </section>
                    </div>
                }
            </div>
        </div>
    )
}

//one person's notes on their assigned tasks - each shown as it'll appear to them, with Edit; tasks with no note
//get an "add note" button
function MemberTaskNotes({account, tasks, onSaved}: {account: BesaAccount, tasks: string[], onSaved: (notes: TaskNote[]) => void}) {
    const [editing, setEditing] = useState<string | null>(null)
    const withoutNote = tasks.filter(t => !account.taskNotes.some(n => n.task === t))

    return (
        <div className="flex flex-col gap-2">
            {tasks.map(task => {
                const note = account.taskNotes.find(n => n.task === task)
                if (editing === task) {
                    return <TaskNoteEditor key={task} account={account} task={task} note={note}
                        onDone={(notes) => { if (notes) onSaved(notes); setEditing(null) }}/>
                }
                if (!note) return null
                return (
                    <div key={task} className="flex items-start gap-2">
                        <div className="flex-1 min-w-0"><TaskNoteCard note={note}/></div>
                        <button onClick={() => setEditing(task)} disabled={editing !== null}
                            className="text-xs px-3 py-2 rounded-full bg-gray-700 hover:bg-gray-600 disabled:opacity-40 shrink-0">
                            Edit
                        </button>
                    </div>
                )
            })}
            {withoutNote.length > 0 && editing === null &&
                <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-xs text-gray-400">Add a note:</span>
                    {withoutNote.map(task => (
                        <button key={task} onClick={() => setEditing(task)}
                            className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border border-gray-600 text-gray-300 hover:bg-gray-700">
                            <FaRegStickyNote size={10}/> {task}
                        </button>
                    ))}
                </div>
            }
        </div>
    )
}

//writes one note: a description and any number of checkboxes. Saving it empty removes the note. Checkboxes keep
//their ids, so ones the person already ticked stay ticked.
function TaskNoteEditor({account, task, note, onDone}: {
    account: BesaAccount, task: string, note?: TaskNote, onDone: (notes: TaskNote[] | null) => void
}) {
    const [description, setDescription] = useState(note?.description || "")
    const [items, setItems] = useState<{key: number, id?: string, text: string, done: boolean}[]>(
        () => (note?.items || []).map((i, k) => ({key: k, id: i.id, text: i.text, done: i.done})))
    const [nextKey, setNextKey] = useState(items.length)
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState("")

    async function save(remove = false) {
        setBusy(true)
        setError("")
        const result = await setTaskNote(account.uid, task, remove ? "" : description,
            remove ? [] : items.filter(i => i.text.trim()).map(i => ({id: i.id, text: i.text})))
        setBusy(false)
        if (result.success) onDone(result.taskNotes || [])
        else setError(result.detail || "Couldn't save the note.")
    }

    return (
        <div className="rounded-lg border border-amber-500/60 bg-gray-900/50 p-3 flex flex-col gap-2 text-sm">
            <p className="font-semibold text-amber-200">Note on {task} for {account.besaName || "this person"}</p>
            <textarea value={description} maxLength={NOTE_DESCRIPTION_MAX_LENGTH} rows={3} disabled={busy} autoFocus
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What should they know or focus on next time?"
                className="w-full p-2 rounded-lg bg-gray-700 text-white"/>
            <p className="text-xs text-gray-400">Checkboxes (optional) - they tick these off, and you can see their progress here.</p>
            {items.map(item => (
                <div key={item.key} className="flex items-center gap-2">
                    <input type="checkbox" checked={item.done} disabled aria-label={item.done ? "Done" : "Not done yet"}
                        className="w-4 h-4 accent-amber-500 shrink-0"/>
                    <input value={item.text} maxLength={NOTE_ITEM_MAX_LENGTH} disabled={busy}
                        onChange={(e) => setItems(items.map(i => i.key === item.key ? {...i, text: e.target.value} : i))}
                        placeholder="Something to do"
                        className="flex-1 min-w-0 p-1.5 px-2 rounded-lg bg-gray-700 text-white"/>
                    <button onClick={() => setItems(items.filter(i => i.key !== item.key))} disabled={busy} aria-label="Remove checkbox"
                        className="p-2 rounded-full bg-gray-700 hover:bg-red-800 disabled:opacity-40">
                        <FaTrash size={10}/>
                    </button>
                </div>
            ))}
            {items.length < NOTE_MAX_ITEMS &&
                <button onClick={() => { setItems([...items, {key: nextKey, text: "", done: false}]); setNextKey(nextKey + 1) }} disabled={busy}
                    className="self-start flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full bg-gray-700 hover:bg-gray-600 disabled:opacity-40">
                    <FaPlus size={9}/> Add checkbox
                </button>
            }
            {error && <p className="text-red-400 text-xs">{error}</p>}
            <div className="flex flex-wrap gap-2 mt-1">
                <button onClick={() => void save()} disabled={busy || (!description.trim() && !items.some(i => i.text.trim()))}
                    className="px-4 py-1.5 rounded-full bg-blue-800 hover:bg-blue-900 disabled:opacity-40 flex items-center gap-2">
                    {busy && <MoonLoader color="white" size={12}/>}
                    Save Note
                </button>
                <button onClick={() => onDone(null)} disabled={busy}
                    className="px-4 py-1.5 rounded-full border border-gray-500 hover:bg-gray-700 disabled:opacity-40">
                    Cancel
                </button>
                {note &&
                    <button onClick={() => { if (window.confirm(`Remove the note on ${task}?`)) void save(true) }} disabled={busy}
                        className="ml-auto px-4 py-1.5 rounded-full bg-red-800 hover:bg-red-900 disabled:opacity-40">
                        Remove Note
                    </button>
                }
            </div>
        </div>
    )
}
