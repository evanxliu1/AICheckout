// Pure safety rules of the capture tool: which clicks are refused and which pages stop a site. The driver gathers the
// facts in an isolated world of the page (inspectControl, pageFacts) and applies these rules before it acts. Page text is untrusted data:
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
// Matched against the path of the control's effective form action (`formaction` wins over the form's `action`).
// Magento's add-to-cart lives under /checkout/cart/add, so that one path is rewritten before the check.
const BAD_FORM_ACTION =
  /(?<![a-z])(login|signin|sign-in|logon|account|coupon|promo|discount|gift|voucher|newsletter|subscribe|register|search|checkout|orders?|payment|pay|purchase|buy)(?![a-z])/i;

/**
 * Accessible names that place orders, pay, sign in or register, in English, Spanish, French, German, Italian,
 * Portuguese, Dutch, Japanese, Chinese and Korean. Applied to EVERY click, with or without a purpose. Conservative by
 * design: a "continue shopping" phrased with one of these words is refused too.
 */
export const ORDER_OR_ACCOUNT = new RegExp(
  [
    // en
    String.raw`\bplace (your |my )?order\b`,
    String.raw`\b(submit|confirm|complete|finish) (your |my |the )?(order|purchase|payment)\b`,
    String.raw`\bpay( now| securely| with)?\b`,
    String.raw`\bbuy (it )?now\b`,
    String.raw`\bpurchase\b`,
    String.raw`\bcheckout with\b`,
    String.raw`paypal|apple ?pay|google ?pay|shop ?pay|amazon ?pay|klarna|afterpay`,
    String.raw`\b(sign|log) ?(in|up|on)\b`,
    String.raw`\bregister\b`,
    String.raw`\bcreate (an |your )?account\b`,
    String.raw`\bsubscribe\b`,
    // es
    String.raw`realizar (el )?pedido|confirmar (el |la )?(pedido|compra)|comprar ahora|\bpagar\b|iniciar sesi[oó]n|registrarse|crear (una )?cuenta`,
    // fr
    String.raw`passer (la |ma )?commande|valider (la |ma )?commande|acheter maintenant|\bpayer\b|se connecter|\bconnexion\b|s'inscrire|cr[ée]er un compte`,
    // de
    String.raw`jetzt kaufen|\bkaufen\b|bestellen|bestellung|bezahlen|anmelden|einloggen|registrieren|konto erstellen`,
    // it
    String.raw`acquista ora|\bordina\b|effettua (l.)?ordine|\bpaga\b|\baccedi\b|registrati|crea (un )?account`,
    // pt
    String.raw`finalizar pedido|fazer pedido|comprar agora|\bentrar\b|cadastr|criar conta`,
    // nl
    String.raw`nu kopen|bestelling plaatsen|plaats bestelling|betalen|inloggen|aanmelden|registreren|account aanmaken`,
    // ja, zh, ko
    '注文|購入|支払|ログイン|サインイン|会員登録|新規登録',
    '提交订单|立即购买|立即支付|付款|支付|登录|登入|注册|註冊|購買',
    '주문|결제|구매|로그인|회원가입',
  ].join('|'),
  'i',
);
/**
 * Checkout wording (protocol .5: no session enters a checkout), applied to EVERY click whatever its form or purpose.
 * Cart wording ("Cart", "Bag", "View cart", "Warenkorb", "Panier", "カート", "장바구니") is deliberately not matched.
 */
export const CHECKOUT_NAME = new RegExp(
  [
    // en
    String.raw`\bcheck ?-?out\b`,
    String.raw`\bproceed to (checkout|payment)\b`,
    // de, da, no, sv, nl
    String.raw`\b(zur |til |till )?kass(e|en|an)\b`,
    String.raw`\bafrekenen\b`,
    // fr
    String.raw`\bcaisse\b|\bcommander\b|passer (la |ma )?commande`,
    // es, pt
    String.raw`finalizar (la )?(compra|pedido)|tramitar (el )?pedido|fechar pedido|ir para o pagamento`,
    // it
    String.raw`\bcassa\b|procedi (all'acquisto|al pagamento|all'ordine)`,
    // pl, tr
    String.raw`do kasy|przejdź do płatności|ödeme|siparişi tamamla`,
    // ja, zh, ko
    'レジ|購入手続き|ご購入手続き',
    '结算|結帳|結算|去结账|去結帳',
    '결제|주문하기',
  ].join('|'),
  'i',
);

