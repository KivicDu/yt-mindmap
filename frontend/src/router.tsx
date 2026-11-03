import { createBrowserRouter, Navigate } from 'react-router-dom'
import RootLayout from './layouts/RootLayout'
import Home from './pages/Home'
import Setup from './pages/Setup'
import Workspace from './pages/Workspace'

export const router = createBrowserRouter([
  {
    path: '/',
    element: <RootLayout />,
    children: [
      { index: true, element: <Home /> },
      { path: 'start', element: <Setup /> },
      { path: 'app', element: <Workspace /> },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
])
