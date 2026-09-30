// Sports view: canvas pitch with a heatmap, animated pass/shot arrows and event markers for
// the player on air, plus the match itself: scoreboard, a timeline of goals and cards along the
// bottom, and the player spotlight for big moments. With no player chosen ("whole match"), the
// timeline is the star and the pitch waits for a pick.
import { getJson } from '../api.js';
import { el, prefersReducedMotion, setChildren } from '../dom.js';
import { num, t } from '../i18n.js';
import { EVENT_COLORS, drawArrow, drawSurface, fitCanvas, surfacePath, surfaceRect, toPx } from '../pitch.js';
import { createSpotlight } from '../spotlight.js';
import { createTimeline } from '../timeline.js';

const tx = t.sports;

const ANIMATION_MS = 700;
const STAGGER_MS = 60;
const HEAT_RAMP = buildHeatRamp();

// Moments that open the spotlight by themselves when they are approved during the broadcast.
const AUTO_SPOTLIGHT = new Set(['Goal', 'OwnGoal', 'RedCard', 'Wicket', 'Six', 'AllOut']);
// Moments drawn on the pitch as the player's photo rather than a dot (when a photo exists).
const PHOTO_MARKERS = new Set(['Goal', 'OwnGoal', 'Wicket', 'Six', 'AllOut']);

