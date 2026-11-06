import { Component, ReactNode } from "react";

export class ErrorBoundary extends Component<{children: ReactNode, resetKey?: any}, {hasError: boolean}> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidUpdate(prevProps: any) {
    if (this.props.resetKey !== prevProps.resetKey) {
      this.setState({ hasError: false });
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex-1 flex items-center justify-center p-8">
          <div className="text-center space-y-4">
            <h2 className="text-xl font-display font-bold text-danger">Something went wrong</h2>
            <p className="text-sm text-muted voice">The void has consumed this page</p>
            <button
              onClick={() => this.setState({ hasError: false })}
              className="mt-4 px-6 py-2 glass-band text-ink rounded-full text-xs voice hover:bg-surface transition"
            >
              Try Again
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
