import React from 'react'
import ReactDOM from 'react-dom/client'
import { ConvexProvider, ConvexReactClient } from 'convex/react'
import App from './App.jsx'
import './index.css'

// The live client, not the HTTP one: two people can be naming from two phones
// at once, and each needs to see the tray shrink as the other works — otherwise
// both are handed the same slip and one of them files a bill twice.
//
// The URL is baked in as a fallback the way the cash book and stock panel do
// it, so a forgotten environment variable cannot ship a dead build.
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
