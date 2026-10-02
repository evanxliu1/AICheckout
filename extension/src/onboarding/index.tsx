import React from 'react';
import ReactDOM from 'react-dom/client';
import Onboarding from './Onboarding';
import ErrorBoundary from '../components/ErrorBoundary';
import '@ai-checkout/ui/styles.css';
import '../styles/globals.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <Onboarding />
    </ErrorBoundary>
  </React.StrictMode>,
);
