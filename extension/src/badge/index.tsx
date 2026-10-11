import React from 'react';
import ReactDOM from 'react-dom/client';
import BadgeApp from './BadgeApp';
import ErrorBoundary from '../components/ErrorBoundary';
import '@ai-checkout/ui/styles.css';
import '../styles/globals.css';
import { loadMerchantsInEffect } from '../state/merchants-page';
import './badge.css';

// The cached merchant release (Phase 14.6) is read before the first render, so names and matches use it.
await loadMerchantsInEffect();
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <BadgeApp />
    </ErrorBoundary>
  </React.StrictMode>,
);
