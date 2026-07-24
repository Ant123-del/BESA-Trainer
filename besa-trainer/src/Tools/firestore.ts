import { getFirestore, setDoc, doc, collection, getDoc, writeBatch, getDocs, updateDoc, deleteDoc } from "firebase/firestore";
import { getFirebaseApp } from "./firebase";
import type { CosScript, Floor, FloorCode, User } from "./types";
import { deleteObject, getStorage, ref } from "firebase/storage";

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
        const draftsRef = collection(db, "training_data", "floors", floor.floorCode)
        const otherDocs = await getDocs(draftsRef)
        if (!otherDocs.empty) {
            otherDocs.forEach((docs) => {
                const data = docs.data() as Floor
                const docRef = doc(db, "training_data", "floors", floor.floorCode, data.id)
                batch.update(docRef, {current: false})
            })
            await batch.commit()
        }
        const chosenDoc = doc(db, "training_data", "floors", floor.floorCode, floor.id)
        await updateDoc(chosenDoc, {current: true})
    } catch (e) {
        console.error("There was an error: " + e)
        return null
    }
}

//wipes every custom script blob a user has, then their user doc - the Firebase Auth account itself
//still has to be deleted separately by the caller (it needs the live auth.currentUser, not just a uid).
export async function deleteUserAccountData(uid: string, scriptPaths: CosScript[]) {
    const storage = getStorage()
    for (const cosScript of scriptPaths) {
        try {
            await deleteObject(ref(storage, cosScript.path))
        } catch (e) {
            console.error("Failed to delete custom script blob: " + e)
        }
    }
    await deleteDoc(doc(db, "training_data", "data_root", "users", uid))
}

//drops a single custom script (used for "revert to default") - the storage blob and the scriptPaths entry.
export async function removeCustomScript(uid: string, scriptPaths: CosScript[], target: CosScript): Promise<CosScript[]> {
    const storage = getStorage()
    try {
        await deleteObject(ref(storage, target.path))
    } catch (e) {
        console.error("Failed to delete custom script blob: " + e)
    }
    const newScriptPaths = scriptPaths.filter(s => s.id !== target.id)
    await updateDoc(doc(db, "training_data", "data_root", "users", uid), {scriptPaths: newScriptPaths})
    return newScriptPaths
}

export async function deleteDraftFloor(floor: Floor) {
    try {
        const docRef = doc(db, "training_data", "floors", floor.floorCode, floor.id)
        const scriptRef = doc(db, "training_data", "data_root", "scripts", floor.defScriptId)
        await deleteDoc(scriptRef)
        await deleteDoc(docRef)
        const storage = getStorage()
        const vidRef = ref(storage, floor.path)
        const scripFiletRef = ref(storage, "scripts/" + floor.defScriptId)
        await deleteObject(vidRef)
       await deleteObject(scripFiletRef)
    } catch (e) {
        console.error("There was an error: " + e)
        return null
    }
}