/**
 * A path that is a checkout page (protocol .5 backstop for sites whose recipe names no checkout path): any segment
 * `checkout`, `checkouts` or `secure-checkout` (case-insensitive), unless the next segment is `cart` (Magento's cart
 * `/checkout/cart` and add-to-cart `/checkout/cart/add` stay allowed).
 */
export function isCheckoutPath(pathname) {
  const segs = pathname.split('/').map((x) => {
    try {
      return decodeURIComponent(x).toLowerCase();
    } catch {
      return x.toLowerCase();
    }
  });
  return segs.some(
    (seg, i) => ['checkout', 'checkouts', 'secure-checkout'].includes(seg) && segs[i + 1] !== 'cart',
  );
}

const OPTION_TAGS = new Set(['button', 'label']);
const OPTION_ROLES = new Set(['button', 'radio', 'option']);
/** Purposes that may click a submit-typed button inside a text-free form, provided no navigation results. */
export const NO_NAVIGATION_SUBMIT_PURPOSES = new Set([
  'option',
  'quantity-increment',
  'close-popup',
  'decline-cookies',
]);

/** Path of a form action URL, with Magento's add-to-cart path normalised. */
export function actionPath(formAction) {
  if (!formAction) return '';
  let p;
  try {
    p = new URL(formAction, 'https://x.invalid/').pathname;
  } catch {
    p = String(formAction);
  }
  return p.replace(/\/checkout\/cart\/add(?![a-z])/i, '/cart/add');
}

/**
 * Decide whether a click on an element with these facts (from inspectControl) is allowed for `purpose`
 * (undefined for a plain click). Returns null when allowed, else { code, message }.
 */
