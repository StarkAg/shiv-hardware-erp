import React from 'react'
import ReactDOM from 'react-dom/client'
import { ConvexProvider, ConvexReactClient } from 'convex/react'
import App from './App.jsx'
import './style.css'

const convex = new ConvexReactClient(
  import.meta.env.VITE_CONVEX_URL || 'https://sensible-panther-176.convex.cloud',
)

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ConvexProvider client={convex}>
      <App />
    </ConvexProvider>
  </React.StrictMode>,
)
