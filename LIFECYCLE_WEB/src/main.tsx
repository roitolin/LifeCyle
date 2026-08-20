import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { APP_ICON_URL } from '@/assets/appIconAssets'

document.querySelector<HTMLLinkElement>('link[rel="icon"]')?.setAttribute('href', APP_ICON_URL)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
