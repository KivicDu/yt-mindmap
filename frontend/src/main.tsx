import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { RouterProvider } from 'react-router-dom'
import { router } from './router'
import { MindmapConfigProvider } from './context/MindmapConfig'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MindmapConfigProvider>
      <RouterProvider router={router} />
    </MindmapConfigProvider>
  </StrictMode>,
)
