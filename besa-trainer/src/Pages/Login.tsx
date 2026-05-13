import type { JSX } from "react"
import Header from "../Components/Header"
import Image from '../imgs/Google.png'
import { Link } from "react-router-dom"
export default function Login({login}: {login:boolean}): JSX.Element {

    return (
        <>
           <Header/>
            {/*I know code a little wobby sobby but bare with me*/}
           { login ? <SignIn/> : <SignUp/>}
        </>
    )
}

function SignUp(): JSX.Element {
    return (
        <div className="w-screen h-screen flex items-center justify-center bg-gray-900">
            <form className="w-2/4 mx-auto bg-white rounded-2xl p-5 text-black">
                <h2 className="mb-2 text-center bold text-3xl">Sign In</h2>
                <div className="w-3/4 mx-auto">
                    {/* Regular sign in jsx */}
                    <input type="text" placeholder="Enter your email..." className="block my-10 w-full p-3 rounded-xl bg-gray-600 focus:border-amber-500 focus:border-2  text-white"/>
                    <input type="password" placeholder="Enter your password..." className="block mb-10 w-full p-3 rounded-xl bg-gray-600 text-white"/>
                </div>
                <input type="submit" className="py-5 px-2 my-5 bg-blue-900 rounded-2xl text-white font-[500] w-3/4 mx-auto block cursor-pointer hover:brightness-75 active:brightness-50" value={"Submit"}/>
                <p className="text-center mb-5 text-gray-700">Don't have an account? <Link to={'/signup'} className="text-blue-900">Create One!</Link> </p>
                <div className="separator">OR</div>
                {/* Google auth sign in  */}
                <div className="flex justify-center items-center w-3/4 border border-solid border-blue-900 rounded-2xl bg-white h-10 mx-auto gap-5 mt-5 hover:brightness-75 active:brightness-50 cursor-pointer">
                    <img src={Image} className="w-5"/>
                    <span className="block">Sign in with Google</span>
                </div>
            </form>
        </div>
    )
}

function SignIn(): JSX.Element {
    return (
        <div className="w-screen h-screen flex items-center justify-center bg-gray-900">
            <form className="w-2/4 mx-auto bg-white rounded-2xl p-5 text-black">
                <h2 className="mb-2 text-center bold text-3xl">Sign Up</h2>
                <div className="w-3/4 mx-auto">
                    {/* Regular sign in jsx */}
                    <input type="text" placeholder="Enter your new email..." className="block my-10 w-full p-3 rounded-xl bg-gray-600 focus:border-amber-500 focus:border-2  text-white"/>
                    <input type="password" placeholder="Enter your new password..." className="block mb-10 w-full p-3 rounded-xl bg-gray-600 text-white"/>
                </div>
                <input type="submit" className="py-5 px-2 my-5 bg-blue-900 rounded-2xl text-white font-[500] w-3/4 mx-auto block cursor-pointer hover:brightness-75 active:brightness-50" value={"Submit"}/>
                <p className="text-center mb-5 text-gray-700">Have an account? <Link to={'/signin'} className="text-blue-900">Sign In!</Link> </p>
                <div className="separator">OR</div>
                {/* Google auth sign in  */}
                <div className="flex justify-center items-center w-3/4 border border-solid border-blue-900 rounded-2xl bg-white h-10 mx-auto gap-5 mt-5 hover:brightness-75 active:brightness-50 cursor-pointer">
                    <img src={Image} className="w-5"/>
                    <span className="block">Sign in with Google</span>
                </div>
            </form>
        </div>
    )
}