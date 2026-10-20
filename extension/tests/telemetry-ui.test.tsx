// Phase 15.3: the consent screen, the Settings controls and the two tap features, and the agreement between
// the consent copy and the generated public dictionary (docs/telemetry/events.md).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import Consent from '../src/components/Consent';
import TelemetrySettings from '../src/components/TelemetrySettings';
import SuggestStore from '../src/components/SuggestStore';
import ReportProblem from '../src/components/ReportProblem';
import {
  CONSENT_COPY,
  CONSENT_COVERAGE,
  PROBLEM_REASONS,
  TELEMETRY_EVENT_TYPES,
} from '../src/state/telemetry-contracts';

const dictionary = readFileSync(resolve(__dirname, '../../docs/telemetry/events.md'), 'utf8');
const sendMessage = vi.fn();
function stubChrome(status = { enabled: true, consent: null as 'granted' | 'declined' | null }) {
  sendMessage.mockReset();
  sendMessage.mockImplementation(async (request: { type: string; granted?: boolean }) => ({
    ok: true,
    status:
      request.type === 'telemetry:consent'
        ? { ...status, consent: request.granted ? 'granted' : 'declined' }
        : request.type === 'telemetry:delete'
          ? { ...status, consent: 'declined' }
          : status,
  }));
  vi.stubGlobal('chrome', { runtime: { sendMessage } });
}
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('the consent screen and the dictionary agree', () => {
  it('names what is sent for every event type in the dictionary, with the identifier wording and never "anonymous"', () => {
    render(<Consent busy={false} onAnswer={() => undefined} />);
    const text = document.body.textContent ?? '';
    for (const type of TELEMETRY_EVENT_TYPES) {
      expect(dictionary, `dictionary lists ${type}`).toContain(`### \`${type}\``);
      expect(text, `consent copy covers ${type}`).toContain(CONSENT_COVERAGE[type]);
    }
    expect(text).toContain('A random identifier');
    expect(text).toContain('no name, email or browsing history');
    expect(text.toLowerCase()).not.toContain('anonymous');
    expect(dictionary.toLowerCase()).not.toContain('anonymous');
    expect(dictionary).toContain('random identifier');
    // The data the dictionary carries is named on the screen: exact amounts, owned cards, errors, 90 days.
    expect(text).toContain('exact cart amount');
    expect(text).toContain('never card numbers');
    expect(text).toContain('90 days');
    expect(dictionary).toContain('90 days');
    expect(dictionary).toContain(
      'No automatic event carries a store name, domain, web address, page text or card number',
    );
  });
  it('offers Share and Not now equally, and reports the answer', () => {
    const onAnswer = vi.fn();
    render(<Consent busy={false} onAnswer={onAnswer} />);
    expect(screen.getByRole('heading', { name: CONSENT_COPY.title })).toBeTruthy();
    const share = screen.getByRole('button', { name: 'Share' });
    const notNow = screen.getByRole('button', { name: 'Not now' });
    expect(share.className).toBe(notNow.className);
    fireEvent.click(notNow);
    expect(onAnswer).toHaveBeenLastCalledWith(false);
    fireEvent.click(share);
    expect(onAnswer).toHaveBeenLastCalledWith(true);
    expect(screen.getByRole('list').querySelectorAll('li')).toHaveLength(CONSENT_COPY.sent.length);
  });
  it('shows an error and disables both buttons while busy', () => {
    render(<Consent busy error="Your choice could not be saved. Try again." onAnswer={() => undefined} />);
    expect(screen.getByRole('alert').textContent).toContain('could not be saved');
    expect((screen.getByRole('button', { name: 'Share' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Not now' }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('Settings: Sharing usage data and Delete my data', () => {
  it('turning the toggle off is Stop sharing; Delete my data posts the delete request', async () => {
    stubChrome({ enabled: true, consent: 'granted' });
    render(<TelemetrySettings />);
    const toggle = (await screen.findByRole('switch', { name: 'Sharing usage data' })) as HTMLInputElement;
    expect(toggle.checked).toBe(true);
    fireEvent.click(toggle);
    await screen.findByText('Sharing stopped. Nothing more will be sent.');
    expect(sendMessage).toHaveBeenCalledWith({
      type: 'telemetry:consent',
      granted: false,
      source: 'settings',
    });
    expect((screen.getByRole('switch', { name: 'Sharing usage data' }) as HTMLInputElement).checked).toBe(
      false,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Delete my data' }));
    await screen.findByText(/sharing is off/);
    expect(sendMessage).toHaveBeenCalledWith({ type: 'telemetry:delete' });
    expect(document.body.textContent?.toLowerCase()).not.toContain('anonymous');
  });
  it('turning the toggle on asks for consent from Settings', async () => {
    stubChrome({ enabled: true, consent: 'declined' });
    render(<TelemetrySettings />);
    const toggle = (await screen.findByRole('switch', { name: 'Sharing usage data' })) as HTMLInputElement;
    expect(toggle.checked).toBe(false);
    fireEvent.click(toggle);
    await screen.findByText('Sharing is on.');
    expect(sendMessage).toHaveBeenCalledWith({
      type: 'telemetry:consent',
      granted: true,
      source: 'settings',
    });
  });
  it('shows the worker’s error when a deletion cannot reach the service', async () => {
    stubChrome({ enabled: true, consent: 'granted' });
    render(<TelemetrySettings />);
    await screen.findByRole('switch', { name: 'Sharing usage data' });
    sendMessage.mockResolvedValueOnce({
      ok: false,
      error: 'The service could not be reached, so nothing was deleted yet. Try again later.',
    });
    fireEvent.click(screen.getByRole('button', { name: 'Delete my data' }));
    expect((await screen.findByRole('alert')).textContent).toContain('nothing was deleted yet');
  });
});

describe('Suggest this store and Report a problem', () => {
  it('Suggest sends the tab id only (the worker resolves the address) and thanks the shopper', async () => {
    stubChrome();
    render(<SuggestStore tabId={7} />);
    fireEvent.click(screen.getByRole('button', { name: 'Suggest this store' }));
    await screen.findByRole('status');
    expect(sendMessage).toHaveBeenCalledWith({ type: 'telemetry:suggest-store', tabId: 7 });
    expect(screen.queryByRole('button', { name: 'Suggest this store' })).toBeNull();
  });
  it('Report has fixed reasons and no text field; it sends the reason and the tab id', async () => {
    stubChrome();
    render(<ReportProblem tabId={7} />);
    expect(screen.queryByRole('textbox')).toBeNull();
    const select = screen.getByLabelText('What went wrong') as HTMLSelectElement;
    expect(Array.from(select.options, (o) => o.value)).toEqual(Object.keys(PROBLEM_REASONS));
    fireEvent.change(select, { target: { value: 'no-badge' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send report' }));
    await screen.findByText('Thanks. Your report was sent.');
    expect(sendMessage).toHaveBeenCalledWith({
      type: 'telemetry:report-problem',
      tabId: 7,
      reason: 'no-badge',
    });
    expect(screen.queryByRole('textbox')).toBeNull();
  });
  it('Report is disabled without a store tab', () => {
    stubChrome();
    render(<ReportProblem tabId={null} />);
    expect((screen.getByRole('button', { name: 'Send report' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Open AI Checkout from a store’s page/)).toBeTruthy();
  });
  it('shows the worker’s refusal', async () => {
    stubChrome();
    sendMessage.mockResolvedValueOnce({ ok: false, error: 'This store is already recognised.' });
    render(<SuggestStore tabId={7} />);
    fireEvent.click(screen.getByRole('button', { name: 'Suggest this store' }));
    expect((await screen.findByRole('alert')).textContent).toContain('already recognised');
    expect(screen.getByRole('button', { name: 'Suggest this store' })).toBeTruthy();
  });
});
