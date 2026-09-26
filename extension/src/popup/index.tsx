import React from 'react';
import ReactDOM from 'react-dom/client';
import VaultGate from '../components/VaultGate';
import ErrorBoundary from '../components/ErrorBoundary';
import '../styles/globals.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><ErrorBoundary><VaultGate /></ErrorBoundary></React.StrictMode>,
);
