import {useEffect, useState, type JSX} from "react"
import { onAuthStateChanged, type User } from "firebase/auth"
import Header from "../Components/Header"
import { getFirebaseAuth, isFirebaseConfigured } from "../firebase"
import { useNavigate } from "react-router-dom"

export default function Profile(): JSX.Element {
    const [user, setUser] = useState<User | null>(null)
    const navigate = useNavigate()

    useEffect(() => {
        const auth = getFirebaseAuth()
        const unsub = onAuthStateChanged(auth, (user: User | null) => {
            setUser(user)
            if(!user?.uid) {
                navigate("/")
            }
        })
        return unsub
    }, [])

    return (
        <>
            <Header sticky={true}/>
            <section>
                {user?.photoURL || "hello"}
            </section>
        </>
    )
}