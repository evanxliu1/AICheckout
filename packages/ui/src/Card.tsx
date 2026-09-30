// Helios Card (container): https://helios.hashicorp.design/components/card
import type { ElementType, HTMLAttributes } from 'react';
import { cx } from './cx';

export type CardLevel = 'base' | 'mid' | 'high';
export type CardProps = HTMLAttributes<HTMLElement> & {
  level?: CardLevel;
  levelHover?: CardLevel;
  hasBorder?: boolean;
  background?: 'neutral-primary' | 'neutral-secondary';
  overflow?: 'visible' | 'hidden';
  /** Element to render, for example `li` inside a list or `section` with a heading. */
  as?: ElementType;
};

export function Card({
  level = 'base',
  levelHover,
  hasBorder,
  background = 'neutral-primary',
  overflow = 'visible',
  as: Tag = 'div',
  className,
  ...rest
}: CardProps) {
  return (
    <Tag
      className={cx(
        'ac-card',
        `ac-card--level-${level}`,
        hasBorder && 'ac-card--border',
        levelHover && `ac-card--hover-${levelHover}`,
        `ac-card--${background}`,
        overflow === 'hidden' && 'ac-card--overflow-hidden',
        className,
      )}
      {...rest}
    />
  );
}
