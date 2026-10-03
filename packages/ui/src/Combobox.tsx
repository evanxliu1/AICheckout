// Helios has no React combobox; this follows the Helios form text input and dropdown list styles
// (https://helios.hashicorp.design/components/form/text-input) and the WAI-ARIA editable combobox
// with list autocomplete pattern (https://www.w3.org/WAI/ARIA/apg/patterns/combobox/).
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type InputHTMLAttributes,
  type KeyboardEvent,
} from 'react';
import { cx } from './cx';
import { matchesSearch, type ComboboxOption } from './search';

export type { ComboboxOption };

export type ComboboxProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'onSelect' | 'value' | 'defaultValue' | 'onChange' | 'type' | 'role'
> & {
  options: ComboboxOption[];
  /** Called with the chosen option's id. The text field is cleared afterwards. */
  onSelect: (id: string) => void;
  /** Accessible name of the list of matches. */
  listLabel: string;
  /** Live status when the search matches nothing; also shown under the field. */
  emptyText?: string;
  /** Live status for a number of matches. */
  countText?: (count: number) => string;
  isInvalid?: boolean;
};

/**
 * A text field that filters a list of options as you type and adds the one you pick. Arrow keys
 * move through the matches (the field keeps focus; `aria-activedescendant` names the active one),
 * Enter picks, Escape closes the list or clears the text. Matches are grouped (`role="group"`) and
 * their count is announced in a polite status region.
 */
export function Combobox({
  options,
  onSelect,
  listLabel,
  emptyText = 'No matches',
  countText = (count) => `${count} ${count === 1 ? 'match' : 'matches'}`,
  isInvalid,
  id,
  className,
  disabled,
  onBlur,
  onKeyDown,
  'aria-describedby': describedBy,
  ...rest
}: ComboboxProps) {
  const generated = useId();
  const inputId = id ?? `combobox${generated}`;
  const listId = `${inputId}-list`;
  const statusId = `${inputId}-status`;
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const list = useRef<HTMLDivElement>(null);
  const matches = useMemo(() => options.filter((option) => matchesSearch(option, query)), [options, query]);
  const groups = useMemo(() => {
    const byGroup = new Map<string, { option: ComboboxOption; index: number }[]>();
    matches.forEach((option, index) => {
      const key = option.group ?? '';
      byGroup.set(key, [...(byGroup.get(key) ?? []), { option, index }]);
    });
    return [...byGroup];
  }, [matches]);
  const optionId = (index: number) => `${inputId}-option-${index}`;
  const showList = open && !disabled && matches.length > 0;

  useEffect(() => {
    if (!showList || active < 0) return;
    list.current?.ownerDocument.getElementById(optionId(active))?.scrollIntoView?.({ block: 'nearest' });
  }, [active, showList]); // eslint-disable-line react-hooks/exhaustive-deps

  function choose(index: number) {
    const option = matches[index];
    if (!option) return;
    onSelect(option.id);
    setQuery('');
    setOpen(false);
    setActive(-1);
  }
  function move(step: number) {
    if (!matches.length) return;
    setOpen(true);
    setActive((current) =>
      current < 0 ? (step > 0 ? 0 : matches.length - 1) : (current + step + matches.length) % matches.length,
    );
  }
  function keyDown(event: KeyboardEvent<HTMLInputElement>) {
    onKeyDown?.(event);
    if (event.defaultPrevented) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (!open && event.altKey) setOpen(true);
      else move(1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      move(-1);
    } else if (event.key === 'Enter') {
      // Never submit the surrounding form from the search field.
      event.preventDefault();
      if (showList && active >= 0) choose(active);
      else if (showList && matches.length === 1) choose(0);
    } else if (event.key === 'Escape') {
      if (open) {
        event.preventDefault();
        setOpen(false);
        setActive(-1);
      } else if (query) {
        event.preventDefault();
        setQuery('');
      }
    }
  }

  const status = !open || !query.trim() ? '' : matches.length ? countText(matches.length) : emptyText;
  return (
    <div className={cx('ac-combobox', className)}>
      <input
        {...rest}
        id={inputId}
        type="text"
        role="combobox"
        autoComplete="off"
        spellCheck={false}
        disabled={disabled}
        value={query}
        className={cx('ac-form-text-input', isInvalid && 'ac-form-control--invalid')}
        aria-invalid={isInvalid || undefined}
        aria-autocomplete="list"
        aria-expanded={showList}
        aria-controls={listId}
        aria-activedescendant={showList && active >= 0 ? optionId(active) : undefined}
        aria-describedby={describedBy}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
          setActive(-1);
        }}
        onKeyDown={keyDown}
        onBlur={(event) => {
          onBlur?.(event);
          setOpen(false);
          setActive(-1);
        }}
      />
      <div
        ref={list}
        id={listId}
        role="listbox"
        aria-label={listLabel}
        className="ac-combobox__listbox"
        hidden={!showList}
      >
        {showList &&
          groups.map(([group, items], groupIndex) => {
            const rendered = items.map(({ option, index }) => (
              <div
                key={option.id}
                id={optionId(index)}
                role="option"
                aria-selected={index === active}
                className={cx('ac-combobox__option', index === active && 'ac-combobox__option--active')}
                // Keep focus in the field; the click picks the option.
                onMouseDown={(event) => event.preventDefault()}
                onMouseMove={() => index !== active && setActive(index)}
                onClick={() => choose(index)}
              >
                {option.label}
              </div>
            ));
            if (!group) return rendered;
            const labelId = `${inputId}-group-${groupIndex}`;
            return (
              <div key={group} role="group" aria-labelledby={labelId} className="ac-combobox__group">
                <div id={labelId} role="presentation" className="ac-combobox__group-label">
                  {group}
                </div>
                {rendered}
              </div>
            );
          })}
      </div>
      <div
        id={statusId}
        role="status"
        className={open && query.trim() && !matches.length ? 'ac-combobox__empty' : 'ac-visually-hidden'}
      >
        {status}
      </div>
    </div>
  );
}
