import { z } from 'zod';

// Imported first by main.tsx. The review CSP forbids eval, so turn off zod's JIT before any schema
// runs; otherwise zod probes `new Function` and the browser reports a CSP violation.
z.config({ jitless: true });
