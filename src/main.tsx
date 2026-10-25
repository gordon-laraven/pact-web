import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/inter'
import '@fontsource-variable/sora'
import App from './App'
import { exposeTicketsForReading } from './support/tickets'
import './theme/tokens.css'
import './styles.css'

exposeTicketsForReading() // pactTickets.list() in the console

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
