import type {JSX} from 'react'
import Login from './Pages/Login'
import {createBrowserRouter, createRoutesFromChildren, Route, RouterProvider} from 'react-router-dom'
import Home from './Pages/Home'
import Profile from './Pages/Profile'
import SectionEditor from './Pages/SectionEditor'
import Edit from './Components/SectionEditor/Edit'
import Simulator from './Pages/Simulator'
import ReadScript from './Pages/ReadScript'
import MyProgress from './Pages/Progress'
import { createPlayer, videoFeatures } from '@videojs/react'
import GettingStarted from './Components/SectionEditor/GettingStarted'
import QuestionSimulator from './Pages/QuestionSimulator'
import QuestionsEditor from './Pages/QuestionsEditor'
import QuestionsProgress from './Pages/QuestionsProgress'
import BesaSignUp from './Pages/BesaSignUp'
import ManageAdmins from './Pages/ManageAdmins'
import RequireAccess from './Components/RequireAccess'

//Router for naviation
const Player = createPlayer({features: videoFeatures})

const router = createBrowserRouter(createRoutesFromChildren(
  [<Route path='/signup' element={<Login login={true}/>}/>,
    <Route path='/signup-besa' element={<BesaSignUp/>}/>,
    <Route path='/signin' element={<Login login={false}/>}/>,
    <Route path='/profile' element={<Profile/>}/>,
    <Route path='/manage-admins' element={<RequireAccess level="besaLead"><ManageAdmins/></RequireAccess>}/>,
    <Route path='/section-editor' element={<RequireAccess level="admin"><SectionEditor/></RequireAccess>}>
      <Route path='getting-started' element={<GettingStarted/>}/>
      <Route path='edit' element={<Edit/>}/>
    </Route>,
    <Route path='/simulator/:tour' element={<Player.Provider><Simulator/></Player.Provider>}>
      <Route path='general' element={<div></div>}/>
    </Route>,
    <Route path='/read-script/:tour' element={<RequireAccess level="besa"><ReadScript/></RequireAccess>}/>,
    <Route path='/questions/:setId' element={<QuestionSimulator/>}/>,
    <Route path='/questions-editor' element={<RequireAccess level="besa"><QuestionsEditor/></RequireAccess>}/>,
    <Route path='/questions-progress' element={<QuestionsProgress/>}/>,
    <Route path='/progress/:tour' element={<MyProgress/>}/>,
    <Route path='/' element={<Home/>}/>,
  ]))

function App(): JSX.Element {

  return (
    <RouterProvider router={router}/>
  )
}

export default App
