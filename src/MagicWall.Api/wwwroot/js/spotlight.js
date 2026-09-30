// Player spotlight: the broadcast "hero card" for a big moment (goal, red card, wicket…).
// Opens when a timeline moment is tapped, or by itself when a new one is approved live.
// Photos are the server's cached copies (TheSportsDB, credited on the card).
import { el, prefersReducedMotion, setChildren } from './dom.js';
import { formatDetail, num, t } from './i18n.js';
import { EVENT_COLORS } from './pitch.js';

const tx = t.sports;
const SHOW_MS = 9000;

/** Initials for a player without a photo: "Bukayo Saka" → "BS". */
const initials = name => name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase();

export function createSpotlight(host) {
  const layer = el('div', { class: 'spotlight', hidden: true, role: 'dialog', 'aria-modal': 'false', 'aria-live': 'polite' });
  host.append(layer);
  let timer = 0;

  function hide() {
    clearTimeout(timer);
    if (layer.hidden) return;
    layer.classList.remove('is-open');
    // Let the exit animation play (none with reduced motion).
    const done = () => { layer.hidden = true; };
    if (prefersReducedMotion()) done(); else setTimeout(done, 250);
  }

  /**
   * @param event  a timeline event: { minute, eventType, detail, playerName, team, playerPhoto }
   * @param match  the timeline payload (teams, badges) for the badge beside the team name
   */
  function show(event, match) {
    clearTimeout(timer);
    const color = EVENT_COLORS[event.eventType] ?? '#38bdf8';
    const badge = event.team === match?.teamA ? match?.teamABadge : event.team === match?.teamB ? match?.teamBBadge : null;

    const photo = event.playerPhoto
      ? el('img', { class: 'spotlight-photo', src: event.playerPhoto, alt: '' })
      : el('span', { class: 'spotlight-monogram', 'aria-hidden': 'true' }, initials(event.playerName));

    const close = el('button', { type: 'button', class: 'spotlight-close', 'aria-label': tx.spotlightClose, onclick: hide }, '✕');

    setChildren(layer,
      el('div', { class: 'spotlight-card', style: `--moment:${color}` },
        el('div', { class: 'spotlight-visual' }, el('div', { class: 'spotlight-glow' }), photo),
        el('div', { class: 'spotlight-text' },
          el('p', { class: 'spotlight-moment' },
            el('span', { class: 'spotlight-minute' }, tx.minute(num(event.minute))),
            tx.spotlight[event.eventType] ?? tx.events[event.eventType] ?? event.eventType),
          el('h2', { class: 'spotlight-name' }, event.playerName),
          el('p', { class: 'spotlight-team' },
            badge ? el('img', { class: 'spotlight-badge', src: badge, alt: '' }) : null,
            event.team),
          event.detail ? el('p', { class: 'spotlight-detail' }, formatDetail(event.detail)) : null,
          event.playerPhoto ? el('p', { class: 'spotlight-credit' }, tx.photoCredit) : null),
        close));

    layer.hidden = false;
    // Next frame, so the entry transition runs from the hidden state.
    requestAnimationFrame(() => layer.classList.add('is-open'));
    timer = setTimeout(hide, SHOW_MS);
  }

  layer.addEventListener('click', event => { if (event.target === layer) hide(); });
  const onKey = event => { if (event.key === 'Escape') hide(); };
  document.addEventListener('keydown', onKey);

  return {
    show,
    hide,
    destroy() {
      clearTimeout(timer);
      document.removeEventListener('keydown', onKey);
      layer.remove();
    }
  };
}
