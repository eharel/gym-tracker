import { Component, type ReactNode } from 'react'

interface Props {
  children: ReactNode
  fallback?: ReactNode
}

interface State {
  hasError: boolean
  message: string
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, message: '' }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, message: error.message }
  }

  override render() {
    if (this.state.hasError) {
      return this.props.fallback ?? (
        <div className="min-h-screen flex flex-col items-center justify-center p-6 gap-4 text-center">
          <p className="font-semibold text-negative">Something went wrong.</p>
          <p className="text-sm text-ink-secondary">{this.state.message}</p>
          <button
            onClick={() => window.location.reload()}
            className="text-sm text-accent underline"
          >
            Reload app
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
