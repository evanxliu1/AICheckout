// Helios ApplicationState: https://helios.hashicorp.design/components/application-state
import type { ElementType, HTMLAttributes, ReactNode } from 'react';
import { Icon, type IconName } from './Icon';
import { cx } from './cx';

export type ApplicationStateProps = Omit<HTMLAttributes<HTMLDivElement>, 'title'> & {
  /** `loading` renders a polite status region so the change is announced. */
  status: 'loading' | 'empty' | 'error';
  title: ReactNode;
  /** Pick the heading level that fits the page outline. */
  titleTag?: ElementType;
  icon?: IconName | false;
  errorCode?: string;
  /** Up to three actions (Button or Link). */
  actions?: ReactNode;
  align?: 'left' | 'center';
  children?: ReactNode;
};

const DEFAULT_ICON: Record<ApplicationStateProps['status'], IconName | undefined> = {
  loading: 'loading',
  empty: undefined,
  error: 'alert-circle',
};

export function ApplicationState({
  status,
  title,
  titleTag: TitleTag = 'h2',
  icon,
  errorCode,
  actions,
  align = 'left',
  className,
  children,
  ...rest
}: ApplicationStateProps) {
  const iconName = icon === false ? undefined : (icon ?? DEFAULT_ICON[status]);
  return (
    <div
      className={cx(
        'ac-application-state',
        `ac-application-state--${status}`,
        `ac-application-state--${align}`,
        className,
      )}
      role={status === 'loading' ? 'status' : undefined}
      aria-live={status === 'loading' ? 'polite' : undefined}
      {...rest}
    >
      <div className="ac-application-state__header">
        {errorCode ? <div className="ac-application-state__error-code">Error {errorCode}</div> : null}
        <TitleTag className="ac-application-state__title">
          {iconName ? <Icon name={iconName} size={24} className="ac-application-state__icon" /> : null}
          {title}
        </TitleTag>
      </div>
      {children ? <div className="ac-application-state__body">{children}</div> : null}
      {actions ? <div className="ac-application-state__footer">{actions}</div> : null}
    </div>
  );
}
