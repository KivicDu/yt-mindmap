import { createBrowserRouter } from 'react-router-dom'
import ProtectedRoute from './components/ProtectedRoute'
import RootLayout from './layouts/RootLayout'
import RouteError from './pages/RouteError'

export const router = createBrowserRouter([
  {
    path: '/',
    element: <RootLayout />,
    errorElement: <RouteError />,
    HydrateFallback: () => (
      <div className="route-loading" role="status">
        Đang mở trang…
      </div>
    ),
    children: [
      {
        index: true,
        lazy: async () => ({ Component: (await import('./pages/Home')).default }),
      },
      {
        path: 'app',
        lazy: async () => ({ Component: (await import('./pages/Workspace')).default }),
      },
      {
        path: 's/:slug',
        lazy: async () => ({ Component: (await import('./pages/SharedProject')).default }),
      },
      {
        path: 'verify-email',
        lazy: async () => ({ Component: (await import('./pages/VerifyEmail')).default }),
      },
      {
        path: 'confirm-email-change',
        lazy: async () => ({ Component: (await import('./pages/ConfirmEmailChange')).default }),
      },
      {
        path: 'forgot-password',
        lazy: async () => ({ Component: (await import('./pages/ForgotPassword')).default }),
      },
      {
        path: 'reset-password',
        lazy: async () => ({ Component: (await import('./pages/ResetPassword')).default }),
      },
      {
        path: 'privacy',
        lazy: async () => ({
          Component: (await import('./pages/Legal')).PrivacyPage,
        }),
      },
      {
        path: 'terms',
        lazy: async () => ({
          Component: (await import('./pages/Legal')).TermsPage,
        }),
      },
      {
        path: 'contact',
        lazy: async () => ({
          Component: (await import('./pages/Legal')).ContactPage,
        }),
      },
      {
        path: 'app/:projectId',
        lazy: async () => {
          const { default: Workspace } = await import('./pages/Workspace')
          return {
            Component: () => (
              <ProtectedRoute>
                <Workspace />
              </ProtectedRoute>
            ),
          }
        },
      },
      {
        path: 'login',
        lazy: async () => ({ Component: (await import('./pages/Auth/AuthPage')).default }),
      },
      {
        path: 'register',
        lazy: async () => ({ Component: (await import('./pages/Auth/AuthPage')).default }),
      },
      {
        path: 'dashboard',
        lazy: async () => {
          const { default: Dashboard } = await import('./pages/Dashboard')
          return {
            Component: () => (
              <ProtectedRoute>
                <Dashboard />
              </ProtectedRoute>
            ),
          }
        },
      },
      {
        path: '*',
        lazy: async () => ({ Component: (await import('./pages/NotFound')).default }),
      },
    ],
  },
])
