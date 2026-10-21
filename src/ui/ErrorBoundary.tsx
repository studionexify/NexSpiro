// A render error in any panel used to unmount the whole app (blank page). The scene lives in the store, outside
// React, so the fallback can save the project or simply render again without losing the plate.
import { Component, type ReactNode } from 'react';
import { reportError } from '../state/errors';

export class ErrorBoundary extends Component<{ children: ReactNode; area?: string }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error) { reportError(error, `${this.props.area ?? 'The app'} stopped drawing`); }
  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="page" role="alert" style={{ padding: 24 }}>
        <h2>{this.props.area ?? 'NexSpiro'} ran into a problem</h2>
        <p className="mono" style={{ whiteSpace: 'pre-wrap' }}>{error.message}</p>
        <p>Your plate is still in memory. Save it first if you want to be safe, then try again.</p>
        <div className="row">
          <button className="btn-primary" onClick={() => this.setState({ error: null })}>Try again</button>
          <button className="btn-secondary" onClick={() => { void import('../state/project').then((m) => m.saveProject()).catch((e) => reportError(e, 'Save failed')); }}>Save project</button>
          <button className="btn-secondary" onClick={() => location.reload()}>Reload page</button>
        </div>
      </div>
    );
  }
}
