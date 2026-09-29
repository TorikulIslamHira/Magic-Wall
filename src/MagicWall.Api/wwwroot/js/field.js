// Field reporter's submission form (the "maker" side of maker-checker): phone-friendly.
// District → seat → the candidates' new counts → submit. Nothing goes on air until the
// desk approves; "আমার জমা" shows each submission's status and any rejection reason.
import { getJson, sendJson } from './api.js';
import { el, setChildren } from './dom.js';
import { $, attempt, fillSelect, statusChip, toast } from './admin-ui.js';
import { ago, num, t } from './i18n.js';

const F = t.admin.field;

export function createFieldForm() {
  const districtSelect = $('#fd-district');
  const seatSelect = $('#fd-seat');
  const candidatesBox = $('#fd-candidates');
  const noteInput = $('#fd-note');
  const submitButton = $('#fd-submit');
  const mineList = $('#fd-mine');

  let seats = [];
  let mine = [];
  let candidates = [];
  let inputs = new Map();   // candidateId -> <input>

  async function init() {
    const [summaries, districts] = await Promise.all([
      getJson('/api/election/constituencies'),
      getJson('/maps/bd-districts.geojson')
    ]);
    seats = summaries ?? [];
    const withSeats = new Set(seats.map(s => s.districtCode));
    const options = (districts?.features ?? []).map(f => f.properties).filter(d => withSeats.has(d.code))
      .sort((a, b) => a.name_bn.localeCompare(b.name_bn, 'bn'));
    fillSelect(districtSelect, options, { value: d => d.code, label: d => d.name_bn, placeholder: F.chooseDistrict });
    renderSeats();
    await refreshMine();
  }

  function renderSeats() {
    const inDistrict = seats.filter(s => s.districtCode === districtSelect.value)
      .sort((a, b) => a.name.localeCompare(b.name, 'bn', { numeric: true }));
    fillSelect(seatSelect, inDistrict, { value: s => s.svgPathId, label: s => s.name, placeholder: F.chooseSeat });
    seatSelect.disabled = inDistrict.length === 0;
    loadCandidates();
  }

  async function loadCandidates() {
    const svgPathId = seatSelect.value;
    candidates = svgPathId ? (await getJson(`/api/election/constituencies/${encodeURIComponent(svgPathId)}/candidates`)) ?? [] : [];
    renderCandidates();
  }

  function renderCandidates() {
    inputs = new Map();
    const seat = seats.find(s => s.svgPathId === seatSelect.value);
    submitButton.disabled = !seat || candidates.length === 0;
    if (!seat) {
      setChildren(candidatesBox);
      return;
    }
    if (!candidates.length) {
      setChildren(candidatesBox, el('p', { class: 'empty' }, F.noCandidates));
      return;
    }

    setChildren(candidatesBox, candidates.map(c => {
      const myPending = mine.find(s => s.status === 'Pending' && s.constituencyId === seat.id && s.candidateId === c.candidateId);
      const input = el('input', {
        type: 'number', inputmode: 'numeric', min: 0, step: 1, class: 'fd-votes',
        placeholder: c.approvedVotes == null ? '0' : String(c.approvedVotes), 'aria-label': `${c.name}: নতুন সংখ্যা`
      });
      inputs.set(c.candidateId, input);
      return el('div', { class: 'fd-candidate' },
        el('div', { class: 'fd-candidate-info' },
          el('strong', {}, c.name),
          el('span', { class: 'muted' }, c.symbol ? `${c.partyName} · ${c.symbol}` : c.partyName),
          el('span', { class: 'fd-onair' }, F.onAir(c.approvedVotes)),
          myPending ? el('span', { class: 'fd-pending' }, F.pendingMine(myPending.votesReceived)) : null),
        input);
    }));
  }

  async function submit() {
    const seat = seats.find(s => s.svgPathId === seatSelect.value);
    if (!seat) return;
    const changes = [...inputs]
      .filter(([, input]) => input.value.trim() !== '')
      .map(([candidateId, input]) => ({ candidateId, votes: Number(input.value) }));

    if (!changes.length) return toast(F.nothingChanged, 'error');
    if (changes.some(c => !Number.isInteger(c.votes) || c.votes < 0)) return toast(t.admin.wholeNumber(t.admin.election.votes), 'error');

    submitButton.disabled = true;
    let sent = 0;
    for (const change of changes) {
      const ok = await attempt(() => sendJson('POST', '/api/election/submissions', {
        constituencyId: seat.id,
        candidateId: change.candidateId,
        votesReceived: change.votes,
        note: noteInput.value.trim() || null
      }));
      if (!ok) break;
      sent++;
    }
    submitButton.disabled = false;
    if (sent) {
      toast(F.submitted(sent));
      noteInput.value = '';
      await refreshMine();
      await loadCandidates();
    }
  }

  async function refreshMine() {
    mine = (await getJson('/api/election/submissions')) ?? [];   // the server returns only this reporter's own
    const recent = [...mine].sort((a, b) => (a.submittedAt < b.submittedAt ? 1 : -1)).slice(0, 30);
    setChildren(mineList, recent.length
      ? recent.map(s => el('li', { class: `fd-mine-row status-row-${s.status.toLowerCase()}` },
          el('div', { class: 'fd-mine-main' },
            el('strong', {}, `${s.constituencyName} · ${s.candidateName}`),
            el('span', {}, num(s.votesReceived))),
          el('div', { class: 'fd-mine-meta' },
            statusChip(s.status, t.admin.statuses[s.status] ?? s.status),
            el('span', { class: 'muted' }, ago(s.submittedAt))),
          s.status === 'Rejected' && s.reviewNote ? el('p', { class: 'fd-reason' }, F.reason(s.reviewNote)) : null))
      : el('li', { class: 'empty' }, F.noSubmissions));
    renderCandidates();
  }

  districtSelect.addEventListener('change', renderSeats);
  seatSelect.addEventListener('change', loadCandidates);
  $('#fd-form').addEventListener('submit', event => {
    event.preventDefault();
    submit();
  });

  return { init, refreshMine };
}
