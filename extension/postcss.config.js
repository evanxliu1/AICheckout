import tailwindcss from '@tailwindcss/postcss';
import autoprefixer from 'autoprefixer';

/** Tailwind 4 always emits its own zero-specificity, bottom-margin space-y rules. Drop them so only
 * the Tailwind 3-compatible space-y utility in src/styles/globals.css applies. */
const dropTailwind4SpaceY = {
  postcssPlugin: 'drop-tailwind4-space-y',
  Rule(rule) {
    if (rule.selector.startsWith(':where(.space-y-')) rule.remove();
  },
};

export default {
  plugins: [tailwindcss({ optimize: false }), dropTailwind4SpaceY, autoprefixer()],
};
