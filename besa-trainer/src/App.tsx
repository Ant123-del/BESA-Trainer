import type {JSX} from 'react'
import Login from './Pages/Login'
import {createBrowserRouter, createRoutesFromChildren, Route, RouterProvider} from 'react-router-dom'
import Home from './Pages/Home'
import Profile from './Pages/Profile'
import SectionEditor from './Pages/SectionEditor'
import Edit from './Components/Edit'
import Simulator from './Pages/Simulator'
import MyProgress from './Pages/Progress'
import DebugLoader from './Pages/__DebugLoader'
import { createPlayer, videoFeatures } from '@videojs/react'
import GettingStarted from './Components/GettingStarted'

//Router for naviation
const Player = createPlayer({features: videoFeatures})

const router = createBrowserRouter(createRoutesFromChildren(
  [<Route path='/signup' element={<Login login={true}/>}/>,
    <Route path='/signin' element={<Login login={false}/>}/>,
    <Route path='/profile' element={<Profile/>}/>,
    <Route path='/section-editor' element={<SectionEditor/>}>
      <Route path='getting-started' element={<GettingStarted/>}/>
      <Route path='edit' element={<Edit/>}/>
    </Route>,
    <Route path='/simulator/:tour' element={<Player.Provider><Simulator/></Player.Provider>}>
      <Route path='general' element={<div></div>}/>
    </Route>,
    <Route path='/progress/:tour' element={<MyProgress/>}/>,
    <Route path='/' element={<Home/>}/>,
    <Route path='/__debug-loader' element={<DebugLoader/>}/>
  ]))

function App(): JSX.Element {

  return (
    <RouterProvider router={router}/>
  )
}

export default App
