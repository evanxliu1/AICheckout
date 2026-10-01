import { Component, type ErrorInfo, type ReactNode } from 'react';
import { ApplicationState, Button } from '@ai-checkout/ui';

/** Catches render errors and offers a reload; error details stay in the console, not the UI. */
export default class ErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('AI Checkout popup error:', error, info.componentStack);
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <main className="checkout-popup">
        <div className="card-body">
          <ApplicationState
            status="error"
            title="Something went wrong"
            titleTag="h1"
            actions={
              <Button icon="arrow-right" iconPosition="trailing" onClick={() => window.location.reload()}>
                Reload the extension
              </Button>
            }
          >
            The popup hit an unexpected error. Your saved inputs are unchanged.
          </ApplicationState>
        </div>
      </main>
    );
  }
}
