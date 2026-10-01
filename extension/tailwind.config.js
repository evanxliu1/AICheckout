/**
 * Tailwind is kept for layout utilities only. Its design scales are replaced (not extended) by
 * Helios design tokens, so any color, type, radius or shadow utility resolves to a --token-*
 * variable from @ai-checkout/ui/styles.css. Preflight is off: components bring their own resets.
 * @type {import('tailwindcss').Config}
 */
const token = (name) => `var(--token-${name})`;
export default {
  content: ['./src/**/*.{ts,tsx,html}'],
  corePlugins: { preflight: false },
  theme: {
    colors: {
      transparent: 'transparent',
      current: 'currentColor',
      page: token('color-page-faint'),
      surface: token('color-surface-primary'),
      'surface-faint': token('color-surface-faint'),
      'surface-strong': token('color-surface-strong'),
      strong: token('color-foreground-strong'),
      primary: token('color-foreground-primary'),
      faint: token('color-foreground-faint'),
      action: token('color-foreground-action'),
      critical: token('color-foreground-critical-on-surface'),
      success: token('color-foreground-success-on-surface'),
      border: token('color-border-primary'),
      'border-faint': token('color-border-faint'),
    },
    fontFamily: { sans: token('typography-font-stack-text'), mono: token('typography-font-stack-code') },
    fontSize: {
      xs: [token('typography-body-100-font-size'), token('typography-body-100-line-height')],
      sm: [token('typography-body-200-font-size'), token('typography-body-200-line-height')],
      base: [token('typography-body-300-font-size'), token('typography-body-300-line-height')],
      lg: [token('typography-display-300-font-size'), token('typography-display-300-line-height')],
      xl: [token('typography-display-400-font-size'), token('typography-display-400-line-height')],
    },
    fontWeight: {
      normal: token('typography-font-weight-regular'),
      medium: token('typography-font-weight-medium'),
      semibold: token('typography-font-weight-semibold'),
      bold: token('typography-font-weight-bold'),
    },
    borderRadius: {
      none: '0',
      sm: token('border-radius-small'),
      DEFAULT: token('border-radius-medium'),
      lg: token('border-radius-large'),
    },
    boxShadow: {
      none: 'none',
      low: token('elevation-low-box-shadow'),
      mid: token('elevation-mid-box-shadow'),
    },
    extend: {},
  },
  plugins: [],
};
