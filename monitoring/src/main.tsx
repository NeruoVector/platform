import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

if (import.meta.env.DEV && import.meta.env.VITE_DISABLE_REACT_DEVTOOLS !== '1') {
  void import('react-grab')
  void import('react-scan')
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
