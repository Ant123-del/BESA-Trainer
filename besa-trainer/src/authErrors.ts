import { FirebaseError } from "firebase/app"

//maps the firebase auth error to a readable string
export function mapFirebaseAuthError(err: unknown): string {
  if (err instanceof FirebaseError) {
    switch (err.code) {
      case "auth/invalid-email":
        return "Invalid email address."
      case "auth/user-disabled":
        return "This account has been disabled."
      case "auth/wrong-password":
        return "Wrong email or password."
      case "auth/email-already-in-use":
        return "An account already exists with this email."
      case "auth/weak-password":
        return "Password must be at least 6 characters."
      case "auth/too-many-requests":
        return "Too many attempts. Try again later."
      case "auth/operation-not-allowed":
        return "Email/password sign-in is not enabled in Firebase (enable it in the console)."
      default:
        return err.message
    }
  }
  if (err instanceof Error) {
    return err.message
  }
  return "Something went wrong."
}
