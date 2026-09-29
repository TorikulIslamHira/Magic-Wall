// Sports view: canvas pitch with a heatmap, animated pass/shot arrows and event markers
// for the match + player the admin has put on air.
import { getJson } from '../api.js';
import { el, prefersReducedMotion } from '../dom.js';
import { num, t } from '../i18n.js';
import { EVENT_COLORS, drawArrow, drawSurface, fitCanvas, surfacePath, surfaceRect, toPx } from '../pitch.js';

const tx = t.sports;

const ANIMATION_MS = 700;
const STAGGER_MS = 60;
const HEAT_RAMP = buildHeatRamp();

export function createSportsView() {
  const abort = new AbortController();
  const layers = { heatmap: true, arrows: true, markers: true };
  const appearAt = new Map();     // event id -> time its animation starts

  let state = null;
  let data = null;
  let canvas, ctx, message, side, resizeObserver;
  let size = { w: 0, h: 0 };
  let rect = null;
  let pitchCache = null;          // pre-rendered surface, rebuilt on resize / sport change
  let heatCache = null;           // pre-rendered heatmap, rebuilt when events change
  let frame = 0;

  async function mount(container, initialState) {
    canvas = el('canvas', { class: 'pitch-canvas', 'aria-label': 'Pitch' });
    message = el('div', { class: 'stage-message' });
    side = el('aside', { class: 'side-panel glass' });
    const pitchWrap = el('div', { class: 'map-card glass pitch-wrap' }, canvas, message);
    container.append(el('div', { class: 'sports' }, pitchWrap, side));
    ctx = canvas.getContext('2d');

    resizeObserver = new ResizeObserver(() => {
      size = fitCanvas(canvas);
      invalidate({ pitch: true, heat: true });
    });
    resizeObserver.observe(pitchWrap);
    size = fitCanvas(canvas);

    state = initialState;
    await load(true);
  }

  async function update(nextState) {
    const changed = nextState.matchId !== state?.matchId || nextState.playerId !== state?.playerId;
    state = nextState;
    if (changed) await load(true);
  }

  async function onData(keys) {
    if (keys.has('*') || keys.has(`${state.matchId}:${state.playerId}`)) await load(false);
  }

  function unmount() {
    abort.abort();
    cancelAnimationFrame(frame);
    resizeObserver?.disconnect();
  }

  async function load(isNewSelection) {
    if (!state.matchId || !state.playerId) {
      data = null;
      showMessage(tx.waiting);
      renderSide();
      invalidate({ pitch: true, heat: true });
      return;
    }

    const next = await getJson(`/api/sports/events/${state.matchId}/${state.playerId}`, abort.signal);
    if (!next) {
      data = null;
      showMessage(tx.notFound);
      renderSide();
      invalidate({ pitch: true, heat: true });
      return;
    }

    // On a new selection everything animates in, staggered; on a live update only new events do.
    // With reduced motion, everything "appeared" long ago, so it draws in its final state.
    const now = prefersReducedMotion() ? -Infinity : performance.now();
    if (isNewSelection) appearAt.clear();
    let order = 0;
    for (const event of next.events) {
      if (!appearAt.has(event.id)) appearAt.set(event.id, now + (isNewSelection ? Math.min(order++ * STAGGER_MS, 1500) : 0));
    }

    const sportChanged = data?.sport !== next.sport;
    data = next;
    showMessage(data.events.length ? '' : tx.noEvents);
    renderSide();
    invalidate({ pitch: sportChanged, heat: true });
  }

  function invalidate({ pitch = false, heat = false }) {
    if (pitch) pitchCache = null;
    if (heat) heatCache = null;
    if (!frame) frame = requestAnimationFrame(draw);
  }

  function draw(now) {
    frame = 0;
    if (!size.w || !size.h) return;

    const sport = data?.sport ?? 'Football';
    rect = surfaceRect(size.w, size.h, sport, 32);
    pitchCache ??= renderOffscreen(size, c => drawSurface(c, rect));

    ctx.clearRect(0, 0, size.w, size.h);
    ctx.drawImage(pitchCache, 0, 0, size.w, size.h);
    if (!data) return;

    if (layers.heatmap) {
      heatCache ??= renderHeatmap(data.events, rect, size);
      ctx.save();
      surfacePath(ctx, rect);
      ctx.clip();
      ctx.drawImage(heatCache, 0, 0, size.w, size.h);
      ctx.restore();
    }

    const lineWidth = Math.max(2, rect.w * 0.004);
    const markerRadius = Math.max(6, rect.w * 0.009);
    let animating = false;

    for (const event of data.events) {
      const t = Math.min(1, Math.max(0, (now - (appearAt.get(event.id) ?? 0)) / ANIMATION_MS));
      if (t < 1) animating = true;
      if (t === 0) continue;

      const color = EVENT_COLORS[event.eventType] ?? '#ffffff';
      const start = toPx(rect, event.x, event.y);

      if (layers.arrows && event.endX != null && event.endY != null) {
        drawArrow(ctx, start, toPx(rect, event.endX, event.endY), color, lineWidth, easeOutCubic(t));
      }
      if (layers.markers) {
        drawMarker(ctx, start, markerRadius * easeOutBack(Math.min(1, t * 1.6)), color, event.eventType === 'Goal');
      }
    }

    if (animating) frame = requestAnimationFrame(draw);
  }

  function renderSide() {
    if (!data) {
      side.replaceChildren(el('p', { class: 'hint' }, tx.waiting));
      return;
    }

    const counts = new Map();
    for (const e of data.events) counts.set(e.eventType, (counts.get(e.eventType) ?? 0) + 1);

    side.replaceChildren(
      el('div', { class: 'player-card' },
        el('p', { class: 'eyebrow' }, data.matchTitle),
        el('h2', { class: 'panel-title' }, data.playerName),
        el('p', { class: 'muted' }, data.team)),
      el('div', { class: 'hero' },
        el('span', { class: 'hero-value' }, num(data.events.length)),
        el('span', { class: 'hero-caption' }, 'মোট ঘটনা')),
      el('div', { class: 'event-counts' },
        [...counts].sort((a, b) => b[1] - a[1]).map(([type, count]) =>
          el('div', { class: 'count' },
            el('span', { class: 'swatch lg', style: `background:${EVENT_COLORS[type] ?? '#fff'}` }),
            el('span', { class: 'count-label' }, tx.events[type] ?? type),
            el('strong', {}, num(count))))),
      el('div', { class: 'layer-toggles', role: 'group', 'aria-label': 'Layers' },
        toggle('heatmap', tx.layers.heatmap),
        toggle('arrows', tx.layers.arrows),
        toggle('markers', tx.layers.markers)));
  }

  function toggle(layer, label) {
    return el('button', {
      class: 'chip toggle',
      type: 'button',
      'aria-pressed': String(layers[layer]),
      onclick: event => {
        layers[layer] = !layers[layer];
        event.currentTarget.setAttribute('aria-pressed', String(layers[layer]));
        invalidate({});
      }
    }, label);
  }

  function showMessage(text) {
    message.textContent = text;
    message.hidden = !text;
  }

  return { mount, update, onData, unmount };
}

