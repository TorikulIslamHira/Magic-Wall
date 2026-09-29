// Tiny DOM builder. Strings become text nodes, so API data is never parsed as HTML.
export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value == null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? '' : value);
  }
  node.append(...children.flat(Infinity).filter(c => c != null && c !== false));
  return node;
}

/**
 * replaceChildren that skips null/false like el() does. The native method would
 * render a conditional `cond ? node : null` as the literal text "null".
 */
export function setChildren(node, ...children) {
  node.replaceChildren(...children.flat(Infinity).filter(c => c != null && c !== false));
}

/** JS-driven animations (counters, tweens) should jump to their end state when this is true. */
export const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export const formatNumber = n => Number(n).toLocaleString();
export const formatPercent = n => `${Number(n).toFixed(1)}%`;
