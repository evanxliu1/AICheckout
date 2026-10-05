// Pure safety rules of the capture tool: which clicks are refused and which pages stop a site. The driver gathers the
// facts in the page (inspectTarget, pageFacts) and applies these rules before it acts. Page text is untrusted data:
// it is only matched against fixed patterns here, never followed.

/** Thrown when the tool refuses an action. The action did not happen. `exclusionCode` is ready for sites.json. */
export class RefusalError extends Error {
  constructor(code, message, exclusionCode = 'would-need-forbidden-action') {
    super(`${code}: ${message}`);
    this.name = 'RefusalError';
    this.code = code;
    this.exclusionCode = exclusionCode;
  }
}

/** Thrown when the site must stop at once (block, CAPTCHA, sign-in wall, robots). Nothing is retried. */
export class StopError extends Error {
  constructor(code, message) {
    super(`${code}: ${message}`);
    this.name = 'StopError';
    this.code = code;
    this.exclusionCode = code;
  }
}

// Names are checked only to refuse; nothing requires an English name, so recipes work on storefronts worldwide.
// The safety of allowlisted clicks rests on structure: an allowlisted control inside a <form> is clicked only if that
// form has no visible text entry field (so promo-code, sign-in, newsletter and search forms are never touched).
const NOT_ADD_TO_CART =
  /promo|coupon|code|gift ?card|discount|voucher|sign ?in|log ?in|subscribe|newsletter|e-?mail|register|apply|redeem|gutschein|rabatt|anmelden|cup[oó]n|c[oó]digo|descuento|r[ée]duction|connexion|s'identifier|accedi|sconto|inloggen|kortingscode|rabattkod|logga in/i;
const BAD_FORM_ACTION =
  /login|signin|sign-in|logon|account|coupon|promo|discount|gift|voucher|newsletter|subscribe|register|search/i;
const OPTION_TAGS = new Set(['button', 'label']);
const OPTION_ROLES = new Set(['button', 'radio', 'option']);

/**
 * Decide whether a click on an element with these facts (from inspectTarget) is allowed for `purpose`
 * (undefined for a plain click). Returns null when allowed, else { code, message }.
 */
export function judgeClick(info, purpose) {
  const no = (code, message) => ({ code, message });
  if (info.frame)
    return no(
      'refused-cross-origin-frame',
      'target is or contains a frame; the tool never clicks into frames',
    );
  if (info.file) return no('refused-file-input', 'target is a file input');
  if (info.select) return no('refused-select', 'target is a <select> or one of its options');
  if (info.textEntry)
    return no('refused-text-entry', 'target is a text entry field (focus would invite typing)');
  if (info.submit && purpose !== 'add-to-cart')
    return no('refused-submit', 'target submits a form and is not an allowlisted add-to-cart control');
  if (info.inForm && !purpose)
    return no('refused-in-form', 'target is inside a <form> and not on the allowlist');
  if (!purpose) return null;
  if (info.inForm && (info.formHasTextEntry || info.formHasPassword))
    return no('refused-input-form', 'target belongs to a form with a text, e-mail or password field');
  if (purpose === 'continue-as-guest' && info.inForm)
    return no('refused-in-form', 'continue-as-guest is allowed only outside a <form>');
  if (purpose === 'add-to-cart') {
    if (NOT_ADD_TO_CART.test(info.name) || BAD_FORM_ACTION.test(info.formAction ?? ''))
      return no(
        'refused-allowlist-mismatch',
        'add-to-cart target looks like a promo, sign-in or newsletter control',
      );
    return null;
  }
  if (purpose === 'option') {
    const ok =
      OPTION_TAGS.has(info.tag) ||
      (info.tag === 'input' && ['button', 'radio'].includes(info.inputType)) ||
      OPTION_ROLES.has(info.role ?? '');
    return ok ? null : no('refused-allowlist-mismatch', 'option target is not a button, radio or label');
  }
  return null;
}

const CAPTCHA_FRAME =
  /captcha|hcaptcha\.com|arkoselabs|funcaptcha|challenges\.cloudflare\.com|px-cdn|perimeterx|px-captcha|datadome|captcha-delivery/i;
const EXTENSION_CHECK =
  /disable (your |any |all )?(ad ?blockers?|extensions?|browser extensions?)|turn off (your )?(ad ?blocker|extensions?)/i;
