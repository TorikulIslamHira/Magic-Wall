// Fullscreen for the presenter wall: the F key, a double-click on the background, or the
// corner button. In fullscreen the button and cursor fade out after a few idle seconds so
// nothing but the graphics is on air; any movement or touch brings them back.

const IDLE_MS = 3000;

// Double-clicks on these are presenter interactions (tapping a seat, dragging the slider),
// not a request to change the screen mode.
const INTERACTIVE = 'button, a, input, select, textarea, .region, .zone, .slice, .timeline, .seat-row, .zone-row, .sector-row, .project-card';

export function initFullscreen(button, labels) {
  // Not supported (e.g. iPhone Safari) or shown inside the admin's preview iframe: no button.
  if (!document.fullscreenEnabled || window.self !== window.top) {
    button.remove();
    return;
  }

  const isFullscreen = () => Boolean(document.fullscreenElement);

  function toggle() {
    const request = isFullscreen()
      ? document.exitFullscreen()
      : document.documentElement.requestFullscreen({ navigationUI: 'hide' });
    // Browsers refuse fullscreen without a user gesture; nothing useful to do but log it.
    request.catch(error => console.warn('Fullscreen request refused:', error));
  }

  function render() {
    const on = isFullscreen();
    document.body.classList.toggle('is-fullscreen', on);
    button.setAttribute('aria-pressed', String(on));
    const label = on ? labels.exit : labels.enter;
    button.setAttribute('aria-label', label);
    button.title = `${label} (F)`;
    wake();
  }

  let idleTimer = 0;
  function wake() {
    document.body.classList.remove('is-idle');
    clearTimeout(idleTimer);
    if (isFullscreen()) idleTimer = setTimeout(() => document.body.classList.add('is-idle'), IDLE_MS);
  }

  button.addEventListener('click', toggle);

  document.addEventListener('keydown', event => {
    if (event.key.toLowerCase() !== 'f' || event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.target.closest?.('input, textarea, select, [contenteditable]')) return;
    event.preventDefault();
    toggle();
  });

  document.addEventListener('dblclick', event => {
    if (event.target.closest?.(INTERACTIVE)) return;
    toggle();
  });

  document.addEventListener('fullscreenchange', render);
  for (const type of ['pointermove', 'pointerdown', 'keydown']) document.addEventListener(type, wake, { passive: true });

  render();
}
