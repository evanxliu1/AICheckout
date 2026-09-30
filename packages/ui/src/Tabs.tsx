// Helios Tabs: https://helios.hashicorp.design/components/tabs
// Keyboard: arrow keys move between tabs (wrapping) and select them; Home/End jump to the ends.
import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Icon, type IconName } from './Icon';
import { cx } from './cx';

export type TabItem = {
  id: string;
  label: ReactNode;
  icon?: IconName;
  count?: number | string;
  content: ReactNode;
};

export type TabsProps = {
  /** Accessible name for the tab list. */
  label: string;
  tabs: TabItem[];
  selectedId?: string;
  defaultSelectedId?: string;
  onChange?: (id: string) => void;
  size?: 'medium' | 'large';
  className?: string;
};

export function Tabs({
  label,
  tabs,
  selectedId,
  defaultSelectedId,
  onChange,
  size = 'medium',
  className,
}: TabsProps) {
  const baseId = useId();
  const [internal, setInternal] = useState(defaultSelectedId ?? tabs[0]?.id);
  const current = selectedId ?? internal;
  const refs = useRef(new Map<string, HTMLButtonElement>());

  const select = (id: string, focus = false) => {
    if (selectedId === undefined) setInternal(id);
    if (id !== current) onChange?.(id);
    if (focus) refs.current.get(id)?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = tabs.findIndex((tab) => tab.id === current);
    const next = {
      ArrowRight: (index + 1) % tabs.length,
      ArrowLeft: (index - 1 + tabs.length) % tabs.length,
      Home: 0,
      End: tabs.length - 1,
    }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    select(tabs[next].id, true);
  };

  const tabId = (id: string) => `${baseId}-tab-${id}`;
  const panelId = (id: string) => `${baseId}-panel-${id}`;
  return (
    <div className={cx('ac-tabs', `ac-tabs--${size}`, className)}>
      <div role="tablist" aria-label={label} className="ac-tabs__tablist" onKeyDown={onKeyDown}>
        {tabs.map((tab) => {
          const selected = tab.id === current;
          return (
            <button
              key={tab.id}
              ref={(node) => {
                if (node) refs.current.set(tab.id, node);
                else refs.current.delete(tab.id);
              }}
              type="button"
              role="tab"
              id={tabId(tab.id)}
              aria-selected={selected}
              aria-controls={panelId(tab.id)}
              tabIndex={selected ? 0 : -1}
              className={cx('ac-tabs__tab', selected && 'ac-tabs__tab--selected')}
              onClick={() => select(tab.id)}
            >
              {tab.icon ? <Icon name={tab.icon} className="ac-tabs__icon" /> : null}
              <span>{tab.label}</span>
              {tab.count !== undefined ? <span className="ac-tabs__count">{tab.count}</span> : null}
            </button>
          );
        })}
      </div>
      {tabs.map((tab) => (
        <div
          key={tab.id}
          role="tabpanel"
          id={panelId(tab.id)}
          aria-labelledby={tabId(tab.id)}
          hidden={tab.id !== current}
          tabIndex={0}
          className="ac-tabs__panel"
        >
          {tab.content}
        </div>
      ))}
    </div>
  );
}
