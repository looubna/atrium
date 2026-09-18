import { Component, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

/**
 * Catches a failure inside the 3D scene — no WebGL, a model that will not
 * decode — and says so, instead of React unmounting the whole app and leaving
 * a blank screen with no clue why.
 */
export class SceneError extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error) {
    console.error('[Atrium] scene failed to start:', error)
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children

    const noWebgl = /webgl|context/i.test(error.message)
    return (
      <div className="absolute inset-0 grid place-items-center bg-ink-900 p-6">
        <div className="max-w-md rounded-2xl border border-white/10 bg-ink-800/90 p-6 text-center">
          <div className="text-[15px] font-semibold tracking-tight text-chalk">
            The city could not load
          </div>
          <p className="mt-2 text-[13px] leading-relaxed text-mist">
            {noWebgl
              ? 'This browser has 3D graphics (WebGL) turned off. In Chrome, enable Settings → System → "Use graphics acceleration when available", then relaunch.'
              : 'Something went wrong while starting the 3D scene. Reloading usually fixes it.'}
          </p>
          <pre className="mt-4 overflow-x-auto whitespace-pre-wrap rounded-lg bg-black/40 p-3 text-left text-[11px] text-faint">
            {error.message}
          </pre>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-4 rounded-lg border border-white/15 px-4 py-2 text-[13px] text-chalk hover:bg-white/10"
          >
            Reload
          </button>
        </div>
      </div>
    )
  }
}
