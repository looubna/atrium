import { Component, type ReactNode } from 'react'

/**
 * Keeps one bad model or texture from taking a whole interior down with it.
 *
 * The rooms are assembled from glTF props that are fetched at runtime, so any one of them can be
 * missing or fail to decode on a given device. A room with a chair missing is still a room; a
 * blank screen is not.
 */
export class SceneBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error: Error) {
    console.info('[Atrium] part of the room could not be drawn:', error.message)
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}
