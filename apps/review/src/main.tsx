import { Component, StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { reviewConfigSchema } from '@ai-checkout/catalog-review';
import { readBoundedJson } from '@ai-checkout/catalog-client';
import { createReviewAuth } from './client';
import App from './App';
import './styles.css';

class ReviewBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? <main className="sign-in"><h1>The review screen could not load.</h1><p>Reload to sign in and retrieve the latest draft.</p><button onClick={() => location.reload()}>Reload</button></main> : this.props.children; }
}
const root = createRoot(document.getElementById('root')!);
root.render(<main className="sign-in"><p role="status">Loading catalog review…</p></main>);
try {
  const response = await fetch('/review/config.json', { credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(10000) });
  const auth = createReviewAuth(reviewConfigSchema.parse(await readBoundedJson(response, 8192)));
  root.render(<StrictMode><ReviewBoundary><App auth={auth} /></ReviewBoundary></StrictMode>);
} catch {
  root.render(<main className="sign-in"><h1>Catalog review is unavailable.</h1><p>Check the connection and server configuration, then reload.</p><button onClick={() => location.reload()}>Reload</button></main>);
}
