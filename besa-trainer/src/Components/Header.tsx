import { NavLink } from 'react-router-dom'
import type {JSX} from 'react'
import Logo from '../imgs/BE_logo.png'

export default function Header():JSX.Element {
    return (
        <header className="flex justify-around w-screen h-16 items-center bg-white border-double border-b-2 border-gray-500 text-blue-900 absolute">
            <div className="font-sans text-3xl font-[600] tracking-wide flex justify-center items-center gap-5">
                <img src={Logo} className='w-10'/>
                <span>
                    BESA-Trainer
                </span>
            </div>
            <nav className="flex justify-center gap-x-10 h-fit text-sm">
                <NavLink className="h-fit" to={"/"}>HOME</NavLink>
                <NavLink className="h-fit" to={"/signin"}>SIGN UP/SIGN IN</NavLink>
            </nav>
        </header>
    )
}