function renderOffscreen(size, paint) {
  const dpr = window.devicePixelRatio || 1;
  const off = document.createElement('canvas');
  off.width = Math.round(size.w * dpr);
  off.height = Math.round(size.h * dpr);
  const c = off.getContext('2d');
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  paint(c);
  return off;
}

// Density heatmap: stack soft alpha blobs, then map accumulated alpha onto a colour ramp.
// Computed at CSS resolution (not device pixels) to keep the per-pixel pass cheap on 4K walls.
function renderHeatmap(events, rect, size) {
  const off = document.createElement('canvas');
  off.width = Math.max(1, Math.round(size.w));
  off.height = Math.max(1, Math.round(size.h));
  const c = off.getContext('2d', { willReadFrequently: true });
  if (!events.length) return off;

  const radius = rect.w * 0.07;
  for (const e of events) {
    const p = toPx(rect, e.x, e.y);
    const gradient = c.createRadialGradient(p.x, p.y, 0, p.x, p.y, radius);
    gradient.addColorStop(0, 'rgba(0, 0, 0, 0.35)');
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
    c.fillStyle = gradient;
    c.fillRect(p.x - radius, p.y - radius, radius * 2, radius * 2);
  }

  const image = c.getImageData(0, 0, off.width, off.height);
  const px = image.data;
  for (let i = 0; i < px.length; i += 4) {
    const alpha = px[i + 3];
    if (!alpha) continue;
    const o = alpha * 4;
    px[i] = HEAT_RAMP[o];
    px[i + 1] = HEAT_RAMP[o + 1];
    px[i + 2] = HEAT_RAMP[o + 2];
    px[i + 3] = Math.min(210, alpha * 1.5);
  }
  c.putImageData(image, 0, 0);
  return off;
}

function buildHeatRamp() {
  const c = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  const gradient = c.createLinearGradient(0, 0, 256, 0);
  gradient.addColorStop(0, '#2c7bb6');
  gradient.addColorStop(0.3, '#00a6ca');
  gradient.addColorStop(0.5, '#90eb9d');
  gradient.addColorStop(0.7, '#f9d057');
  gradient.addColorStop(1, '#d7191c');
  c.canvas.width = 256;
  c.canvas.height = 1;
  c.fillStyle = gradient;
  c.fillRect(0, 0, 256, 1);
  return c.getImageData(0, 0, 256, 1).data;
}

function drawMarker(ctx, p, radius, color, emphasise) {
  if (radius <= 0) return;
  ctx.save();
  ctx.beginPath();
  ctx.arc(p.x, p.y, emphasise ? radius * 1.4 : radius, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.shadowColor = 'rgba(0, 0, 0, 0.6)';
  ctx.shadowBlur = 6;
  ctx.fill();
  ctx.lineWidth = emphasise ? 3 : 2;
  ctx.strokeStyle = emphasise ? '#ffffff' : 'rgba(15, 23, 42, 0.9)';
  ctx.stroke();
  ctx.restore();
}

const easeOutCubic = t => 1 - (1 - t) ** 3;
const easeOutBack = t => 1 + 2.70158 * (t - 1) ** 3 + 1.70158 * (t - 1) ** 2;
