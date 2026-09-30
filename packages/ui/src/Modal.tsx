// Helios Modal: https://helios.hashicorp.design/components/modal
// Focus moves into the dialog, Tab is trapped, Esc and the overlay close it (unless
// isDismissDisabled), the rest of the page is inert, and focus returns to the opener.
// Designed for one modal at a time; a nested modal works (only the top one handles keys, and
// the body scroll lock holds until the last one closes) but is not a supported pattern.
import { useEffect, useId, useRef, type ReactNode, type RefObject } from 'react';
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
  '[tabindex]',
].join(',');

/** Content of a closed <details> is unreachable, except that element's own summary. */
function insideClosedDetails(node: HTMLElement, root: HTMLElement): boolean {
  for (let el = node.parentElement; el && el !== root; el = el.parentElement) {
    if (el instanceof HTMLDetailsElement && !el.open) {
      const summary = el.querySelector(':scope > summary');
      if (node !== summary) return true;
    }
  }
  return false;
}

function isVisible(node: HTMLElement): boolean {
  // checkVisibility covers display:none, visibility:hidden, and content-visibility; jsdom lacks it.
  return (
    node.checkVisibility?.({
      visibilityProperty: true,
      checkVisibilityCSS: true,
    } as CheckVisibilityOptions) ?? true
  );
}

/** Elements Tab can reach inside `root`, in DOM order (one entry per radio group). */
function tabbable(root: HTMLElement): HTMLElement[] {
  const candidates = [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (node) =>
      !node.closest('[hidden], [inert]') &&
      !(node.getAttribute('tabindex') ?? '').trim().startsWith('-') &&
      !insideClosedDetails(node, root) &&
      isVisible(node),
  );
  const radioGroups = new Map<string, HTMLInputElement[]>();
  for (const node of candidates)
    if (node instanceof HTMLInputElement && node.type === 'radio' && node.name) {
      const key = `${node.form ? 'form' : 'doc'}:${node.name}`;
      radioGroups.set(key, [...(radioGroups.get(key) ?? []), node]);
    }
  const keep = new Set<HTMLElement>();
  for (const group of radioGroups.values()) keep.add(group.find((radio) => radio.checked) ?? group[0]);
  return candidates.filter(
    (node) => !(node instanceof HTMLInputElement && node.type === 'radio' && node.name) || keep.has(node),
  );
}

// Open dialogs, innermost last: only the top one handles keys; the body stays locked until all close.
const openStack: HTMLElement[] = [];

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
    openStack.push(dialog);
    document.body.classList.add('ac-modal-open');
    (initialFocusRef?.current ?? tabbable(dialog)[0] ?? dialog).focus();

    // On document, so Esc and Tab still work if focus fell to <body>.
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (openStack[openStack.length - 1] !== dialog) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        if (!dismissRef.current.isDismissDisabled) dismissRef.current.onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      event.preventDefault();
      const items = tabbable(dialog);
      if (!items.length) return dialog.focus();
      const index = items.indexOf(document.activeElement as HTMLElement);
      const next = event.shiftKey
        ? index <= 0
          ? items.length - 1
          : index - 1
        : index === -1 || index === items.length - 1
          ? 0
          : index + 1;
      items[next].focus();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      openStack.splice(openStack.indexOf(dialog), 1);
      siblings.forEach((node) => (node.inert = false));
      if (!openStack.length) document.body.classList.remove('ac-modal-open');
      if (opener?.isConnected) opener.focus();
    };
    // Runs once per open; initialFocusRef is read on open only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dismiss = () => {
    if (!dismissRef.current.isDismissDisabled) dismissRef.current.onClose();
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
