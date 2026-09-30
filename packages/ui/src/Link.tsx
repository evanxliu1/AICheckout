// Helios Link::Standalone https://helios.hashicorp.design/components/link/standalone
// Helios Link::Inline https://helios.hashicorp.design/components/link/inline
import { forwardRef, type AnchorHTMLAttributes } from 'react';
import { Icon, type IconName } from './Icon';
import { cx } from './cx';

export type LinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'color'> & {
  href: string;
  variant?: 'inline' | 'standalone';
  color?: 'primary' | 'secondary';
  /** Standalone only. */
  size?: 'small' | 'medium' | 'large';
  icon?: IconName;
  iconPosition?: 'leading' | 'trailing';
  /** Opens in a new tab with `rel="noopener noreferrer"` and an announced external indicator. */
  isExternal?: boolean;
};

export const Link = forwardRef<HTMLAnchorElement, LinkProps>(function Link(
  {
    variant = 'inline',
    color = 'primary',
    size = 'medium',
    icon,
    iconPosition = variant === 'inline' ? 'trailing' : 'leading',
    isExternal,
    className,
    children,
    target,
    rel,
    ...rest
  },
  ref,
) {
  const external = isExternal || target === '_blank';
  const trailingIcon = external ? 'external-link' : iconPosition === 'trailing' ? icon : undefined;
  const leadingIcon = iconPosition === 'leading' ? icon : undefined;
  return (
    <a
      ref={ref}
      className={cx(
        'ac-link',
        `ac-link--${variant}`,
        `ac-link--${color}`,
        variant === 'standalone' && `ac-link--${size}`,
        className,
      )}
      target={external ? '_blank' : target}
      rel={external ? cx('noopener noreferrer', rel) : rel}
      {...rest}
    >
      {leadingIcon ? <Icon name={leadingIcon} className="ac-link__icon" /> : null}
      <span className="ac-link__text">{children}</span>
      {external ? <span className="ac-visually-hidden"> (opens in a new tab)</span> : null}
      {trailingIcon ? <Icon name={trailingIcon} className="ac-link__icon" /> : null}
    </a>
  );
});
