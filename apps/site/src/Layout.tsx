import type { ReactNode } from 'react';
import { Icon, Link } from '@ai-checkout/ui';

export const REPO = 'https://github.com/evanxliu1/AICheckout';
export type PageId = 'home' | 'results' | 'architecture' | 'privacy' | 'support';
export const PAGES: { id: PageId; path: string; label: string }[] = [
  { id: 'home', path: '/', label: 'Overview' },
  { id: 'results', path: '/results/', label: 'Results' },
  { id: 'architecture', path: '/architecture/', label: 'Architecture' },
  { id: 'privacy', path: '/privacy/', label: 'Privacy' },
  { id: 'support', path: '/support/', label: 'Support' },
];

export function Layout({ page, children }: { page: PageId; children: ReactNode }) {
  return (
    <>
      <a className="skip-link ac-link ac-link--inline ac-link--primary" href="#main">
        Skip to content
      </a>
      <header className="site-header">
        <div className="site-header__inner">
          <a className="brand" href="/">
            <Icon name="shopping-cart" size={24} />
            <span>AI Checkout</span>
          </a>
          <nav aria-label="Site">
            <ul className="site-nav">
              {PAGES.map((item) => (
                <li key={item.id}>
                  <a
                    className="site-nav__link"
                    href={item.path}
                    aria-current={item.id === page ? 'page' : undefined}
                  >
                    {item.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        </div>
      </header>
      <main id="main" className="site-main" tabIndex={-1}>
        {children}
      </main>
      <footer className="site-footer">
        <div className="site-footer__inner">
          <p>
            AI Checkout is an open-source project.{' '}
            <Link href={REPO} isExternal>
              Source on GitHub
            </Link>
          </p>
          <p className="muted">
            Interface built to the specs of the Helios design system with its tokens and Flight icons
            (MPL-2.0). Not affiliated with or endorsed by HashiCorp. Card names belong to their issuers; AI
            Checkout is not affiliated with any issuer or retailer.
          </p>
        </div>
      </footer>
    </>
  );
}

/** A page heading block: an eyebrow line, the h1 and a short lead paragraph. */
export function PageIntro({
  eyebrow,
  title,
  children,
}: {
  eyebrow: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="page-intro">
      <p className="eyebrow">{eyebrow}</p>
      <h1>{title}</h1>
      <div className="lead">{children}</div>
    </div>
  );
}
