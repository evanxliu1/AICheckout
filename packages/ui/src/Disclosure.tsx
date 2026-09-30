// Native details/summary styled after Helios Accordion: https://helios.hashicorp.design/components/accordion
import type { DetailsHTMLAttributes, ElementType, ReactNode } from 'react';
import { Icon } from './Icon';
import { cx } from './cx';

export type DisclosureProps = Omit<DetailsHTMLAttributes<HTMLDetailsElement>, 'title'> & {
  title: ReactNode;
  /** Wraps the summary text, for example `h3`, so the toggle stays in the heading outline. */
  titleTag?: ElementType;
  children: ReactNode;
};

export function Disclosure({
  title,
  titleTag: TitleTag = 'span',
  className,
  children,
  ...rest
}: DisclosureProps) {
  return (
    <details className={cx('ac-disclosure', className)} {...rest}>
      <summary className="ac-disclosure__summary">
        <Icon name="chevron-right" className="ac-disclosure__icon" />
        <TitleTag className="ac-disclosure__title">{title}</TitleTag>
      </summary>
      <div className="ac-disclosure__content">{children}</div>
    </details>
  );
}