export function createSportsView() {
  const abort = new AbortController();
  const layers = { heatmap: true, arrows: true, markers: true };
  const appearAt = new Map();     // event id -> time its animation starts

  let state = null;
  let data = null;                // the player on air: events + photo (null in whole-match mode)
  let match = null;               // scoreboard + timeline for the match on air
  let photo = null;               // the player's photo as an <img>, once loaded, for the canvas
  let canvas, ctx, message, side, resizeObserver, timeline, spotlight;
  let size = { w: 0, h: 0 };
  let rect = null;
  let pitchCache = null;          // pre-rendered surface, rebuilt on resize / sport change
  let heatCache = null;           // pre-rendered heatmap, rebuilt when events change
  let frame = 0;

  async function mount(container, initialState) {
    canvas = el('canvas', { class: 'pitch-canvas', 'aria-label': tx.pitch });
    message = el('div', { class: 'stage-message' });
    side = el('aside', { class: 'side-panel glass' });
    const pitchWrap = el('div', { class: 'map-card glass pitch-wrap' }, canvas, message);
    timeline = createTimeline({ onSelect: moment => spotlight.show(moment, match) });
    const root = el('div', { class: 'sports' }, pitchWrap, side, timeline.element);
    container.append(root);
    spotlight = createSpotlight(root);
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
    // New photos/badges, a change anywhere in this match (another player's goal, the score), or everything.
    const inMatch = [...keys].some(k => k.startsWith(`${state.matchId}:`));
    if (keys.has('*') || keys.has('media') || inMatch) {
      await load(false);
      return;
    }
    // Only the match on air is drawn; edits to other matches show once they go on air.
    console.log(`[wall] Sports: change was for ${[...keys].join(', ')}, but match ${state.matchId} is on air — nothing to redraw`);
  }

  function unmount() {
    abort.abort();
    cancelAnimationFrame(frame);
    resizeObserver?.disconnect();
    spotlight?.destroy();
  }

  async function load(isNewSelection) {
    if (!state.matchId) {
      data = null;
      match = null;
      timeline.element.hidden = true;
      showMessage(tx.waiting);
      renderSide();
      invalidate({ pitch: true, heat: true });
      return;
    }

    const [nextMatch, next] = await Promise.all([
      getJson(`/api/sports/matches/${state.matchId}/timeline`, abort.signal),
      state.playerId ? getJson(`/api/sports/events/${state.matchId}/${state.playerId}`, abort.signal) : null
    ]);
    updateMatch(nextMatch, isNewSelection);

    if (!state.playerId) {
      // Whole match: scoreboard, timeline and spotlight; the pitch waits for a moment to be picked.
      data = null;
      photo = null;
      showMessage(nextMatch ? tx.pickFromTimeline : tx.notFound);
      renderSide();
      invalidate({ pitch: true, heat: true });
      return;
    }

    if (!next) {
      data = null;
      showMessage(tx.notFound);
      renderSide();
      invalidate({ pitch: true, heat: true });
      return;
    }
    loadPhoto(next.playerPhoto);

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
    showMessage(positioned().length ? '' : tx.noEvents);
    renderSide();
    invalidate({ pitch: sportChanged, heat: true });
  }

  /** Events with a place on the pitch (live score feeds report goals and cards without one). */
  const positioned = () => (data?.events ?? []).filter(e => e.x != null && e.y != null);

  function updateMatch(next, isNewSelection) {
    const previous = match;
    match = next;
    timeline.element.hidden = !match;
    if (!match) return;
    timeline.render(match);

    // A big moment approved while we're on air: bring it up in the spotlight by itself.
    if (!isNewSelection && previous?.matchId === match.matchId) {
      const known = new Set(previous.events.map(e => e.id));
      const fresh = match.events.filter(e => !known.has(e.id) && AUTO_SPOTLIGHT.has(e.eventType));
      if (fresh.length) spotlight.show(fresh[fresh.length - 1], match);
    }
  }

  function loadPhoto(url) {
    if (!url) { photo = null; return; }
    if (photo?.dataset.src === url) return;
    const img = new Image();
    img.dataset.src = url;
    img.onload = () => { if (photo === img) invalidate({}); };
    img.src = url;
    photo = img;
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

    const events = positioned();
    if (layers.heatmap) {
      heatCache ??= renderHeatmap(events, rect, size);
      ctx.save();
      surfacePath(ctx, rect);
      ctx.clip();
      ctx.drawImage(heatCache, 0, 0, size.w, size.h);
      ctx.restore();
    }

    const lineWidth = Math.max(2, rect.w * 0.004);
    const markerRadius = Math.max(6, rect.w * 0.009);
    let animating = false;

    const face = photo?.complete && photo.naturalWidth ? photo : null;
    for (const event of events) {
      const t = Math.min(1, Math.max(0, (now - (appearAt.get(event.id) ?? 0)) / ANIMATION_MS));
      if (t < 1) animating = true;
      if (t === 0) continue;

      const color = EVENT_COLORS[event.eventType] ?? '#ffffff';
      const start = toPx(rect, event.x, event.y);

      if (layers.arrows && event.endX != null && event.endY != null) {
        drawArrow(ctx, start, toPx(rect, event.endX, event.endY), color, lineWidth, easeOutCubic(t));
      }
      if (layers.markers) {
        const grow = easeOutBack(Math.min(1, t * 1.6));
        if (face && PHOTO_MARKERS.has(event.eventType)) drawPhotoMarker(ctx, start, markerRadius * 2.1 * grow, color, face);
        else drawMarker(ctx, start, markerRadius * grow, color, event.eventType === 'Goal');
      }
    }

    if (animating) frame = requestAnimationFrame(draw);
  }

  function renderSide() {
    if (!data && match) {
      renderMatchSide();
      return;
    }
    if (!data) {
      side.replaceChildren(el('p', { class: 'hint' }, tx.waiting));
      return;
    }

    const counts = new Map();
    for (const e of data.events) counts.set(e.eventType, (counts.get(e.eventType) ?? 0) + 1);

    side.replaceChildren(
      el('div', { class: 'player-card' },
        data.playerPhoto ? el('img', { class: 'player-photo', src: data.playerPhoto, alt: '' }) : null,
        el('div', { class: 'player-card-text' },
          el('p', { class: 'eyebrow' }, `${tx.sports[data.sport] ?? data.sport} · ${data.matchTitle}`),
          el('h2', { class: 'panel-title' }, data.playerName),
          el('p', { class: 'muted player-team' },
            data.teamBadge ? el('img', { class: 'team-badge-sm', src: data.teamBadge, alt: '' }) : null,
            data.team))),
      el('div', { class: 'hero' },
        el('span', { class: 'hero-value' }, num(data.events.length)),
        el('span', { class: 'hero-caption' }, tx.totalEvents)),
      el('div', { class: 'event-counts' },
        [...counts].sort((a, b) => b[1] - a[1]).map(([type, count]) =>
          el('div', { class: 'count' },
            el('span', { class: 'swatch lg', style: `background:${EVENT_COLORS[type] ?? '#fff'}` }),
            el('span', { class: 'count-label' }, tx.events[type] ?? type),
            el('strong', {}, num(count))))),
      el('div', { class: 'layer-toggles', role: 'group', 'aria-label': tx.layersLabel },
        toggle('heatmap', tx.layers.heatmap),
        toggle('arrows', tx.layers.arrows),
        toggle('markers', tx.layers.markers)));
  }

  /** Whole-match mode: the latest big moments, newest first, each opening the spotlight. */
  function renderMatchSide() {
    const recent = [...match.events].reverse().slice(0, 6);
    setChildren(side,
      el('div', { class: 'player-card' },
        el('div', { class: 'player-card-text' },
          el('p', { class: 'eyebrow' }, [tx.sports[match.sport] ?? match.sport, match.competition].filter(Boolean).join(' · ')),
          el('h2', { class: 'panel-title' }, match.title),
          el('p', { class: 'muted' }, tx.matchOverviewHint))),
      recent.length
        ? el('div', { class: 'recent-moments' }, recent.map(e =>
            el('button', { type: 'button', class: 'recent-moment', style: `--moment:${EVENT_COLORS[e.eventType] ?? '#94a3b8'}`, onclick: () => spotlight.show(e, match) },
              e.playerPhoto ? el('img', { class: 'recent-photo', src: e.playerPhoto, alt: '' }) : el('span', { class: 'recent-photo is-empty', 'aria-hidden': 'true' }),
              el('span', { class: 'recent-text' },
                el('strong', {}, e.playerName),
                el('span', {}, `${tx.minute(num(e.minute))} · ${tx.events[e.eventType] ?? e.eventType}`)))))
        : el('p', { class: 'hint' }, tx.timelineEmpty));
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

/** A big moment on the pitch: the player's face in a ring of the event's colour. */
function drawPhotoMarker(ctx, p, radius, color, image) {
  if (radius <= 0) return;
  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.55)';
  ctx.shadowBlur = 10;
  ctx.beginPath();
  ctx.arc(p.x, p.y, radius + 3, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.beginPath();
  ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
  ctx.fillStyle = '#0b1324';
  ctx.fill();
  ctx.clip();
  // Player cut-outs are head-and-shoulders portraits: take a square from the top centre (the face).
  const side = Math.min(image.naturalWidth, image.naturalHeight) * 0.55;
  const sx = (image.naturalWidth - side) / 2;
  const sy = image.naturalHeight * 0.04;
  ctx.drawImage(image, sx, sy, side, side, p.x - radius, p.y - radius, radius * 2, radius * 2);
  ctx.restore();
}

const easeOutCubic = t => 1 - (1 - t) ** 3;
const easeOutBack = t => 1 + 2.70158 * (t - 1) ** 3 + 1.70158 * (t - 1) ** 2;
