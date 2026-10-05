// Prototype (Phase 10 probe, not shipped). On a page event dispatched by the probe driver, mount an extension
// iframe the way the cart badge does (host on <html>, closed shadow root) and record whether it loaded or the
// page's CSP blocked it. Result goes to <html data-ai-checkout-probe-frame>; the frame is then removed.
window.addEventListener('ai-checkout-probe-frame-test', () => {
  const root = document.documentElement;
  const violations = [];
  const onViolation = (e) => {
    if (String(e.blockedURI).startsWith('chrome-extension')) violations.push(e.effectiveDirective);
  };
  document.addEventListener('securitypolicyviolation', onViolation);
  const host = document.createElement('ai-checkout-probe-frame');
  const shadow = host.attachShadow({ mode: 'closed' });
  const frame = document.createElement('iframe');
  frame.src = chrome.runtime.getURL('probe.html');
  frame.style.cssText = 'width:1px;height:1px;border:0;position:fixed;bottom:0;right:0';
  shadow.append(frame);
  let done = false;
  const finish = (result) => {
    if (done) return;
    done = true;
    window.removeEventListener('message', onMessage);
    document.removeEventListener('securitypolicyviolation', onViolation);
    host.remove();
    root.setAttribute('data-ai-checkout-probe-frame', result);
  };
  const onMessage = (e) => {
    if (e.source === frame.contentWindow && e.data && e.data.aiCheckoutProbe === 'loaded') finish('loaded');
  };
  window.addEventListener('message', onMessage);
  root.append(host);
  setTimeout(() => finish(violations.length ? 'blocked:' + violations.join(',') : 'timeout'), 5000);
});
