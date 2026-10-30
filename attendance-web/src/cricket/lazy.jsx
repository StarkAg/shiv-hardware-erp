// The only doorway from App.jsx into the theme: off means none of it is downloaded.
import { lazy, Suspense } from 'react'

const part = (name, fallback = null) => {
  const Part = lazy(() => import('./parts.js').then((m) => ({ default: m[name] })))
  return function Lazy({ fallback: own, ...props }) {
    return <Suspense fallback={own ?? fallback}><Part {...props} /></Suspense>
  }
}

export const CricketLayer = part('CricketLayer')
export const CricketKey = part('CricketKey')
export const CricketTabIcon = part('CricketTabIcon')
export const PointsTable = part('PointsTable')
export const RunChase = part('RunChase')
