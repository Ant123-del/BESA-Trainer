import { useEffect, useState } from "react"
import { getAuth, onAuthStateChanged } from "firebase/auth"
import { doc, getDoc } from "firebase/firestore"
import { MoonLoader } from "react-spinners"
import { v4 as uuidv4 } from "uuid"
import { FaTrash } from "react-icons/fa"
import Header from "../Components/Header"
import { Loading } from "../Components/SectionEditor/Edit"
import { db, createQuestionSet, deleteQuestionSet, getQuestionSets, saveQuestions } from "../Tools/firestore"
import type { Question, QuestionSet, User } from "../Tools/types"

//universal (any besa/besaLead, not admin-only) editor for the shared, collaboratively-edited question
//sets used by /questions/:setId - structural twin of SectionEditor/Edit.tsx + EditScript.tsx, but for
//Quizlet-style question/answer pairs instead of video drafts/scripts.
export default function QuestionsEditor() {
    const [uid, setUid] = useState<string | null>(null)
    const [sets, setSets] = useState<QuestionSet[] | null>(null)
    const [selectedId, setSelectedId] = useState<string | null>(null)
    const [newSetTitle, setNewSetTitle] = useState("")
    const [creating, setCreating] = useState(false)
    const [deletePopup, setDeletePopup] = useState<QuestionSet | null>(null)

    useEffect(() => {
        const auth = getAuth()
        const unsub = onAuthStateChanged(auth, async (user) => {
            if (!user) {
                return
            }
            const userDoc = await getDoc(doc(db, "training_data/data_root/users/" + user.uid))
            if (userDoc.exists()) {
                setUid((userDoc.data() as User).uid)
            }
        })
        return unsub
    }, [])

    function refreshSets() {
        getQuestionSets().then(result => setSets(result))
    }

    useEffect(refreshSets, [])

    async function handleCreateSet() {
        if (!uid || !newSetTitle.trim()) {
            return
        }
        setCreating(true)
        try {
            const newSet = await createQuestionSet(uid, newSetTitle.trim())
            setSets(prev => [...(prev || []), newSet])
            setSelectedId(newSet.id)
            setNewSetTitle("")
        } finally {
            setCreating(false)
        }
    }

    async function handleDeleteSet() {
        if (!deletePopup) {
            return
        }
        await deleteQuestionSet(deletePopup.id)
        setSets(prev => (prev || []).filter(s => s.id !== deletePopup.id))
        if (selectedId === deletePopup.id) {
            setSelectedId(null)
        }
        setDeletePopup(null)
    }

    const selected = sets?.find(s => s.id === selectedId) || null

    return (
        <div className="bg-gray-900 w-full min-h-screen text-white">
            <Header/>
            <div className="h-16 relative top-0 left-0 w-full"></div>
            <div className="w-11/12 md:w-5/6 mx-auto py-10 flex flex-col md:flex-row gap-6 items-start">
                <div className="w-full md:w-1/3 md:shrink-0">
                    <h1 className="text-2xl sm:text-3xl tracking-wider mb-1">Question Editor</h1>
                    <p className="text-gray-400 text-sm mb-4">Any BESA can create sets and add or edit questions - it's a shared pool everyone practices from.</p>

                    <div className="bg-gray-800 rounded-2xl p-4 mb-4">
                        <h2 className="text-sm text-gray-400 mb-2">New Set</h2>
                        <div className="flex gap-2">
                            <input value={newSetTitle} onChange={(e) => setNewSetTitle(e.target.value)} placeholder="Set title..."
                                className="flex-1 p-2 rounded-lg bg-gray-700 text-white text-sm"/>
                            <button onClick={() => void handleCreateSet()} disabled={creating || !newSetTitle.trim()}
                                className="px-4 py-2 rounded-full bg-blue-800 hover:bg-blue-900 disabled:opacity-40 disabled:cursor-not-allowed text-sm shrink-0">
                                {creating ? <MoonLoader color="white" size={16}/> : "Create"}
                            </button>
                        </div>
                    </div>

                    {sets === null ?
                        <div className="flex justify-center py-10"><MoonLoader color="white" size={24}/></div>
                        : sets.length === 0 ?
                        <p className="text-gray-500 italic text-sm">No question sets yet - create the first one above.</p>
                        :
                        <div className="flex flex-col gap-2">
                            {sets.map(s => (
                                <div key={s.id} onClick={() => setSelectedId(s.id)}
                                    className={"rounded-xl p-3 cursor-pointer flex justify-between items-center gap-2 " + (s.id === selectedId ? "bg-blue-900" : "bg-gray-800 hover:bg-gray-700")}>
                                    <div>
                                        <p className="font-semibold">{s.title}</p>
                                        <p className="text-xs text-gray-400">{s.questions.length} question{s.questions.length === 1 ? "" : "s"}</p>
                                    </div>
                                    <button onClick={(e) => {e.stopPropagation(); setDeletePopup(s)}} title="Delete set"
                                        className="text-gray-400 hover:text-red-500 p-2 shrink-0">
                                        <FaTrash/>
                                    </button>
                                </div>
                            ))}
                        </div>
                    }
                </div>

                <div className="flex-1 min-w-0">
                    {selected ?
                        <SetEditor key={selected.id} set={selected} onSaved={(questions) => {
                            setSets(prev => (prev || []).map(s => s.id === selected.id ? {...s, questions} : s))
                        }}/>
                        :
                        <div className="bg-gray-800 rounded-2xl p-10 text-center text-gray-500 italic">
                            Select a set on the left, or create a new one, to start editing.
                        </div>
                    }
                </div>
            </div>

            {deletePopup &&
                <Loading onClose={() => setDeletePopup(null)}>
                    <div className="bg-gray-900 w-11/12 sm:w-2/3 md:w-1/3 max-w-md p-5 rounded-2xl text-center">
                        <h3 className="text-2xl mb-1 text-red-500">Delete "{deletePopup.title}"?</h3>
                        <p className="text-sm text-gray-400">This deletes the whole set and every question in it. This can't be undone.</p>
                        <button onClick={() => void handleDeleteSet()} className="rounded-full w-full mt-4 p-2 bg-red-800 hover:bg-red-900">Delete Set</button>
                        <button onClick={() => setDeletePopup(null)} className="rounded-full w-full mt-3 border-solid border-2 border-gray-400 hover:bg-gray-800 p-2">Cancel</button>
                    </div>
                </Loading>}
        </div>
    )
}

