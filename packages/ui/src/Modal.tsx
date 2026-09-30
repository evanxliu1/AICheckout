// Helios Modal: https://helios.hashicorp.design/components/modal
// Focus moves into the dialog, Tab is trapped, Esc and the overlay close it (unless
// isDismissDisabled), the rest of the page is inert, and focus returns to the opener.
import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { Icon, type IconName } from './Icon';
import { cx } from './cx';

export type ModalProps = {
  isOpen: boolean;
  onClose: () => void;
  title: ReactNode;
  tagline?: ReactNode;
  icon?: IconName;
  color?: 'neutral' | 'warning' | 'critical';
  size?: 'small' | 'medium' | 'large';
  /** Prevents Esc, overlay, and dismiss-button closing, for example while a request is pending. */
  isDismissDisabled?: boolean;
  /** Element to focus on open; defaults to the first focusable element. */
  initialFocusRef?: RefObject<HTMLElement | null>;
  footer?: ReactNode;
  children: ReactNode;
};

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'summary',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function focusable(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (node) => !node.closest('[hidden], [inert]'),
  );
}

export function Modal(props: ModalProps) {
  return props.isOpen ? createPortal(<ModalDialog {...props} />, document.body) : null;
}

function ModalDialog({
  onClose,
  title,
  tagline,
  icon,
  color = 'neutral',
  size = 'medium',
  isDismissDisabled,
  initialFocusRef,
  footer,
  children,
}: ModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const dismissRef = useRef({ onClose, isDismissDisabled });
  dismissRef.current = { onClose, isDismissDisabled };

  useEffect(() => {
    const dialog = dialogRef.current!;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const root = dialog.closest('.ac-modal-root')!;
    const siblings = [...document.body.children].filter(
      (node): node is HTMLElement => node !== root && node instanceof HTMLElement && !node.inert,
    );
    siblings.forEach((node) => (node.inert = true));
    document.body.classList.add('ac-modal-open');
    (initialFocusRef?.current ?? focusable(dialog)[0] ?? dialog).focus();
    return () => {
      siblings.forEach((node) => (node.inert = false));
      document.body.classList.remove('ac-modal-open');
      if (opener?.isConnected) opener.focus();
    };
    // Runs once per open; initialFocusRef is read on open only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dismiss = () => {
    if (!dismissRef.current.isDismissDisabled) dismissRef.current.onClose();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      dismiss();
      return;
    }
    if (event.key !== 'Tab') return;
    const items = focusable(dialogRef.current!);
    if (!items.length) {
      event.preventDefault();
      return;
    }
    const first = items[0],
      last = items[items.length - 1];
    if (
      event.shiftKey &&
      (document.activeElement === first || document.activeElement === dialogRef.current)
    ) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div className="ac-modal-root">
      <div className="ac-modal-overlay" aria-hidden="true" onClick={dismiss} />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={cx('ac-modal', `ac-modal--${size}`, `ac-modal--${color}`)}
        onKeyDown={onKeyDown}
      >
        <div className="ac-modal__header">
          {icon ? <Icon name={icon} className="ac-modal__icon" /> : null}
          <div className="ac-modal__heading">
            {tagline ? <div className="ac-modal__tagline">{tagline}</div> : null}
            <h2 id={titleId} className="ac-modal__title">
              {title}
            </h2>
          </div>
          <button
            type="button"
            className="ac-dismiss-button"
            aria-label="Dismiss"
            onClick={dismiss}
            disabled={isDismissDisabled}
          >
            <Icon name="x" />
          </button>
        </div>
        <div className="ac-modal__body">{children}</div>
        {footer ? <div className="ac-modal__footer">{footer}</div> : null}
      </div>
    </div>
  );
}
