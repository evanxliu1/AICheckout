import { describe, expect, it } from 'vitest';
import { routeMessage } from '../src/background/routing';

const ids = {
  runtimeId: 'ext',
  pageUrls: [
    'chrome-extension://ext/src/popup/index.html',
    'chrome-extension://ext/src/onboarding/index.html',
  ],
  badgeUrl: 'chrome-extension://ext/src/badge/index.html',
};
const popup = { id: 'ext', url: 'chrome-extension://ext/src/popup/index.html' };
const badge = { id: 'ext', url: 'chrome-extension://ext/src/badge/index.html', tab: { id: 7 }, frameId: 3 };
const content = { id: 'ext', url: 'https://www.bestbuy.com/cart', tab: { id: 7 }, frameId: 0 };

describe('worker routing by sender', () => {
  it('gives the popup and onboarding page the wallet API and nothing else does', () => {
    expect(routeMessage({ type: 'checkout:get-state' }, popup, ids)).toEqual({ kind: 'page' });
    expect(
      routeMessage(
        { type: 'settings:get' },
        { id: 'ext', url: 'chrome-extension://ext/src/onboarding/index.html' },
        ids,
      ),
    ).toEqual({ kind: 'page' });
    for (const sender of [badge, content, { ...popup, id: 'other' }])
      expect(routeMessage({ type: 'checkout:get-state' }, sender, ids)).toEqual({ kind: 'deny' });
  });
  it('lets the badge iframe use badge:* for its own tab only, identified by Chrome', () => {
    expect(routeMessage({ type: 'badge:get', tabId: 99 }, badge, ids)).toEqual({ kind: 'badge', tabId: 7 });
    expect(routeMessage({ type: 'badge:get' }, { ...badge, frameId: 0 }, ids)).toEqual({ kind: 'deny' });
    expect(routeMessage({ type: 'badge:get' }, { ...badge, tab: undefined }, ids)).toEqual({ kind: 'deny' });
    expect(routeMessage({ type: 'badge:get' }, content, ids)).toEqual({ kind: 'deny' });
    expect(routeMessage({ type: 'badge:get' }, popup, ids)).toEqual({ kind: 'deny' });
    expect(routeMessage({ type: 'badge:changed' }, popup, ids)).toEqual({ kind: 'ignore' });
  });
  it('lets the content script report readings and order pages only from a tab top frame over HTTPS', () => {
    expect(routeMessage({ type: 'cart:reading' }, content, ids)).toEqual({
      kind: 'content',
      tabId: 7,
      url: 'https://www.bestbuy.com/cart',
    });
    expect(routeMessage({ type: 'order:page' }, { ...content, frameId: 1 }, ids)).toEqual({ kind: 'deny' });
    expect(
      routeMessage({ type: 'cart:reading' }, { ...content, url: 'http://www.bestbuy.com/cart' }, ids),
    ).toEqual({
      kind: 'deny',
    });
    expect(routeMessage({ type: 'cart:reading' }, { ...content, id: 'other' }, ids)).toEqual({
      kind: 'deny',
    });
  });
  it('ignores unrelated or malformed messages', () => {
    for (const request of [null, 'checkout:get-state', { type: 5 }, { type: 'other:thing' }])
      expect(routeMessage(request, popup, ids)).toEqual({ kind: 'ignore' });
  });
});
