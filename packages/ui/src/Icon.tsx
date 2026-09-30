// Helios Icon: https://helios.hashicorp.design/components/icon
// Flight icons (MPL-2.0) inlined as SVG; see scripts/generate-icons.mjs for the included set.
import { forwardRef, type SVGProps } from 'react';
import { FLIGHT_ICONS, type IconName } from './icons.generated';
import { cx } from './cx';

export type { IconName };
export type IconProps = Omit<SVGProps<SVGSVGElement>, 'name' | 'children'> & {
  name: IconName;
  size?: 16 | 24;
  /**
   * Accessible name (or pass aria-label / aria-labelledby). Without one the icon is decorative and
   * hidden from assistive technology.
   */
  title?: string;
  isInline?: boolean;
};

export const Icon = forwardRef<SVGSVGElement, IconProps>(function Icon(
  { name, size = 16, title, isInline, className, 'aria-label': ariaLabel, ...rest },
  ref,
) {
  const sizes = FLIGHT_ICONS[name];
  const paths = (size === 24 && sizes[24]) || sizes[16];
  return (
    <svg
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox={paths === sizes[16] ? '0 0 16 16' : '0 0 24 24'}
      fill="none"
      focusable="false"
      className={cx(
        'ac-icon',
        name === 'loading' && 'ac-icon--loading',
        isInline && 'ac-icon--inline',
        className,
      )}
      data-icon={name}
      {...(title || ariaLabel || rest['aria-labelledby']
        ? { role: 'img', 'aria-label': title ?? ariaLabel }
        : { 'aria-hidden': true })}
      {...rest}
    >
      {paths.map((path, index) => (
        <path
          key={index}
          d={path.d}
          fill="currentColor"
          opacity={path.opacity}
          fillRule={path.fillRule}
          clipRule={path.fillRule}
        />
      ))}
    </svg>
  );
});
