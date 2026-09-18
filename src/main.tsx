import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'
import { isNativeApp } from './platform/env'
import { firebaseConfigured } from './platform/firebase'
import { startNativeAppCheck } from './platform/native'

// The iOS app attests itself before any API call or Firestore read.
if (firebaseConfigured()) void startNativeAppCheck()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Production web only: a service worker in dev serves stale modules and makes HMR
// behave like a haunted house, and the native app bundles its assets already.
if (import.meta.env.PROD && !isNativeApp() && 'serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    try {
      await navigator.serviceWorker.register('/sw.js')
      await navigator.serviceWorker.ready

      // Hand the worker the URLs this page already fetched. They were
      // requested before it took control, so it cannot cache them itself.
      const urls = performance
        .getEntriesByType('resource')
        .map((e) => e.name)
        .filter((u) => u.startsWith(location.origin))

      const send = () =>
        navigator.serviceWorker.controller?.postMessage({ type: 'cache-urls', urls })

      send()
      navigator.serviceWorker.addEventListener('controllerchange', send, { once: true })
    } catch {
      /* Offline support is a bonus; never let it break the app. */
    }
  })
}
