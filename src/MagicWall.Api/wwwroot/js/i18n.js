// Bangla and English text, and number/date formatting, for the wall, the hub and the dashboard.
// All wording lives here (Bangla) and in i18n-en.js (English) so the desk can review it in one place.
//
// Language: ?lang=bn|en in the URL, else the viewer's saved choice, else Bangla. Switching reloads the
// page (every module reads its text once, at start), keeping the current screen via URL/session.
import { buildEnglish, STATIC_EN } from './i18n-en.js';

const STORAGE_KEY = 'magicwall.lang';

function detectLanguage() {
  if (typeof location === 'undefined') return 'bn';   // loaded outside a browser (checks)
  const fromUrl = new URLSearchParams(location.search).get('lang');
  if (fromUrl === 'bn' || fromUrl === 'en') return fromUrl;
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'bn' || saved === 'en') return saved;
  } catch { /* storage blocked: default */ }
  return 'bn';
}

export const LANG = detectLanguage();
const EN = LANG === 'en';

// English uses Indian grouping (12,34,567) to match the lakh/crore units used on air.
export const LOCALE = EN ? 'en-IN' : 'bn-BD';

const integer = new Intl.NumberFormat(LOCALE);
const oneDecimal = new Intl.NumberFormat(LOCALE, { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** Digits in free text in the interface language: "2025-26" -> "২০২৫-২৬" in Bangla, unchanged in English. */
export const digits = s => (EN ? String(s ?? '') : String(s ?? '').replace(/\d/g, d => '০১২৩৪৫৬৭৮৯'[d]));

/** 1234567 -> "১২,৩৪,৫৬৭" / "12,34,567" */
export const num = n => integer.format(Math.round(Number(n) || 0));

/** 66.666 -> "৬৬.৭%" / "66.7%" */
export const pct = n => `${oneDecimal.format(Number(n) || 0)}%`;

/** Money in the budget's unit (BDT crore): 94000 -> "৯৪,০০০ কোটি টাকা" / "Tk 94,000 crore" */
export const taka = n => (EN ? `Tk ${num(n)} crore` : `${num(n)} কোটি টাকা`);

/** "2024-04-15" or a UTC day number -> "১৫ এপ্রিল, ২০২৪" / "15 April 2024" */
export function date(value) {
  const d = typeof value === 'number' ? new Date(value * 86_400_000) : new Date(`${value}T00:00:00Z`);
  return d.toLocaleDateString(LOCALE, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

/** Broadcast-style clock: "বিকাল ৪:৪৫" (time of day instead of AM/PM) / "4:45 PM". */
export function clock(d = new Date()) {
  const h = d.getHours();
  const hour12 = h % 12 || 12;
  const minutes = String(d.getMinutes()).padStart(2, '0');
  if (EN) return `${hour12}:${minutes} ${h < 12 ? 'AM' : 'PM'}`;
  const period = h < 4 ? 'রাত' : h < 6 ? 'ভোর' : h < 12 ? 'সকাল' : h < 15 ? 'দুপুর' : h < 18 ? 'বিকাল' : h < 20 ? 'সন্ধ্যা' : 'রাত';
  return `${period} ${integer.format(hour12)}:${digits(minutes)}`;
}

/**
 * Server timestamps are UTC; SQLite hands them back without a zone marker, which JavaScript
 * would read as local time (6 hours off in Dhaka). Treat zone-less values as UTC.
 */
export const parseUtc = value => new Date(/[zZ]|[+-]\d\d:\d\d$/.test(value) ? value : `${value}Z`);

/** A kick-off in the viewer's local time: "শনিবার, ৪ অক্টোবর, রাত ১০:০০" / "Saturday, 4 October, 10:00 PM". */
export function kickoff(value) {
  const d = parseUtc(value);
  return `${d.toLocaleDateString(LOCALE, { weekday: 'long', day: 'numeric', month: 'long' })}, ${clock(d)}`;
}

/** Compact date + time for lists: "৪ অক্টো. রাত ১০:০০" / "4 Oct 10:00 PM". */
export function shortDateTime(value) {
  const d = parseUtc(value);
  return `${d.toLocaleDateString(LOCALE, { day: 'numeric', month: 'short' })} ${clock(d)}`;
}

/** "এইমাত্র", "৫ মিনিট আগে" / "just now", "5 min ago", else the date. */
export function ago(value) {
  const seconds = (Date.now() - parseUtc(value).getTime()) / 1000;
  if (seconds < 45) return EN ? 'just now' : 'এইমাত্র';
  if (seconds < 3600) return EN ? `${num(Math.round(seconds / 60))} min ago` : `${num(Math.round(seconds / 60))} মিনিট আগে`;
  if (seconds < 86_400) return EN ? `${num(Math.round(seconds / 3600))} h ago` : `${num(Math.round(seconds / 3600))} ঘণ্টা আগে`;
  return parseUtc(value).toLocaleString(LOCALE, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}

/** "মঙ্গলবার, ২৯ সেপ্টেম্বর" / "Tuesday, 29 September" */
export const today = (d = new Date()) =>
  d.toLocaleDateString(LOCALE, { weekday: 'long', day: 'numeric', month: 'long' });

/** A map feature's name in the interface language (the map files carry both). */
export const placeName = props => (EN ? props?.name_en ?? titleCase(props?.code) : props?.name_bn ?? props?.code) ?? '';

/** A division's name: Bangla from the map, English from its code ("khulna" -> "Khulna"). */
export const divisionName = props => (EN ? titleCase(props?.division) : props?.division_bn) ?? '';

const titleCase = s => (s ? String(s).replace(/(^|[\s-])\p{L}/gu, c => c.toUpperCase()) : s);

const bn = {
  brand: 'ম্যাজিক ওয়াল',
  close: 'বন্ধ করুন',
  language: { switchTo: 'English', switchLabel: 'Switch to English · ইংরেজিতে দেখুন', current: 'বাংলা' },
  status: { live: 'সরাসরি', connecting: 'সংযোগ হচ্ছে…', reconnecting: 'পুনঃসংযোগ…', offline: 'অফলাইন' },
  error: 'সমস্যা হয়েছে',
  fullscreen: { enter: 'পূর্ণ পর্দা', exit: 'পূর্ণ পর্দা থেকে বের হন' },

  modules: {
    Election: { title: 'নির্বাচন ফলাফল', eyebrow: 'জাতীয় সংসদ নির্বাচন' },
    Sports: { title: 'ম্যাচ বিশ্লেষণ', eyebrow: 'খেলা' },
    War: { title: 'সংঘাত পরিস্থিতি', eyebrow: 'যুদ্ধ ও ভূরাজনীতি' },
    Budget: { title: 'জাতীয় বাজেট', eyebrow: 'অর্থনীতি' }
  },

  hub: {
    menuTitle: 'প্রধান মেনু',
    menuEyebrow: 'ইন্টারঅ্যাক্টিভ হাব',
    declared: (n, total) => `${num(n)} / ${num(total)} আসনে ফলাফল`,
    matches: n => `${num(n)}টি ম্যাচ`,
    zones: n => `${num(n)}টি সংঘাতপূর্ণ অঞ্চল`,
    budget: (fy, total) => `${digits(fy)} · ${taka(total)}`,
    chooseMatch: 'একটি ম্যাচ বেছে নিন',
    noMatches: 'এখনো কোনো ম্যাচ নেই।',
    allMatches: '← সব ম্যাচ',
    choosePlayer: title => (title ? `${title}: একজন খেলোয়াড় বেছে নিন` : 'একজন খেলোয়াড় বেছে নিন'),
    noPlayers: 'এই ম্যাচে কোনো খেলোয়াড় নেই।'
  },

  // Save/load failures (api.js). Messages the server sends come in the chosen language already.
  api: {
    unreachable: 'সংরক্ষণ ব্যর্থ: সার্ভারে পৌঁছানো যাচ্ছে না। সার্ভার চালু আছে কি না দেখুন।',
    failed: status => `সংরক্ষণ ব্যর্থ (HTTP ${status})`,
    expired: 'সেশন শেষ হয়েছে — আবার লগইন করুন।',
    forbidden: 'এই কাজের অনুমতি আপনার নেই।',
    serverError: 'সার্ভার ত্রুটি — সার্ভারের লগ দেখুন (docker compose logs)।'
  },

  election: {
    national: 'জাতীয় চিত্র',
    seatsLeading: 'আসনে এগিয়ে',
    declared: (n, total) => `${num(n)} / ${num(total)} আসনে ফলাফল`,
    majority: n => `সংখ্যাগরিষ্ঠতা ${num(n)}`,
    raceTitle: 'আসন পরিস্থিতি',
    undeclared: 'ফলাফল বাকি',
    turnout: 'উপস্থিতি',
    votesCast: 'প্রদত্ত ভোট',
    registered: 'মোট ভোটার',
    leadsBy: (party, n) => `${party} ${num(n)} ভোটে এগিয়ে`,
    noCandidates: 'কোনো প্রার্থীর তথ্য নেই',
    seats: n => `${num(n)}টি আসন`,
    back: 'ফিরে যান',
    tapHint: 'মানচিত্রে জেলা স্পর্শ করুন',
    votes: 'ভোট',
    notFound: 'আসনটি পাওয়া যায়নি',
    boundaryCredit: 'সীমানা: BBS / OCHA (geoBoundaries)',
    division: name => `${name} বিভাগ`,
    district: name => `${name} জেলা`
  },

  war: {
    casualtiesAll: 'মোট হতাহত · সব অঞ্চল',
    controlledBy: 'নিয়ন্ত্রণে',
    casualtiesToDate: 'এ পর্যন্ত হতাহত',
    noReports: 'তথ্য নেই',
    contested: 'বিরোধপূর্ণ',
    allZones: 'সব অঞ্চল',
    tapHint: 'বিস্তারিত দেখতে মানচিত্রে অঞ্চল স্পর্শ করুন',
    casualtiesReported: n => `${num(n)} জন হতাহত`,
    play: 'চালান',
    pause: 'থামান',
    prev: 'আগের ঘটনা',
    next: 'পরের ঘটনা',
    empty: 'এখনো কোনো অঞ্চল যোগ করা হয়নি',
    noEvents: 'এই অঞ্চলের কোনো ঘটনা নেই',
    mapCredit: 'মানচিত্র: Natural Earth',
    timeline: 'সময়রেখা'
  },

  budget: {
    total: fy => `জাতীয় বাজেট ${digits(fy)}`.trim(),
    crore: 'কোটি টাকা',
    sectors: 'খাতভিত্তিক বরাদ্দ',
    other: 'অন্যান্য',
    megaProjects: 'মেগা প্রকল্প',
    projectsSummary: (n, amount, share) => `${num(n)}টি প্রকল্প · ${taka(amount)} (খাতের ${pct(share)})`,
    noProjects: 'এই খাতে কোনো মেগা প্রকল্প নেই',
    complete: p => `${pct(p)} সম্পন্ন`,
    shareOfSector: 'খাত বরাদ্দের',
    remaining: 'কাজ বাকি',
    empty: 'এখনো কোনো বাজেট খাত নেই',
    completion: 'অগ্রগতি',
    select: 'একটি খাত বেছে নিন'
  },

  // Admin dashboard (producers). Messages from the API are already in Bangla.
  admin: {
    roles: { FieldReporter: 'মাঠ প্রতিবেদক', DeskReporter: 'ডেস্ক প্রতিবেদক', SportsDesk: 'স্পোর্টস ডেস্ক', Admin: 'অ্যাডমিন' },
    statuses: { Pending: 'অপেক্ষমাণ', Approved: 'অনুমোদিত', Rejected: 'বাতিল', Superseded: 'প্রতিস্থাপিত' },

    login: {
      failed: 'ব্যবহারকারীর নাম বা পাসওয়ার্ড ভুল।',
      tooMany: 'অনেকবার চেষ্টা করা হয়েছে। এক মিনিট পর আবার চেষ্টা করুন।',
      offline: 'সার্ভারে পৌঁছানো যাচ্ছে না।',
      expired: 'সেশন শেষ হয়েছে — আবার লগইন করুন।',
      welcome: name => `স্বাগতম, ${name}`
    },
    forbidden: 'এই কাজের অনুমতি আপনার নেই।',

    queue: {
      emptyElection: 'অনুমোদনের অপেক্ষায় কিছু নেই।',
      emptySports: 'ফিড থেকে অনুমোদনের অপেক্ষায় কোনো ঘটনা নেই।',
      firstCount: 'প্রথম হিসাব',
      decreased: 'সংখ্যা কমেছে — যাচাই করুন',
      submittedBy: (name, when) => `${name} · ${when}`,
      approve: 'অনুমোদন',
      reject: 'প্রত্যাখ্যান',
      reasonPlaceholder: 'প্রত্যাখ্যানের কারণ (প্রতিবেদক দেখতে পাবেন)',
      confirmReject: 'প্রত্যাখ্যান নিশ্চিত করুন',
      cancel: 'বাতিল',
      ownItem: 'নিজের জমা — অন্য একজন ডেস্ক প্রতিবেদককে অনুমোদন করতে হবে',
      approved: 'অনুমোদিত — ওয়ালে দেখানো হচ্ছে',
      rejected: 'প্রত্যাখ্যাত — প্রতিবেদক কারণ দেখতে পাবেন',
      reviewedBy: (name, when) => `${name} · ${when}`,
      recent: 'সাম্প্রতিক সিদ্ধান্ত',
      noRecent: 'এখনো কোনো সিদ্ধান্ত নেই।',
      selected: n => `${num(n)}টি নির্বাচিত`,
      approveSelected: n => `অনুমোদন (${num(n)})`,
      rejectSelected: n => `প্রত্যাখ্যান (${num(n)})`,
      selectAll: 'সব বেছে নিন',
      bulkApproved: n => `${num(n)}টি ঘটনা অনুমোদিত — ওয়ালে দেখানো হচ্ছে`,
      bulkRejected: n => `${num(n)}টি ঘটনা প্রত্যাখ্যাত`,
      allMatches: 'সব ম্যাচ',
      received: 'এসেছে',
      undo: 'ফিরিয়ে নিন',
      undone: 'ফিরিয়ে নেওয়া হয়েছে — কিছুই বদলায়নি',
      approving: n => `${num(n)}টি অনুমোদন হচ্ছে…`,
      rejecting: n => `${num(n)}টি প্রত্যাখ্যান হচ্ছে…`,
      submissions: n => `${num(n)}টি জমা`,
      latestBy: name => `সর্বশেষ: ${name}`,
      showAll: 'সব জমা দেখুন',
      hideAll: 'লুকান',
      ownLatest: 'সর্বশেষ জমাটি আপনার — অন্য একজনকে অনুমোদন করতে হবে',
      skippedOwn: n => `${num(n)}টি নিজের জমা বাদ দেওয়া হয়েছে`,
      groupsApproved: n => `${num(n)}টি সংখ্যা অনুমোদিত — ওয়ালে যাচ্ছে`,
      groupsRejected: n => `${num(n)}টি জমা প্রত্যাখ্যাত`,
      reasonRequired: 'প্রত্যাখ্যানের কারণ লিখুন',
      matchOption: (sport, title, when, id, n) => `${sport} · ${title} · ${when} · #${id} — ${num(n)}টি অপেক্ষমাণ`
    },

    field: {
      chooseDistrict: 'জেলা বেছে নিন',
      chooseSeat: 'আসন বেছে নিন',
      noCandidates: 'এই আসনে কোনো প্রার্থী নথিভুক্ত নেই। ডেস্কে যোগাযোগ করুন।',
      onAir: v => (v == null ? 'এখনো কোনো অনুমোদিত সংখ্যা নেই' : `ওয়ালে এখন: ${num(v)}`),
      pendingMine: v => `আপনার জমা অপেক্ষমাণ: ${num(v)}`,
      nothingChanged: 'কোনো সংখ্যা বদলানো হয়নি।',
      submitted: n => `${num(n)}টি সংখ্যা জমা হয়েছে — ডেস্কের অনুমোদনের অপেক্ষায়`,
      noSubmissions: 'আপনি এখনো কিছু জমা দেননি।',
      reason: r => `কারণ: ${r}`,
      newCount: name => `${name}: নতুন সংখ্যা`,
      sunlight: '☀ রোদ মোড'
    },

    users: {
      created: name => `${name} তৈরি হয়েছে`,
      saved: name => `${name}-এর পরিবর্তন সংরক্ষিত হয়েছে`,
      passwordReset: name => `${name}-এর পাসওয়ার্ড বদলানো হয়েছে`,
      active: 'সক্রিয়',
      inactive: 'নিষ্ক্রিয়',
      you: 'আপনি',
      selfLocked: 'নিজের ভূমিকা বা অবস্থা নিজে বদলানো যায় না',
      allRoles: 'সব ভূমিকা',
      save: 'সংরক্ষণ',
      resetPassword: 'পাসওয়ার্ড রিসেট',
      newPassword: 'নতুন পাসওয়ার্ড (অন্তত ৮ অক্ষর)',
      confirmReset: 'পাসওয়ার্ড বদলান',
      cancel: 'বাতিল',
      generate: 'তৈরি করুন',
      tooShort: 'পাসওয়ার্ড অন্তত ৮ অক্ষরের হতে হবে',
      noMatch: 'কোনো ব্যবহারকারী মেলেনি',
      created_at: when => `যোগ হয়েছে ${when}`,
      count: n => `${n} জন`,
      inactiveCount: n => `${num(n)} জন নিষ্ক্রিয়`,
      roleChange: (from, to) => `ভূমিকা বদল: ${from} → ${to}`,
      gains: 'নতুন পাবেন',
      loses: 'হারাবেন',
      grantsTitle: role => `${role} যা করতে পারবেন`,
      cannot: 'যা পারবেন না',
      permissions: (n, total) => `${num(n)}/${num(total)} অনুমতি`,
      permission: 'অনুমতি',
      yes: 'আছে',
      no: 'নেই',
      role: 'ভূমিকা',
      displayNameOf: user => `${user}: প্রদর্শিত নাম`,
      roleOf: user => `${user}: ভূমিকা`,
      activeOf: user => `${user}: সক্রিয়`,
      newPasswordOf: user => `${user}: নতুন পাসওয়ার্ড`,
      edit: 'সম্পাদনা',
      more: user => `${user}: আরও বিকল্প`,
      activate: 'সক্রিয় করুন',
      deactivate: 'নিষ্ক্রিয় করুন',
      confirmResetOf: name => `${name}-এর পাসওয়ার্ড বদলাবেন? পুরোনো পাসওয়ার্ড আর কাজ করবে না।`,
      displayName: 'প্রদর্শিত নাম',
      confirmDeactivate: name => `${name}-কে নিষ্ক্রিয় করবেন? তিনি সঙ্গে সঙ্গে লগআউট হয়ে যাবেন।`,
      everyone: 'সবাই',
      rolesLabel: 'ভূমিকা'
    },

    // Capabilities come from the server (Policies.Roles); these are only their names.
    caps: {
      SubmitElection: { name: 'ভোটের সংখ্যা জমা', desc: 'মাঠ থেকে আসনভিত্তিক ভোটের সংখ্যা পাঠানো; ডেস্কের অনুমোদনের অপেক্ষায় থাকে' },
      ReviewElection: { name: 'নির্বাচন অনুমোদন', desc: 'জমা হওয়া সংখ্যা অনুমোদন বা বাতিল করা; অনুমোদিত সংখ্যাই ওয়ালে যায়' },
      EditDesk: { name: 'ডেস্ক সম্পাদনা', desc: 'প্রার্থী, আসন, সংঘাত ও বাজেটের তথ্য সরাসরি সম্পাদনা' },
      ManageSports: { name: 'খেলা পরিচালনা', desc: 'ম্যাচ, খেলোয়াড় ও ঘটনা; লাইভ ফিড চালু/বন্ধ; ফিডের ঘটনা অনুমোদন' },
      ControlWall: { name: 'ওয়াল নিয়ন্ত্রণ', desc: 'কোন বিষয় সম্প্রচারে যাবে তা বদলানো' },
      ManageUsers: { name: 'ব্যবহারকারী ও সেটিংস', desc: 'অ্যাকাউন্ট তৈরি, ভূমিকা বদল, পাসওয়ার্ড রিসেট' }
    },
    roleSummary: {
      FieldReporter: 'শুধু মাঠ থেকে ভোটের সংখ্যা জমা দেন। কিছু অনুমোদন বা সম্প্রচার করতে পারেন না।',
      DeskReporter: 'মাঠের সংখ্যা যাচাই ও অনুমোদন করেন; নির্বাচন, সংঘাত ও বাজেটের তথ্য সম্পাদনা এবং ওয়াল নিয়ন্ত্রণ করেন।',
      SportsDesk: 'খেলার লাইভ ফিড অনুমোদন, ম্যাচ পরিচালনা ও ওয়াল নিয়ন্ত্রণ করেন।',
      Admin: 'সব কিছু করতে পারেন, ব্যবহারকারী ও সেটিংস ব্যবস্থাপনাসহ।'
    },

    feed: {
      linked: id => `লাইভ ফিড চালু · ${id}`,
      notFound: id => `ফিডে "${id}" নামে কোনো ম্যাচ নেই — আইডি ঠিক করুন`,
      unlinked: 'লাইভ ফিড বন্ধ',
      linkedToast: 'লাইভ ফিড চালু — নতুন ঘটনা অনুমোদন সারিতে আসবে',
      unlinkedToast: 'লাইভ ফিড বন্ধ',
      turnOn: 'লাইভ ফিড চালু',
      turnOff: 'লাইভ ফিড বন্ধ',
      pickCompetition: 'প্রতিযোগিতা বেছে "সূচি দেখুন" চাপুন।',
      noFixtures: 'এই সময়ে কোনো ম্যাচ নেই।',
      importButton: 'আমদানি',
      imported: 'আমদানি হয়েছে',
      importedToast: title => `${title} আমদানি হয়েছে — লাইভ ফিডে যুক্ত`,
      open: 'খুলুন',
      note: (feed, media) => `ফিড: ${feed}${media ? ` · ছবি: ${media}` : ''} · সূচি ৫ মিনিট পর্যন্ত ক্যাশ থাকে (প্রোভাইডারের অনুরোধ-সীমা বাঁচাতে)।`,
      competitions: {
        PL: 'প্রিমিয়ার লিগ', PD: 'লা লিগা', BL1: 'বুন্দেসলিগা', SA: 'সেরি আ', FL1: 'লিগ ১',
        CL: 'চ্যাম্পিয়নস লিগ', DED: 'এরেডিভিসি', PPL: 'প্রিমেইরা লিগা', ELC: 'চ্যাম্পিয়নশিপ',
        BSA: 'ব্রাজিল সেরি আ', WC: 'বিশ্বকাপ', EC: 'ইউরো'
      }
    },

    // "Feed data": what the providers brought in, visible and correctable without the approval queue.
    data: {
      matchSaved: 'ম্যাচের তথ্য সংরক্ষিত হয়েছে',
      playerSaved: name => `${name}: সংরক্ষিত`,
      teamRenamed: (from, to) => `"${from}" এখন "${to}"`,
      photoRefresh: name => `${name}-এর ছবি আবার খোঁজা হচ্ছে`,
      badgeRefresh: team => `${team}-এর লোগো আবার খোঁজা হচ্ছে`,
      confirmRename: (from, to) => `"${from}" দলের নাম সব ম্যাচ ও খেলোয়াড়ে "${to}" করবেন?`,
      renamePrompt: team => `"${team}" দলের নতুন নাম:`,
      feedOwned: 'লাইভ ফিডে যুক্ত — স্কোর ফিড থেকে আসে',
      manualScore: 'ফিডে যুক্ত নয় — স্কোর হাতে দেওয়া যায়',
      noPlayers: 'এই ম্যাচের কোনো খেলোয়াড় এখনো আসেনি।',
      noMatches: 'এখনো কোনো ম্যাচ নেই।',
      events: (approved, pending) => `${num(approved)} অনুমোদিত · ${num(pending)} অপেক্ষমাণ`,
      updated: when => `ফিড হালনাগাদ: ${when}`,
      never: 'এখনো আসেনি',
      source: 'উৎস',
      checked: when => `খোঁজা হয়েছে ${when}`,
      notChecked: 'এখনো খোঁজা হয়নি',
      noPicture: 'ছবি পাওয়া যায়নি',
      manual: 'হাতে দেওয়া',
      rename: 'নাম বদল',
      refetch: 'আবার খুঁজুন',
      raw: 'কাঁচা ডেটা',
      rawTitle: (provider, when) => `${provider} থেকে শেষ উত্তর · ${when}`,
      hideRaw: 'কাঁচা ডেটা লুকান',
      noRaw: 'সার্ভার চালু হওয়ার পর এই ম্যাচের কোনো কাঁচা ডেটা এখনো আসেনি।',
      matchDetails: 'ম্যাচের তথ্য',
      title: 'শিরোনাম',
      competition: 'প্রতিযোগিতা',
      kickoff: 'কিক-অফ',
      score: team => `${team}-এর গোল`
    },

    onAirTag: 'লাইভ',
    modules: { Election: 'নির্বাচন', Sports: 'খেলা', War: 'সংঘাত', Budget: 'বাজেট' },
    status: { live: 'সংযুক্ত', connecting: 'সংযোগ হচ্ছে…', reconnecting: 'পুনঃসংযোগ…', offline: 'সংযোগ নেই' },
    onAir: name => `${name} এখন সম্প্রচারে`,
    onWall: name => `${name} ওয়ালে দেখানো হচ্ছে`,
    key: {
      saved: 'এই ব্রাউজার সেশনের জন্য সংরক্ষিত',
      missing: 'যেকোনো পরিবর্তনের জন্য প্রয়োজন',
      autoFilled: 'লোকাল পরীক্ষার জন্য স্বয়ংক্রিয়ভাবে বসানো হয়েছে'
    },
    save: 'সংরক্ষণ',
    remove: 'মুছুন',
    wholeNumber: label => `${label} ০ বা তার বেশি পূর্ণসংখ্যা হতে হবে।`,
    atLeastZero: label => `${label} ০ বা তার বেশি হতে হবে।`,
    between: (label, max) => `${label} ০ থেকে ${num(max)}-এর মধ্যে হতে হবে।`,

    election: {
      chooseSeat: 'একটি আসন বেছে নিন',
      chooseDistrict: 'একটি জেলা বেছে নিন',
      chooseCandidate: 'একটি প্রার্থী বেছে নিন',
      pickSeatFirst: 'ফলাফল সম্পাদনা করতে একটি আসন বেছে নিন।',
      noCandidates: 'এই আসনে এখনো কোনো প্রার্থী নেই। নিচে যোগ করুন।',
      summary: (cast, voters, turnout) => `মোট ${num(voters)} ভোটারের মধ্যে ${num(cast)} ভোট পড়েছে (উপস্থিতি ${pct(turnout)})`,
      votesFor: name => `${name}-এর ভোট`,
      votes: 'ভোট',
      voters: 'মোট ভোটার',
      saved: 'ভোট সংরক্ষিত হয়েছে',
      seatAdded: 'আসন যোগ হয়েছে',
      candidateAdded: 'প্রার্থী যোগ হয়েছে',
      pickCandidate: 'যোগ করার জন্য একজন প্রার্থী বেছে নিন।'
    },

    sports: {
      chooseMatch: 'একটি ম্যাচ বেছে নিন',
      choosePlayer: 'একজন খেলোয়াড় বেছে নিন',
      noEvents: 'এই খেলোয়াড়ের এখনো কোনো ঘটনা নেই।',
      noPosition: 'অবস্থান ঠিক করা হয়নি',
      at: (x, y) => `অবস্থান: ${x}, ${y}`,
      fromTo: (x1, y1, x2, y2) => `${x1}, ${y1} থেকে ${x2}, ${y2}`,
      pickMatchPlayer: 'আগে একটি ম্যাচ ও একজন খেলোয়াড় বেছে নিন।',
      tapPitch: 'ঘটনার অবস্থান ঠিক করতে মাঠে স্পর্শ করুন।',
      minute: 'মিনিট',
      added: 'ঘটনা যোগ হয়েছে',
      deleted: 'ঘটনা মুছে ফেলা হয়েছে',
      confirmDelete: 'এই ঘটনাটি মুছবেন? এটি ওয়াল থেকেও সরে যাবে।',
      onWall: 'খেলোয়াড় বিশ্লেষণ ওয়ালে দেখানো হচ্ছে',
      versus: 'বনাম',
      noMatches: 'এই খেলার কোনো ম্যাচ নেই — নিচে তৈরি করুন',
      matchAdded: 'ম্যাচ তৈরি হয়েছে',
      playerAdded: 'খেলোয়াড় যোগ হয়েছে',
      pickMatchFirst: 'আগে একটি ম্যাচ বেছে নিন।'
    },

    war: {
      allZones: 'সব অঞ্চল (সারসংক্ষেপ)',
      pickZoneFirst: 'টাইমলাইন দেখতে ও সম্পাদনা করতে একটি অঞ্চল বেছে নিন।',
      noEvents: 'এখনো কোনো ঘটনা নেই। নিচে প্রথমটি যোগ করুন।',
      pickZone: 'আগে একটি অঞ্চল বেছে নিন।',
      casualties: 'হতাহতের সংখ্যা',
      added: 'ঘটনা যোগ হয়েছে',
      deleted: 'ঘটনা মুছে ফেলা হয়েছে',
      zoneAdded: 'অঞ্চল যোগ হয়েছে',
      confirmDelete: 'টাইমলাইনের এই ঘটনাটি মুছবেন? ওয়াল নিয়ন্ত্রণ ও হতাহতের হিসাব আবার করবে।',
      trackerOnAir: 'সংঘাত পরিস্থিতি সম্প্রচারে'
    },

    budget: {
      noBudget: 'এখনো কোনো বাজেট নেই',
      addSectorFirst: 'আগে একটি খাত যোগ করুন',
      noSectors: 'এই অর্থবছরে কোনো খাত নেই।',
      pickSector: 'একটি খাত বেছে নিন।',
      noProjects: 'এই খাতে এখনো কোনো মেগা প্রকল্প নেই।',
      pickSectorFirst: 'আগে একটি খাত বেছে নিন।',
      allocation: 'বরাদ্দ',
      amount: 'প্রকল্প ব্যয়',
      completion: 'অগ্রগতি',
      allocationFor: name => `${name}-এর বরাদ্দ`,
      amountFor: name => `${name}-এর ব্যয়`,
      completionFor: name => `${name}-এর অগ্রগতি`,
      locationFor: name => `${name}-এর অবস্থান`,
      allocationSaved: 'বরাদ্দ সংরক্ষিত হয়েছে',
      sectorAdded: 'খাত যোগ হয়েছে',
      projectSaved: 'প্রকল্প সংরক্ষিত হয়েছে',
      projectAdded: 'প্রকল্প যোগ হয়েছে',
      projectDeleted: 'প্রকল্প মুছে ফেলা হয়েছে',
      confirmDelete: name => `"${name}" মুছবেন? এটি ওয়াল থেকেও সরে যাবে।`,
      onAir: fy => (fy ? `বাজেট ${digits(fy)} সম্প্রচারে` : 'বাজেট সম্প্রচারে')
    }
  },

  sports: {
    waiting: 'অ্যাডমিন ড্যাশবোর্ড থেকে ম্যাচ ও খেলোয়াড় বেছে নিন',
    notFound: 'ম্যাচ বা খেলোয়াড় পাওয়া যায়নি',
    noEvents: 'এই খেলোয়াড়ের কোনো ঘটনা নেই',
    layers: { heatmap: 'হিটম্যাপ', arrows: 'তীর', markers: 'চিহ্ন' },
    sports: {
      Football: 'ফুটবল', Cricket: 'ক্রিকেট', Hockey: 'হকি', Kabaddi: 'কাবাডি', Basketball: 'বাস্কেটবল', Tennis: 'টেনিস'
    },
    events: {
      Pass: 'পাস', Shot: 'শট', Goal: 'গোল', Tackle: 'ট্যাকল', Foul: 'ফাউল', Save: 'সেভ',
      Four: 'চার', Six: 'ছক্কা', Wicket: 'উইকেট', Catch: 'ক্যাচ', Delivery: 'ডেলিভারি',
      PenaltyCorner: 'পেনাল্টি কর্নার',
      Raid: 'রেইড পয়েন্ট', Bonus: 'বোনাস পয়েন্ট', AllOut: 'অল আউট',
      TwoPointer: '২ পয়েন্ট', ThreePointer: '৩ পয়েন্ট', FreeThrow: 'ফ্রি থ্রো', Rebound: 'রিবাউন্ড',
      Ace: 'এস', Winner: 'উইনার', UnforcedError: 'আনফোর্সড এরর', DoubleFault: 'ডাবল ফল্ট',
      OwnGoal: 'আত্মঘাতী গোল', YellowCard: 'হলুদ কার্ড', RedCard: 'লাল কার্ড', Substitution: 'বদলি'
    },
    // Provider match status → what the scoreboard says.
    status: {
      SCHEDULED: 'শুরু হয়নি', TIMED: 'শুরু হয়নি', IN_PLAY: 'চলছে', LIVE: 'চলছে', PAUSED: 'বিরতি',
      FINISHED: 'শেষ', AWARDED: 'ফল ঘোষিত', POSTPONED: 'স্থগিত', SUSPENDED: 'বন্ধ', CANCELLED: 'বাতিল',
      NOT_FOUND: 'ফিডে পাওয়া যায়নি'
    },
    live: 'লাইভ',
    matchOverview: 'পুরো ম্যাচ',
    matchOverviewHint: 'স্কোর, টাইমলাইন ও গুরুত্বপূর্ণ মুহূর্ত',
    timeline: 'ম্যাচ টাইমলাইন',
    timelineEmpty: 'এখনো কোনো গোল বা কার্ড নেই',
    pickFromTimeline: 'টাইমলাইনের কোনো মুহূর্তে চাপুন',
    halfTime: 'বিরতি',
    minute: m => `${m}′`,
    spotlightClose: 'বন্ধ করুন',
    // The spotlight's headline per moment
    spotlight: {
      Goal: 'গোল!', OwnGoal: 'আত্মঘাতী গোল', YellowCard: 'হলুদ কার্ড', RedCard: 'লাল কার্ড',
      Substitution: 'বদলি', Wicket: 'উইকেট!', Six: 'ছক্কা!', AllOut: 'অল আউট!'
    },
    photoCredit: 'ছবি: TheSportsDB',
    totalEvents: 'মোট ঘটনা',
    pitch: 'মাঠ',
    layersLabel: 'স্তর',
    // Tokens the feed stores in an event's detail (see MatchEvent.Detail).
    detail: {
      penalty: 'পেনাল্টি',
      secondYellow: 'দ্বিতীয় হলুদ কার্ড',
      assist: name => `অ্যাসিস্ট: ${name}`,
      off: name => `বদলি হয়ে বের হলেন: ${name}`,
      stoppage: n => `+${digits(n)}`
    }
  }
};

const en = buildEnglish({ num, pct, taka, digits });

/** The text for the chosen language. English mirrors the Bangla dictionary's shape exactly. */
export const t = EN ? en : bn;

/** For checks and tests: both dictionaries. */
export const dictionaries = { bn, en };

/**
 * An event's detail as stored by the feed (" · "-separated tokens: "penalty", "+2", "assist: Name",
 * "off: Name", "second-yellow") in the interface language. Unknown text is shown as it is.
 */
export function formatDetail(detail) {
  if (!detail) return '';
  const d = t.sports.detail;
  return detail.split(' · ').map(part => {
    // Events stored before the tokens existed carry the old Bangla wording: read that too.
    if (part === 'penalty' || part === 'পেনাল্টি') return d.penalty;
    if (part === 'second-yellow' || part === 'দ্বিতীয় হলুদ কার্ড') return d.secondYellow;
    if (/^\+\d+$/.test(part)) return d.stoppage(part.slice(1));
    if (part.startsWith('assist: ')) return d.assist(part.slice(8));
    if (part.startsWith('অ্যাসিস্ট: ')) return d.assist(part.slice('অ্যাসিস্ট: '.length));
    if (part.startsWith('off: ')) return d.off(part.slice(5));
    if (part.startsWith('বদলি: ')) return d.off(part.slice('বদলি: '.length));
    return part;
  }).join(' · ');
}

// ---------- static page text (HTML) ----------

const BANGLA = /[\u0980-\u09FF]/;
const ATTRIBUTES = ['placeholder', 'aria-label', 'title', 'alt'];
const missing = new Set();

function translate(text) {
  const key = text.trim();
  if (!BANGLA.test(key)) return text;
  const english = STATIC_EN[key];
  if (english === undefined) {
    if (!missing.has(key)) { missing.add(key); console.warn(`[i18n] no English for: "${key}"`); }
    return text;
  }
  return text.replace(key, english);
}

/**
 * Puts a page's static text (written in Bangla in the HTML) into the interface language.
 * Text nodes and the user-facing attributes are looked up by their Bangla wording.
 */
export function localizeDom(root = document) {
  document.documentElement.lang = LANG;
  if (!EN) return;
  if (root === document) document.title = translate(document.title);
  const walker = document.createTreeWalker(root === document ? document.body : root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!BANGLA.test(node.nodeValue)) continue;
    // One Bangla word can need different English by context ("দল" = party or team): data-en decides.
    const override = node.parentElement?.dataset.en;
    node.nodeValue = override ? node.nodeValue.replace(node.nodeValue.trim(), override) : translate(node.nodeValue);
  }
  const scope = root === document ? document : root;
  for (const attr of ATTRIBUTES) {
    for (const element of scope.querySelectorAll(`[${attr}]`)) {
      const value = element.getAttribute(attr);
      if (BANGLA.test(value)) element.setAttribute(attr, translate(value));
    }
  }
}

/** Saves the choice and reloads, so every module starts in the new language. */
export function setLanguage(lang) {
  try { localStorage.setItem(STORAGE_KEY, lang); } catch { /* still switches for this load via the URL */ }
  const url = new URL(location.href);
  if (url.searchParams.has('lang')) url.searchParams.set('lang', lang);
  location.replace(url);
}

/** The switch: shows the other language's name ("English" / "বাংলা"). */
export function languageToggle(className = 'lang-toggle') {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.lang = EN ? 'bn' : 'en';
  button.textContent = t.language.switchTo;
  button.title = t.language.switchLabel;
  button.setAttribute('aria-label', t.language.switchLabel);
  button.addEventListener('click', () => setLanguage(EN ? 'bn' : 'en'));
  return button;
}
