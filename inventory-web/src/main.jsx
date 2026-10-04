import React from 'react'
import ReactDOM from 'react-dom/client'
import { ConvexProvider, ConvexReactClient } from 'convex/react'
import App from './App.jsx'
import './index.css'

// Live client, so a count saved on one phone shows on another at once. The URL is
// baked in as a fallback like the sort and cash sites, so a forgotten environment
// variable cannot ship a dead build.
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
