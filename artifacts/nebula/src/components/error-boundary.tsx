import { Component, ReactNode } from "react";
import { PreviewDataError } from '@nebula/local';
import { PreviewRecovery } from './preview-recovery';

type Props = { children: ReactNode; resetKey?: string };
export class ErrorBoundary extends Component<Props, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidUpdate(prevProps: Props) {
    if (this.props.resetKey !== prevProps.resetKey) {
      this.setState({ error: null });
    }
  }

  render() {
    if (this.state.error instanceof PreviewDataError) {
      return <PreviewRecovery message={this.state.error.message} onRetry={() => this.setState({ error: null })} />;
    }
    if (this.state.error) {
      return (
        <div className="flex-1 flex items-center justify-center p-8">
          <div className="text-center space-y-4">
            <h2 className="text-xl font-display font-bold text-danger">Something went wrong</h2>
            <p className="text-sm text-muted voice">The void has consumed this page</p>
            <button
              onClick={() => this.setState({ error: null })}
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