// English first, then a few common phrasings elsewhere. Text is a backstop: status codes and challenge frames are
// language-neutral, and the operator ends a session with the right code when a wall goes unrecognised.
const BOT_WALL =
  /zugriff verweigert|acc[eè]s (refus[ée]|interdit)|acceso denegado|accesso negato|toegang geweigerd|[eé]tes-vous un robot|kein roboter|press (&|and) hold|verify (that )?(you are|you're) (a )?human|are you a (robot|human)|access (to this page )?(has been )?denied|just a moment\.\.\.|unusual (traffic|activity)|request (was )?blocked|pardon our interruption|you have been blocked|checking your browser|attention required|bot (detection|protection)/i;
const LOGIN_PATH =
  /(^|\/)(log-?in|sign-?in|signin|logon|auth|authenticate|account\/login|anmelden|connexion|iniciar-sesion|accedi|inloggen|logowanie)(\/|$|\.)/i;

/**
 * facts: { status, url, title, text, frameUrls, passwordVisible }. Returns null or { code, message }.
 * A sign-in form next to guest checkout is not a wall: only a login route with a visible password field is.
 */
export function detectStop(facts) {
  const hit = (code, message) => ({ code, message });
  if (facts.status === 403 || facts.status === 401)
    return hit('blocked-http-403', `main document HTTP ${facts.status}`);
  if (facts.status === 429) return hit('blocked-http-429', 'main document HTTP 429');
  const captchaFrame = (facts.frameUrls ?? []).find(
    (u) => CAPTCHA_FRAME.test(u) && !/size=invisible/.test(u),
  );
  if (captchaFrame) return hit('captcha', `challenge frame on ${safeHost(captchaFrame)}`);
  const words = `${facts.title ?? ''}\n${facts.text ?? ''}`;
  if (EXTENSION_CHECK.test(words)) return hit('blocked-extension-check', 'page asks to disable extensions');
  if (BOT_WALL.test(words)) return hit('blocked-bot-wall', 'bot-wall wording on the page');
  if (facts.passwordVisible && LOGIN_PATH.test(new URL(facts.url).pathname))
    return hit('sign-in-required', 'login route with a visible password field');
  return null;
}

function safeHost(u) {
  try {
    return new URL(u).host;
  } catch {
    return '?';
  }
}

// ---- In-page functions (serialized by Playwright; no closure over module scope) ----

/** Runs in the page on the resolved click target. */
export function inspectTarget(el) {
  const TEXT_TYPES = new Set([
    'text',
    'email',
    'tel',
    'password',
    'search',
    'number',
    'url',
    'date',
    'datetime-local',
    'month',
    'week',
    'time',
    'color',
    'range',
  ]);
  const tag = el.tagName.toLowerCase();
  const inputType = tag === 'input' ? (el.getAttribute('type') || 'text').toLowerCase() : null;
  const isTextEntry = (e) => {
    const t = e.tagName.toLowerCase();
    if (t === 'textarea') return true;
    if (t === 'input') return TEXT_TYPES.has((e.getAttribute('type') || 'text').toLowerCase());
    return e.isContentEditable === true;
  };
  const isSelect = (e) =>
    ['select', 'option', 'optgroup', 'datalist'].includes(e.tagName.toLowerCase()) ||
    Boolean(e.closest('select'));
  const control = tag === 'label' ? el.control : null;
  const form = el.form || el.closest('form');
  const submit =
    (tag === 'button' && el.type === 'submit') ||
    (tag === 'input' && ['submit', 'image'].includes(inputType));
  const labelledBy = (el.getAttribute('aria-labelledby') || '')
    .split(/\s+/)
    .map((id) => (id ? document.getElementById(id)?.textContent : ''))
    .join(' ');
  const name = (el.getAttribute('aria-label') || labelledBy || el.innerText || el.value || el.title || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
  return {
    tag,
    inputType,
    role: el.getAttribute('role'),
    name,
    submit,
    inForm: Boolean(form),
    formAction: form ? form.getAttribute('action') || '' : null,
    formHasPassword: Boolean(form && form.querySelector('input[type=password]')),
    formHasTextEntry: Boolean(
      form &&
      [...form.elements].some((f) => {
        const r = f.getBoundingClientRect();
        return isTextEntry(f) && f.getAttribute('type') !== 'number' && r.width > 0 && r.height > 0;
      }),
    ),
    textEntry: isTextEntry(el) || Boolean(control && isTextEntry(control)),
    select: isSelect(el) || Boolean(control && isSelect(control)),
    file: inputType === 'file' || Boolean(control && control.getAttribute('type') === 'file'),
    frame:
      el.matches('iframe, frame, object, embed, fencedframe') ||
      Boolean(el.querySelector('iframe, frame, object, embed, fencedframe')),
  };
}

/** Runs in the page: the facts detectStop needs. Text is capped and stays in memory, never written. */
export function pageFacts() {
  const visible = (e) => {
    const r = e.getBoundingClientRect();
    const s = getComputedStyle(e);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
  };
  return {
    title: document.title || '',
    text: document.body ? document.body.innerText.slice(0, 4000) : '',
    passwordVisible: [...document.querySelectorAll('input[type=password]')].some(visible),
  };
}
