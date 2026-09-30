// Settings (Admin only): user management and the role-permission matrix.
// The matrix is built from GET /api/auth/roles, i.e. from the same Policies table the API
// enforces, so what the admin reads here is exactly what the server allows.
import { getJson, sendJson } from './api.js';
import { el, setChildren } from './dom.js';
import { $, attempt, moreMenu, toast } from './admin-ui.js';
import { ago, num, t } from './i18n.js';

const A = t.admin;
const U = A.users;
const MIN_PASSWORD = 8;

const roleName = role => A.roles[role] ?? role;
const capName = cap => A.caps[cap]?.name ?? cap;

/** Readable random password (no look-alike characters) for the admin to hand over. */
function generatePassword(length = 12) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789@#%+';
  const bytes = crypto.getRandomValues(new Uint32Array(length));
  return [...bytes].map(b => alphabet[b % alphabet.length]).join('');
}

export function createSettingsPanel(me) {
  const tbody = $('#us-list');
  const form = $('#us-form');
  const search = $('#us-search');
  const filter = $('#us-filter');
  const showInactive = $('#us-show-inactive');

  let roles = [];      // [{ role, capabilities }] in server order
  let allCaps = [];    // every capability, in matrix order
  let users = [];

  const capsOf = role => roles.find(r => r.role === role)?.capabilities ?? [];

  const roleSelect = (value, label) => {
    const select = el('select', { 'aria-label': label }, roles.map(r => el('option', { value: r.role }, roleName(r.role))));
    select.value = value;
    return select;
  };

  // ---------- what a role grants ----------

  /** Checklist of every capability: ✓ granted, ✕ not. Used before creating an account. */
  function grantsList(role) {
    const granted = new Set(capsOf(role));
    return [
      el('p', { class: 'grants-title' }, U.grantsTitle(roleName(role))),
      el('p', { class: 'muted grants-summary' }, A.roleSummary[role] ?? ''),
      el('ul', { class: 'grants-list' }, allCaps.map(cap => el('li', { class: granted.has(cap) ? 'is-granted' : 'is-denied' },
        el('span', { class: 'grant-mark', 'aria-hidden': 'true' }, granted.has(cap) ? '✓' : '✕'),
        el('span', {}, el('strong', {}, capName(cap)), el('small', {}, A.caps[cap]?.desc ?? '')),
        el('span', { class: 'sr-only' }, granted.has(cap) ? '' : ` (${U.cannot})`))))
    ];
  }

  /** "Role change: A → B, gains …, loses …": shown on a row before the admin saves. */
  function roleDiff(from, to) {
    if (from === to) return null;
    const before = new Set(capsOf(from));
    const after = new Set(capsOf(to));
    const gains = [...after].filter(c => !before.has(c));
    const loses = [...before].filter(c => !after.has(c));
    return el('div', { class: 'role-diff' },
      el('strong', {}, U.roleChange(roleName(from), roleName(to))),
      gains.length ? el('span', { class: 'diff-gain' }, `+ ${U.gains}: ${gains.map(capName).join(', ')}`) : null,
      loses.length ? el('span', { class: 'diff-loss' }, `− ${U.loses}: ${loses.map(capName).join(', ')}`) : null);
  }

  // ---------- who holds which role: one line, each role a filter ----------

  function renderRoleCards() {
    const chip = (value, label, count) => el('button', {
      type: 'button', class: 'role-chip', 'aria-pressed': String(filter.value === value),
      onclick: () => { filter.value = filter.value === value && value ? '' : value; renderUsers(); renderRoleCards(); }
    }, label, count == null ? null : el('strong', {}, num(count)));
    const inactive = users.filter(u => !u.isActive).length;
    setChildren($('#st-roles'),
      el('span', { class: 'role-summary-label' }, U.rolesLabel),
      chip('', U.everyone, users.filter(u => u.isActive).length),
      roles.map(({ role }) => chip(role, roleName(role), users.filter(u => u.role === role && u.isActive).length)),
      inactive ? el('span', { class: 'muted role-summary-inactive' }, U.inactiveCount(inactive)) : null);
  }

  // ---------- permission matrix ----------

  function renderMatrix() {
    setChildren($('#st-matrix-head'), el('tr', {},
      el('th', {}, U.permission),
      roles.map(r => el('th', { class: `center role-col role-${r.role}` }, roleName(r.role)))));
    setChildren($('#st-matrix'), allCaps.map(cap => el('tr', {},
      el('td', { class: 'cap-cell' }, el('strong', {}, capName(cap)), el('small', {}, A.caps[cap]?.desc ?? '')),
      roles.map(r => {
        const yes = r.capabilities.includes(cap);
        return el('td', { class: `center ${yes ? 'is-yes' : 'is-no'}` },
          el('span', { class: 'matrix-mark', 'aria-label': yes ? U.yes : U.no }, yes ? '✓' : '—'));
      }))));
  }

  // ---------- users table ----------

  function visibleUsers() {
    const q = search.value.trim().toLowerCase();
    return users.filter(u =>
      (!filter.value || u.role === filter.value)
      && (showInactive.checked || u.isActive)
      && (!q || u.userName.includes(q) || u.displayName.toLowerCase().includes(q)));
  }

  function renderUsers() {
    const rows = visibleUsers();
    if (!rows.length) {
      setChildren(tbody, el('tr', {}, el('td', { colspan: 5, class: 'muted' }, U.noMatch)));
      return;
    }
    setChildren(tbody, rows.flatMap(userRows));
  }

  const editing = new Set();     // user ids with their edit form open
  let resetting = null;          // user id with the password form open

  /** Read-only by default: a row to scan; editing and the rarer actions are one step away. */
  function userRows(u) {
    const self = u.userName === me.userName;

    const row = el('tr', { class: u.isActive ? null : 'is-inactive' },
      el('td', {},
        el('div', { class: 'user-cell' },
          el('strong', {}, u.userName, self ? el('span', { class: 'you-tag' }, U.you) : null),
          el('small', { class: 'muted' }, U.created_at(ago(u.createdAt))))),
      el('td', {}, u.displayName),
      el('td', {}, el('span', { class: `role-name role-${u.role}` }, roleName(u.role))),
      el('td', {}, statusChip(u.isActive)),
      el('td', {}, el('div', { class: 'actions' },
        el('button', {
          type: 'button', class: 'secondary sm', 'aria-expanded': String(editing.has(u.id)),
          onclick: () => { editing.has(u.id) ? editing.delete(u.id) : editing.add(u.id); renderUsers(); }
        }, U.edit),
        moreMenu(U.more(u.userName), [
          { label: U.resetPassword, onSelect: () => { resetting = resetting === u.id ? null : u.id; renderUsers(); } },
          u.isActive
            ? { label: U.deactivate, danger: true, disabled: self, title: self ? U.selfLocked : null, onSelect: () => setActive(u, false) }
            : { label: U.activate, onSelect: () => setActive(u, true) }
        ]))));

    const rows = [row];
    if (editing.has(u.id)) rows.push(editRow(u, self));
    if (resetting === u.id) rows.push(resetRow(u));
    return rows;
  }

  const statusChip = active => el('span', { class: `status-chip ${active ? 'status-approved' : 'status-superseded'}` }, active ? U.active : U.inactive);

  function editRow(u, self) {
    const display = el('input', { type: 'text', value: u.displayName, maxlength: 120, 'aria-label': U.displayNameOf(u.userName) });
    const role = roleSelect(u.role, U.roleOf(u.userName));
    const active = el('input', { type: 'checkbox', 'aria-label': U.activeOf(u.userName) });
    active.checked = u.isActive;
    if (self) {
      role.disabled = active.disabled = true;
      role.title = active.title = U.selfLocked;
    }
    const activeLabel = el('span', {}, u.isActive ? U.active : U.inactive);
    const diffBox = el('div', {});
    const save = el('button', { type: 'button', disabled: true }, U.save);

    const dirty = () => display.value.trim() !== u.displayName || role.value !== u.role || active.checked !== u.isActive;
    const update = () => {
      save.disabled = !dirty() || !display.value.trim();
      setChildren(diffBox, roleDiff(u.role, role.value));
      activeLabel.textContent = active.checked ? U.active : U.inactive;
    };
    display.addEventListener('input', update);
    role.addEventListener('change', update);
    active.addEventListener('change', update);

    save.addEventListener('click', async () => {
      if (u.isActive && !active.checked && !confirm(U.confirmDeactivate(u.displayName))) return;
      const ok = await attempt(async () => {
        await sendJson('PUT', `/api/auth/users/${u.id}`, {
          displayName: display.value.trim(), role: role.value, isActive: active.checked, password: null
        });
        return true;
      }, U.saved(u.userName));
      if (ok) {
        editing.delete(u.id);
        await refresh();
      }
    });

    return el('tr', { class: 'edit-row' }, el('td', { colspan: 5 },
      el('div', { class: 'edit-form' },
        el('label', {}, U.displayName, display),
        el('label', { class: 'role-cell' }, U.role, role, diffBox),
        el('label', { class: 'switch' }, active, activeLabel),
        el('div', { class: 'button-row' },
          save,
          el('button', { type: 'button', class: 'secondary', onclick: () => { editing.delete(u.id); renderUsers(); } }, U.cancel)))));
  }

  // Password reset uses the saved values, so it never sneaks in unsaved edits from an open form.
  function resetRow(u) {
    const password = el('input', { type: 'text', minlength: MIN_PASSWORD, autocomplete: 'new-password', spellcheck: 'false', placeholder: U.newPassword, 'aria-label': U.newPasswordOf(u.userName) });
    const reset = async () => {
      if (password.value.length < MIN_PASSWORD) return toast(U.tooShort, 'error');
      if (!confirm(U.confirmResetOf(u.displayName))) return;
      const ok = await attempt(async () => {
        await sendJson('PUT', `/api/auth/users/${u.id}`, {
          displayName: u.displayName, role: u.role, isActive: u.isActive, password: password.value
        });
        return true;
      }, U.passwordReset(u.userName));
      if (ok) { resetting = null; renderUsers(); }
    };
    queueMicrotask(() => password.focus());
    return el('tr', { class: 'reset-row' }, el('td', { colspan: 5 },
      el('div', { class: 'reset-form' },
        el('span', { class: 'muted' }, `${u.displayName} (${u.userName})`),
        password,
        el('button', { type: 'button', class: 'secondary', onclick: () => { password.value = generatePassword(); password.focus(); } }, U.generate),
        el('button', { type: 'button', onclick: reset }, U.confirmReset),
        el('button', { type: 'button', class: 'secondary', onclick: () => { resetting = null; renderUsers(); } }, U.cancel))));
  }

  async function setActive(u, isActive) {
    if (!isActive && !confirm(U.confirmDeactivate(u.displayName))) return;
    const ok = await attempt(async () => {
      await sendJson('PUT', `/api/auth/users/${u.id}`, { displayName: u.displayName, role: u.role, isActive, password: null });
      return true;
    }, U.saved(u.userName));
    if (ok) await refresh();
  }

  // ---------- new user ----------

  function setFormOpen(open) {
    form.hidden = !open;
    $('#us-add-toggle').setAttribute('aria-expanded', String(open));
    if (open) $('#us-new-name').focus();
  }

  const renderGrants = () => setChildren($('#us-new-grants'), grantsList($('#us-new-role').value));

  $('#us-add-toggle').addEventListener('click', () => setFormOpen(form.hidden));
  $('#us-add-cancel').addEventListener('click', () => { form.reset(); setFormOpen(false); });
  $('#us-generate').addEventListener('click', () => {
    const input = $('#us-new-password');
    input.type = 'text';   // the admin needs to read it out / copy it once
    input.value = generatePassword();
    input.select();
  });

  form.addEventListener('submit', async event => {
    event.preventDefault();
    const userName = $('#us-new-name').value.trim().toLowerCase();
    const created = await attempt(() => sendJson('POST', '/api/auth/users', {
      userName,
      displayName: $('#us-new-display').value.trim(),
      password: $('#us-new-password').value,
      role: $('#us-new-role').value
    }), U.created(userName));
    if (created) {
      form.reset();
      $('#us-new-password').type = 'password';
      renderGrants();
      setFormOpen(false);
      await refresh();
    }
  });

  search.addEventListener('input', renderUsers);
  showInactive.addEventListener('change', renderUsers);
  filter.addEventListener('change', () => { renderUsers(); renderRoleCards(); });

  // ---------- load ----------

  async function init() {
    roles = (await getJson('/api/auth/roles')) ?? [];
    allCaps = [...new Set(roles.flatMap(r => r.capabilities))]
      .sort((a, b) => Object.keys(A.caps).indexOf(a) - Object.keys(A.caps).indexOf(b));

    $('#us-new-role').replaceWith(Object.assign(roleSelect('FieldReporter', U.role), { id: 'us-new-role' }));
    $('#us-new-role').addEventListener('change', renderGrants);
    setChildren(filter, el('option', { value: '' }, U.allRoles), roles.map(r => el('option', { value: r.role }, roleName(r.role))));

    renderMatrix();
    renderGrants();
    await refresh();
  }

  async function refresh() {
    users = (await getJson('/api/auth/users')) ?? [];
    renderRoleCards();
    renderUsers();
  }

  return { init, refresh };
}
