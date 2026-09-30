// Component gallery entry (dev only, not shipped): npm run gallery --workspace=@ai-checkout/ui
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import Gallery from './Gallery';
import '../src/styles.css';
import './gallery.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Gallery />
  </StrictMode>,
);