function SetEditor({set, onSaved}: {set: QuestionSet, onSaved: (questions: Question[]) => void}) {
    const [questions, setQuestions] = useState<Question[]>(set.questions)
    const [saving, setSaving] = useState(false)
    const [importOpen, setImportOpen] = useState(false)

    const dirty = JSON.stringify(questions) !== JSON.stringify(set.questions)

    function updateQuestion(id: string, field: "question" | "answer", value: string) {
        setQuestions(prev => prev.map(q => q.id === id ? {...q, [field]: value} : q))
    }

    function addRow() {
        setQuestions(prev => [...prev, {id: uuidv4(), question: "", answer: ""}])
    }

    function deleteRow(id: string) {
        setQuestions(prev => prev.filter(q => q.id !== id))
    }

    async function handleSave() {
        setSaving(true)
        try {
            //empty rows are just editor scratch space, not real questions - don't save them
            const cleaned = questions.filter(q => q.question.trim() || q.answer.trim())
            await saveQuestions(set.id, cleaned)
            setQuestions(cleaned)
            onSaved(cleaned)
        } finally {
            setSaving(false)
        }
    }

    function handleImported(imported: Question[]) {
        setQuestions(prev => [...prev, ...imported])
        setImportOpen(false)
    }

    return (
        <div className="bg-gray-800 rounded-2xl p-5">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 mb-4">
                <h2 className="text-2xl tracking-wide">{set.title}</h2>
                <div className="flex gap-2 flex-wrap">
                    <button onClick={() => setImportOpen(true)} className="px-4 py-2 rounded-full border border-gray-500 hover:bg-gray-700 text-sm">Import</button>
                    <button onClick={addRow} className="px-4 py-2 rounded-full border border-gray-500 hover:bg-gray-700 text-sm">Add Question</button>
                    <button onClick={() => void handleSave()} disabled={!dirty || saving}
                        className={"px-4 py-2 rounded-full text-sm " + (!dirty || saving ? "bg-gray-700 text-gray-400 cursor-not-allowed" : "bg-blue-800 hover:bg-blue-900")}>
                        {saving ? <MoonLoader color="white" size={16}/> : "Save Changes"}
                    </button>
                </div>
            </div>

            {questions.length === 0 ?
                <p className="text-gray-500 italic text-sm mb-3">No questions yet - add one, or use Import to paste several at once.</p>
                :
                <div className="flex flex-col gap-3">
                    {questions.map((q, i) => (
                        <div key={q.id} className="bg-gray-900 rounded-xl p-3 flex gap-3 items-start">
                            <span className="text-gray-500 text-sm pt-2 w-5 shrink-0">{i + 1}</span>
                            <div className="flex-1 flex flex-col gap-2">
                                <div>
                                    <label className="block text-xs text-gray-400 mb-1">Question</label>
                                    <textarea value={q.question} onChange={(e) => updateQuestion(q.id, "question", e.target.value)}
                                        className="w-full p-2 rounded-lg bg-gray-700 text-white text-sm resize-none" rows={2}/>
                                </div>
                                <div>
                                    <label className="block text-xs text-gray-400 mb-1">Answer</label>
                                    <textarea value={q.answer} onChange={(e) => updateQuestion(q.id, "answer", e.target.value)}
                                        className="w-full p-2 rounded-lg bg-gray-700 text-white text-sm resize-none" rows={2}/>
                                </div>
                            </div>
                            <button onClick={() => deleteRow(q.id)} title="Delete question" className="text-gray-400 hover:text-red-500 p-2 shrink-0">
                                <FaTrash/>
                            </button>
                        </div>
                    ))}
                </div>
            }

            {importOpen &&
                <ImportPanel onImport={handleImported} onClose={() => setImportOpen(false)}/>
            }
        </div>
    )
}