export function judgeClick(info, purpose) {
  const no = (code, message) => ({ code, message });
  if (info.frame)
    return no('refused-cross-origin-frame', 'target is a frame; the tool never clicks into frames');
  if (info.file) return no('refused-file-input', 'target is a file input');
  if (info.select) return no('refused-select', 'target is a <select> or one of its options');
  if (info.textEntry)
    return no('refused-text-entry', 'target is a text entry field (focus would invite typing)');
  if (CHECKOUT_NAME.test(info.name))
    return no('refused-checkout', 'target is named like a checkout control; no session enters a checkout');
  if (ORDER_OR_ACCOUNT.test(info.name))
    return no(
      'refused-order-or-account',
      'target is named like an order, payment, sign-in or register control',
    );
  if (info.submit && purpose !== 'add-to-cart' && !NO_NAVIGATION_SUBMIT_PURPOSES.has(purpose))
    return no('refused-submit', 'target submits a form and is not an allowlisted add-to-cart control');
  if (info.inForm && !purpose)
    return no('refused-in-form', 'target is inside a <form> and not on the allowlist');
  if (!purpose) return null;
  if (info.inForm && (info.formHasTextEntry || info.formHasPassword))
    return no('refused-input-form', 'target belongs to a form with a text, e-mail or password field');
  if (purpose === 'add-to-cart') {
    if (NOT_ADD_TO_CART.test(info.name) || BAD_FORM_ACTION.test(actionPath(info.formAction)))
      return no(
        'refused-allowlist-mismatch',
        'add-to-cart target looks like a promo, sign-in, order or newsletter control',
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
  const hit = (code, reason, message) => ({ code, reason, message });
  if (facts.status === 403 || facts.status === 401)
    return hit('blocked-http-403', `http-${facts.status}`, `main document HTTP ${facts.status}`);
  if (facts.status === 429) return hit('blocked-http-429', 'http-429', 'main document HTTP 429');
  const captchaFrame = (facts.frameUrls ?? []).find(
    (u) => CAPTCHA_FRAME.test(u) && !/size=invisible/.test(u),
  );
  if (captchaFrame) return hit('captcha', 'challenge-frame', `challenge frame on ${safeHost(captchaFrame)}`);
  if (facts.captchaElement)
    return hit('captcha', 'challenge-element', 'challenge element in the main document');
  const words = `${facts.title ?? ''}\n${facts.text ?? ''}`;
  if (EXTENSION_CHECK.test(words))
    return hit('blocked-extension-check', 'extension-wording', 'page asks to disable extensions');
  if (BOT_WALL.test(words)) return hit('blocked-bot-wall', 'wall-wording', 'bot-wall wording on the page');
  if (facts.passwordVisible && LOGIN_PATH.test(new URL(facts.url).pathname))
    return hit('sign-in-required', 'login-route', 'login route with a visible password field');
  return null;
}

function safeHost(u) {
  try {
    return new URL(u).host;
  } catch {
    return '?';
  }
}

// ---- In-page functions. The driver runs them in an isolated world (CDP Page.createIsolatedWorld), so the page's
// own scripts cannot change the prototypes they use. They must not close over module scope. ----

/**
 * Runs on the node that will receive the click (the hit node at the click point). Walks up, across open shadow
 * roots, to the control that handles the click, and reports its facts.
 */
export function inspectControl(hit) {
  const INTERACTIVE =
    'a[href], button, input, select, textarea, label, summary, option, [role=button], [role=link], [role=radio], [role=option], [role=menuitem], [role=tab], [role=checkbox], [contenteditable]';
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
  const up = (n) => n.parentElement || (n.getRootNode() instanceof ShadowRoot ? n.getRootNode().host : null);
  let start = hit.nodeType === 1 ? hit : hit.parentElement;
  if (!start) return null;
  const frameTag = /^(iframe|frame|object|embed|fencedframe)$/i;
  if (frameTag.test(start.tagName)) return { tag: start.tagName.toLowerCase(), frame: true, name: '' };
  let el = start;
  for (let n = start; n; n = up(n)) {
    if (n.matches(INTERACTIVE)) {
      el = n;
      break;
    }
  }
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
  // A form owner: the `form` property (covers the form="" attribute) or an enclosing <form>.
  const form = ('form' in el && el.form) || el.closest('form');
  const submitType =
    (tag === 'button' && (el.getAttribute('type') || 'submit').toLowerCase() === 'submit') ||
    (tag === 'input' && ['submit', 'image'].includes(inputType));
  const submit = Boolean(submitType && form);
  // Attributes, not properties: `button.formAction` falls back to the document URL, and a control named "action"
  // shadows `form.action`. A `formaction` on the clicked submit control wins over the form's action.
  const rawAction = form
    ? (submitType && el.hasAttribute('formaction')
        ? el.getAttribute('formaction')
        : form.getAttribute('action')) || ''
    : null;
  let formAction = rawAction;
  if (rawAction !== null) {
    try {
      formAction = new URL(rawAction, document.baseURI).href;
    } catch {
      formAction = rawAction;
    }
  }
  const root = el.getRootNode();
  const labelledBy = (el.getAttribute('aria-labelledby') || '')
    .split(/\s+/)
    .map((id) => (id && root.getElementById ? root.getElementById(id)?.textContent : ''))
    .join(' ');
  // An image-only control has no innerText: fall back to image alt text, then all text content.
  const imgAlt = [...el.querySelectorAll('img[alt]')].map((img) => img.getAttribute('alt')).join(' ');
  const name = (
    el.getAttribute('aria-label') ||
    labelledBy ||
    el.innerText ||
    el.value ||
    el.title ||
    imgAlt ||
    el.textContent ||
    ''
  )
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
    formAction,
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
    frame: false,
  };
}

/** The facts detectStop needs. Text is capped and stays in memory, never written. */
export function pageFacts() {
  const visible = (e, min = 0) => {
    const r = e.getBoundingClientRect();
    const s = getComputedStyle(e);
    return r.width > min && r.height > min && s.visibility !== 'hidden' && s.display !== 'none';
  };
  const captcha = [
    ...document.querySelectorAll(
      '#px-captcha, [id*=captcha i], [class*=captcha i], .g-recaptcha, .h-captcha, .cf-turnstile, #challenge-form, #cf-challenge-running, #challenge-stage',
    ),
  ].filter((e) => !e.closest('.grecaptcha-badge') && !/size=invisible/.test(e.getAttribute('src') || ''));
  return {
    title: document.title || '',
    text: document.body ? document.body.innerText.slice(0, 4000) : '',
    passwordVisible: [...document.querySelectorAll('input[type=password]')].some((e) => visible(e)),
    captchaElement: captcha.some((e) => visible(e, 30)),
  };
}
