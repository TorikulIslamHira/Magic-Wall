// Match timeline: a broadcast strip along the bottom of the sports view. Scoreboard on the left
// (badges, live score, status), then the match minute by minute: the home side's moments above
// the line, the away side's below. Every moment is a button that opens the player spotlight.
import { el, setChildren } from './dom.js';
import { num, t } from './i18n.js';
import { EVENT_COLORS } from './pitch.js';

const tx = t.sports;

/** Small inline icons per moment (SVG, so they stay crisp on a 4K wall). */
function icon(type) {
  const svg = (inner, cls = '') => {
    const node = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    node.setAttribute('viewBox', '0 0 24 24');
    node.setAttribute('aria-hidden', 'true');
    node.setAttribute('class', `moment-icon ${cls}`);
    node.innerHTML = inner;   // static markup below, never data
    return node;
  };
  switch (type) {
    case 'Goal':
    case 'OwnGoal':
      return svg('<circle cx="12" cy="12" r="9"/><path d="M12 7.5l3.8 2.8-1.5 4.4H9.7l-1.5-4.4z"/>', type === 'OwnGoal' ? 'is-own' : '');
    case 'YellowCard':
      return svg('<rect x="7" y="4" width="10" height="16" rx="1.5"/>', 'is-card is-yellow');
    case 'RedCard':
      return svg('<rect x="7" y="4" width="10" height="16" rx="1.5"/>', 'is-card is-red');
    case 'Substitution':
      return svg('<path d="M7 17V7m0 0L4 10m3-3l3 3M17 7v10m0 0l-3-3m3 3l3-3"/>', 'is-sub');
    default:
      return svg('<circle cx="12" cy="12" r="6"/>', 'is-dot');
  }
}

export function createTimeline({ onSelect }) {
  const scoreboard = el('div', { class: 'scoreboard' });
  const track = el('div', { class: 'mt-track' });
  const scale = el('div', { class: 'mt-scale', 'aria-hidden': 'true' });   // minute labels, in their own row
  const element = el('section', { class: 'match-timeline glass', 'aria-label': tx.timeline },
    scoreboard,
    el('div', { class: 'mt-body' }, track, scale));

  let data = null;

  // Redraw on resize: how many moments fit side by side depends on the width.
  let lastWidth = 0;
  new ResizeObserver(() => {
    if (!data || track.clientWidth === lastWidth) return;
    lastWidth = track.clientWidth;
    renderTrack();
  }).observe(track);

  function renderScoreboard() {
    const team = (name, badge) => el('div', { class: 'score-team' },
      badge ? el('img', { class: 'score-badge', src: badge, alt: '' }) : el('span', { class: 'score-badge is-empty', 'aria-hidden': 'true' }, name.slice(0, 1)),
      el('span', { class: 'score-name' }, name));
    const hasScore = data.scoreA != null && data.scoreB != null;
    const live = ['IN_PLAY', 'PAUSED', 'LIVE'].includes(data.feedStatus);
    setChildren(scoreboard,
      team(data.teamA, data.teamABadge),
      el('div', { class: 'score-centre' },
        el('span', { class: 'score-value' }, hasScore ? `${num(data.scoreA)} – ${num(data.scoreB)}` : '–'),
        data.feedStatus && data.feedStatus !== 'NOT_FOUND'   // the desk's problem, not the audience's
          ? el('span', { class: `score-status${live ? ' is-live' : ''}` }, live ? el('span', { class: 'dot', 'aria-hidden': 'true' }) : null,
              tx.status[data.feedStatus] ?? data.feedStatus)
          : null),
      team(data.teamB, data.teamBBadge));
  }

  function renderTrack() {
    const events = data.events;
    const last = events.length ? events[events.length - 1].minute : 0;
    const end = last > 90 ? Math.max(120, last + 2) : 90;   // extra time stretches the axis
    const pos = minute => Math.min(100, Math.max(0, (minute / end) * 100));

    const ticks = [0, 15, 30, 45, 60, 75, 90, ...(end > 90 ? [105, 120] : [])].filter(m => m <= end);
    const axis = el('div', { class: 'mt-axis' },
      ticks.map(m => el('span', { class: `mt-tick${m === 45 ? ' is-half' : ''}`, style: `left:${pos(m)}%` })));
    setChildren(scale, ticks.map(m =>
      el('span', { class: `mt-tick-label${m === 45 ? ' is-half' : ''}`, style: `left:${pos(m)}%` }, m === 45 ? tx.halfTime : num(m))));

    // Moments too close to fit (in pixels, so phones and walls both work) sit side by side.
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    const minGap = track.clientWidth ? (2.3 * rem / track.clientWidth) * 100 : 3.2;
    const lanes = { A: [], B: [] };
    const moments = events.map(e => {
      const side = e.team === data.teamB ? 'B' : 'A';
      const left = pos(e.minute);
      const level = lanes[side].filter(x => Math.abs(x - left) < minGap).length;
      lanes[side].push(left);
      const label = `${tx.minute(num(e.minute))} ${tx.events[e.eventType] ?? e.eventType} — ${e.playerName}`;
      return el('button', {
        type: 'button',
        class: `moment side-${side}`,
        style: `left:${left}%; --level:${Math.min(level, 2) * (left > 85 ? -1 : 1)}; --moment:${EVENT_COLORS[e.eventType] ?? '#94a3b8'}`,
        title: label,
        'aria-label': label,
        onclick: () => onSelect(e)
      }, icon(e.eventType), el('span', { class: 'moment-minute' }, tx.minute(num(e.minute))));
    });

    setChildren(track,
      axis,
      moments,
      events.length ? null : el('p', { class: 'mt-empty' }, tx.timelineEmpty));
  }

  return {
    element,
    render(next) {
      data = next;
      renderScoreboard();
      renderTrack();
    }
  };
}
