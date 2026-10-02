import { useState, type ReactNode } from 'react';
import { Disclosure, type DisclosureProps } from '@ai-checkout/ui';

/**
 * A disclosure whose content is rendered only once it has been opened, so a 180-card catalog does
 * not put every rule, field and table into the page up front. `onOpen` runs on each opening.
 */
export default function LazyDisclosure({
  children,
  onOpen,
  ...props
}: Omit<DisclosureProps, 'children' | 'onToggle'> & { children: () => ReactNode; onOpen?: () => void }) {
  const [opened, setOpened] = useState(false);
  return (
    <Disclosure
      {...props}
      onToggle={(event) => {
        if ((event.currentTarget as HTMLDetailsElement).open) {
          setOpened(true);
          onOpen?.();
        }
      }}
    >
      {opened ? children() : null}
    </Disclosure>
  );
}
