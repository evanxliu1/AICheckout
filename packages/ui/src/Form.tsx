// Helios form primitives:
// Field/Label/HelperText/Error https://helios.hashicorp.design/components/form/primitives
// TextInput https://helios.hashicorp.design/components/form/text-input
// Select https://helios.hashicorp.design/components/form/select
// Checkbox https://helios.hashicorp.design/components/form/checkbox
// Radio https://helios.hashicorp.design/components/form/radio
// Toggle https://helios.hashicorp.design/components/form/toggle
import {
  forwardRef,
  useId,
  type FieldsetHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type Ref,
  type SelectHTMLAttributes,
} from 'react';
import { Icon } from './Icon';
import { cx } from './cx';

/** Props a Field hands to its control so the label, helper text, and error are wired up. */
export type FieldControlProps = {
  id: string;
  'aria-describedby'?: string;
  'aria-invalid'?: true;
  required?: boolean;
};

type Messages = { helperText?: ReactNode; error?: ReactNode | ReactNode[] };

function hasError(error: Messages['error']): boolean {
  return Array.isArray(error) ? error.length > 0 : error != null && error !== false && error !== '';
}

/** `aria-invalid` of undefined, false, or "false" means valid. */
function ariaInvalidValue(value: InputHTMLAttributes<HTMLInputElement>['aria-invalid']): boolean {
  return value !== undefined && value !== false && value !== 'false';
}

function describedBy(ids: { helper?: string; error?: string }, messages: Messages, extra?: string) {
  const list = [
    messages.helperText ? ids.helper : undefined,
    hasError(messages.error) ? ids.error : undefined,
    extra,
  ];
  return list.filter(Boolean).join(' ') || undefined;
}

function Indicator({ isRequired, isOptional }: { isRequired?: boolean; isOptional?: boolean }) {
  if (isRequired) return <span className="ac-form-indicator ac-form-indicator--required">Required</span>;
  if (isOptional) return <span className="ac-form-indicator">(Optional)</span>;
  return null;
}

function HelperText({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <div id={id} className="ac-form-helper-text">
      {children}
    </div>
  );
}

/** Always rendered, so an error that appears after user input is announced politely. */
function ErrorRegion({ id, error }: { id: string; error: Messages['error'] }) {
  return (
    <div id={id} className="ac-form-error-region" aria-live="polite">
      {hasError(error) ? <ErrorText error={error} /> : null}
    </div>
  );
}

function ErrorText({ error }: { error: Messages['error'] }) {
  const items = Array.isArray(error) ? error : [error];
  return (
    <div className="ac-form-error">
      <Icon name="alert-diamond" className="ac-form-error__icon" />
      <div className="ac-form-error__content">
        {items.map((item, index) => (
          <p key={index} className="ac-form-error__message">
            {item}
          </p>
        ))}
      </div>
    </div>
  );
}

export type FieldProps = Messages & {
  label: ReactNode;
  isRequired?: boolean;
  isOptional?: boolean;
  /** Control id; generated when omitted. */
  id?: string;
  /** Extra ids for the control's aria-describedby, merged with the helper and error ids. */
  describedBy?: string;
  className?: string;
  children: (control: FieldControlProps) => ReactNode;
};

/** Label + control + helper text + error for text inputs and selects (vertical layout). */
export function Field({
  label,
  helperText,
  error,
  isRequired,
  isOptional,
  id,
  describedBy: extraDescribedBy,
  className,
  children,
}: FieldProps) {
  const generated = useId();
  const controlId = id ?? `field${generated}`;
  const ids = { helper: `${controlId}-helper`, error: `${controlId}-error` };
  const invalid = hasError(error);
  return (
    <div className={cx('ac-form-field', className)}>
      <label className="ac-form-label" htmlFor={controlId}>
        {label}
        <Indicator isRequired={isRequired} isOptional={isOptional} />
      </label>
      {helperText ? <HelperText id={ids.helper}>{helperText}</HelperText> : null}
      <div className="ac-form-field__control">
        {children({
          id: controlId,
          'aria-describedby': describedBy(ids, { helperText, error }, extraDescribedBy),
          'aria-invalid': invalid || undefined,
          required: isRequired || undefined,
        })}
      </div>
      <ErrorRegion id={ids.error} error={error} />
    </div>
  );
}

export type TextInputProps = InputHTMLAttributes<HTMLInputElement> & { isInvalid?: boolean };

export const TextInput = forwardRef<HTMLInputElement, TextInputProps>(function TextInput(
  { type = 'text', isInvalid, className, 'aria-invalid': ariaInvalid, ...rest },
  ref,
) {
  const invalid = Boolean(isInvalid) || ariaInvalidValue(ariaInvalid);
  return (
    <input
      ref={ref}
      type={type}
      className={cx('ac-form-text-input', invalid && 'ac-form-control--invalid', className)}
      aria-invalid={invalid || undefined}
      {...rest}
    />
  );
});

