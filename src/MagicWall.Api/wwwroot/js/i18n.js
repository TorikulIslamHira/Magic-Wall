// Bangla text and number/date formatting for the presenter wall.
// All on-air wording lives here so it can be reviewed by the desk in one place.

const LOCALE = 'bn-BD';

const integer = new Intl.NumberFormat(LOCALE);
const oneDecimal = new Intl.NumberFormat(LOCALE, { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** Swaps ASCII digits for Bangla ones in free text: "2025-26" -> "২০২৫-২৬". */
export const bnDigits = s => String(s ?? '').replace(/\d/g, d => '০১২৩৪৫৬৭৮৯'[d]);

/** 1234567 -> "১২,৩৪,৫৬৭" (Bangla digits, lakh grouping). */
export const num = n => integer.format(Math.round(Number(n) || 0));

/** 66.666 -> "৬৬.৭%" */
export const pct = n => `${oneDecimal.format(Number(n) || 0)}%`;

/** Money in the budget's unit (BDT crore): 94000 -> "৯৪,০০০ কোটি টাকা" */
export const taka = n => `${num(n)} কোটি টাকা`;

/** "2024-04-15" or a UTC day number -> "১৫ এপ্রিল, ২০২৪" */
export function date(value) {
  const d = typeof value === 'number' ? new Date(value * 86_400_000) : new Date(`${value}T00:00:00Z`);
  return d.toLocaleDateString(LOCALE, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

/** Broadcast-style clock: "বিকাল ৪:৪৫" (time of day instead of AM/PM). */
export function clock(d = new Date()) {
  const h = d.getHours();
  const period = h < 4 ? 'রাত' : h < 6 ? 'ভোর' : h < 12 ? 'সকাল' : h < 15 ? 'দুপুর' : h < 18 ? 'বিকাল' : h < 20 ? 'সন্ধ্যা' : 'রাত';
  const hour12 = h % 12 || 12;
  return `${period} ${integer.format(hour12)}:${bnDigits(String(d.getMinutes()).padStart(2, '0'))}`;
}

/**
 * Server timestamps are UTC; SQLite hands them back without a zone marker, which JavaScript
 * would read as local time (6 hours off in Dhaka). Treat zone-less values as UTC.
 */
export const parseUtc = value => new Date(/[zZ]|[+-]\d\d:\d\d$/.test(value) ? value : `${value}Z`);

/** "এইমাত্র", "৫ মিনিট আগে", "২ ঘণ্টা আগে", else the date. */
export function ago(value) {
  const seconds = (Date.now() - parseUtc(value).getTime()) / 1000;
  if (seconds < 45) return 'এইমাত্র';
  if (seconds < 3600) return `${num(Math.round(seconds / 60))} মিনিট আগে`;
  if (seconds < 86_400) return `${num(Math.round(seconds / 3600))} ঘণ্টা আগে`;
  return parseUtc(value).toLocaleString(LOCALE, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}

/** "মঙ্গলবার, ২৯ সেপ্টেম্বর" */
export const today = (d = new Date()) =>
  d.toLocaleDateString(LOCALE, { weekday: 'long', day: 'numeric', month: 'long' });

export const t = {
  brand: 'ম্যাজিক ওয়াল',
  status: { live: 'সরাসরি', connecting: 'সংযোগ হচ্ছে…', reconnecting: 'পুনঃসংযোগ…', offline: 'অফলাইন' },
  error: 'সমস্যা হয়েছে',
  fullscreen: { enter: 'পূর্ণ পর্দা', exit: 'পূর্ণ পর্দা থেকে বের হন' },

  modules: {
    Election: { title: 'নির্বাচন ফলাফল', eyebrow: 'জাতীয় সংসদ নির্বাচন' },
    Sports: { title: 'ম্যাচ বিশ্লেষণ', eyebrow: 'খেলা' },
    War: { title: 'সংঘাত পরিস্থিতি', eyebrow: 'যুদ্ধ ও ভূরাজনীতি' },
    Budget: { title: 'জাতীয় বাজেট', eyebrow: 'অর্থনীতি' }
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
    notFound: 'আসনটি পাওয়া যায়নি'
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
    noEvents: 'এই অঞ্চলের কোনো ঘটনা নেই'
  },

  budget: {
    total: fy => `জাতীয় বাজেট ${bnDigits(fy)}`.trim(),
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
      received: 'এসেছে'
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
      reason: r => `কারণ: ${r}`
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
      inactiveCount: n => `${n} জন নিষ্ক্রিয়`,
      roleChange: (from, to) => `ভূমিকা বদল: ${from} → ${to}`,
      gains: 'নতুন পাবেন',
      loses: 'হারাবেন',
      grantsTitle: role => `${role} যা করতে পারবেন`,
      cannot: 'যা পারবেন না'
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
      unlinked: 'লাইভ ফিড বন্ধ',
      linkedToast: 'লাইভ ফিড চালু — নতুন ঘটনা অনুমোদন সারিতে আসবে',
      unlinkedToast: 'লাইভ ফিড বন্ধ'
    },

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
      onAir: fy => (fy ? `বাজেট ${bnDigits(fy)} সম্প্রচারে` : 'বাজেট সম্প্রচারে')
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
      Ace: 'এস', Winner: 'উইনার', UnforcedError: 'আনফোর্সড এরর', DoubleFault: 'ডাবল ফল্ট'
    }
  }
};