//Quizlet-style bulk paste: split the pasted text into rows, then each row into a question/answer pair,
//using two configurable delimiters. Nothing is saved to Firestore here - imported rows just get appended
//to the editor's in-memory list, so a bad paste is easy to undo by not clicking Save Changes.
function ImportPanel({onImport, onClose}: {onImport: (questions: Question[]) => void, onClose: () => void}) {
    const [text, setText] = useState("")
    const [qaDelimiter, setQaDelimiter] = useState("\t")
    const [rowDelimiter, setRowDelimiter] = useState("\n")
    const [error, setError] = useState("")

    function handleImportClick() {
        if (!text.trim()) {
            return
        }
        const rows = text.split(rowDelimiter).map(r => r.trim()).filter(Boolean)
        const parsed: Question[] = []
        for (const row of rows) {
            const idx = row.indexOf(qaDelimiter)
            if (idx === -1) {
                continue
            }
            const question = row.slice(0, idx).trim()
            const answer = row.slice(idx + qaDelimiter.length).trim()
            if (question && answer) {
                parsed.push({id: uuidv4(), question, answer})
            }
        }
        if (parsed.length === 0) {
            setError("Couldn't find any question/answer pairs with those delimiters - check your text and delimiters.")
            return
        }
        onImport(parsed)
    }

    return (
        <Loading onClose={onClose}>
            <div className="bg-gray-900 w-11/12 sm:w-2/3 max-w-2xl p-5 rounded-2xl">
                <h3 className="text-2xl mb-1">Import Questions</h3>
                <p className="text-sm text-gray-400 mb-4">Paste a list of questions and answers - one per line by default, like Quizlet's import.</p>
                <div className="flex flex-col sm:flex-row gap-4 mb-3">
                    <label className="flex-1 text-sm text-gray-300">
                        Between Question and Answer
                        <input value={qaDelimiter} onChange={(e) => setQaDelimiter(e.target.value)}
                            className="block w-full mt-1 p-2 rounded-lg bg-gray-700 text-white text-sm"/>
                    </label>
                    <label className="flex-1 text-sm text-gray-300">
                        Between Questions
                        <input value={rowDelimiter} onChange={(e) => setRowDelimiter(e.target.value)}
                            className="block w-full mt-1 p-2 rounded-lg bg-gray-700 text-white text-sm"/>
                    </label>
                </div>
                <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder={"Question 1<tab>Answer 1\nQuestion 2<tab>Answer 2"}
                    className="w-full h-48 p-3 rounded-lg bg-gray-700 text-white text-sm resize-none"/>
                {error && <p className="text-red-400 text-sm mt-2">{error}</p>}
                <div className="flex justify-center gap-3 mt-4">
                    <button onClick={handleImportClick} className="px-6 py-2 rounded-full bg-blue-800 hover:bg-blue-900">Import</button>
                    <button onClick={onClose} className="px-6 py-2 rounded-full border border-gray-400 hover:bg-gray-800">Cancel</button>
                </div>
            </div>
        </Loading>
    )
}
