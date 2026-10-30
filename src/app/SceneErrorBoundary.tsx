import { Component, type ErrorInfo, type ReactNode } from 'react'

type SceneErrorBoundaryProps = {
  children: ReactNode
}

type SceneErrorBoundaryState = {
  hasError: boolean
}

export class SceneErrorBoundary extends Component<SceneErrorBoundaryProps, SceneErrorBoundaryState> {
  state: SceneErrorBoundaryState = { hasError: false }

  static getDerivedStateFromError(): SceneErrorBoundaryState {
    return { hasError: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('3D scene initialization failed', error, info)
  }

  render() {
    if (this.state.hasError) {
      return <div className="scene-error" role="alert">Không thể khởi tạo cảnh 3D. Hãy tải lại trang.</div>
    }

    return this.props.children
  }
}
