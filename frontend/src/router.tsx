import { createBrowserRouter, Navigate } from 'react-router-dom'
import ProtectedRoute from './components/ProtectedRoute'
import RootLayout from './layouts/RootLayout'
import Dashboard from './pages/Dashboard'
import AuthPage from './pages/Auth/AuthPage'
import Home from './pages/Home'
import SharedProject from './pages/SharedProject'
import Workspace from './pages/Workspace'

export const router = createBrowserRouter([
  {
    path: '/',
    element: <RootLayout />,
    children: [
      { index: true, element: <Home /> },
      { path: 'app', element: <Workspace /> },
      { path: 's/:slug', element: <SharedProject /> },
      {
        path: 'app/:projectId',
        element: (
          <ProtectedRoute>
            <Workspace />
          </ProtectedRoute>
        ),
      },
      { path: 'login', element: <AuthPage /> },
      { path: 'register', element: <AuthPage /> },
      {
        path: 'dashboard',
        element: (
          <ProtectedRoute>
            <Dashboard />
          </ProtectedRoute>
        ),
      },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
])
