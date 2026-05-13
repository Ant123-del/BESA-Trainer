import type {JSX} from 'react'
import Login from './Pages/Login'
import {createBrowserRouter, createRoutesFromChildren, Route, RouterProvider} from 'react-router-dom'
import Home from './Pages/Home'

//Router for naviation
const router = createBrowserRouter(createRoutesFromChildren(
  [<Route path='/signup' element={<Login login={true}/>}/>,
    <Route path='/signin' element={<Login login={false}/>}/>,
    <Route path='/' element={<Home/>}/>
  ]))

function App(): JSX.Element {

  return (
    <RouterProvider router={router}/>
  )
}

export default App
