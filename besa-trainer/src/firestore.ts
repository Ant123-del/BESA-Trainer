import { getFirestore, setDoc, doc, collection, getDoc } from "firebase/firestore";
import { getFirebaseApp } from "./firebase";
import type { User } from "./types";

const app = getFirebaseApp()
export const db = getFirestore(app)


//gets run everytime a new user is created
export async function createUserDoc (user:User): Promise<void> {
    try {
        //adding document to database
        const userDocRef = doc(db, "training_data", "data_root", "users", user.uid);
    
        await setDoc(userDocRef, user, { merge: true });
        console.log("Document successfully written inside data_root for UID: ", user.uid);
    } catch (e) {
        console.error("Error adding document: ", e)
    }
}

//getting userData
export async function getUserDataById(uid: string): Promise<User | null> {
    try {
        const docRef = doc(db, "training_data", "data_root", "users", uid)
        const docSnap = await getDoc(docRef)
        //returning the data.
        if (docSnap.exists()) {
            return docSnap.data() as User
        } else {
            console.error("No user found with uid or access not granted")
            return null
        }
    } catch (e) {
        console.error("There was error: " + e)
        return null
    }
}