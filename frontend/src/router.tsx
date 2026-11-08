import { createBrowserRouter, Navigate } from 'react-router-dom'
import ProtectedRoute from './components/ProtectedRoute'
import RootLayout from './layouts/RootLayout'
import Dashboard from './pages/Dashboard'
import AuthPage from './pages/Auth/AuthPage'
import ConfirmEmailChange from './pages/ConfirmEmailChange'
import ForgotPassword from './pages/ForgotPassword'
import Home from './pages/Home'
import ResetPassword from './pages/ResetPassword'
import SharedProject from './pages/SharedProject'
import VerifyEmail from './pages/VerifyEmail'
import Workspace from './pages/Workspace'

export const router = createBrowserRouter([
  {
    path: '/',
    element: <RootLayout />,
    children: [
      { index: true, element: <Home /> },
      { path: 'app', element: <Workspace /> },
      { path: 's/:slug', element: <SharedProject /> },
      { path: 'verify-email', element: <VerifyEmail /> },
      { path: 'confirm-email-change', element: <ConfirmEmailChange /> },
      { path: 'forgot-password', element: <ForgotPassword /> },
      { path: 'reset-password', element: <ResetPassword /> },
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
