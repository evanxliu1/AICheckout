// The only script on the site. Tables that are wider than their container scroll inside a
// focusable, labelled region (as the @ai-checkout/ui Table does when it runs in React), so keyboard
// users can scroll them. Everything else is static HTML.
function update(scroller: HTMLElement) {
  const caption = scroller.querySelector('caption');
  if (scroller.scrollWidth > scroller.clientWidth + 1) {
    scroller.tabIndex = 0;
    scroller.setAttribute('role', 'region');
    if (caption?.id) scroller.setAttribute('aria-labelledby', caption.id);
  } else {
    scroller.removeAttribute('tabindex');
    scroller.removeAttribute('role');
    scroller.removeAttribute('aria-labelledby');
  }
}
const scrollers = [...document.querySelectorAll<HTMLElement>('.ac-table-scroll')];
const observer = new ResizeObserver((entries) => {
  for (const entry of entries) update(entry.target as HTMLElement);
});
for (const scroller of scrollers) {
  observer.observe(scroller);
  update(scroller);
}
