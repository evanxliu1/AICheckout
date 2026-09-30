// Helios Badge: https://helios.hashicorp.design/components/badge
import type { HTMLAttributes, ReactNode } from 'react';
import { Icon, type IconName } from './Icon';
import { cx } from './cx';

export type BadgeColor = 'neutral' | 'highlight' | 'success' | 'warning' | 'critical';
export type BadgeProps = Omit<HTMLAttributes<HTMLSpanElement>, 'color'> & {
  color?: BadgeColor;
  type?: 'filled' | 'inverted' | 'outlined';
  size?: 'small' | 'medium' | 'large';
  icon?: IconName;
  /** Shows only the icon; the text stays available to assistive technology. */
  isIconOnly?: boolean;
  children: ReactNode;
};

export function Badge({
  color = 'neutral',
  type = 'filled',
  size = 'medium',
  icon,
  isIconOnly,
  className,
  children,
  ...rest
}: BadgeProps) {
  return (
    <span className={cx('ac-badge', `ac-badge--${color}-${type}`, `ac-badge--${size}`, className)} {...rest}>
      {icon ? <Icon name={icon} className="ac-badge__icon" /> : null}
      <span className={isIconOnly ? 'ac-visually-hidden' : 'ac-badge__text'}>{children}</span>
    </span>
  );
}
