import type {JSX} from 'react'
import Login from './Pages/Login'
import {createBrowserRouter, createRoutesFromChildren, Route, RouterProvider} from 'react-router-dom'
import Home from './Pages/Home'
import Profile from './Pages/Profile'
import SectionEditor from './Pages/SectionEditor'
import Edit from './Components/Edit'

//Router for naviation
const router = createBrowserRouter(createRoutesFromChildren(
  [<Route path='/signup' element={<Login login={true}/>}/>,
    <Route path='/signin' element={<Login login={false}/>}/>,
    <Route path='/profile' element={<Profile/>}/>,
    <Route path='/section-editor' element={<SectionEditor/>}>
      <Route path='getting-started' element={<div>NOSDF</div>}/>
      <Route path='edit' element={<Edit/>}/>
    </Route>,
    <Route path='/' element={<Home/>}/>
  ]))

function App(): JSX.Element {

  return (
    <RouterProvider router={router}/>
  )
}

export default App
