import './zod-config';
import { Component, StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { reviewConfigSchema } from '@ai-checkout/catalog-review';
import { ApplicationState, Button } from '@ai-checkout/ui';
import { readBoundedJson } from '@ai-checkout/catalog-client';
import { createReviewAuth } from './client';
import App from './App';
import '@ai-checkout/ui/styles.css';
import './styles.css';

class ReviewBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <main className="sign-in">
        <ApplicationState
          status="error"
          titleTag="h1"
          title="The review screen could not load."
          actions={<Button onClick={() => location.reload()}>Reload</Button>}
        >
          Reload to sign in and retrieve the latest draft.
        </ApplicationState>
      </main>
    ) : (
      this.props.children
    );
  }
}
const root = createRoot(document.getElementById('root')!);
root.render(
  <main className="sign-in">
    <ApplicationState status="loading" titleTag="h1" title="Loading catalog review…" />
  </main>,
);
try {
  const response = await fetch('/review/config.json', {
    credentials: 'omit',
    cache: 'no-store',
    signal: AbortSignal.timeout(10000),
  });
  const auth = createReviewAuth(reviewConfigSchema.parse(await readBoundedJson(response, 8192)));
  root.render(
    <StrictMode>
      <ReviewBoundary>
        <App auth={auth} />
      </ReviewBoundary>
    </StrictMode>,
  );
} catch {
  root.render(
    <main className="sign-in">
      <ApplicationState
        status="error"
        titleTag="h1"
        title="Catalog review is unavailable."
        actions={<Button onClick={() => location.reload()}>Reload</Button>}
      >
        Check the connection and server configuration, then reload.
      </ApplicationState>
    </main>,
  );
}
