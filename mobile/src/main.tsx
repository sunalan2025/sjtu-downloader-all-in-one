import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { ConfirmationProvider } from './Confirmation'
import './style.css'
import { MotionProvider, configureMotion } from './Motion'
import { applyMaterialTheme, readAppearance } from './MaterialTheme'

applyMaterialTheme(readAppearance(), {dark: window.matchMedia('(prefers-color-scheme: dark)').matches})
configureMotion()

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <MotionProvider><ConfirmationProvider><App /></ConfirmationProvider></MotionProvider>
  </React.StrictMode>
)
