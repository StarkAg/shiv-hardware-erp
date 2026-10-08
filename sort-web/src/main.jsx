import React from 'react'
import ReactDOM from 'react-dom/client'
import { ConvexProvider, ConvexReactClient } from 'convex/react'
import App from './App.jsx'
import { PinGate } from './deviceTrust/PinGate.jsx'
import './index.css'

// The live client, not the HTTP one: two people can be naming from two phones
// at once, and each needs to see the tray shrink as the other works — otherwise
// both are handed the same slip and one of them files a bill twice.
//
// The URL is baked in as a fallback the way the cash book and stock panel do
// it, so a forgotten environment variable cannot ship a dead build.
const CONVEX_URL = import.meta.env.VITE_CONVEX_URL || 'https://sensible-panther-176.convex.cloud'
const convex = new ConvexReactClient(CONVEX_URL)

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ConvexProvider client={convex}>
      {/* The shop PIN once per device (Shiv_Panel convex/devices.ts). */}
      <PinGate convexUrl={CONVEX_URL} app="Sort" client={convex}>
        <App />
      </PinGate>
    </ConvexProvider>
  </React.StrictMode>,
)