export type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & { isInvalid?: boolean };

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { isInvalid, className, 'aria-invalid': ariaInvalid, ...rest },
  ref,
) {
  const invalid = Boolean(isInvalid) || ariaInvalidValue(ariaInvalid);
  return (
    <select
      ref={ref}
      className={cx('ac-form-select', invalid && 'ac-form-control--invalid', className)}
      aria-invalid={invalid || undefined}
      {...rest}
    />
  );
});

type ChoiceProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> &
  Messages & {
    label: ReactNode;
  };

function Choice({
  kind,
  inputRef,
  label,
  helperText,
  error,
  id,
  className,
  'aria-describedby': extraDescribedBy,
  'aria-invalid': ariaInvalid,
  ...rest
}: ChoiceProps & { kind: 'checkbox' | 'radio' | 'toggle'; inputRef: Ref<HTMLInputElement> }) {
  const generated = useId();
  const controlId = id ?? `${kind}${generated}`;
  const ids = { helper: `${controlId}-helper`, error: `${controlId}-error` };
  const invalid = hasError(error) || ariaInvalidValue(ariaInvalid);
  const input = (
    <input
      ref={inputRef}
      id={controlId}
      type={kind === 'radio' ? 'radio' : 'checkbox'}
      role={kind === 'toggle' ? 'switch' : undefined}
      className={cx(
        kind === 'toggle' ? 'ac-form-toggle__control' : `ac-form-${kind}`,
        invalid && 'ac-form-control--invalid',
      )}
      aria-describedby={describedBy(ids, { helperText, error }, extraDescribedBy)}
      aria-invalid={invalid || undefined}
      {...rest}
    />
  );
  return (
    <div className={cx('ac-form-choice', `ac-form-choice--${kind}`, className)}>
      {kind === 'toggle' ? (
        <span className="ac-form-toggle">
          {input}
          <span className="ac-form-toggle__facade" />
        </span>
      ) : (
        input
      )}
      <label className="ac-form-choice__label" htmlFor={controlId}>
        {label}
      </label>
      {helperText ? <HelperText id={ids.helper}>{helperText}</HelperText> : null}
      {hasError(error) ? (
        <div id={ids.error} className="ac-form-choice__error">
          <ErrorText error={error} />
        </div>
      ) : null}
    </div>
  );
}

export type CheckboxProps = ChoiceProps;
export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(props, ref) {
  return <Choice kind="checkbox" inputRef={ref} {...props} />;
});

export type RadioProps = ChoiceProps;
export const Radio = forwardRef<HTMLInputElement, RadioProps>(function Radio(props, ref) {
  return <Choice kind="radio" inputRef={ref} {...props} />;
});

/** A checkbox exposed as `role="switch"`; use for settings that apply immediately. */
export type ToggleProps = ChoiceProps;
export const Toggle = forwardRef<HTMLInputElement, ToggleProps>(function Toggle(props, ref) {
  return <Choice kind="toggle" inputRef={ref} {...props} />;
});

export type FieldsetProps = Omit<FieldsetHTMLAttributes<HTMLFieldSetElement>, 'children'> &
  Messages & {
    legend: ReactNode;
    isRequired?: boolean;
    isOptional?: boolean;
    layout?: 'vertical' | 'horizontal';
    children: ReactNode;
  };

// Helios Fieldset: https://helios.hashicorp.design/components/form/primitives
/** Groups checkboxes, radios, or toggles under a legend with shared helper and error text. */
export function Fieldset({
  legend,
  helperText,
  error,
  isRequired,
  isOptional,
  layout = 'vertical',
  className,
  children,
  id,
  'aria-describedby': extraDescribedBy,
  ...rest
}: FieldsetProps) {
  const generated = useId();
  const baseId = id ?? `fieldset${generated}`;
  const ids = { helper: `${baseId}-helper`, error: `${baseId}-error` };
  return (
    <fieldset
      id={id}
      className={cx('ac-form-fieldset', className)}
      aria-describedby={describedBy(ids, { helperText, error }, extraDescribedBy)}
      {...rest}
    >
      <legend className="ac-form-legend">
        {legend}
        <Indicator isRequired={isRequired} isOptional={isOptional} />
      </legend>
      {helperText ? <HelperText id={ids.helper}>{helperText}</HelperText> : null}
      <div className={cx('ac-form-fieldset__group', `ac-form-fieldset__group--${layout}`)}>{children}</div>
      <ErrorRegion id={ids.error} error={error} />
    </fieldset>
  );
}
