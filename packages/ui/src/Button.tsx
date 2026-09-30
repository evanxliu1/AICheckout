// Helios Button: https://helios.hashicorp.design/components/button
import { forwardRef, type ButtonHTMLAttributes, type MouseEvent } from 'react';
import { Icon, type IconName } from './Icon';
import { cx } from './cx';

export type ButtonColor = 'primary' | 'secondary' | 'tertiary' | 'critical';
export type ButtonSize = 'small' | 'medium' | 'large';
export type ButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'color'> & {
  color?: ButtonColor;
  size?: ButtonSize;
  icon?: IconName;
  iconPosition?: 'leading' | 'trailing';
  /** Shows only the icon; the children text becomes the accessible name. */
  isIconOnly?: boolean;
  isFullWidth?: boolean;
  /** Keeps the button's width and name, shows a spinner, and ignores activation. */
  isLoading?: boolean;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    color = 'primary',
    size = 'medium',
    icon,
    iconPosition = 'leading',
    isIconOnly,
    isFullWidth,
    isLoading,
    type = 'button',
    className,
    children,
    onClick,
    'aria-label': ariaLabel,
    'aria-disabled': ariaDisabled,
    ...rest
  },
  ref,
) {
  if (isIconOnly && !icon) throw new Error('Button: isIconOnly requires an icon');
  const iconNode = icon ? <Icon name={icon} className="ac-button__icon" /> : null;
  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    if (isLoading) event.preventDefault();
    else onClick?.(event);
  };
  return (
    <button
      ref={ref}
      type={type}
      className={cx(
        'ac-button',
        `ac-button--${color}`,
        `ac-button--${size}`,
        isIconOnly && 'ac-button--icon-only',
        isFullWidth && 'ac-button--full-width',
        isLoading && 'ac-button--loading',
        className,
      )}
      aria-label={ariaLabel ?? (isIconOnly && typeof children === 'string' ? children : undefined)}
      aria-disabled={isLoading || ariaDisabled || undefined}
      aria-busy={isLoading || undefined}
      onClick={handleClick}
      {...rest}
    >
      <span className="ac-button__content">
        {iconPosition === 'leading' && iconNode}
        {!isIconOnly && <span className="ac-button__text">{children}</span>}
        {iconPosition === 'trailing' && !isIconOnly && iconNode}
      </span>
      {isLoading && <Icon name="loading" className="ac-button__spinner" />}
    </button>
  );
});
