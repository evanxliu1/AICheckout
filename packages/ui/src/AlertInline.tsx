// Helios Alert (type inline): https://helios.hashicorp.design/components/alert
import type { ElementType, HTMLAttributes, ReactNode } from 'react';
import { useId } from 'react';
import { Icon, type IconName } from './Icon';
import { cx } from './cx';

export type AlertColor = 'neutral' | 'highlight' | 'success' | 'warning' | 'critical';
const DEFAULT_ICON: Record<AlertColor, IconName> = {
  neutral: 'info',
  highlight: 'info',
  success: 'check-circle',
  warning: 'alert-triangle',
  critical: 'alert-diamond',
};

export type AlertInlineProps = Omit<HTMLAttributes<HTMLDivElement>, 'title' | 'role' | 'color'> & {
  color?: AlertColor;
  title?: ReactNode;
  titleTag?: ElementType;
  /** Description; required when there is no title. */
  children?: ReactNode;
  /** Override the default icon, or pass false to hide it. */
  icon?: IconName | false;
  actions?: ReactNode;
  onDismiss?: () => void;
  /**
   * Live-region role. Helios default: `alert` for success, warning, and critical; none for
   * neutral and highlight. Use `status` for non-urgent updates that should still be announced.
   */
  role?: 'alert' | 'status' | 'none';
};

export function AlertInline({
  color = 'neutral',
  title,
  titleTag: TitleTag = 'div',
  children,
  icon,
  actions,
  onDismiss,
  role,
  className,
  ...rest
}: AlertInlineProps) {
  const titleId = useId();
  const liveRole = role ?? (color === 'neutral' || color === 'highlight' ? 'none' : 'alert');
  const iconName = icon === false ? null : (icon ?? DEFAULT_ICON[color]);
  return (
    <div
      className={cx('ac-alert', `ac-alert--${color}`, className)}
      role={liveRole === 'none' ? undefined : liveRole}
      aria-labelledby={title ? titleId : undefined}
      {...rest}
    >
      {iconName ? <Icon name={iconName} className="ac-alert__icon" /> : null}
      <div className="ac-alert__content">
        <div className="ac-alert__text">
          {title ? (
            <TitleTag id={titleId} className="ac-alert__title">
              {title}
            </TitleTag>
          ) : null}
          {children ? <div className="ac-alert__description">{children}</div> : null}
        </div>
        {actions ? <div className="ac-alert__actions">{actions}</div> : null}
      </div>
      {onDismiss ? (
        <button type="button" className="ac-dismiss-button" aria-label="Dismiss" onClick={onDismiss}>
          <Icon name="x" />
        </button>
      ) : null}
    </div>
  );
}
