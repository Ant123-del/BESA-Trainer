import { getFirestore, setDoc, doc, collection, getDoc, writeBatch, getDocs, updateDoc } from "firebase/firestore";
import { getFirebaseApp } from "./firebase";
import type { Floor, FloorCode, User } from "./types";

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

export async function setCurrentFloorDraft(floor: Floor) {
    try {
        // sets all currents within drafts to false and then sets the correct one to be true (shouldn't take too much bandwidth since there are only two drafts allowed)
        //TODO Fix error that doesnt set chosen doc to be true
        const batch = writeBatch(db)
        const draftsRef = collection(db, "training_data", "floors", floor.name)
        const otherDocs = await getDocs(draftsRef)
        if (!otherDocs.empty) {
            otherDocs.forEach((docs) => {
                const data = docs.data() as Floor
                const docRef = doc(db, "training_data", "floors", floor.name, data.path)
                batch.update(docRef, {current: false})
            })
            await batch.commit()
        }
        const chosenDoc = doc(db, "training_data", "floor", floor.name, floor.path)
        await updateDoc(chosenDoc, {current: true})
    } catch (e) {
        console.error("There was an error: " + e)
        return null
    }
}