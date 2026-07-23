// =====================================================================
//  StopBack — Door-to-Door Sales Tracker
//  Plain JavaScript. Data saved on this device via localStorage.
// =====================================================================

const APP_NAME = "StopBack";
const STORAGE_KEY = "stopback-data-v1";

// ---- State (with defaults so old saves still load) -------------------
const DEFAULT_STATE = {
  contactsTally: 0,        // people talked to without getting a number
  contactsTodayCount: 0,   // today's "+1" taps (loaded from log_events)
  leads: [],               // full stop-back records
  activeDays: [],          // "YYYY-MM-DD" strings — used for streaks
  profile: { name: "", dailyGoal: 5, salesGoal: 2 },
  // Historical totals from before using the app — added on top of live data.
  baseline: { contacts: 0, stopbacks: 0, missed: 0, sales: 0 },
  products: [],            // things you sell (for the brochure)
  friends: [],             // people you've added to share highlights with
  likes: {},               // which feed posts you've reacted to
  // Motivation layer (XP is derived; this tracks celebrations + earned badges).
  gamify: {
    badges: {},
    goalHitDate: "", // legacy (pre-gold); superseded by goalCelebrated
    goalCelebrated: { stopbacks: "", sales: "" }, // date each goal last went gold
    lastStreakCelebrated: 0,
    streakSeen: 0,
    records: {},           // personal bests: { key: { v, date } } — permanent
    recordsCelebrated: {},  // { key: "YYYY-MM-DD" } — one banner per type per day
  },
  // What accepted friends are allowed to see (Phase 3).
  privacy: { shareStats: true, shareLeads: false, sharePhone: false },
};

let editingProductId = null; // null = the product form is in "add" mode

let state = structuredClone(DEFAULT_STATE);

function load() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (!saved) return;
  try {
    const data = JSON.parse(saved);
    state = { ...DEFAULT_STATE, ...data };
    state.profile = { ...DEFAULT_STATE.profile, ...(data.profile || {}) };
    state.baseline = { ...DEFAULT_STATE.baseline, ...(data.baseline || {}) };
    state.likes = data.likes || {};
    state.gamify = { ...DEFAULT_STATE.gamify, ...(data.gamify || {}) };
    state.gamify.badges = (data.gamify && data.gamify.badges) || {};
  } catch (e) {
    console.error("Could not read saved data:", e);
  }
}

// Phase 2: Supabase is the source of truth. save() now only writes a local
// CACHE (under a different key) so we never clobber the pre-migration data in
// STORAGE_KEY, which the one-time importer still needs. Likes are cached too.
function save() {
  try {
    localStorage.setItem("stopback-cache-v1", JSON.stringify(state));
    localStorage.setItem("stopback-likes", JSON.stringify(state.likes || {}));
  } catch (_) {}
}

// Debounce helper for chatty inputs (name/goal/baseline typing).
function debounce(fn, ms = 500) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}
const saveProfileDebounced = debounce(
  (patch) => dbSaveProfile(patch).catch(dbFail("Couldn't save profile")),
  500
);

// ---- Date helpers ----------------------------------------------------
function localDateStr(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// Record that the user did something today (drives the streak).
function markActiveToday() {
  const today = localDateStr();
  if (!state.activeDays.includes(today)) {
    state.activeDays.push(today);
    if (window.dbSaveProfile)
      dbSaveProfile({ active_days: state.activeDays, current_streak: currentStreak() })
        .catch(dbFail("Couldn't save streak"));
  }
}

function currentStreak() {
  const set = new Set(state.activeDays);
  let d = new Date();
  // Allow the streak to count even if today isn't logged yet.
  if (!set.has(localDateStr(d))) d.setDate(d.getDate() - 1);
  let streak = 0;
  while (set.has(localDateStr(d))) {
    streak++;
    d.setDate(d.getDate() - 1);
  }
  return streak;
}

// ---- Small helpers ---------------------------------------------------
function countByStatus(status) {
  return state.leads.filter((l) => l.status === status).length;
}

// ---- Totals: live data + imported past stats (baseline) --------------
function base(key) {
  return (state.baseline && state.baseline[key]) || 0;
}
function contactsTotal() {
  return base("contacts") + state.contactsTally + state.leads.length;
}
function stopbacksTotal() {
  return base("stopbacks") + state.leads.length;
}
function missedTotal() {
  return base("missed") + countByStatus("missed");
}
function salesTotal() {
  return base("sales") + countByStatus("sale");
}

// =====================================================================
//  MOTIVATION LAYER — XP, levels, badges, celebrations
// =====================================================================
function stopbacksToday() {
  const t = localDateStr();
  return state.leads.filter((l) => localDateStr(new Date(l.createdAt)) === t).length;
}

// Sales counted by when they were actually closed (soldAt), falling back to
// lead creation for older sales. Used by BOTH the goal ring and the gold
// celebration trigger so the two can never disagree.
function salesToday() {
  const t = localDateStr();
  return state.leads.filter(
    (l) => l.status === "sale" && localDateStr(new Date(l.soldAt || l.createdAt)) === t
  ).length;
}

// =====================================================================
//  PERSONAL RECORDS — permanent all-time bests (stored in gamify.records)
// =====================================================================
const CLOSE_RATE_MIN_CONTACTS = 10; // min contacts for a close-rate record day

const RECORD_LABELS = {
  contactsDay:  (v) => `${v} Contacts Today`,
  stopbacksDay: (v) => `${v} Stop-Backs Today`,
  salesDay:     (v) => `${v} Sales Today`,
  salesStreak:  (v) => `${v}-Day Sales Streak`,
  loginStreak:  (v) => `${v}-Day Streak`,
  closeRate:    (v) => `${v}% Close Rate Day`,
};

function ensureRecords() {
  state.gamify.records = state.gamify.records || {};
  state.gamify.recordsCelebrated = state.gamify.recordsCelebrated || {};
  return state.gamify.records;
}

// All doors talked to today = "+1" taps + stop backs logged.
function contactsToday() {
  return (state.contactsTodayCount || 0) + stopbacksToday();
}

function mySaleDays() {
  const days = new Set();
  state.leads.forEach((l) => {
    if (l.status === "sale") days.add(localDateStr(new Date(l.soldAt || l.createdAt)));
  });
  return [...days];
}

// Longest ever run of consecutive active days (for the login-streak record).
function longestLoginStreak() {
  const days = [...state.activeDays].sort();
  let best = 0, run = 0, prev = null;
  days.forEach((d) => {
    if (prev) {
      const p = new Date(prev);
      p.setDate(p.getDate() + 1);
      run = localDateStr(p) === d ? run + 1 : 1;
    } else run = 1;
    if (run > best) best = run;
    prev = d;
  });
  return best;
}

// Raise a record if beaten. Returns true when it was a NEW best.
function bumpRecord(rec, key, value, date) {
  if (value > ((rec[key] && rec[key].v) || 0)) {
    rec[key] = { v: value, date: date || localDateStr() };
    return true;
  }
  return false;
}

// Silent backfill on load — sets the bar from history, never celebrates.
// dailyRows (v_daily_stats) adds per-day contacts/close-rate/best-week that
// the client can't derive from leads alone.
function seedRecords(dailyRows) {
  const rec = ensureRecords();

  // Best stop-back / sales days from the leads on hand.
  const byDay = {};
  state.leads.forEach((l) => {
    const d = localDateStr(new Date(l.createdAt));
    byDay[d] = byDay[d] || { sb: 0, sales: 0 };
    byDay[d].sb++;
    if (l.status === "sale") {
      const sd = localDateStr(new Date(l.soldAt || l.createdAt));
      byDay[sd] = byDay[sd] || { sb: 0, sales: 0 };
      byDay[sd].sales++;
    }
  });
  Object.entries(byDay).forEach(([d, x]) => {
    bumpRecord(rec, "stopbacksDay", x.sb, d);
    bumpRecord(rec, "salesDay", x.sales, d);
  });

  bumpRecord(rec, "salesStreak", salesStreakFrom(mySaleDays()));
  bumpRecord(rec, "loginStreak", longestLoginStreak());

  if (dailyRows && dailyRows.length) {
    const weeks = {};
    dailyRows.forEach((r) => {
      const contacts = (r.contacts || 0) + (r.stopbacks || 0);
      bumpRecord(rec, "contactsDay", contacts, r.day);
      const closings = (r.sales || 0) + (r.missed || 0);
      if (contacts >= CLOSE_RATE_MIN_CONTACTS && closings > 0)
        bumpRecord(rec, "closeRate", Math.round((r.sales / closings) * 100), r.day);
      // Best week = most stop backs in a Mon–Sun calendar week.
      const d = new Date(r.day + "T12:00:00");
      d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // back to Monday
      const wk = localDateStr(d);
      weeks[wk] = (weeks[wk] || 0) + (r.stopbacks || 0);
    });
    Object.entries(weeks).forEach(([wk, v]) => bumpRecord(rec, "bestWeek", v, wk));
  }
}

// Action-path record check. At most ONE banner per action; a first-ever
// record (beating 0) is stored silently — nothing to brag about yet.
function checkRecords() {
  const rec = ensureRecords();
  const today = localDateStr();
  const candidates = [
    ["salesDay", salesToday()],
    ["stopbacksDay", stopbacksToday()],
    ["salesStreak", salesStreakFrom(mySaleDays())],
    ["contactsDay", contactsToday()],
    ["loginStreak", currentStreak()],
  ];
  const closings = state.leads.filter((l) => {
    const d = localDateStr(new Date(l.soldAt || l.createdAt));
    return d === today && (l.status === "sale" || l.status === "missed");
  });
  if (contactsToday() >= CLOSE_RATE_MIN_CONTACTS && closings.length > 0) {
    const sales = closings.filter((l) => l.status === "sale").length;
    candidates.push(["closeRate", Math.round((sales / closings.length) * 100)]);
  }

  let banner = null;
  candidates.forEach(([key, v]) => {
    const prev = (rec[key] && rec[key].v) || 0;
    if (v > prev) {
      rec[key] = { v, date: today };
      if (prev >= 1 && state.gamify.recordsCelebrated[key] !== today) {
        state.gamify.recordsCelebrated[key] = today;
        if (!banner) banner = RECORD_LABELS[key](v);
      }
    }
  });
  if (banner) recordBanner(banner);
}

// Slim, premium top banner — no popup, self-removing, gold accent.
function recordBanner(text) {
  const b = el(`
    <div class="pb-banner" role="status">
      <span class="pb-trophy">🏆</span>
      <span class="pb-copy">
        <span class="pb-title">New Personal Best</span>
        <span class="pb-sub">${text}</span>
      </span>
    </div>`);
  document.body.appendChild(b);
  setTimeout(() => b.classList.add("out"), 3400);
  setTimeout(() => b.remove(), 3950);
}

// XP weights — effort (doors/showing up) is rewarded at least as much as outcomes.
const XP = { contact: 5, stopback: 15, missed: 10, sale: 40, activeDay: 10 };

// XP is DERIVED from your data, so existing + imported stats already count and
// nothing ever resets. Sales/misses are bonuses layered on top of the stop back.
function computeXP() {
  const contactsOnly = state.contactsTally + base("contacts"); // doors with no number
  return (
    contactsOnly * XP.contact +
    stopbacksTotal() * XP.stopback +
    missedTotal() * XP.missed +
    salesTotal() * XP.sale +
    state.activeDays.length * XP.activeDay
  );
}

const LEVELS = [
  { name: "Rookie", xp: 0 },
  { name: "Door Knocker", xp: 150 },
  { name: "Dealmaker", xp: 400 },
  { name: "Closer", xp: 800 },
  { name: "Top Rep", xp: 1500 },
  { name: "Rainmaker", xp: 2800 },
  { name: "Legend", xp: 5000 },
];

function levelInfo(xp) {
  let i = 0;
  for (let k = 0; k < LEVELS.length; k++) if (xp >= LEVELS[k].xp) i = k;
  const cur = LEVELS[i];
  const next = LEVELS[i + 1] || null;
  const frac = next ? (xp - cur.xp) / (next.xp - cur.xp) : 1;
  return { name: cur.name, cur, next, frac };
}

// Any single day with 2+ closings and a 50%+ close rate.
function hasHighCloseDay() {
  const byDay = {};
  state.leads.forEach((l) => {
    const d = localDateStr(new Date(l.createdAt));
    byDay[d] = byDay[d] || { s: 0, m: 0 };
    if (l.status === "sale") byDay[d].s++;
    else if (l.status === "missed") byDay[d].m++;
  });
  return Object.values(byDay).some((x) => x.s + x.m >= 2 && x.s / (x.s + x.m) >= 0.5);
}

const BADGES = [
  { id: "first_stopback", name: "Getting Started", icon: "🚪", desc: "Log your first stop back", check: () => stopbacksTotal() >= 1 },
  { id: "first_sale", name: "First Sale", icon: "💰", desc: "Close your first deal", check: () => salesTotal() >= 1 },
  { id: "streak_7", name: "On Fire", icon: "🔥", desc: "7-day knock streak", check: () => currentStreak() >= 7 },
  { id: "contacts_100", name: "Century", icon: "💯", desc: "Talk to 100 people", check: () => contactsTotal() >= 100 },
  { id: "close_day_50", name: "Sharpshooter", icon: "🎯", desc: "50%+ close rate in a day (2+ closings)", check: () => hasHighCloseDay() },
  { id: "sales_10", name: "Closer's Club", icon: "🏆", desc: "Close 10 deals", check: () => salesTotal() >= 10 },
];

const STREAK_MILESTONES = [3, 5, 7, 10, 14, 20, 25, 30, 50, 75, 100];

// Silently sync earned badges + "already hit" markers on load (no celebration).
function initGamify() {
  const today = localDateStr();
  BADGES.forEach((b) => {
    if (!state.gamify.badges[b.id] && b.check()) state.gamify.badges[b.id] = "earned";
  });
  // Seed the gold-celebration stamps for goals already met, so a page load
  // or re-render can never re-fire a celebration.
  state.gamify.goalCelebrated = state.gamify.goalCelebrated || { stopbacks: "", sales: "" };
  const sbGoal = state.profile.dailyGoal || 0;
  const sGoal = state.profile.salesGoal || 0;
  if (sbGoal > 0 && stopbacksToday() >= sbGoal) state.gamify.goalCelebrated.stopbacks = today;
  if (sGoal > 0 && salesToday() >= sGoal) state.gamify.goalCelebrated.sales = today;
  // Seed records from the leads on hand (v_daily_stats backfill runs async
  // in startApp). Silent — load can never trigger a record banner.
  seedRecords(null);
  save();
  if (window.dbSaveProfile)
    dbSaveProfile({ gamify: state.gamify }).catch(dbFail("Couldn't save progress"));
}

// Called AFTER a user action. Detects new milestones and celebrates once each.
function runGamification(opts = {}) {
  let party = false;
  const today = localDateStr();

  if (opts.sale) party = true;

  // Daily goals → premium gold celebration, once per goal per day.
  state.gamify.goalCelebrated = state.gamify.goalCelebrated || { stopbacks: "", sales: "" };
  const gc = state.gamify.goalCelebrated;
  const sbGoal = state.profile.dailyGoal || 0;
  const sGoal = state.profile.salesGoal || 0;
  const sbHit = sbGoal > 0 && stopbacksToday() >= sbGoal && gc.stopbacks !== today;
  const sHit = sGoal > 0 && salesToday() >= sGoal && gc.sales !== today;
  if (sbHit) gc.stopbacks = today;
  if (sHit) gc.sales = today;
  let gold = false;
  if (sbHit && sHit) { goldCelebration("BOTH GOALS DOWN"); gold = true; }
  else if (sbHit) { goldCelebration("STOP-BACK GOAL HIT"); gold = true; }
  else if (sHit) { goldCelebration("SALES GOAL HIT"); gold = true; }

  const streak = currentStreak();
  if (STREAK_MILESTONES.includes(streak) && streak > state.gamify.lastStreakCelebrated) {
    state.gamify.lastStreakCelebrated = streak;
    party = true;
    toast(`${streak}-day streak! 🔥`);
  }

  const newBadges = [];
  BADGES.forEach((b) => {
    if (!state.gamify.badges[b.id] && b.check()) {
      state.gamify.badges[b.id] = today;
      newBadges.push(b);
    }
  });

  // Personal records (banner handled inside; persisted with the save below).
  checkRecords();

  save();
  if (window.dbSaveProfile)
    dbSaveProfile({ gamify: state.gamify }).catch(dbFail("Couldn't save progress"));
  // The gold overlay is the headline moment — don't stack plain confetti on it.
  if (!gold && (party || newBadges.length)) confettiBurst();
  newBadges.forEach((b, i) => setTimeout(() => toast(`Badge earned: ${b.name} ${b.icon}`), 700 + i * 900));
}

// Tasteful, non-blocking confetti via the Web Animations API (no libraries).
function confettiBurst() {
  if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const colors = ["#2f6b43", "#234f33", "#b9791f", "#9b2226", "#e4d6b6", "#211c16"];
  const cont = document.createElement("div");
  cont.className = "confetti";
  document.body.appendChild(cont);
  for (let i = 0; i < 28; i++) {
    const p = document.createElement("div");
    p.className = "confetti-piece";
    p.style.background = colors[i % colors.length];
    p.style.left = "50%";
    p.style.top = "40%";
    cont.appendChild(p);
    const dx = (Math.random() * 2 - 1) * (120 + Math.random() * 160);
    const dy = 240 + Math.random() * 220;
    const rot = Math.random() * 720 - 360;
    p.animate(
      [
        { transform: "translate(0,0) rotate(0deg)", opacity: 1 },
        { transform: `translate(${dx}px,-${80 + Math.random() * 90}px) rotate(${rot / 2}deg)`, opacity: 1, offset: 0.35 },
        { transform: `translate(${dx * 1.3}px,${dy}px) rotate(${rot}deg)`, opacity: 0 },
      ],
      { duration: 1200 + Math.random() * 500, easing: "cubic-bezier(0.2,0.6,0.3,1)", fill: "forwards" }
    );
  }
  setTimeout(() => cont.remove(), 1900);
}

// ---- Premium gold celebration (daily goal hit) -------------------------
const HYPE_MESSAGES = [
  "GET ONE MORE!",
  "ANOTHA ONE!",
  "LET'S GO!",
  "KEEP STACKING THEM.",
  "BUILD THE LEAD.",
  "STAY HOT.",
  "ON A ROLL.",
  "KEEP THE MOMENTUM.",
];
// Deterministic per seed so re-renders don't flicker the message, but each
// new goal level / day rotates to a different line.
function hypeLine(seed) {
  return HYPE_MESSAGES[hashStr(seed) % HYPE_MESSAGES.length];
}

// Architecture hook for a future success chime. Intentionally silent for now.
function playCelebrationSound() {}

// Full-screen gold moment, ~2.5s. Non-blocking (pointer-events: none),
// self-removing, honors prefers-reduced-motion. Fired only from
// runGamification with a once-per-goal-per-day stamp — never on re-render.
function goldCelebration(title) {
  playCelebrationSound();
  if (navigator.vibrate) navigator.vibrate([40, 60, 40]);
  if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    toast("🏆 " + title);
    return;
  }

  const ov = el(`
    <div class="gold-celebration" aria-hidden="true">
      <div class="gc-ring"></div>
      <div class="gc-ring gc-ring-2"></div>
      <div class="gc-text">
        <span class="gc-title">${title}</span>
        <span class="gc-sub">${hypeLine(title + localDateStr())}</span>
      </div>
    </div>`);
  document.body.appendChild(ov);
  goldConfetti(ov);

  // Let the freshly-gilded ring pop once, in place.
  document.querySelectorAll(".goal-col.gold").forEach((c) => c.classList.add("gold-pop"));

  setTimeout(() => ov.classList.add("gc-out"), 2100);
  setTimeout(() => ov.remove(), 2700);
}

// Softer, slower confetti in warm metallic golds.
function goldConfetti(cont) {
  const golds = ["#c9a227", "#e6c65c", "#b8912f", "#f2e2a0", "#9a7b1e"];
  for (let i = 0; i < 24; i++) {
    const p = document.createElement("div");
    p.className = "confetti-piece";
    p.style.background = golds[i % golds.length];
    p.style.left = "50%";
    p.style.top = "45%";
    p.style.borderRadius = i % 3 ? "50%" : "2px";
    cont.appendChild(p);
    const dx = (Math.random() * 2 - 1) * (100 + Math.random() * 140);
    const dy = 160 + Math.random() * 180;
    const rot = Math.random() * 540 - 270;
    p.animate(
      [
        { transform: "translate(0,0) rotate(0deg) scale(1)", opacity: 0.95 },
        { transform: `translate(${dx}px,-${70 + Math.random() * 80}px) rotate(${rot / 2}deg) scale(1.05)`, opacity: 0.9, offset: 0.4 },
        { transform: `translate(${dx * 1.25}px,${dy}px) rotate(${rot}deg) scale(0.85)`, opacity: 0 },
      ],
      { duration: 1700 + Math.random() * 700, easing: "cubic-bezier(0.2,0.55,0.35,1)", fill: "forwards" }
    );
  }
}

// Small non-blocking toast.
function toast(msg) {
  const t = document.createElement("div");
  t.className = "toast";
  t.textContent = msg;
  document.body.appendChild(t);
  t.animate([{ opacity: 0, transform: "translate(-50%, 10px)" }, { opacity: 1, transform: "translate(-50%, 0)" }],
    { duration: 220, fill: "forwards" });
  setTimeout(() => {
    const out = t.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 350, fill: "forwards" });
    out.onfinish = () => t.remove();
  }, 2300);
}
function pct(part, whole) {
  return whole ? Math.round((part / whole) * 100) + "%" : "0%";
}
function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str || "";
  return div.innerHTML;
}
function phoneDigits(phone) {
  return (phone || "").replace(/[^0-9+]/g, "");
}
// Turn "2026-06-30" into "Jun 30".
function formatDateShort(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// ---- Callback date+time helpers ---------------------------------------
// State stores callbackAt as a full ISO (UTC) string; the datetime-local
// input wants a local "YYYY-MM-DDTHH:MM" string. Convert between the two.
function toLocalInputValue(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
// "Today 6:00 PM" for today's callbacks, "Jul 10 6:00 PM" otherwise.
function formatCallback(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (localDateStr(d) === localDateStr()) return "Today " + time;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) + " " + time;
}
// A callback is overdue once its exact time has passed.
function callbackOverdue(iso) {
  return !!iso && new Date(iso).getTime() < Date.now();
}
// Simple deterministic hash so the daily hit list rotates predictably.
function hashStr(str) {
  str = String(str);
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return h;
}

// =====================================================================
//  FEED
// =====================================================================
const METHODS = ["Text", "Call", "Stop back in person"];

// Pick up to 5 stop-backs to chase today; rotates day to day.
function dailyHitList() {
  const day = localDateStr();
  const dayIndex = Math.floor(Date.now() / 86400000);
  const candidates = state.leads.filter((l) => l.status === "stopback");

  return candidates
    .map((l) => ({ lead: l, score: hashStr(l.id + day) }))
    .sort((a, b) => a.score - b.score)
    .slice(0, 5)
    .map((item, i) => ({
      lead: item.lead,
      method: METHODS[(dayIndex + i) % METHODS.length],
    }));
}

const dayNumber = () => Math.floor(Date.now() / 86400000);

// =====================================================================
//  ACHIEVEMENTS — computed from real data (you + accepted friends)
//  via get_friends_overview(). No sample data.
// =====================================================================
const SALES_WEEK_TIERS = [20, 15, 10, 5, 3]; // weekly sales milestones
const SB_DAY_TIERS = [20, 15, 10, 5];        // stop backs in one day

// Consecutive days (ending today or yesterday) with at least one sale.
function salesStreakFrom(saleDays) {
  const set = new Set((saleDays || []).map((d) => String(d).slice(0, 10)));
  if (!set.size) return 0;
  const d = new Date();
  if (!set.has(localDateStr(d))) d.setDate(d.getDate() - 1);
  let n = 0;
  while (set.has(localDateStr(d))) {
    n++;
    d.setDate(d.getDate() - 1);
  }
  return n;
}

// Two sales within 60 minutes today. Uses real sold_at timestamps, so
// older sales without one simply don't count.
function twoSalesInHour(times) {
  const t = (times || []).map((x) => new Date(x).getTime()).sort((a, b) => a - b);
  for (let i = 1; i < t.length; i++) if (t[i] - t[i - 1] <= 3600000) return true;
  return false;
}

// Highest tier a value has reached (tiers listed high→low), or 0.
function tierReached(value, tiers) {
  for (const t of tiers) if (value >= t) return t;
  return 0;
}

const CONTACT_DAY_TIERS = [50, 30, 20];      // contacts talked to in one day
const FEED_EVENTS_PER_PERSON = 4;            // keep the feed calm

// Everything one person has earned right now, most significant first,
// capped per person. ids are stable per person + milestone + day/week so
// reaction counts stay consistent across re-renders. Each event carries a
// timestamp label (real time where derivable, "Today"/"This week" otherwise).
function achievementsFor(row) {
  const out = [];
  const day = localDateStr();
  const week = "w" + Math.floor(dayNumber() / 7);
  const uid = row.user_id;
  const g = row.gamify || {};

  // Broke a personal record today (shared via gamify.records).
  const recs = g.records || {};
  const brokeToday = Object.keys(recs).filter(
    (k) => recs[k] && recs[k].date === day && RECORD_LABELS[k]
  );
  if (brokeToday.length) {
    const k = brokeToday[0];
    out.push({ id: `rec-${uid}-${k}-${day}`, banner: `🏆 New personal best — ${RECORD_LABELS[k](recs[k].v)}`, tone: "ink", time: "Today" });
  }

  if (twoSalesInHour(row.sale_times_today)) {
    const times = row.sale_times_today || [];
    const last = times.length ? new Date(times[times.length - 1]) : null;
    out.push({
      id: `hot-${uid}-${day}`, banner: "⚡ 2 sales in one hour", tone: "ink",
      time: last ? last.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "Today",
    });
  }

  // Reached today's goals (goals now shared through the overview).
  if ((row.daily_goal || 0) > 0 && row.stopbacks_today >= row.daily_goal)
    out.push({ id: `goal-${uid}-${day}`, banner: "🎯 Reached today's stop-back goal", tone: "", time: "Today" });
  if ((row.daily_sales_goal || 0) > 0 && row.sales_today >= row.daily_sales_goal)
    out.push({ id: `sgoal-${uid}-${day}`, banner: "💰 Hit today's sales goal", tone: "ink", time: "Today" });

  const salesStreak = salesStreakFrom(row.sale_days);
  if (salesStreak >= 2)
    out.push({ id: `sstreak-${uid}-${salesStreak}`, banner: `💰 ${salesStreak}-day sales streak`, tone: "", time: "Today" });

  // Earned a badge today.
  const badges = g.badges || {};
  const badgeToday = BADGES.find((b) => badges[b.id] === day);
  if (badgeToday)
    out.push({ id: `bdg-${uid}-${badgeToday.id}`, banner: `${badgeToday.icon} Earned "${badgeToday.name}"`, tone: "ink", time: "Today" });

  // Passed yesterday's stop-back total.
  if ((row.stopbacks_yesterday || 0) > 0 && row.stopbacks_today > row.stopbacks_yesterday)
    out.push({
      id: `pyd-${uid}-${day}`, banner: "📈 Passed yesterday's total", tone: "",
      time: `${row.stopbacks_today} vs ${row.stopbacks_yesterday}`,
    });

  const wkTier = tierReached(row.sales_week, SALES_WEEK_TIERS);
  if (wkTier)
    out.push({ id: `wk-${uid}-${wkTier}-${week}`, banner: `🏆 ${row.sales_week} sales this week`, tone: "ink", time: "This week" });

  const sbTier = tierReached(row.stopbacks_today, SB_DAY_TIERS);
  if (sbTier)
    out.push({ id: `sbd-${uid}-${sbTier}-${day}`, banner: `🚪 ${row.stopbacks_today} stop backs today`, tone: "", time: "Today" });

  const contacts = (row.contact_taps_today || 0) + (row.stopbacks_today || 0);
  const cTier = tierReached(contacts, CONTACT_DAY_TIERS);
  if (cTier)
    out.push({ id: `cd-${uid}-${cTier}-${day}`, banner: `💪 ${contacts} contacts today`, tone: "", time: "Today" });

  if (row.current_streak >= 2)
    out.push({ id: `login-${uid}-${row.current_streak}`, banner: `🔥 ${row.current_streak}-day streak`, tone: "", time: "Today" });

  return out.slice(0, FEED_EVENTS_PER_PERSON);
}

// One achievement rendered as a feed card (same style for you + friends).
function achievementPost(row, a) {
  const who = row.is_self ? state.profile.name || "You" : row.display_name || "@" + row.username;
  const tag = `${row.is_self ? "Your highlight" : "@" + (row.username || "")} · ${a.time || "Today"}`;
  const node = el(`
    <article class="post ${row.is_self ? "post-highlight" : "post-friend"}">
      <div class="post-head">
        <span class="avatar ${row.is_self ? "avatar-you" : ""}"${row.is_self ? "" : ' style="background:var(--green-deep)"'}>${initials(who)}</span>
        <div><span class="post-author">${escapeHtml(who)}</span><span class="post-tag">${escapeHtml(tag)}</span></div>
      </div>
      <div class="highlight-banner ${a.tone}">${a.banner}</div>
      <div class="post-foot"><button class="react" type="button">🔥 <span>0</span></button></div>
    </article>`);
  attachReact(node, a.id);
  return node;
}

// ---- Tiny DOM + like helpers -----------------------------------------
function el(html) {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}
function initials(name) {
  return name.split(" ").filter(Boolean).map((w) => w[0]).slice(0, 2).join("").toUpperCase() || "?";
}
function baseLikes(id) {
  return (hashStr(id) % 18) + 3; // stable 3..20 per post
}
function likeCount(id) {
  return baseLikes(id) + (state.likes["like:" + id] ? 1 : 0);
}
function attachReact(node, id) {
  const btn = node.querySelector(".react");
  if (!btn) return;
  const set = () => {
    const liked = !!state.likes["like:" + id];
    btn.classList.toggle("liked", liked);
    btn.querySelector("span").textContent = likeCount(id);
  };
  set();
  btn.onclick = () => {
    state.likes["like:" + id] = !state.likes["like:" + id];
    save();
    set();
  };
}

// ---- Post builders (return an element, or null to skip) --------------

// THE feature card of the feed: who to hit today. Scheduled callbacks that
// are due today / overdue are pinned on top (soonest first, time shown);
// rotating picks fill the remaining slots up to 5. No selling advice —
// just people and the action.
function hitListPost() {
  const due = dueCallbacks();
  const dueIds = new Set(due.map((l) => l.id));
  const picks = dailyHitList().filter((h) => !dueIds.has(h.lead.id));

  const rows = due.map((l) => ({
    lead: l,
    label: (callbackOverdue(l.callbackAt) ? "Overdue — " : "Scheduled — ") + formatCallback(l.callbackAt),
    isCallback: true,
    overdue: callbackOverdue(l.callbackAt),
  }));
  picks.forEach((h) => {
    if (rows.length < 5) rows.push({ lead: h.lead, label: h.method, isCallback: false });
  });

  const node = el(`
    <article class="post post-hitlist">
      <div class="post-head">
        <span class="avatar avatar-ai big">🎯</span>
        <div>
          <span class="post-author hl-heading">Today's Hit List</span>
          <span class="post-tag">Who to text, call, or stop back today</span>
        </div>
      </div>
      <div class="hl-rows"></div>
      <p class="empty-hint" hidden>No one to chase yet — get a number and they'll show up here. 🚪</p>
    </article>`);

  const rowsEl = node.querySelector(".hl-rows");
  if (!rows.length) {
    node.querySelector(".empty-hint").hidden = false;
    return node;
  }

  rows.forEach((r, i) => {
    const digits = phoneDigits(r.lead.phone);
    const icon = r.isCallback ? "📞" : r.label === "Text" ? "📱" : r.label === "Call" ? "📞" : "🚪";
    const row = el(`
      <div class="hit">
        <span class="hit-rank${r.isCallback ? " urgent" : ""}">${i + 1}</span>
        <div class="hit-info">
          <div class="hit-name">${escapeHtml(r.lead.name)}</div>
          <div class="hit-method${r.overdue ? " due" : ""}">${icon} ${escapeHtml(r.label)}${r.lead.address ? " · " + escapeHtml(r.lead.address) : ""}</div>
        </div>
        <div class="hit-actions">
          <a href="tel:${digits}">Call</a>
          <a href="sms:${digits}">Text</a>
          ${r.isCallback ? '<button class="cb-done" type="button">Done</button>' : ""}
        </div>
      </div>`);
    const done = row.querySelector(".cb-done");
    if (done)
      done.onclick = () => {
        r.lead.callbackAt = "";
        render();
        dbUpdateLead(r.lead.id, { callback_at: "" }).catch(dbFail("Couldn't update callback"));
      };
    rowsEl.appendChild(row);
  });
  return node;
}

function weeklyRecapPost() {
  const weekAgo = Date.now() - 7 * 86400000;
  const recent = state.leads.filter((l) => new Date(l.createdAt).getTime() >= weekAgo);
  const sales = recent.filter((l) => l.status === "sale").length;
  const missed = recent.filter((l) => l.status === "missed").length;
  return el(`
    <article class="post">
      <div class="post-head">
        <span class="avatar avatar-you">${initials(state.profile.name || "You")}</span>
        <div><span class="post-author">Your Week</span><span class="post-tag">Last 7 days</span></div>
      </div>
      <div class="recap-grid">
        <div class="recap"><span class="recap-num green">${recent.length}</span><span class="recap-label">Stop backs</span></div>
        <div class="recap"><span class="recap-num green">${sales}</span><span class="recap-label">Sales</span></div>
        <div class="recap"><span class="recap-num red">${missed}</span><span class="recap-label">Missed</span></div>
      </div>
    </article>`);
}

// Gentle nudge when a live streak hasn't been fed today.
function streakRiskPost() {
  const streak = currentStreak();
  if (streak <= 0 || state.activeDays.includes(localDateStr())) return null;
  return el(`
    <article class="post post-risk">
      <div class="post-head">
        <span class="avatar" style="background:var(--amber)">🔥</span>
        <div><span class="post-author">Streak at risk</span><span class="post-tag">Keep it alive</span></div>
      </div>
      <p class="post-body">Log 1 door to keep your <strong>${streak}-day streak</strong> going.</p>
    </article>`);
}

// One goal ring (SVG) with the count centered and a label underneath.
// The real end offset is stashed in data-offset so the fill can animate in.
// Once the original goal is achieved the ring goes GOLD, stays pinned full,
// and the target rolls to value+1 forever (5/5 → 5/6 → 6/7 …).
function ringHtml(value, goal, cls, label, animate) {
  const achieved = value >= goal;
  const shownGoal = achieved ? value + 1 : goal;
  const r = 30;
  const circ = 2 * Math.PI * r;
  const offset = achieved ? 0 : circ * (1 - Math.min(value / goal, 1));
  const startOffset = animate ? circ : offset;
  return `
    <div class="goal-col${achieved ? " gold" : ""}">
      <div class="goal-ring" data-offset="${offset.toFixed(1)}">
        <svg viewBox="0 0 72 72">
          <circle class="ring-bg" cx="36" cy="36" r="${r}"></circle>
          <circle class="ring-fg ${cls}" cx="36" cy="36" r="${r}"
            stroke-dasharray="${circ.toFixed(1)}" stroke-dashoffset="${startOffset.toFixed(1)}"></circle>
        </svg>
        <div class="goal-ring-center">
          <span class="goal-num">${value}</span><span class="goal-of">/ ${shownGoal}</span>
        </div>
      </div>
      <span class="goal-label">${label}</span>
    </div>`;
}

// Twin progress rings: today's stop backs AND sales vs your daily goals.
function goalPost(animate) {
  const sbGoal = state.profile.dailyGoal || 0;
  const sGoal = state.profile.salesGoal || 0;
  if (sbGoal <= 0 && sGoal <= 0) return null;

  const today = localDateStr();
  const todayLeads = state.leads.filter((l) => localDateStr(new Date(l.createdAt)) === today);
  const sb = todayLeads.length;
  const sales = state.leads.filter(
    (l) => l.status === "sale" && localDateStr(new Date(l.soldAt || l.createdAt)) === today
  ).length;

  const rings = [];
  if (sbGoal > 0) rings.push(ringHtml(sb, sbGoal, "", "Stop backs", animate));
  if (sGoal > 0) rings.push(ringHtml(sales, sGoal, "sales", "Sales", animate));

  const sbDone = sbGoal > 0 && sb >= sbGoal;
  const sDone = sGoal > 0 && sales >= sGoal;
  const anyDone = sbDone || sDone;
  const allDone = (sbGoal <= 0 || sbDone) && (sGoal <= 0 || sDone);

  // Once a goal is achieved the message flips to hype and never resets today.
  const remaining = [
    sbGoal > 0 && !sbDone ? `${sbGoal - sb} stop back${sbGoal - sb > 1 ? "s" : ""}` : "",
    sGoal > 0 && !sDone ? `${sGoal - sales} sale${sGoal - sales > 1 ? "s" : ""}` : "",
  ].filter(Boolean).join(" and ");
  const hype = `<strong class="hype">${hypeLine("goal" + sb + "-" + sales + localDateStr())}</strong>`;
  const msg = allDone
    ? hype
    : anyDone
    ? `${hype} ${remaining} to go today.`
    : `${remaining} to go today.`;

  const node = el(`
    <article class="post post-goal${anyDone ? " gold" : ""}">
      <div class="goal-cols">${rings.join("")}</div>
      <div class="goal-text">
        <span class="post-tag">Today's goals</span>
        <p class="post-body">${msg}</p>
      </div>
    </article>`);

  if (animate) {
    // Two rAFs so the browser paints the empty rings before filling them.
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        node.querySelectorAll(".goal-ring").forEach((g) => {
          g.querySelector(".ring-fg").style.strokeDashoffset = g.dataset.offset;
        });
      })
    );
  }
  return node;
}

// ---- Daily pace indicator ------------------------------------------------
// Projects today's finish from the rep's actual rate so far. Day window:
// first logged lead today (fallback 9 AM) through PACE_DAY_END_HOUR.
const PACE_DAY_END_HOUR = 21; // selling day assumed done by 9 PM

function pacePost() {
  const goal = state.profile.dailyGoal || 0;
  if (goal <= 0) return null;

  const sb = stopbacksToday();
  const now = new Date();
  const todayLeads = state.leads.filter(
    (l) => localDateStr(new Date(l.createdAt)) === localDateStr()
  );

  let start = new Date();
  start.setHours(9, 0, 0, 0);
  if (todayLeads.length) {
    const first = Math.min(...todayLeads.map((l) => new Date(l.createdAt).getTime()));
    if (first < start.getTime()) start = new Date(first);
  }
  const end = new Date();
  end.setHours(PACE_DAY_END_HOUR, 0, 0, 0);

  let msg;
  let gold = false;
  if (now >= end) {
    msg = sb >= goal
      ? `Day's done — goal completed with <strong>${sb}</strong>.`
      : `Day's done — <strong>${sb}</strong> on the board.`;
  } else if (sb === 0) {
    msg = "Log your first door to start today's pace.";
  } else {
    const elapsedH = Math.max(0.25, (now - start) / 3600000);
    const remainingH = Math.max(0, (end - now) / 3600000);
    const projected = Math.round(sb + (sb / elapsedH) * remainingH);
    if (sb >= goal) {
      gold = true;
      msg = `Completed today's goal. On pace for <strong>${Math.max(projected, sb)}</strong> today.`;
    } else {
      const frac = Math.min(1, Math.max(0, (now - start) / Math.max(1, end - start)));
      const expected = Math.ceil(goal * frac);
      const diff = sb - expected;
      if (diff >= 0) {
        msg = `Ahead of pace — on track for <strong>${Math.max(projected, goal)}</strong> stop-backs today.`;
      } else {
        const next = new Date(now);
        next.setMinutes(0, 0, 0);
        next.setHours(next.getHours() + 1);
        const nextLabel = next.toLocaleTimeString([], { hour: "numeric" });
        msg = `Behind pace by <strong>${-diff}</strong>. ${-diff} more before ${nextLabel} keeps today's goal in reach.`;
      }
    }
  }

  return el(`
    <article class="post post-pace${gold ? " gold-edge" : ""}">
      <div class="post-head">
        <span class="avatar avatar-ai">⏱</span>
        <div><span class="post-author">Pace</span><span class="post-tag">Based on today so far</span></div>
      </div>
      <p class="post-body">${msg}</p>
    </article>`);
}

// ---- Friends leaderboard -----------------------------------------------
// Reads the already-loaded friendsOverview (today/week/all-time counts +
// streaks). Range clicks repaint only this card's rows — no full feed
// re-render, so scroll position is untouched. Both Stop Backs and Sales are
// always shown with an effort-first sort, so there's no metric toggle.
let lbRange = "today";      // today | week | all

function lbValue(row, metric, range) {
  return row[metric + "_" + (range === "all" ? "all" : range)] || 0;
}

// Effort-first ranking: stop backs, then sales, then name. Shared by the
// friends + team boards.
function rankRows(rows, range) {
  return [...rows].sort(
    (a, b) =>
      lbValue(b, "stopbacks", range) - lbValue(a, "stopbacks", range) ||
      lbValue(b, "sales", range) - lbValue(a, "sales", range) ||
      (a.display_name || a.username || "").localeCompare(b.display_name || b.username || "")
  );
}

// One leaderboard row's markup — always shows BOTH stats (SB is the primary
// effort metric). Shared by the friends + team boards.
function lbRowHtml(r, i, range) {
  const who = r.is_self ? "You" : r.display_name || "@" + (r.username || "");
  const crown = r.role === "owner" ? ` <span class="tm-crown" title="Team owner">👑</span>` : "";
  const medal = i === 0 ? " lb-gold" : i === 1 ? " lb-silver" : i === 2 ? " lb-bronze" : "";
  return `
    <div class="lb-row${r.is_self ? " me" : ""}">
      <span class="lb-rank${medal}">${i + 1}</span>
      <span class="avatar ${r.is_self ? "avatar-you" : ""}" ${r.is_self ? "" : 'style="background:var(--green-deep)"'}>${initials(r.display_name || r.username || "?")}</span>
      <span class="lb-name">${escapeHtml(who)}${crown}${r.current_streak > 0 ? ` <span class="lb-streak">🔥${r.current_streak}</span>` : ""}</span>
      <span class="lb-stat primary">${lbValue(r, "stopbacks", range)}<em>SB</em></span>
      <span class="lb-stat">${lbValue(r, "sales", range)}<em>Sales</em></span>
    </div>`;
}

function leaderboardPost() {
  const rows = friendsOverview || [];
  if (!rows.length) return null;

  const node = el(`
    <article class="post post-leaderboard">
      <div class="post-head">
        <span class="avatar avatar-ai">🏅</span>
        <div><span class="post-author">Leaderboard</span><span class="post-tag">You vs your crew</span></div>
      </div>
      <div class="seg lb-seg">
        <button type="button" class="seg-btn" data-v="today">Today</button>
        <button type="button" class="seg-btn" data-v="week">This Week</button>
        <button type="button" class="seg-btn" data-v="all">All Time</button>
      </div>
      <div class="lb-rows"></div>
      <p class="muted small lb-hint" hidden>Add friends to make this a race. 🏁</p>
    </article>`);

  const paint = () => {
    node.querySelectorAll(".lb-seg .seg-btn").forEach((b) =>
      b.classList.toggle("active", b.dataset.v === lbRange)
    );
    node.querySelector(".lb-rows").innerHTML = rankRows(rows, lbRange)
      .map((r, i) => lbRowHtml(r, i, lbRange))
      .join("");
    node.querySelector(".lb-hint").hidden = rows.length > 1;
  };

  node.querySelectorAll(".lb-seg .seg-btn").forEach((b) => (b.onclick = () => { lbRange = b.dataset.v; paint(); }));
  paint();
  return node;
}

// ---- Teams (company crews — migration 5) --------------------------------
// A manager ("owner") creates a team; reps join with a code. Everyone on the
// team shares aggregate stats, so the board + insights always fill. Data lives
// in module vars (like the friends caches), not in `state`.
let myTeams = [];        // get_my_teams()
let activeTeamId = null;  // which team the Feed board/insights show
let teamOverview = [];    // get_team_overview(activeTeamId)

async function refreshTeams() {
  if (!window.sb) return;
  try {
    myTeams = await dbGetMyTeams();
    if (!myTeams.some((t) => t.id === activeTeamId))
      activeTeamId = myTeams[0] ? myTeams[0].id : null;
    teamOverview = activeTeamId ? await dbGetTeamOverview(activeTeamId) : [];
  } catch (err) {
    console.error("[StopBack] Couldn't load teams:", err);
    myTeams = [];
    teamOverview = [];
  }
  renderFeed();
  if (!document.getElementById("view-teams").hidden) renderTeamManager();
}

function activeTeam() {
  return myTeams.find((t) => t.id === activeTeamId) || null;
}

async function setActiveTeam(id) {
  activeTeamId = id;
  try {
    teamOverview = await dbGetTeamOverview(id);
  } catch (_) {
    teamOverview = [];
  }
  renderFeed();
  renderTeamManager();
}

// 12am / 4pm style labels for the "best time of day" insight (viewer-local).
function hourLabel(h) {
  const ap = h < 12 ? "am" : "pm";
  let hr = h % 12;
  if (hr === 0) hr = 12;
  return hr + ap;
}

// Peak 2-hour selling window from real sold_at stamps, bucketed by LOCAL hour
// (correct for the viewer's timezone). Needs a few sales to be meaningful.
function bestSaleWindow(times) {
  if (!times || times.length < 4) return null;
  const buckets = new Array(24).fill(0);
  times.forEach((t) => { buckets[new Date(t).getHours()]++; });
  let best = -1, at = 0;
  for (let h = 0; h < 24; h++) {
    const sum = buckets[h] + buckets[(h + 1) % 24];
    if (sum > best) { best = sum; at = h; }
  }
  if (best <= 0) return null;
  return { start: at, end: (at + 2) % 24, count: best };
}

// ---- Team leaderboard (Feed) --------------------------------------------
// Same look as the friends board, but scoped to the active team. The header
// carries an Insights button (opens the trends modal) and the whole card opens
// the Team Info view; the owner's crown shows on their row.
let tlbRange = "today";      // today | week | all

// Team avatar: the uploaded company logo if present, else the default 🏢.
function teamLogoHtml(team, cls) {
  if (team && team.logo_url)
    return `<span class="${cls} has-logo"><img src="${escapeHtml(team.logo_url)}" alt="${escapeHtml(team.name || "Team")} logo"></span>`;
  return `<span class="${cls}">🏢</span>`;
}

function teamLeaderboardPost() {
  const team = activeTeam();
  const rows = teamOverview || [];
  if (!team || !rows.length) return null;

  const node = el(`
    <article class="post post-leaderboard post-team">
      <div class="post-head team-post-head">
        ${teamLogoHtml(team, "avatar avatar-team")}
        <button type="button" class="team-title-btn" aria-label="Open ${escapeHtml(team.name)} team info">
          <span class="post-author">${escapeHtml(team.name)}</span><span class="post-tag">Team ranking · tap for info</span>
        </button>
        <button type="button" class="team-insights-btn">📊 Insights</button>
      </div>
      <div class="seg lb-seg">
        <button type="button" class="seg-btn" data-v="today">Today</button>
        <button type="button" class="seg-btn" data-v="week">This Week</button>
        <button type="button" class="seg-btn" data-v="all">All Time</button>
      </div>
      <div class="lb-rows"></div>
      <p class="muted small lb-hint" hidden>Share code <strong>${escapeHtml(team.join_code || "")}</strong> to fill out the board. 🏁</p>
    </article>`);

  const paint = () => {
    node.querySelectorAll(".lb-seg .seg-btn").forEach((b) =>
      b.classList.toggle("active", b.dataset.v === tlbRange)
    );
    node.querySelector(".lb-rows").innerHTML = rankRows(rows, tlbRange)
      .map((r, i) => lbRowHtml(r, i, tlbRange))
      .join("");
    node.querySelector(".lb-hint").hidden = rows.length > 1;
  };

  node.querySelectorAll(".lb-seg .seg-btn").forEach((b) =>
    (b.onclick = (e) => { e.stopPropagation(); tlbRange = b.dataset.v; paint(); }));
  node.querySelector(".team-insights-btn").onclick = (e) => { e.stopPropagation(); openTeamInsights(); };
  node.querySelector(".team-title-btn").onclick = (e) => { e.stopPropagation(); openTeamInfo(team.id); };
  // Clicking the card background (but not a control or a member row) opens info.
  node.addEventListener("click", (e) => {
    if (e.target.closest("button, a, input, .lb-row")) return;
    openTeamInfo(team.id);
  });

  paint();
  return node;
}

// ---- Team insights (modal, opened from the board's Insights button) -----
// Data-driven patterns to help the crew improve — NOT selling advice
// (per CLAUDE.md rule 6). Three angles: close rate vs team, pace/momentum,
// best time of day. Each row only appears when there's enough data.
const TEAM_CLOSE_MIN = 5;   // decided closings (sales+missed) to rate someone

function computeTeamInsights(rows) {
  const me = rows.find((r) => r.is_self);
  if (!me) return [];

  const items = [];

  // 1) Close rate vs the team (30-day window).
  const decided = (r) => (r.sales_month || 0) + (r.missed_month || 0);
  const closeRate = (r) => (decided(r) ? (r.sales_month || 0) / decided(r) : null);
  const rated = rows.filter((r) => decided(r) >= TEAM_CLOSE_MIN);
  if (rated.length && decided(me) >= TEAM_CLOSE_MIN) {
    const mine = closeRate(me);
    const avg = rated.reduce((s, r) => s + closeRate(r), 0) / rated.length;
    const pct = (v) => Math.round(v * 100) + "%";
    const rank = [...rated].sort((a, b) => closeRate(b) - closeRate(a)).findIndex((r) => r.is_self) + 1;
    let detail;
    if (mine >= avg) detail = `Your ${pct(mine)} beats the team's ${pct(avg)} average${rank === 1 ? " — #1 on the crew 🥇" : ""}.`;
    else detail = `You're at ${pct(mine)} vs the team's ${pct(avg)} average — room to climb.`;
    items.push({ icon: "🎯", label: "Close rate", detail });
  }

  // 2) Pace & momentum (this week's effort vs last week's).
  const change = (r) => {
    const prev = r.stopbacks_prev_week || 0;
    if (prev <= 0) return null;
    return ((r.stopbacks_week || 0) - prev) / prev;
  };
  const myChange = change(me);
  if (myChange !== null && Math.abs(myChange) >= 0.1) {
    const p = Math.round(Math.abs(myChange) * 100);
    items.push({
      icon: myChange > 0 ? "📈" : "📉",
      label: "Your momentum",
      detail: myChange > 0
        ? `Stop backs up ${p}% vs last week — you're heating up.`
        : `Stop backs down ${p}% vs last week — time to push the doors.`,
    });
  } else if (rows.length > 1) {
    // No personal signal? Spotlight the crew's biggest mover instead.
    const movers = rows.map((r) => ({ r, c: change(r) })).filter((m) => m.c !== null && m.c > 0.1);
    if (movers.length) {
      const top = movers.sort((a, b) => b.c - a.c)[0];
      const who = top.r.is_self ? "You're" : (top.r.display_name || "@" + top.r.username) + " is";
      items.push({ icon: "🚀", label: "On the rise", detail: `${escapeHtml(who)} up ${Math.round(top.c * 100)}% in stop backs this week.` });
    }
  }

  // 3) Best time of day (from real sale timestamps, viewer-local hours).
  const myWindow = bestSaleWindow(me.sale_times_month);
  if (myWindow) {
    items.push({
      icon: "⏰",
      label: "Your window",
      detail: `You close most between ${hourLabel(myWindow.start)}–${hourLabel(myWindow.end)}. Load your route there.`,
    });
  } else {
    // Not enough of the rep's own sales? Show the team's peak window.
    const allTimes = rows.flatMap((r) => r.sale_times_month || []);
    const teamWindow = bestSaleWindow(allTimes);
    if (teamWindow)
      items.push({ icon: "⏰", label: "Team's window", detail: `The crew closes most between ${hourLabel(teamWindow.start)}–${hourLabel(teamWindow.end)}.` });
  }

  return items;
}

// ---- Team Intelligence dashboard ----------------------------------------
// The manager-facing view of the same aggregates the board already loads.
// Four tabs: Overview (KPIs + funnel), Crew (scorecard + signals), Timing
// (closing windows + 30-day trend), You (the personal read above).
//
// Charts are hand-rolled HTML/SVG — no chart library (rule 5, no build step).
// Colors come from the validated chart tokens in style.css: a single-hue
// green sequential ramp for the funnel, emphasis (one green mark, the rest
// muted) for comparisons. Green and amber sit in the CVD floor band, so any
// two-series mark is ALWAYS direct-labeled — never color alone.
//
// Everything here is derived from get_team_overview's existing columns, so
// no migration is needed. contacts_month in particular was previously
// loaded and never used — it's what makes a real funnel possible.

let tdTab = "overview";           // overview | crew | timing | you

// Sum a column across the crew.
function tdSum(rows, key) { return rows.reduce((s, r) => s + (r[key] || 0), 0); }

// Percent, guarding divide-by-zero. Returns null when there's no denominator.
function tdRate(num, den) { return den > 0 ? num / den : null; }
function tdPct(v, digits = 0) { return v === null ? "—" : (v * 100).toFixed(digits) + "%"; }

// Week-over-week change for a metric across the crew.
function tdDelta(rows, weekKey, prevKey) {
  const now = tdSum(rows, weekKey), prev = tdSum(rows, prevKey);
  if (prev <= 0) return null;
  return (now - prev) / prev;
}

// A delta chip: green up / red down / muted flat. Arrow + sign carry the
// direction too, so it never reads by color alone.
function tdDeltaHtml(d) {
  if (d === null || !isFinite(d)) return `<span class="td-delta is-flat">no prior week</span>`;
  const p = Math.round(Math.abs(d) * 100);
  if (p < 1) return `<span class="td-delta is-flat">→ flat</span>`;
  const up = d > 0;
  return `<span class="td-delta ${up ? "is-up" : "is-down"}">${up ? "↑" : "↓"} ${p}% vs last week</span>`;
}

function tdName(r) { return r.display_name || "@" + (r.username || "rep"); }

// ---- Charts -------------------------------------------------------------

// Funnel: Contacts → Stop Backs → Sales as horizontal bars on one shared
// scale (bar length is honestly proportional to the count), with the
// conversion rate called out between stages. Single-hue ramp, deeper = later
// in the funnel. Every bar is direct-labeled, which is also the required
// relief for the lightest step's contrast on cream.
function tdFunnelHtml(stages) {
  const max = Math.max(1, ...stages.map((s) => s.value));
  return `<div class="td-funnel">${stages.map((s, i) => {
    const prev = i > 0 ? stages[i - 1] : null;
    const conv = prev ? tdRate(s.value, prev.value) : null;
    const step = `<div class="td-fn-step">
        <div class="td-fn-label"><span>${escapeHtml(s.label)}</span><b>${s.value.toLocaleString()}</b></div>
        <div class="td-fn-track">
          <div class="td-fn-bar td-fill-${i + 1}" style="width:${Math.max(2, (s.value / max) * 100)}%"
               data-tip="${escapeHtml(s.label)}: ${s.value.toLocaleString()}"></div>
        </div>
      </div>`;
    const link = conv === null ? "" :
      `<div class="td-fn-conv"><span class="td-fn-arrow" aria-hidden="true">↓</span>
         <span>${tdPct(conv, conv < 0.1 ? 1 : 0)} of ${escapeHtml(prev.label.toLowerCase())} became ${escapeHtml(s.label.toLowerCase())}</span>
       </div>`;
    return (i > 0 ? link : "") + step;
  }).join("")}</div>`;
}

// Closing windows: sales by hour of day, 8am–9pm, viewer-local. Emphasis
// form — the peak two-hour block is the accent green, every other hour is
// the muted track color, so the one thing that matters pops without a
// legend. Hours with no sales still render an empty column (an absent bar
// is data too).
const TD_HOUR_FROM = 8, TD_HOUR_TO = 21;
function tdHoursHtml(times, peak) {
  const buckets = new Array(24).fill(0);
  (times || []).forEach((t) => { buckets[new Date(t).getHours()]++; });
  const span = [];
  for (let h = TD_HOUR_FROM; h <= TD_HOUR_TO; h++) span.push(h);
  const max = Math.max(1, ...span.map((h) => buckets[h]));
  const inPeak = (h) => peak && (h === peak.start || h === (peak.start + 1) % 24);
  const cols = span.map((h) => {
    const n = buckets[h];
    const pctH = (n / max) * 100;
    return `<div class="td-hr-col">
        <div class="td-hr-track">
          <div class="td-hr-bar ${inPeak(h) ? "is-peak" : ""}" style="height:${n ? Math.max(4, pctH) : 0}%"
               data-tip="${hourLabel(h)}–${hourLabel((h + 1) % 24)}: ${n} sale${n === 1 ? "" : "s"}"></div>
        </div>
        <span class="td-hr-lab">${h % 3 === 0 ? hourLabel(h).replace(":00", "") : ""}</span>
      </div>`;
  }).join("");
  return `<div class="td-hours">${cols}</div>`;
}

// 30-day sales trend: area + line, one series, so no legend — the card
// title names it. Points are hoverable for the exact day. Rendered in a
// viewBox so it scales to any card width; strokes stay 2px via
// vector-effect, per the mark spec.
function tdTrendHtml(times, days = 30) {
  const byDay = new Map();
  (times || []).forEach((t) => {
    const k = localDateStr(new Date(t));
    byDay.set(k, (byDay.get(k) || 0) + 1);
  });
  const pts = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(dayStart(i));
    pts.push({ key: localDateStr(d), date: d, v: byDay.get(localDateStr(d)) || 0 });
  }
  const total = pts.reduce((s, p) => s + p.v, 0);
  if (!total) return `<p class="empty-hint" style="margin:0">No timestamped sales in the last ${days} days yet.</p>`;

  const W = 320, H = 90, PAD = 6;
  const max = Math.max(1, ...pts.map((p) => p.v));
  const x = (i) => PAD + (i * (W - PAD * 2)) / (pts.length - 1);
  const y = (v) => H - PAD - (v / max) * (H - PAD * 2);
  const line = pts.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join(" ");
  const area = `${line} L${x(pts.length - 1).toFixed(1)},${H - PAD} L${x(0).toFixed(1)},${H - PAD} Z`;
  // Only the peak day gets a dot + label — never a number on every point.
  const peakI = pts.reduce((bi, p, i) => (p.v > pts[bi].v ? i : bi), 0);
  const dots = pts.map((p, i) => `
    <circle class="td-tr-dot ${i === peakI ? "is-peak" : ""}" cx="${x(i).toFixed(1)}" cy="${y(p.v).toFixed(1)}"
            r="${i === peakI ? 3.5 : 2.2}"
            data-tip="${formatDateShort(p.key)}: ${p.v} sale${p.v === 1 ? "" : "s"}"></circle>`).join("");

  return `
    <svg class="td-trend" viewBox="0 0 ${W} ${H}" role="img"
         aria-label="Team sales per day over the last ${days} days, ${total} total, peak ${pts[peakI].v} on ${formatDateShort(pts[peakI].key)}">
      <path class="td-tr-area" d="${area}"></path>
      <path class="td-tr-line" d="${line}"></path>
      ${dots}
    </svg>
    <div class="td-axis"><span>${formatDateShort(pts[0].key)}</span><span>${formatDateShort(pts[pts.length - 1].key)}</span></div>`;
}

// ---- Crew signals -------------------------------------------------------
// Operational patterns about ACTIVITY — who to check on, who's climbing.
// Never advice on how to sell (rule 6): the app surfaces the pattern, the
// team lead decides what to do about it.
function tdSignals(rows) {
  const out = [];
  const wow = (r) => {
    const prev = r.stopbacks_prev_week || 0;
    return prev > 0 ? ((r.stopbacks_week || 0) - prev) / prev : null;
  };

  // Biggest climber this week.
  const climbers = rows.map((r) => ({ r, c: wow(r) })).filter((m) => m.c !== null && m.c >= 0.2);
  if (climbers.length) {
    const top = climbers.sort((a, b) => b.c - a.c)[0];
    out.push({ icon: "🚀", tone: "good", label: "Biggest climber",
      detail: `${tdName(top.r)} is up ${Math.round(top.c * 100)}% in stop backs vs last week.` });
  }

  // Went quiet — logged this month, nothing in the last 7 days. Checked
  // BEFORE "cooling off" so a rep at zero is reported once, as the stronger
  // signal, instead of also showing up as "down 100%".
  const quiet = rows.filter((r) => (r.stopbacks_week || 0) === 0 && (r.stopbacks_month || 0) > 0);
  const isQuiet = new Set(quiet.map((r) => r.user_id));

  // Cooling off — still working, but well down on last week.
  const cooling = rows.filter((r) => !isQuiet.has(r.user_id)).map((r) => ({ r, c: wow(r) }))
    .filter((m) => m.c !== null && m.c <= -0.3 && (m.r.stopbacks_prev_week || 0) >= 3);
  if (cooling.length) {
    const worst = cooling.sort((a, b) => a.c - b.c)[0];
    out.push({ icon: "📉", tone: "warn", label: "Cooling off",
      detail: `${tdName(worst.r)} is down ${Math.round(Math.abs(worst.c) * 100)}% in stop backs vs last week.` });
  }

  if (quiet.length) {
    out.push({ icon: "🌙", tone: "warn", label: "Went quiet",
      detail: quiet.length === 1
        ? `${tdName(quiet[0])} hasn't logged a stop back in the last 7 days.`
        : `${quiet.length} reps haven't logged a stop back in the last 7 days: ${quiet.slice(0, 3).map(tdName).join(", ")}${quiet.length > 3 ? "…" : ""}.`});
  }

  // Knocking hard, converting light: above-median contacts, below-crew
  // contact→stop-back rate. A workload pattern, not a sales critique.
  const withContacts = rows.filter((r) => (r.contacts_month || 0) >= 20);
  if (withContacts.length >= 2) {
    const crewRate = tdRate(tdSum(rows, "stopbacks_month"), tdSum(rows, "contacts_month"));
    const sorted = [...withContacts].sort((a, b) => (b.contacts_month || 0) - (a.contacts_month || 0));
    const median = sorted[Math.floor(sorted.length / 2)].contacts_month || 0;
    const lagging = withContacts
      .map((r) => ({ r, rate: tdRate(r.stopbacks_month || 0, r.contacts_month || 0) }))
      .filter((m) => m.rate !== null && crewRate && m.rate < crewRate * 0.6 && (m.r.contacts_month || 0) >= median);
    if (lagging.length) {
      const m = lagging.sort((a, b) => a.rate - b.rate)[0];
      out.push({ icon: "🚪", tone: "warn", label: "Doors aren't the problem",
        detail: `${tdName(m.r)} logged ${m.r.contacts_month} contacts but converts ${tdPct(m.rate, 1)} to stop backs — crew runs ${tdPct(crewRate, 1)}.` });
    }
  }

  // Best closer on decided closings.
  const decided = (r) => (r.sales_month || 0) + (r.missed_month || 0);
  const rated = rows.filter((r) => decided(r) >= TEAM_CLOSE_MIN);
  if (rated.length >= 2) {
    const best = rated.sort((a, b) => (b.sales_month / decided(b)) - (a.sales_month / decided(a)))[0];
    out.push({ icon: "🎯", tone: "good", label: "Best closer",
      detail: `${tdName(best)} closes ${tdPct(best.sales_month / decided(best))} of decided closings this month.` });
  }

  // Longest active streak on the crew.
  const streaks = rows.filter((r) => (r.current_streak || 0) >= 3)
    .sort((a, b) => b.current_streak - a.current_streak);
  if (streaks.length) {
    out.push({ icon: "🔥", tone: "good", label: "Longest streak",
      detail: `${tdName(streaks[0])} is on a ${streaks[0].current_streak}-day logging streak.` });
  }

  return out.slice(0, 5);
}

// ---- Rep scorecard ------------------------------------------------------
// Nine reps is past the point where color can carry identity, so the crew
// comparison is a table (with an inline effort bar per row, emphasis-styled
// on the viewer). Sortable by any column.
let tdSort = { key: "sales_month", dir: -1 };

function tdScorecardHtml(rows) {
  const decided = (r) => (r.sales_month || 0) + (r.missed_month || 0);
  const closeOf = (r) => (decided(r) >= TEAM_CLOSE_MIN ? r.sales_month / decided(r) : null);
  const maxSb = Math.max(1, ...rows.map((r) => r.stopbacks_month || 0));

  const val = (r, k) => (k === "close" ? (closeOf(r) === null ? -1 : closeOf(r)) : (r[k] || 0));
  const sorted = [...rows].sort((a, b) => (val(a, tdSort.key) - val(b, tdSort.key)) * tdSort.dir
    || tdName(a).localeCompare(tdName(b)));

  const cols = [
    { k: "contacts_month", label: "Contacts" },
    { k: "stopbacks_month", label: "Stop backs" },
    { k: "sales_month", label: "Sales" },
    { k: "close", label: "Close %" },
  ];

  const head = `<tr><th scope="col" class="td-sc-name">Rep</th>${cols.map((c) =>
    `<th scope="col"><button type="button" class="td-sc-sort ${tdSort.key === c.k ? "is-on" : ""}" data-sort="${c.k}"
        aria-label="Sort by ${c.label}">${c.label}${tdSort.key === c.k ? (tdSort.dir < 0 ? " ↓" : " ↑") : ""}</button></th>`).join("")}</tr>`;

  const body = sorted.map((r) => {
    const cr = closeOf(r);
    const sb = r.stopbacks_month || 0;
    return `<tr class="${r.is_self ? "is-self" : ""}">
      <th scope="row" class="td-sc-name">
        <span class="td-sc-who">${escapeHtml(tdName(r))}${r.role === "owner" ? ' <span class="tm-crown" title="Team owner">👑</span>' : ""}</span>
        <span class="td-sc-effort" aria-hidden="true"><i style="width:${(sb / maxSb) * 100}%"></i></span>
      </th>
      <td>${(r.contacts_month || 0).toLocaleString()}</td>
      <td>${sb.toLocaleString()}</td>
      <td><b>${(r.sales_month || 0).toLocaleString()}</b></td>
      <td>${cr === null ? `<span class="muted" title="Needs ${TEAM_CLOSE_MIN} decided closings">—</span>` : tdPct(cr)}</td>
    </tr>`;
  }).join("");

  return `<div class="td-scroll"><table class="td-sc">
      <caption class="td-cap">Last 30 days · tap a column to sort</caption>
      <thead>${head}</thead><tbody>${body}</tbody>
    </table></div>`;
}

// ---- Tab renderers ------------------------------------------------------
function tdCard(title, note, inner) {
  return `<section class="td-card">
      <h3 class="td-card-title">${escapeHtml(title)}</h3>
      ${note ? `<p class="td-note">${note}</p>` : ""}
      ${inner}
    </section>`;
}

function tdOverviewHtml(rows) {
  const sales = tdSum(rows, "sales_month");
  const sbs = tdSum(rows, "stopbacks_month");
  const contacts = tdSum(rows, "contacts_month");
  const missed = tdSum(rows, "missed_month");
  const close = tdRate(sales, sales + missed);
  const activeWeek = rows.filter((r) => (r.stopbacks_week || 0) > 0 || (r.sales_week || 0) > 0).length;

  const kpis = [
    { label: "Team sales", value: sales, delta: tdDelta(rows, "sales_week", "sales_prev_week"), hero: true },
    { label: "Stop backs", value: sbs, delta: tdDelta(rows, "stopbacks_week", "stopbacks_prev_week") },
    { label: "Close rate", value: tdPct(close), raw: true,
      sub: `${sales} of ${sales + missed} decided` },
    { label: "Active reps", value: `${activeWeek}/${rows.length}`, raw: true, sub: "logged this week" },
  ];

  const tiles = kpis.map((k) => `
    <div class="td-kpi ${k.hero ? "is-hero" : ""}">
      <span class="td-kpi-lab">${escapeHtml(k.label)}</span>
      <span class="td-kpi-val">${k.raw ? k.value : k.value.toLocaleString()}</span>
      ${k.delta !== undefined ? tdDeltaHtml(k.delta) : `<span class="td-delta is-flat">${escapeHtml(k.sub || "")}</span>`}
    </div>`).join("");

  const funnel = contacts + sbs + sales === 0
    ? `<p class="empty-hint" style="margin:0">Nothing logged in the last 30 days yet.</p>`
    : tdFunnelHtml([
        { label: "Contacts", value: contacts },
        { label: "Stop backs", value: sbs },
        { label: "Sales", value: sales },
      ]) + (missed
        ? `<p class="td-foot"><span class="td-dot td-dot-miss"></span>${missed} missed closing${missed === 1 ? "" : "s"} in the same window — the branch that didn't convert.</p>`
        : "");

  return `<div class="td-kpis">${tiles}</div>
    ${tdCard("Crew funnel", "Last 30 days, whole team. Each stage is what survived the one above it.", funnel)}`;
}

function tdCrewHtml(rows) {
  const signals = tdSignals(rows);
  const sig = signals.length
    ? `<div class="ti-rows">${signals.map((s) => `
        <div class="ti-row">
          <span class="ti-icon tone-${s.tone}">${s.icon}</span>
          <div class="ti-text"><strong>${escapeHtml(s.label)}</strong><span class="muted small">${escapeHtml(s.detail)}</span></div>
        </div>`).join("")}</div>`
    : `<p class="empty-hint" style="margin:0">No standout patterns this week — the crew is steady.</p>`;

  return tdCard("Crew signals", "Activity patterns worth a conversation. What to do about them is your call.", sig)
    + tdCard("Rep scorecard", "", tdScorecardHtml(rows));
}

function tdTimingHtml(rows) {
  const allTimes = rows.flatMap((r) => r.sale_times_month || []);
  const peak = bestSaleWindow(allTimes);
  const hoursNote = peak
    ? `The crew closes most between <b>${hourLabel(peak.start)}–${hourLabel(peak.end)}</b> — ${peak.count} of ${allTimes.length} sales in the last 30 days.`
    : `Not enough timestamped sales yet to call a peak window.`;
  const hours = allTimes.length
    ? tdHoursHtml(allTimes, peak)
    : `<p class="empty-hint" style="margin:0">No timestamped sales in the last 30 days yet.</p>`;

  return tdCard("Closing windows", hoursNote, hours)
    + tdCard("Team sales, last 30 days", "One point per day, whole crew.", tdTrendHtml(allTimes));
}

function tdYouHtml(rows) {
  const items = computeTeamInsights(rows);
  const inner = items.length
    ? `<div class="ti-rows">${items.map((it) => `
        <div class="ti-row">
          <span class="ti-icon">${it.icon}</span>
          <div class="ti-text"><strong>${escapeHtml(it.label)}</strong><span class="muted small">${it.detail}</span></div>
        </div>`).join("")}</div>`
    : `<p class="empty-hint" style="margin:0">Not enough of your own data yet — keep logging and your read fills in. 📈</p>`;

  const me = rows.find((r) => r.is_self);
  const mine = me
    ? tdCard("Your last 30 days", "", tdFunnelHtml([
        { label: "Contacts", value: me.contacts_month || 0 },
        { label: "Stop backs", value: me.stopbacks_month || 0 },
        { label: "Sales", value: me.sales_month || 0 },
      ]))
    : "";

  return tdCard("Your read", "How you're tracking against the crew.", inner) + mine;
}

function renderTeamDash() {
  const rows = teamOverview || [];
  const body = document.getElementById("tin-body");
  if (!body) return;

  if (!rows.length) {
    body.innerHTML = `<p class="empty-hint" style="margin:0">No crew data yet. Share your join code and the dashboard fills in. 📈</p>`;
    return;
  }

  body.innerHTML =
    tdTab === "crew" ? tdCrewHtml(rows) :
    tdTab === "timing" ? tdTimingHtml(rows) :
    tdTab === "you" ? tdYouHtml(rows) :
    tdOverviewHtml(rows);

  // Sortable scorecard headers repaint just this tab.
  body.querySelectorAll(".td-sc-sort").forEach((btn) => {
    btn.onclick = () => {
      const k = btn.dataset.sort;
      if (tdSort.key === k) tdSort.dir *= -1;
      else tdSort = { key: k, dir: -1 };
      renderTeamDash();
    };
  });
}

function openTeamInsights() {
  const team = activeTeam();
  const logo = document.getElementById("tin-logo");
  if (team) {
    document.getElementById("tin-title").textContent = team.name;
    logo.classList.toggle("has-logo", !!team.logo_url);
    logo.innerHTML = team.logo_url
      ? `<img src="${escapeHtml(team.logo_url)}" alt="${escapeHtml(team.name)} logo">` : "🏢";
    const n = (teamOverview || []).length;
    document.getElementById("tin-sub").textContent =
      `Crew performance · ${n} rep${n === 1 ? "" : "s"} · last 30 days`;
  }
  tdTab = "overview";
  document.querySelectorAll("#tin-tabs .td-tab").forEach((b) => {
    const on = b.dataset.tdtab === "overview";
    b.classList.toggle("is-on", on);
    b.setAttribute("aria-selected", on ? "true" : "false");
  });
  renderTeamDash();
  openModal("team-insights-modal");
}

// ---- Modal helpers ------------------------------------------------------
function openModal(id) { const m = document.getElementById(id); if (m) m.hidden = false; }
function closeModal(id) { const m = document.getElementById(id); if (m) m.hidden = true; }

// ---- Team Info view (modal) ---------------------------------------------
// Opened by clicking the team card/name. Shows name, logo, description, owner,
// and the full member directory with emails (server only returns these to
// members of the same team).
async function openTeamInfo(teamId) {
  const team = myTeams.find((t) => t.id === teamId);
  if (!team) return;

  document.getElementById("ti-title").textContent = team.name;
  const logo = document.getElementById("ti-logo");
  logo.classList.toggle("has-logo", !!team.logo_url);
  logo.innerHTML = team.logo_url
    ? `<img src="${escapeHtml(team.logo_url)}" alt="${escapeHtml(team.name)} logo">` : "🏢";
  const desc = document.getElementById("ti-desc");
  desc.textContent = team.description || "No description yet.";
  desc.classList.toggle("muted", !team.description);

  const list = document.getElementById("ti-members");
  const ownerLine = document.getElementById("ti-owner");
  const empty = document.getElementById("ti-empty");
  empty.hidden = true;
  ownerLine.textContent = "";
  list.innerHTML = `<li class="muted small">Loading members…</li>`;
  openModal("team-info-modal");

  let members = [];
  try { members = await dbGetTeamMembers(teamId); }
  catch (_) { list.innerHTML = `<li class="muted small">Couldn't load members.</li>`; return; }

  const owner = members.find((m) => m.role === "owner");
  ownerLine.textContent = owner
    ? `Owned by ${owner.is_self ? "you" : (owner.display_name || "@" + owner.username)}`
    : "";
  list.innerHTML = members.map((m) => {
    const name = m.display_name || m.username || "Member";
    const badge = m.role === "owner" ? `<span class="owner-badge">Owner</span>` : "";
    const meTag = m.is_self ? `<span class="muted small"> · you</span>` : "";
    return `
      <li class="ti-member">
        <span class="avatar" style="background:var(--green-deep)">${initials(name)}</span>
        <span class="ti-member-info">
          <span class="ti-member-name">${escapeHtml(name)}${badge}${meTag}</span>
          <span class="muted small">${escapeHtml(m.email || "")}</span>
        </span>
      </li>`;
  }).join("");
  empty.hidden = members.length > 1;   // only the owner so far → show the hint
}

// ---- Edit Team (owner only) ---------------------------------------------
// editLogoState: {file} pending upload | "remove" | null (logo unchanged).
let editLogoState = null;

function setEditLogoPreview(url) {
  const p = document.getElementById("te-logo-preview");
  if (url) { p.innerHTML = `<img src="${escapeHtml(url)}" alt="Logo preview">`; p.classList.add("has-logo"); }
  else { p.innerHTML = "🏢"; p.classList.remove("has-logo"); }
}

function openEditTeam(teamId) {
  const team = myTeams.find((t) => t.id === teamId);
  if (!team || !team.is_owner) return;   // frontend guard (server also enforces)
  editLogoState = null;
  document.getElementById("te-id").value = team.id;
  document.getElementById("te-name").value = team.name || "";
  document.getElementById("te-desc").value = team.description || "";
  document.getElementById("te-desc-count").textContent = (team.description || "").length;
  setEditLogoPreview(team.logo_url);
  document.getElementById("te-logo-remove").hidden = !team.logo_url;
  document.getElementById("te-error").hidden = true;
  openModal("team-edit-modal");
}

const LOGO_MAX_BYTES = 2 * 1024 * 1024;               // 2MB
const LOGO_TYPES = ["image/png", "image/jpeg", "image/webp"];

function onLogoInputChange(e) {
  const file = e.target.files[0];
  if (!file) return;
  const err = document.getElementById("te-error");
  if (!LOGO_TYPES.includes(file.type)) {
    err.textContent = "Please choose a PNG, JPG, or WebP image.";
    err.hidden = false; e.target.value = ""; return;
  }
  if (file.size > LOGO_MAX_BYTES) {
    err.textContent = "That image is too large (max 2MB).";
    err.hidden = false; e.target.value = ""; return;
  }
  err.hidden = true;
  editLogoState = { file };
  setEditLogoPreview(URL.createObjectURL(file));   // instant preview
  document.getElementById("te-logo-remove").hidden = false;
}

function onRemoveLogoClick() {
  if (!confirm("Remove the team logo?")) return;
  editLogoState = "remove";
  setEditLogoPreview(null);
  document.getElementById("te-logo-remove").hidden = true;
  document.getElementById("te-logo-input").value = "";
}

async function submitEditTeam(e) {
  e.preventDefault();
  const id = document.getElementById("te-id").value;
  const name = document.getElementById("te-name").value.trim();
  const description = document.getElementById("te-desc").value.trim();
  const err = document.getElementById("te-error");
  const saveBtn = document.getElementById("te-save");

  if (!name) { err.textContent = "Team name can't be blank."; err.hidden = false; return; }
  if (name.length > 60) { err.textContent = "Team name is too long (max 60)."; err.hidden = false; return; }
  if (description.length > 500) { err.textContent = "Description is too long (max 500)."; err.hidden = false; return; }
  err.hidden = true;

  saveBtn.disabled = true;
  saveBtn.textContent = "Saving…";
  try {
    await dbUpdateTeam(id, { name, description });
    if (editLogoState && editLogoState.file) await dbUploadTeamLogo(id, editLogoState.file);
    else if (editLogoState === "remove") await dbRemoveTeamLogo(id);
    await refreshTeams();          // repaints board + manager with new info
    closeModal("team-edit-modal");
    toast("Team updated ✓");
  } catch (e2) {
    err.textContent = (e2 && e2.message) || "Couldn't save changes. Try again.";
    err.hidden = false;
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = "Save";
  }
}

// ---- Team manager (Profile → Team view) ---------------------------------
function renderTeamManager() {
  const wrap = document.getElementById("teams-current");
  if (!wrap) return;
  if (!myTeams.length) {
    wrap.innerHTML = `<div class="card"><p class="empty-hint" style="margin:0">You're not on a team yet. Join one with a code below, or create your own.</p></div>`;
    return;
  }

  wrap.innerHTML = myTeams
    .map((t) => {
      const isActive = t.id === activeTeamId;
      const roster = isActive
        ? (teamOverview || [])
            .map((m) => {
              const who = m.is_self ? "You" : m.display_name || "@" + (m.username || "");
              const crown = m.role === "owner" ? ` <span class="tm-crown">👑</span>` : "";
              const canRemove = t.is_owner && !m.is_self;
              return `
                <li class="tm-row">
                  <span class="avatar ${m.is_self ? "avatar-you" : ""}" ${m.is_self ? "" : 'style="background:var(--green-deep)"'}>${initials(m.display_name || m.username || "?")}</span>
                  <span class="tm-name">${escapeHtml(who)}${crown}</span>
                  ${canRemove ? `<button type="button" class="linkish tm-remove" data-team="${t.id}" data-user="${m.user_id}">Remove</button>` : ""}
                </li>`;
            })
            .join("")
        : "";
      return `
        <div class="card team-card${isActive ? " team-active" : ""}">
          <div class="team-card-head">
            <div class="team-card-title">
              ${teamLogoHtml(t, "team-logo-sm")}
              <h2 class="card-title" style="margin:0">${escapeHtml(t.name)}${t.is_owner ? ` <span class="tm-crown" title="You own this team">👑</span>` : ""}</h2>
            </div>
            <div class="team-head-actions">
              ${t.is_owner ? `<button type="button" class="linkish edit-team" data-team="${t.id}">Edit</button>` : ""}
              ${isActive ? `<span class="team-badge">On the Feed</span>` : `<button type="button" class="linkish set-active" data-team="${t.id}">Show on Feed</button>`}
            </div>
          </div>
          <div class="team-code-row">
            <span class="muted small">Invite code</span>
            <button type="button" class="code-chip" data-code="${escapeHtml(t.join_code || "")}" title="Tap to copy">${escapeHtml(t.join_code || "")} <span class="code-copy">Copy</span></button>
          </div>
          <p class="muted small">${t.member_count} member${t.member_count === 1 ? "" : "s"}</p>
          ${isActive ? `<ul class="team-members">${roster}</ul>` : ""}
          <button type="button" class="ghost full ${t.is_owner ? "danger-ghost" : ""}" data-team="${t.id}" data-act="${t.is_owner ? "delete" : "leave"}">
            ${t.is_owner ? "Delete team" : "Leave team"}
          </button>
        </div>`;
    })
    .join("");

  // Wire the freshly-built controls.
  wrap.querySelectorAll(".code-chip").forEach((b) =>
    (b.onclick = () => copyCode(b.dataset.code, b))
  );
  wrap.querySelectorAll(".set-active").forEach((b) =>
    (b.onclick = () => setActiveTeam(b.dataset.team))
  );
  wrap.querySelectorAll(".edit-team").forEach((b) =>
    (b.onclick = () => openEditTeam(b.dataset.team))
  );
  wrap.querySelectorAll(".tm-remove").forEach((b) =>
    (b.onclick = () => onRemoveMember(b.dataset.team, b.dataset.user))
  );
  wrap.querySelectorAll("[data-act]").forEach((b) =>
    (b.onclick = () => (b.dataset.act === "delete" ? onDeleteTeam(b.dataset.team) : onLeaveTeam(b.dataset.team)))
  );
}

function copyCode(code, btn) {
  if (!code) return;
  navigator.clipboard?.writeText(code).then(
    () => { toast("Code copied — text it to your reps 📋"); if (btn) { btn.classList.add("copied"); setTimeout(() => btn.classList.remove("copied"), 1200); } },
    () => toast("Couldn't copy — code is " + code)
  );
}

async function onCreateTeam(e) {
  e.preventDefault();
  const input = document.getElementById("team-create-name");
  const name = input.value.trim();
  if (!name) return;
  try {
    const team = await dbCreateTeam(name);
    input.value = "";
    await refreshTeams();
    if (team) await setActiveTeam(team.id);
    toast(`Team created — code ${team ? team.join_code : ""} 🎉`);
  } catch (err) {
    dbFail("Couldn't create team")(err);
  }
}

async function onJoinTeam(e) {
  e.preventDefault();
  const input = document.getElementById("team-join-code");
  const code = input.value.trim();
  if (!code) return;
  try {
    const team = await dbJoinTeam(code);
    input.value = "";
    await refreshTeams();
    if (team) await setActiveTeam(team.id);
    toast(`Joined ${team ? team.name : "the team"} 🤝`);
  } catch (err) {
    toast("No team found for that code");
  }
}

async function onLeaveTeam(teamId) {
  if (!confirm("Leave this team? You'll drop off its rankings.")) return;
  try {
    await dbLeaveTeam(teamId);
    if (activeTeamId === teamId) activeTeamId = null;
    await refreshTeams();
    toast("Left the team");
  } catch (err) {
    dbFail("Couldn't leave")(err);
  }
}

async function onDeleteTeam(teamId) {
  if (!confirm("Delete this team for everyone? This can't be undone.")) return;
  try {
    await dbDeleteTeam(teamId);
    if (activeTeamId === teamId) activeTeamId = null;
    await refreshTeams();
    toast("Team deleted");
  } catch (err) {
    dbFail("Couldn't delete")(err);
  }
}

async function onRemoveMember(teamId, userId) {
  if (!confirm("Remove this member from the team?")) return;
  try {
    await dbRemoveMember(teamId, userId);
    await refreshTeams();
    toast("Member removed");
  } catch (err) {
    dbFail("Couldn't remove member")(err);
  }
}

// ---- Weekly Recognition ---------------------------------------------------
// Live leaders across this week's five awards. Needs a crew of 2+.
const RECOGNITION_MIN_CONTACTS_WEEK = 15; // close-rate award eligibility

function weeklyRecognitionPost() {
  const rows = friendsOverview || [];
  if (rows.length < 2) return null;

  const contactsWeek = (r) => (r.contact_taps_week || 0) + (r.stopbacks_week || 0);
  const closeRateWeek = (r) => {
    const closings = (r.sales_week || 0) + (r.missed_week || 0);
    if (!closings || contactsWeek(r) < RECOGNITION_MIN_CONTACTS_WEEK) return -1;
    return (r.sales_week || 0) / closings;
  };

  const awards = [
    { icon: "🏆", name: "Top Stop-Backs", val: (r) => r.stopbacks_week || 0, fmt: (v) => v },
    { icon: "💰", name: "Top Sales", val: (r) => r.sales_week || 0, fmt: (v) => v },
    { icon: "🎯", name: "Highest Close Rate", val: closeRateWeek, fmt: (v) => Math.round(v * 100) + "%" },
    { icon: "💪", name: "Iron Man", val: contactsWeek, fmt: (v) => v + " contacts" },
    { icon: "🔥", name: "Sales Streak", val: (r) => salesStreakFrom(r.sale_days), fmt: (v) => v + " days" },
  ];

  const rowsHtml = awards
    .map((a) => {
      const winner = [...rows].sort((x, y) => a.val(y) - a.val(x))[0];
      const v = a.val(winner);
      if (v <= 0) return "";
      const who = winner.is_self ? "You" : winner.display_name || "@" + (winner.username || "");
      return `
        <div class="wr-row">
          <span class="wr-icon">${a.icon}</span>
          <span class="wr-award">${a.name}</span>
          <span class="wr-winner${winner.is_self ? " me" : ""}">${escapeHtml(who)}</span>
          <span class="wr-value">${a.fmt(v)}</span>
        </div>`;
    })
    .join("");
  if (!rowsHtml.trim()) return null;

  return el(`
    <article class="post post-recognition">
      <div class="post-head">
        <span class="avatar avatar-gold">🏆</span>
        <div><span class="post-author">Weekly Recognition</span><span class="post-tag">This week's leaders</span></div>
      </div>
      <div class="wr-rows">${rowsHtml}</div>
    </article>`);
}

// ---- Friend comparison insight ---------------------------------------------
// One positive, motivating line. Never negative framing.
function ordinal(n) {
  const s = ["th", "st", "nd", "rd"], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function insightPost() {
  const rows = friendsOverview || [];
  const me = rows.find((r) => r.is_self);
  if (!me || rows.length < 2) return null;

  const byToday = [...rows].sort((a, b) => (b.stopbacks_today || 0) - (a.stopbacks_today || 0));
  const myIdx = byToday.indexOf(me);
  const friendsCount = rows.length - 1;
  let msg = null;

  if (myIdx === 0 && (me.stopbacks_today || 0) > 0) {
    msg = "You're leading the crew today. Keep the pressure on.";
  }
  if (!msg) {
    const behindMe = byToday.length - 1 - myIdx;
    const pct = Math.round((behindMe / friendsCount) * 100);
    if (pct >= 60) msg = `You're ahead of ${pct}% of your friends today.`;
  }
  if (!msg) {
    const byWeekSales = [...rows].sort((a, b) => (b.sales_week || 0) - (a.sales_week || 0));
    if (byWeekSales[0] !== me && (byWeekSales[0].sales_week || 0) > 0) {
      const gap = byWeekSales[0].sales_week - (me.sales_week || 0);
      if (gap > 0 && gap <= 3)
        msg = `You're only ${gap} sale${gap > 1 ? "s" : ""} behind first place this week.`;
    }
  }
  if (!msg && myIdx > 0) {
    const above = byToday[myIdx - 1];
    const need = (above.stopbacks_today || 0) - (me.stopbacks_today || 0) + 1;
    msg = `${need} more stop-back${need > 1 ? "s" : ""} moves you into ${ordinal(myIdx)} place today.`;
  }
  if (!msg) return null;

  return el(`
    <article class="post post-insight">
      <div class="post-head">
        <span class="avatar avatar-ai">📊</span>
        <div><span class="post-author">Insight</span><span class="post-tag">You vs the crew</span></div>
      </div>
      <p class="post-body">${msg}</p>
    </article>`);
}

// Round-robin merge so the feed mixes coach / you / friends.
function interleave(...lists) {
  const out = [];
  const max = Math.max(0, ...lists.map((l) => l.length));
  for (let i = 0; i < max; i++) lists.forEach((l) => l[i] && out.push(l[i]));
  return out;
}

// Animations (card enter, ring fill) play on the FIRST feed build only,
// so later re-renders (after logging, liking, etc.) don't re-jump.
let feedAnimated = false;

// Live stats for you + accepted friends — fills the feed's achievements.
let friendsOverview = [];
async function refreshFriendsOverview() {
  if (!window.sb) return;
  try {
    friendsOverview = await dbGetFriendsOverview();
    renderFeed();
  } catch (err) {
    console.error("[StopBack] Couldn't load the team feed:", err);
  }
}

function renderFeed() {
  const name = state.profile.name ? state.profile.name.split(" ")[0] : "there";
  const hour = new Date().getHours();
  const part = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  document.getElementById("feed-greeting").textContent = `${part}, ${name} 👋`;
  document.getElementById("streak-num").textContent = currentStreak();
  maybeAnimateStreak();

  const animate = !feedAnimated;
  const stream = document.getElementById("feed-stream");
  stream.innerHTML = "";

  // Real achievements from the shared overview: yours + your friends'.
  const rows = friendsOverview || [];
  const mine = rows
    .filter((r) => r.is_self)
    .flatMap((r) => achievementsFor(r).map((a) => achievementPost(r, a)));
  const theirs = rows
    .filter((r) => !r.is_self)
    .flatMap((r) => achievementsFor(r).map((a) => achievementPost(r, a)));

  // Hit list is the point of the feed — it leads. Social mix after.
  const posts = [
    streakRiskPost(),
    goalPost(animate),
    pacePost(),
    hitListPost(),
    teamLeaderboardPost(),
    ...interleave(mine, theirs),
    insightPost(),
    leaderboardPost(),
    weeklyRecognitionPost(),
    weeklyRecapPost(),
  ].filter(Boolean);

  posts.forEach((p, i) => {
    if (animate) {
      p.classList.add("enter");
      p.style.animationDelay = i * 60 + "ms";
    }
    stream.appendChild(p);
  });

  feedAnimated = true;
}

// Pop the streak flame only when the streak actually goes up (tracked across
// sessions via a tiny localStorage value, separate from app data).
function maybeAnimateStreak() {
  const cur = currentStreak();
  const chip = document.querySelector(".streak-chip");
  if (chip && cur > (state.gamify.streakSeen || 0)) {
    chip.classList.remove("pop");
    void chip.offsetWidth; // restart the animation
    chip.classList.add("pop");
  }
  state.gamify.streakSeen = cur;
  save();
}

// Most stop backs logged in a single calendar day.
function bestDay() {
  const counts = {};
  state.leads.forEach((l) => {
    const d = localDateStr(new Date(l.createdAt));
    counts[d] = (counts[d] || 0) + 1;
  });
  const values = Object.values(counts);
  return values.length ? Math.max(...values) : 0;
}

// Open leads whose callback is due today (even if later today) or overdue.
// Sorted soonest-first so the most urgent is always on top.
function dueCallbacks() {
  const today = localDateStr();
  return state.leads
    .filter((l) => {
      if (l.status !== "stopback" || !l.callbackAt) return false;
      const d = new Date(l.callbackAt);
      return d.getTime() < Date.now() || localDateStr(d) === today;
    })
    .sort((a, b) => new Date(a.callbackAt) - new Date(b.callbackAt));
}

// =====================================================================
//  LOG counters
// =====================================================================
function renderCounters() {
  document.getElementById("stat-contacts").textContent = contactsTotal();
  document.getElementById("stat-stopbacks").textContent = stopbacksTotal();
  document.getElementById("stat-missed").textContent = missedTotal();
  document.getElementById("stat-sales").textContent = salesTotal();
}

// =====================================================================
//  LEADS
// =====================================================================
// =====================================================================
//  Map view (Leaflet) — the territory command center. Pins every lead
//  that has GPS coordinates (captured at log time via tagLocation — the
//  rep is standing at the door, so they're accurate). v2 adds premium
//  basemaps, marker clustering, interest/callback-aware pins, filter
//  chips, a bottom-sheet of quick actions, and a callback-zone insight.
//  Phase B/C (heatmap, streets, routes, friends, AI): MAP-ARCHITECTURE.md.
// =====================================================================
let leadsMap = null;         // Leaflet map instance (created lazily)
let leadsMapLayer = null;    // cluster group (or layerGroup fallback) holding pins
let leadsViewMode = "list";  // "list" | "map"
let mapFilter = "all";       // active .mf-chip — see leadMatchesMapFilter
let mapSheetLeadId = null;   // lead currently shown in the bottom sheet
let meMarker = null;         // "my location" dot
let baseTileLayer = null;    // current basemap tile layer
let insightZonePts = null;   // [[lat,lng]] the insight strip zooms to

// Default center until there are pins: central Indiana (rep's home turf).
const MAP_DEFAULT_CENTER = [39.7684, -86.1581];

// Basemaps: CARTO Voyager reads clean and warm (Apple-Maps-like); Esri
// World Imagery for satellite. Both free with attribution — volume/licensing
// notes in MAP-ARCHITECTURE.md. The choice persists locally.
const MAP_STYLES = {
  standard: {
    url: "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png",
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
    className: "tiles-standard", // CSS warms the tiles toward the papyrus brand
  },
  satellite: {
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    attribution: "Tiles &copy; Esri — Maxar, Earthstar Geographics",
    className: "",
  },
};
let mapStyle = localStorage.getItem("stopback-map-style") || "standard";

const PIN_STATUS_LABEL = { sale: "Sale", missed: "Missed closing", stopback: "Stop back" };

// "Due" on the map = the Hit List's exact definition (callbackOverdue +
// due-later-today), so the two features can never disagree about priority.
function leadCallbackState(l) {
  if (l.status !== "stopback" || !l.callbackAt) return "";
  if (callbackOverdue(l.callbackAt)) return "overdue";
  return localDateStr(new Date(l.callbackAt)) === localDateStr() ? "today" : "";
}

// Smart pin: tone from status + interest, ring from callback state. Due
// callbacks are "today's priority" and pulse gently (reduced-motion aware).
function pinIcon(l) {
  let tone = "stopback";
  if (l.status === "sale") tone = "sale";
  else if (l.status === "missed") tone = "missed";
  else if (l.interest === "Maybe") tone = "maybe";
  else if (l.interest === "Unlikely") tone = "cold";
  const cb = leadCallbackState(l);
  const cls = "sb-pin sb-pin-" + tone + (cb ? " sb-pin-cb-" + cb + " sb-pin-priority" : "");
  return L.divIcon({
    className: cls,
    html: '<span class="sb-pin-dot"></span>',
    iconSize: [22, 22],
    iconAnchor: [11, 11],
  });
}

function clusterIcon(cluster) {
  const n = cluster.getChildCount();
  const size = n < 10 ? 34 : n < 50 ? 40 : 46;
  return L.divIcon({ className: "sb-cluster", html: "<span>" + n + "</span>", iconSize: [size, size] });
}

function setMapStyle(name) {
  mapStyle = MAP_STYLES[name] ? name : "standard";
  localStorage.setItem("stopback-map-style", mapStyle);
  const btn = document.getElementById("map-style");
  if (btn) {
    btn.classList.toggle("on", mapStyle === "satellite");
    btn.setAttribute("aria-pressed", mapStyle === "satellite" ? "true" : "false");
  }
  if (!leadsMap) return;
  if (baseTileLayer) leadsMap.removeLayer(baseTileLayer);
  const s = MAP_STYLES[mapStyle];
  baseTileLayer = L.tileLayer(s.url, { maxZoom: 19, attribution: s.attribution, className: s.className }).addTo(leadsMap);
}

// Create the map once, on first switch to map mode.
function ensureLeadsMap() {
  if (leadsMap) return leadsMap;
  if (typeof L === "undefined") {
    toast("⚠ Map failed to load (no connection?)");
    return null;
  }
  leadsMap = L.map("leads-map", { zoomControl: true });
  setMapStyle(mapStyle);
  // Clustering keeps the DOM light at thousands of pins; if the plugin CDN
  // didn't load, degrade to a plain layer group — the map still works.
  leadsMapLayer = (typeof L.markerClusterGroup === "function"
    ? L.markerClusterGroup({
        chunkedLoading: true,
        showCoverageOnHover: false,
        maxClusterRadius: 46,
        disableClusteringAtZoom: 17,
        iconCreateFunction: clusterIcon,
      })
    : L.layerGroup()
  ).addTo(leadsMap);
  leadsMap.setView(MAP_DEFAULT_CENTER, 12);
  leadsMap.on("locationfound", (e) => {
    if (meMarker) leadsMap.removeLayer(meMarker);
    // Blue dot — the universal "you are here" convention (Apple/Google).
    meMarker = L.circleMarker(e.latlng, {
      radius: 7, color: "#fff", weight: 2, fillColor: "#1c6dd0", fillOpacity: 1,
    }).addTo(leadsMap);
  });
  leadsMap.on("locationerror", () => toast("⚠ Couldn't get your location"));
  return leadsMap;
}

function leadMatchesMapFilter(l) {
  switch (mapFilter) {
    case "callbacks":  return !!leadCallbackState(l);
    case "interested": return l.status === "stopback" && l.interest === "Interested";
    case "maybe":      return l.status === "stopback" && l.interest === "Maybe";
    case "sales":      return l.status === "sale";
    case "missed":     return l.status === "missed";
    default:           return true;
  }
}

// Straight-line meters between two points (plenty for walking-zone math).
function distMeters(aLat, aLng, bLat, bLng) {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (bLat - aLat) * rad, dLng = (bLng - aLng) * rad;
  const s = Math.sin(dLat / 2) ** 2 +
    Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

// One live insight from real data: the densest walkable cluster of due
// callbacks ("knock these out together"). O(n²) over due callbacks only,
// capped at 400 — trivial at field scale; PostGIS takes over in Phase B.
function renderMapInsight() {
  const el = document.getElementById("map-insight");
  const due = state.leads
    .filter((l) => l.lat != null && l.lng != null && leadCallbackState(l))
    .slice(0, 400);
  let best = [];
  due.forEach((a) => {
    const group = due.filter((b) => distMeters(a.lat, a.lng, b.lat, b.lng) <= 150);
    if (group.length > best.length) best = group;
  });
  if (best.length >= 2) {
    insightZonePts = best.map((l) => [l.lat, l.lng]);
    el.textContent = `${best.length} callbacks within a short walk — knock them out together. Tap to zoom.`;
    el.hidden = false;
  } else if (due.length) {
    insightZonePts = due.map((l) => [l.lat, l.lng]);
    el.textContent = `${due.length} callback${due.length > 1 ? "s" : ""} due on the map. Tap to frame ${due.length > 1 ? "them" : "it"}.`;
    el.hidden = false;
  } else {
    el.hidden = true;
    insightZonePts = null;
  }
}

function renderLeadsMap(opts) {
  if (!ensureLeadsMap()) return;
  const fit = !!(opts && opts.fit);
  leadsMapLayer.clearLayers();
  const pts = [];
  let tagged = 0;
  state.leads.forEach((l) => {
    if (l.lat == null || l.lng == null) return;
    tagged++;
    if (!leadMatchesMapFilter(l)) return;
    const m = L.marker([l.lat, l.lng], { icon: pinIcon(l) });
    m.on("click", () => openMapSheet(l.id));
    leadsMapLayer.addLayer(m);
    pts.push([l.lat, l.lng]);
  });
  // Empty overlay = "no houses tagged at all"; an empty *filter* result
  // just shows the map (the active chip explains why).
  document.getElementById("map-empty").hidden = tagged > 0;
  renderMapInsight();
  // The container may have been hidden; fix sizing, then frame the pins —
  // but only when asked (mode/filter change), so background data syncs
  // never yank the viewport while the rep is panning.
  setTimeout(() => {
    leadsMap.invalidateSize();
    if (fit && pts.length) leadsMap.fitBounds(pts, { padding: [40, 40], maxZoom: 17 });
  }, 0);
}

function setLeadsMode(mode) {
  leadsViewMode = mode;
  document.querySelectorAll(".lt-btn").forEach((b) => {
    const on = b.dataset.mode === mode;
    b.classList.toggle("active", on);
    b.setAttribute("aria-selected", on ? "true" : "false");
  });
  document.getElementById("leads-list-wrap").hidden = mode !== "list";
  document.getElementById("leads-map-wrap").hidden = mode !== "map";
  if (mode === "map") renderLeadsMap({ fit: true });
}

function locateMe() {
  if (!ensureLeadsMap()) return;
  leadsMap.locate({ setView: true, maxZoom: 17 });
}

// ---- Bottom sheet: quick actions for a tapped pin --------------------
// Reuses the app's existing mutations (toggleStatus / deleteLead) and the
// edit modal (which already covers reschedule-callback, notes, address) —
// the sheet adds zero parallel logic.
function openMapSheet(id) {
  const l = state.leads.find((x) => x.id === id);
  if (!l) return;
  mapSheetLeadId = id;
  document.getElementById("ms-name").textContent = l.name;
  document.getElementById("ms-sub").textContent = l.address || l.phone;
  const badge = document.getElementById("ms-badge");
  badge.textContent = PIN_STATUS_LABEL[l.status] || "Stop back";
  badge.className = "badge" + (l.status === "sale" ? " sale" : l.status === "missed" ? " missed" : "");
  const chips = [];
  if (l.interest)
    chips.push(`<span class="badge interest-${l.interest.toLowerCase()}">${escapeHtml(l.interest)}</span>`);
  if (l.callbackAt)
    chips.push(`<span class="badge callback">📞 ${formatCallback(l.callbackAt)}</span>`);
  document.getElementById("ms-badges").innerHTML = chips.join("");
  const digits = phoneDigits(l.phone);
  document.getElementById("ms-call").href = "tel:" + digits;
  document.getElementById("ms-text").href = "sms:" + digits;
  document.getElementById("ms-directions").href =
    "https://www.google.com/maps/dir/?api=1&destination=" +
    (l.lat != null ? l.lat + "," + l.lng : encodeURIComponent(l.address || ""));
  document.getElementById("ms-sale").textContent = l.status === "sale" ? "Undo sale" : "Sale";
  document.getElementById("ms-missed").textContent = l.status === "missed" ? "Undo missed" : "Missed";
  document.getElementById("map-sheet-backdrop").hidden = false;
  const sheet = document.getElementById("map-sheet");
  sheet.hidden = false;
  requestAnimationFrame(() => sheet.classList.add("open"));
}

function closeMapSheet() {
  const sheet = document.getElementById("map-sheet");
  if (sheet.hidden) return;
  sheet.classList.remove("open");
  document.getElementById("map-sheet-backdrop").hidden = true;
  mapSheetLeadId = null;
  setTimeout(() => { sheet.hidden = true; }, 220);
}

// ---- GPS capture in the Add Stop Back form --------------------------
function tagLocation() {
  const btn = document.getElementById("f-geo-btn");
  const status = document.getElementById("f-geo-status");
  if (!("geolocation" in navigator)) {
    status.textContent = "No GPS on this device";
    return;
  }
  btn.disabled = true;
  status.textContent = "Locating…";
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      document.getElementById("f-lat").value = pos.coords.latitude;
      document.getElementById("f-lng").value = pos.coords.longitude;
      btn.classList.add("tagged");
      btn.textContent = "📍 House tagged ✓";
      status.textContent = "Pin saved for this house";
      btn.disabled = false;
    },
    (err) => {
      status.textContent =
        err.code === 1 ? "Location permission denied" : "Couldn't get location";
      btn.disabled = false;
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
  );
}

// Reset the GPS control after a lead is saved / the form is cleared.
function clearGeoTag() {
  const btn = document.getElementById("f-geo-btn");
  btn.classList.remove("tagged");
  btn.textContent = "📍 Tag this house";
  btn.disabled = false;
  document.getElementById("f-geo-status").textContent = "";
  document.getElementById("f-lat").value = "";
  document.getElementById("f-lng").value = "";
}

function renderLeads() {
  const listEl = document.getElementById("leads-list");
  const emptyEl = document.getElementById("leads-empty");
  const query = document.getElementById("search").value.trim().toLowerCase();

  const leads = [...state.leads].reverse().filter((l) => {
    if (!query) return true;
    return (l.name + " " + l.address + " " + l.notes + " " + l.phone)
      .toLowerCase()
      .includes(query);
  });

  emptyEl.hidden = state.leads.length > 0;
  listEl.innerHTML = "";

  leads.forEach((l) => {
    const li = document.createElement("li");
    li.className = "lead status-" + l.status;
    const digits = phoneDigits(l.phone);

    const statusBadge =
      l.status === "sale"
        ? `<span class="badge sale">Sale</span>`
        : l.status === "missed"
        ? `<span class="badge missed">Missed closing</span>`
        : `<span class="badge">Stop back</span>`;

    li.innerHTML = `
      <button class="lead-edit" type="button" title="Edit lead" aria-label="Edit lead">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.8 2.8 0 014 4L7.5 20.5 3 22l1.5-4.5z"/></svg>
      </button>
      <div class="lead-name">${escapeHtml(l.name)}</div>
      <div class="lead-phone">${escapeHtml(l.phone)}</div>
      ${l.address ? `<div class="lead-addr">📍 ${escapeHtml(l.address)}</div>` : ""}
      ${l.notes ? `<div class="lead-notes">${escapeHtml(l.notes)}</div>` : ""}
      <div class="lead-badges">
        ${statusBadge}
        ${l.interest ? `<span class="badge interest-${l.interest.toLowerCase()}">${escapeHtml(l.interest)}</span>` : ""}
        ${l.demeanor ? `<span class="badge demeanor">${escapeHtml(l.demeanor)}</span>` : ""}
        ${l.callbackAt ? `<span class="badge callback">📞 ${formatCallback(l.callbackAt)}</span>` : ""}
      </div>
      <div class="lead-actions">
        <button class="call">Call</button>
        <button class="text">Text</button>
        <button class="mark-missed ${l.status === "missed" ? "on" : ""}">Missed</button>
        <button class="mark-sale ${l.status === "sale" ? "on" : ""}">Sale</button>
        <button class="del">Delete</button>
      </div>`;

    li.querySelector(".lead-edit").onclick = () => openEdit(l.id); // same modal as before
    li.querySelector(".call").onclick = () => (window.location.href = "tel:" + digits);
    li.querySelector(".text").onclick = () => (window.location.href = "sms:" + digits);
    li.querySelector(".mark-missed").onclick = () => toggleStatus(l.id, "missed");
    li.querySelector(".mark-sale").onclick = () => toggleStatus(l.id, "sale");
    li.querySelector(".del").onclick = () => deleteLead(l.id);
    listEl.appendChild(li);
  });

  // Keep the map in sync when it's the active view (pins added/removed/restatused).
  if (leadsViewMode === "map" && leadsMap) renderLeadsMap();
}

// =====================================================================
//  STATS  (with time filter + drill-down detail views)
// =====================================================================
let statsRange = "all";            // "today" | "week" | "all"
let currentStatsCategory = null;   // which category detail is open

// Category definitions: label + which leads belong to it.
const CAT = {
  contacts:  { label: "Contacts",        match: () => true },
  stopbacks: { label: "Stop Backs",      match: () => true },
  missed:    { label: "Missed Closings", match: (l) => l.status === "missed" },
  sales:     { label: "Sales",           match: (l) => l.status === "sale" },
};

// Start-of-day timestamp for "N days ago" (0 = today).
function dayStart(daysAgo = 0) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - daysAgo);
  return d.getTime();
}

// Leads whose createdAt falls inside the selected range.
function leadsInRange(range) {
  if (range === "all") return state.leads;
  const from = range === "today" ? dayStart(0) : dayStart(6); // week = last 7 days incl today
  return state.leads.filter((l) => new Date(l.createdAt).getTime() >= from);
}

// Leads belonging to a category within a range.
function categoryLeads(cat, range) {
  return leadsInRange(range).filter(CAT[cat].match);
}

// Category counts for a range. "All time" folds in imported baseline + tally.
function rangeCounts(range) {
  const leads = leadsInRange(range);
  const missed = leads.filter(CAT.missed.match).length;
  const sales = leads.filter(CAT.sales.match).length;
  const stopbacks = leads.length;
  let contacts = leads.length;
  let sb = stopbacks, ms = missed, sl = sales;
  if (range === "all") {
    contacts += state.contactsTally + base("contacts");
    sb += base("stopbacks");
    ms += base("missed");
    sl += base("sales");
  }
  return { contacts, stopbacks: sb, missed: ms, sales: sl };
}

function renderStats() {
  // Empty state when there's no data at all (no leads, tally, or imported stats).
  const hasData = contactsTotal() > 0 || missedTotal() > 0 || salesTotal() > 0;
  document.getElementById("stats-empty").hidden = hasData;
  document.getElementById("stats-content").hidden = !hasData;

  const c = rangeCounts(statsRange);

  // Highlights
  document.getElementById("h-sales").textContent = c.sales;
  document.getElementById("h-closerate").textContent = pct(c.sales, c.sales + c.missed);
  document.getElementById("h-stopbacks").textContent = c.stopbacks;

  // Funnel bars (widths relative to the top of the funnel = contacts)
  const top = Math.max(c.contacts, 1);
  setBar("f-contacts", c.contacts, top);
  setBar("f-stopbacks", c.stopbacks, top);
  setBar("f-missed", c.missed, top);
  setBar("f-sales", c.sales, top);

  // Conversion rates
  document.getElementById("r-stopback").textContent = pct(c.stopbacks, c.contacts);
  document.getElementById("r-close").textContent = pct(c.sales, c.sales + c.missed);
  document.getElementById("r-overall").textContent = pct(c.sales, c.contacts);

  // Keep an open detail view in sync.
  if (currentStatsCategory && !document.getElementById("view-stats-detail").hidden) {
    renderStatsDetail();
  }
}

function setBar(id, value, max) {
  document.getElementById(id).style.width = Math.round((value / max) * 100) + "%";
  document.getElementById(id + "-n").textContent = value;
}

function setStatsRange(range) {
  statsRange = range;
  document.querySelectorAll("#stats-range .seg-btn").forEach((b) =>
    b.classList.toggle("active", b.dataset.range === range)
  );
  renderStats();
}

// Count a category's leads created between two timestamps.
function countCatBetween(cat, from, to) {
  return state.leads.filter((l) => {
    const t = new Date(l.createdAt).getTime();
    return t >= from && t < to && CAT[cat].match(l);
  }).length;
}

// Plain-English "vs last week" line for a category.
function categoryInsight(cat) {
  const label = CAT[cat].label;
  const now = Date.now();
  const week = 7 * 86400000;
  const thisWeek = countCatBetween(cat, now - week, now + 1);
  const lastWeek = countCatBetween(cat, now - 2 * week, now - week);

  if (thisWeek === 0 && lastWeek === 0) return `No ${label.toLowerCase()} logged in the last two weeks yet.`;
  if (lastWeek === 0) return `${thisWeek} ${label.toLowerCase()} this week — up from 0 last week. 🚀`;
  const change = Math.round(((thisWeek - lastWeek) / lastWeek) * 100);
  if (change > 0) return `${label} up ${change}% vs last week (${thisWeek} vs ${lastWeek}).`;
  if (change < 0) return `${label} down ${Math.abs(change)}% vs last week (${thisWeek} vs ${lastWeek}).`;
  return `${label} flat vs last week (${thisWeek} both weeks).`;
}

// 7-day trend bars (last 7 days, oldest → newest).
function trendHtml(cat) {
  const dayLabels = ["S", "M", "T", "W", "T", "F", "S"];
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const from = dayStart(i);
    const to = dayStart(i - 1); // next midnight
    const d = new Date(from);
    days.push({ count: countCatBetween(cat, from, to), label: dayLabels[d.getDay()] });
  }
  const max = Math.max(1, ...days.map((d) => d.count));
  const barClass = cat === "missed" ? "trend-bar missed" : "trend-bar";
  const cols = days
    .map((d) => `
      <div class="trend-col">
        <span class="trend-count">${d.count || ""}</span>
        <div class="trend-track"><div class="${barClass}" style="height:${(d.count / max) * 100}%"></div></div>
        <span class="trend-day">${d.label}</span>
      </div>`)
    .join("");
  return `<div class="trend">${cols}</div>`;
}

function openStatsDetail(cat) {
  currentStatsCategory = cat;
  switchView("stats-detail");
  renderStatsDetail();
}

function renderStatsDetail() {
  const cat = currentStatsCategory;
  if (!cat) return;
  const label = CAT[cat].label;
  const count = rangeCounts(statsRange)[cat];
  const leads = categoryLeads(cat, statsRange).slice().reverse(); // newest first
  const rangeLabel = statsRange === "today" ? "today" : statsRange === "week" ? "this week" : "all time";

  // Note when the shown number includes undated imported/tally data not in the list.
  const extra = count - leads.length;
  const extraNote = extra > 0
    ? `<p class="muted small">+${extra} earlier/imported not shown individually.</p>`
    : "";

  const list = leads.length
    ? leads.map((l) => `
        <div class="mini-lead">
          <div>
            <div class="ml-name">${escapeHtml(l.name)}</div>
            <div class="ml-sub">${escapeHtml(l.phone)}${l.interest ? " · " + escapeHtml(l.interest) : ""}</div>
          </div>
          <span class="ml-date">${formatDateShort(localDateStr(new Date(l.createdAt)))}</span>
        </div>`).join("")
    : `<p class="empty-hint">No ${label.toLowerCase()} in this range yet.</p>`;

  document.getElementById("stats-detail-body").innerHTML = `
    <h1 class="view-title">${label}</h1>
    <p class="view-sub">Showing ${rangeLabel}</p>
    <div class="card">
      <span class="detail-num">${count}</span>
      <p class="detail-insight">${categoryInsight(cat)}</p>
    </div>
    <div class="card">
      <h2 class="card-title">Last 7 days</h2>
      ${trendHtml(cat)}
    </div>
    <div class="card">
      <h2 class="card-title">Leads</h2>
      ${extraNote}
      ${list}
    </div>`;
}

// =====================================================================
//  PROFILE
// =====================================================================

// Achievement Showcase — collectible-style tiles. Record tiles go gold once
// a real best exists. Keeps the p-contacts/p-stopbacks/p-sales/p-days ids so
// live updates from the baseline inputs keep working.
function buildShowcase() {
  const rec = ensureRecords();
  const topBadge = [...BADGES].reverse().find((b) => state.gamify.badges[b.id]);
  const rv = (k) => (rec[k] && rec[k].v) || 0;

  const tiles = [
    { icon: topBadge ? topBadge.icon : "🎖", label: "Top Badge", value: topBadge ? topBadge.name : "None yet", small: !!topBadge },
    { icon: "💰", label: "Sales Streak", value: salesStreakFrom(mySaleDays()) + "d" },
    { icon: "🔥", label: "Login Streak", value: currentStreak() + "d" },
    { icon: "🤝", label: "Lifetime Sales", value: salesTotal(), id: "p-sales" },
    { icon: "📈", label: "Lifetime Stop-Backs", value: stopbacksTotal(), id: "p-stopbacks" },
    { icon: "🚪", label: "Lifetime Contacts", value: contactsTotal(), id: "p-contacts" },
    { icon: "🗓", label: "Active Days", value: state.activeDays.length, id: "p-days" },
    { icon: "🏆", label: "Best Sales Day", value: rv("salesDay"), gold: rv("salesDay") > 0 },
    { icon: "🏆", label: "Best Stop-Back Day", value: rv("stopbacksDay"), gold: rv("stopbacksDay") > 0 },
    { icon: "🏆", label: "Best Contacts Day", value: rv("contactsDay"), gold: rv("contactsDay") > 0 },
    { icon: "🏆", label: "Best Week", value: rv("bestWeek") + " SB", gold: rv("bestWeek") > 0 },
    { icon: "🎯", label: "Best Close Rate", value: rv("closeRate") + "%", gold: rv("closeRate") > 0 },
  ];

  document.getElementById("showcase").innerHTML = tiles
    .map(
      (t) => `
      <div class="sc-tile${t.gold ? " gold" : ""}">
        <span class="sc-icon">${t.icon}</span>
        <span class="sc-value${t.small ? " sc-small" : ""}"${t.id ? ` id="${t.id}"` : ""}>${t.value}</span>
        <span class="sc-label">${t.label}</span>
      </div>`
    )
    .join("");
}

function renderProfile() {
  document.getElementById("p-name").value = state.profile.name;
  document.getElementById("p-goal").value = state.profile.dailyGoal;
  document.getElementById("p-sales-goal").value = state.profile.salesGoal;
  buildShowcase();

  // Level + XP
  const xp = computeXP();
  const li = levelInfo(xp);
  document.getElementById("level-name").textContent = li.name;
  document.getElementById("level-xp").textContent = xp.toLocaleString() + " XP";
  document.getElementById("level-fill").style.width = Math.round(li.frac * 100) + "%";
  document.getElementById("level-next").textContent = li.next
    ? `${(li.next.xp - xp).toLocaleString()} XP to ${li.next.name}`
    : "Max level — Legend status. 🏆";

  // Badges (earned / locked)
  document.getElementById("badge-grid").innerHTML = BADGES.map((b) => {
    const earned = !!state.gamify.badges[b.id];
    return `<div class="badge-item ${earned ? "earned" : "locked"}">
      <span class="badge-icon">${b.icon}</span>
      <span class="badge-name">${escapeHtml(b.name)}</span>
      <span class="badge-desc">${escapeHtml(b.desc)}</span>
    </div>`;
  }).join("");

  // Sharing toggles
  document.getElementById("pv-stats").checked = state.privacy.shareStats;
  document.getElementById("pv-leads").checked = state.privacy.shareLeads;
  document.getElementById("pv-phone").checked = state.privacy.sharePhone;

  // Past-stats inputs (only show a value if it's non-zero, so placeholder shows otherwise)
  document.getElementById("b-contacts").value = state.baseline.contacts || "";
  document.getElementById("b-stopbacks").value = state.baseline.stopbacks || "";
  document.getElementById("b-missed").value = state.baseline.missed || "";
  document.getElementById("b-sales").value = state.baseline.sales || "";
}

// =====================================================================
//  Master render
// =====================================================================
function render() {
  renderFeed();
  renderCounters();
  renderLeads();
  renderStats();
  renderProfile();
  renderProducts();
  save();
}

// =====================================================================
//  Actions
// =====================================================================
function addLead(e) {
  e.preventDefault();
  const name = document.getElementById("f-name").value.trim();
  const phone = document.getElementById("f-phone").value.trim();
  if (!name || !phone) return;

  const latV = document.getElementById("f-lat").value;
  const lngV = document.getElementById("f-lng").value;

  const lead = {
    id: crypto.randomUUID(),
    name,
    phone,
    address: document.getElementById("f-address").value.trim(),
    demeanor: "",                                       // legacy field, kept for old data
    interest: document.getElementById("f-interest").value || "", // Interested | Maybe | Unlikely
    notes: document.getElementById("f-notes").value.trim(),
    // datetime-local gives a local "YYYY-MM-DDTHH:MM"; store real ISO (UTC).
    callbackAt: document.getElementById("f-callback").value
      ? new Date(document.getElementById("f-callback").value).toISOString()
      : "",
    // Optional GPS pin captured with "Tag this house".
    lat: latV ? parseFloat(latV) : null,
    lng: lngV ? parseFloat(lngV) : null,
    status: "stopback",
    createdAt: new Date().toISOString(),
  };
  state.leads.push(lead);

  markActiveToday();
  render();
  runGamification();
  // Insert the core row first; persist coordinates as a best-effort follow-up
  // so logging never breaks even before migration 5 is run on the shared DB.
  dbAddLead(lead)
    .then(() =>
      lead.lat != null && lead.lng != null
        ? dbUpdateLead(lead.id, { lat: lead.lat, lng: lead.lng }).catch(() => {})
        : null
    )
    .catch(dbFail("Couldn't save lead"));
  e.target.reset();
  clearInterestChips();
  clearGeoTag();
  document.getElementById("f-name").focus();
}

// Tapping an interest chip: highlight it, store the value, and — if the note is
// empty — drop the word in so a rep can log with a single tap.
const INTEREST_WORDS = ["Interested", "Maybe", "Unlikely"];
function selectInterest(chip) {
  const value = chip.dataset.interest;
  document.querySelectorAll(".interest-chips .chip").forEach((c) =>
    c.classList.toggle("active", c === chip)
  );
  document.getElementById("f-interest").value = value;
  // Fill the note if it's empty — or still just a previously-tapped chip word.
  const notes = document.getElementById("f-notes");
  const current = notes.value.trim();
  if (!current || INTEREST_WORDS.includes(current)) notes.value = value;
}

function clearInterestChips() {
  document.querySelectorAll(".interest-chips .chip").forEach((c) => c.classList.remove("active"));
  document.getElementById("f-interest").value = "";
}

function toggleStatus(id, status) {
  const lead = state.leads.find((l) => l.id === id);
  if (!lead) return;
  lead.status = lead.status === status ? "stopback" : status;
  // Real sale timestamp — powers the "2 sales in an hour" achievement.
  lead.soldAt = lead.status === "sale" ? new Date().toISOString() : "";
  markActiveToday();
  render();
  runGamification({ sale: lead.status === "sale" });
  dbUpdateLead(id, { status: lead.status, sold_at: lead.soldAt }).catch(dbFail("Couldn't update lead"));
}

function deleteLead(id) {
  if (!confirm("Delete this lead?")) return;
  state.leads = state.leads.filter((l) => l.id !== id);
  render();
  dbDeleteLead(id).catch(dbFail("Couldn't delete lead"));
}

function bumpTally(amount) {
  const next = Math.max(0, state.contactsTally + amount);
  const changed = next !== state.contactsTally;
  state.contactsTally = next;
  if (changed)
    state.contactsTodayCount = Math.max(0, (state.contactsTodayCount || 0) + amount);
  if (amount > 0) markActiveToday();
  render();
  if (amount > 0) {
    runGamification();
    if (changed) dbLogContact().catch(dbFail("Couldn't log contact"));
  } else if (amount < 0 && changed) {
    dbUnlogContact().catch(dbFail("Couldn't update contacts"));
  }
}

// ---- Edit a lead (modal) --------------------------------------------
function openEdit(id) {
  const l = state.leads.find((x) => x.id === id);
  if (!l) return;
  document.getElementById("e-id").value = id;
  document.getElementById("e-name").value = l.name;
  document.getElementById("e-phone").value = l.phone;
  document.getElementById("e-address").value = l.address || "";
  document.getElementById("e-demeanor").value = l.demeanor || "Neutral";
  document.getElementById("e-notes").value = l.notes || "";
  document.getElementById("e-callback").value = toLocalInputValue(l.callbackAt);
  document.getElementById("edit-modal").hidden = false;
}

function closeEdit() {
  document.getElementById("edit-modal").hidden = true;
}

function submitEdit(e) {
  e.preventDefault();
  const id = document.getElementById("e-id").value; // uuid string
  const l = state.leads.find((x) => x.id === id);
  if (!l) return;
  l.name = document.getElementById("e-name").value.trim();
  l.phone = document.getElementById("e-phone").value.trim();
  l.address = document.getElementById("e-address").value.trim();
  l.demeanor = document.getElementById("e-demeanor").value;
  l.notes = document.getElementById("e-notes").value.trim();
  const cbVal = document.getElementById("e-callback").value;
  l.callbackAt = cbVal ? new Date(cbVal).toISOString() : ""; // cleared = "none set"
  closeEdit();
  render();
  dbUpdateLead(id, {
    name: l.name, phone: l.phone, address: l.address,
    demeanor: l.demeanor, notes: l.notes, callback_at: l.callbackAt,
  }).catch(dbFail("Couldn't save changes"));
}

// ---- Products --------------------------------------------------------
function renderProducts() {
  const list = document.getElementById("products-list");
  const empty = document.getElementById("products-empty");
  empty.style.display = state.products.length ? "none" : "block";
  list.innerHTML = "";

  state.products.forEach((p) => {
    const features = (p.features || "").split("\n").filter((f) => f.trim());
    const li = document.createElement("li");
    li.className = "product";
    li.innerHTML = `
      <div class="product-top">
        <span class="product-name">${escapeHtml(p.name)}</span>
        ${p.price ? `<span class="product-price">${escapeHtml(p.price)}</span>` : ""}
      </div>
      ${
        features.length
          ? `<ul class="product-features">${features
              .map((f) => `<li>${escapeHtml(f)}</li>`)
              .join("")}</ul>`
          : ""
      }
      <div class="product-actions">
        <button class="pedit">Edit</button>
        <button class="pdel">Delete</button>
      </div>`;
    li.querySelector(".pedit").onclick = () => startEditProduct(p.id);
    li.querySelector(".pdel").onclick = () => deleteProduct(p.id);
    list.appendChild(li);
  });
}

function submitProduct(e) {
  e.preventDefault();
  const name = document.getElementById("pr-name").value.trim();
  if (!name) return;
  const price = document.getElementById("pr-price").value.trim();
  const features = document.getElementById("pr-features").value.trim();

  if (editingProductId) {
    const p = state.products.find((x) => x.id === editingProductId);
    if (p) {
      p.name = name;
      p.price = price;
      p.features = features;
      dbUpdateProduct(p.id, { name, price, features }).catch(dbFail("Couldn't save product"));
    }
    cancelEditProduct();
  } else {
    const prod = { id: crypto.randomUUID(), name, price, features, createdAt: new Date().toISOString() };
    state.products.push(prod);
    dbAddProduct(prod).catch(dbFail("Couldn't save product"));
    e.target.reset();
  }
  save();
  renderProducts();
}

function startEditProduct(id) {
  const p = state.products.find((x) => x.id === id);
  if (!p) return;
  editingProductId = id;
  document.getElementById("pr-name").value = p.name;
  document.getElementById("pr-price").value = p.price || "";
  document.getElementById("pr-features").value = p.features || "";
  document.getElementById("product-form-title").textContent = "Edit Product";
  document.getElementById("product-submit").textContent = "Update Product";
  document.getElementById("product-cancel").hidden = false;
  window.scrollTo(0, 0);
}

function cancelEditProduct() {
  editingProductId = null;
  document.getElementById("product-form").reset();
  document.getElementById("product-form-title").textContent = "Add Product";
  document.getElementById("product-submit").textContent = "Add Product";
  document.getElementById("product-cancel").hidden = true;
}

function deleteProduct(id) {
  if (!confirm("Delete this product?")) return;
  state.products = state.products.filter((x) => x.id !== id);
  if (editingProductId === id) cancelEditProduct();
  save();
  renderProducts();
  dbDeleteProduct(id).catch(dbFail("Couldn't delete product"));
}

// ---- Friends (real friend requests via Supabase) ---------------------
let friendships = []; // cache of get_friendships() while the view is open

// Accepted friends' user ids — used by the feed/leaderboard later.
function acceptedFriendIds() {
  return friendships.filter((f) => f.status === "accepted").map((f) => f.other_id);
}

async function loadFriends() {
  try {
    friendships = await dbGetFriendships();
  } catch (err) {
    console.error("[StopBack] Couldn't load friends:", err);
    friendships = [];
  }
  renderFriendsLists();
}

function renderFriendsLists() {
  const incoming = friendships.filter((f) => f.status === "pending" && f.direction === "incoming");
  const outgoing = friendships.filter((f) => f.status === "pending" && f.direction === "outgoing");
  const accepted = friendships.filter((f) => f.status === "accepted");

  // Requests card (incoming to accept/decline, outgoing to cancel)
  const reqCard = document.getElementById("requests-card");
  const reqList = document.getElementById("requests-list");
  reqCard.hidden = incoming.length === 0 && outgoing.length === 0;
  reqList.innerHTML = "";

  incoming.forEach((f) => {
    const li = el(`
      <li class="friend-item">
        <span class="avatar" style="background:var(--green-deep)">${initials(f.display_name || f.username)}</span>
        <span class="friend-name">${escapeHtml(f.display_name || f.username)}<br><span class="muted small">@${escapeHtml(f.username)} · wants to connect</span></span>
        <span class="fr-actions">
          <button class="fr-accept" type="button">Accept</button>
          <button class="frdel" type="button">Decline</button>
        </span>
      </li>`);
    li.querySelector(".fr-accept").onclick = () => acceptFriend(f.friendship_id);
    li.querySelector(".frdel").onclick = () => removeFriend(f.friendship_id);
    reqList.appendChild(li);
  });

  outgoing.forEach((f) => {
    const li = el(`
      <li class="friend-item">
        <span class="avatar" style="background:var(--ink-soft)">${initials(f.display_name || f.username)}</span>
        <span class="friend-name">${escapeHtml(f.display_name || f.username)}<br><span class="muted small">@${escapeHtml(f.username)} · request sent</span></span>
        <button class="frdel" type="button">Cancel</button>
      </li>`);
    li.querySelector(".frdel").onclick = () => removeFriend(f.friendship_id);
    reqList.appendChild(li);
  });

  // Accepted friends
  const list = document.getElementById("friends-list");
  document.getElementById("friends-empty").hidden = accepted.length > 0;
  list.innerHTML = "";
  accepted.forEach((f) => {
    const li = el(`
      <li class="friend-item">
        <span class="avatar" style="background:var(--green-deep)">${initials(f.display_name || f.username)}</span>
        <span class="friend-name">${escapeHtml(f.display_name || f.username)}<br><span class="muted small">@${escapeHtml(f.username)}</span></span>
        <button class="frdel" type="button">Remove</button>
      </li>`);
    li.querySelector(".frdel").onclick = () => removeFriend(f.friendship_id);
    list.appendChild(li);
  });
}

async function searchFriends(q) {
  const resultsEl = document.getElementById("search-results");
  if (!q.trim()) { resultsEl.innerHTML = ""; return; }
  let results = [];
  try {
    results = await dbSearchProfiles(q.trim());
  } catch (err) {
    console.error("[StopBack] Search failed:", err);
  }
  const known = new Set(friendships.map((f) => f.other_id));
  resultsEl.innerHTML = "";
  if (!results.length) {
    resultsEl.innerHTML = `<p class="muted small">No one found for "${escapeHtml(q)}".</p>`;
    return;
  }
  results.forEach((r) => {
    const already = known.has(r.id);
    const li = el(`
      <div class="friend-item">
        <span class="avatar" style="background:var(--green-deep)">${initials(r.display_name || r.username)}</span>
        <span class="friend-name">${escapeHtml(r.display_name || r.username)}<br><span class="muted small">@${escapeHtml(r.username)}</span></span>
        <button class="fr-accept" type="button" ${already ? "disabled" : ""}>${already ? "Pending/Friend" : "Add"}</button>
      </div>`);
    if (!already) li.querySelector(".fr-accept").onclick = () => sendFriendRequest(r.id);
    resultsEl.appendChild(li);
  });
}

async function sendFriendRequest(otherId) {
  try {
    await dbSendRequest(otherId);
    toast("Request sent 👍");
    document.getElementById("friend-search").value = "";
    document.getElementById("search-results").innerHTML = "";
    await loadFriends();
  } catch (err) {
    dbFail("Couldn't send request")(err);
  }
}
async function acceptFriend(id) {
  try { await dbAcceptFriendship(id); toast("Friend added 🎉"); await loadFriends(); }
  catch (err) { dbFail("Couldn't accept")(err); }
}
async function removeFriend(id) {
  try { await dbDeleteFriendship(id); await loadFriends(); }
  catch (err) { dbFail("Couldn't update")(err); }
}

// ---- Backup ----------------------------------------------------------
function exportBackup() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `stopback-backup-${localDateStr()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

// Export leads as a CSV that opens cleanly in Excel / Google Sheets.
function exportCsv() {
  if (!state.leads.length) {
    alert("No leads to export yet.");
    return;
  }
  const headers = ["Name", "Phone", "Address", "Demeanor", "Status", "Callback", "Notes", "Created"];
  const rows = state.leads.map((l) => [
    l.name,
    l.phone,
    l.address,
    l.demeanor,
    l.status,
    l.callbackAt ? new Date(l.callbackAt).toLocaleString() : "",
    l.notes || "",
    new Date(l.createdAt).toLocaleString(),
  ]);
  // Wrap every field in quotes and double any internal quotes (CSV-safe).
  const esc = (v) => `"${String(v == null ? "" : v).replace(/"/g, '""')}"`;
  const csv = [headers, ...rows].map((r) => r.map(esc).join(",")).join("\r\n");

  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `stopback-leads-${localDateStr()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function importBackup(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (!Array.isArray(data.leads)) throw new Error("Not a StopBack backup");
      if (!confirm("This will replace your current data. Continue?")) return;
      state = { ...DEFAULT_STATE, ...data };
      state.profile = { ...DEFAULT_STATE.profile, ...(data.profile || {}) };
      render();
      alert("Backup imported.");
    } catch (err) {
      alert("Sorry, that file isn't a valid StopBack backup.");
    }
  };
  reader.readAsText(file);
}

// =====================================================================
//  Navigation
// =====================================================================
function switchView(view) {
  document.querySelectorAll(".view").forEach((v) => (v.hidden = true));
  document.getElementById("view-" + view).hidden = false;
  document.querySelectorAll(".nav-btn").forEach((b) =>
    b.classList.toggle("active", b.dataset.view === view)
  );
  window.scrollTo(0, 0);
}

// =====================================================================
//  Init
// =====================================================================

// Loads data and paints the app. Called by the auth layer once a rep is
// signed in (Phase 2). For now it still reads from localStorage; the Supabase
// data layer swaps in behind this same entry point in the next commit.
async function startApp() {
  try {
    state = await dbLoadState(); // pull this rep's data from Supabase
  } catch (err) {
    console.error("[StopBack] Failed to load your data:", err);
    if (typeof toast === "function") toast("⚠ Couldn't load your data");
    state = structuredClone(DEFAULT_STATE);
  }
  initGamify(); // sync earned badges silently — no celebration on page load
  render();
  // Keep the shareable streak in sync (e.g. if it lapsed since last login).
  if (window.dbSaveProfile)
    dbSaveProfile({ current_streak: currentStreak() }).catch(() => {});
  // One-time-per-load record backfill from daily history (adds contacts/
  // close-rate/best-week bests the client can't derive from leads alone).
  dbGetDailyStats()
    .then((rows) => {
      seedRecords(rows);
      save();
      dbSaveProfile({ gamify: state.gamify }).catch(() => {});
      renderProfile(); // showcase tiles pick up the backfilled bests
    })
    .catch((err) => console.error("[StopBack] Couldn't backfill records:", err));
  refreshFriendsOverview(); // pull the team feed's achievements
  refreshTeams();           // pull company-team rankings + insights
}

// Wires DOM event listeners exactly once, before auth decides which screen
// to show. Safe to run while logged out (the app views are just hidden).
function wireEvents() {
  document.getElementById("today-label").textContent = new Date().toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });

  document.getElementById("lead-form").addEventListener("submit", addLead);
  document.querySelectorAll(".interest-chips .chip").forEach((chip) =>
    chip.addEventListener("click", () => selectInterest(chip))
  );
  document.getElementById("tally-plus").addEventListener("click", () => bumpTally(1));
  document.getElementById("tally-minus").addEventListener("click", () => bumpTally(-1));
  document.getElementById("search").addEventListener("input", renderLeads);

  // Leads list ⇄ map toggle + one-tap GPS capture on the Add Stop Back form.
  document.querySelectorAll(".lt-btn").forEach((b) =>
    b.addEventListener("click", () => setLeadsMode(b.dataset.mode))
  );
  document.getElementById("f-geo-btn").addEventListener("click", tagLocation);

  // Map v2: filter chips, tools, insight strip, and the pin bottom sheet.
  document.querySelectorAll(".mf-chip").forEach((c) =>
    c.addEventListener("click", () => {
      mapFilter = c.dataset.mf;
      document.querySelectorAll(".mf-chip").forEach((x) => {
        const on = x === c;
        x.classList.toggle("active", on);
        x.setAttribute("aria-pressed", on ? "true" : "false");
      });
      renderLeadsMap({ fit: true });
    })
  );
  document.getElementById("map-locate").addEventListener("click", locateMe);
  document.getElementById("map-style").addEventListener("click", () =>
    setMapStyle(mapStyle === "standard" ? "satellite" : "standard")
  );
  document.getElementById("map-insight").addEventListener("click", () => {
    if (insightZonePts && leadsMap)
      leadsMap.fitBounds(insightZonePts, { padding: [60, 60], maxZoom: 18 });
  });
  document.getElementById("map-sheet-backdrop").addEventListener("click", closeMapSheet);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeMapSheet(); });
  // Sheet actions delegate to the app's existing mutations; capture the id
  // before closing (close clears it).
  document.getElementById("ms-sale").addEventListener("click", () => {
    const id = mapSheetLeadId; closeMapSheet(); if (id) toggleStatus(id, "sale");
  });
  document.getElementById("ms-missed").addEventListener("click", () => {
    const id = mapSheetLeadId; closeMapSheet(); if (id) toggleStatus(id, "missed");
  });
  document.getElementById("ms-edit").addEventListener("click", () => {
    const id = mapSheetLeadId; closeMapSheet(); if (id) openEdit(id);
  });
  document.getElementById("ms-del").addEventListener("click", () => {
    const id = mapSheetLeadId; closeMapSheet(); if (id) deleteLead(id);
  });

  // Profile fields save as you type (debounced write to Supabase).
  document.getElementById("p-name").addEventListener("input", (e) => {
    state.profile.name = e.target.value;
    save();
    renderFeed();
    saveProfileDebounced({ display_name: e.target.value });
  });
  document.getElementById("p-goal").addEventListener("input", (e) => {
    state.profile.dailyGoal = parseInt(e.target.value, 10) || 0;
    save();
    saveProfileDebounced({ daily_goal: state.profile.dailyGoal });
  });
  document.getElementById("p-sales-goal").addEventListener("input", (e) => {
    state.profile.salesGoal = parseInt(e.target.value, 10) || 0;
    save();
    saveProfileDebounced({ daily_sales_goal: state.profile.salesGoal });
  });

  // Import-past-stats inputs. We update totals everywhere but DON'T re-render
  // the Profile inputs themselves, so the field you're typing in isn't disturbed.
  ["contacts", "stopbacks", "missed", "sales"].forEach((key) => {
    document.getElementById("b-" + key).addEventListener("input", (e) => {
      state.baseline[key] = Math.max(0, parseInt(e.target.value, 10) || 0);
      save();
      renderCounters();
      renderStats();
      renderFeed();
      document.getElementById("p-contacts").textContent = contactsTotal();
      document.getElementById("p-stopbacks").textContent = stopbacksTotal();
      document.getElementById("p-sales").textContent = salesTotal();
      saveProfileDebounced({ ["baseline_" + key]: state.baseline[key] });
    });
  });

  document.getElementById("export-btn").addEventListener("click", exportBackup);
  document.getElementById("export-csv").addEventListener("click", exportCsv);
  document.getElementById("import-btn").addEventListener("click", () =>
    document.getElementById("import-file").click()
  );
  document.getElementById("import-file").addEventListener("change", (e) => {
    if (e.target.files[0]) importBackup(e.target.files[0]);
  });

  document.querySelectorAll(".nav-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      switchView(btn.dataset.view);
      if (btn.dataset.view === "feed") { refreshFriendsOverview(); refreshTeams(); } // fresh team stats
    });
  });

  // Empty-state call-to-action buttons jump to the relevant tab.
  document.querySelectorAll("[data-goto]").forEach((btn) => {
    btn.addEventListener("click", () => switchView(btn.dataset.goto));
  });

  // Stats: time filter, drill-down taps, and back button
  document.querySelectorAll("#stats-range .seg-btn").forEach((b) =>
    b.addEventListener("click", () => setStatsRange(b.dataset.range))
  );
  document.querySelectorAll("[data-cat]").forEach((elm) =>
    elm.addEventListener("click", () => openStatsDetail(elm.dataset.cat))
  );
  document.getElementById("stats-detail-back").addEventListener("click", () => switchView("stats"));

  // Edit-lead modal
  document.getElementById("edit-form").addEventListener("submit", submitEdit);
  document.getElementById("edit-cancel").addEventListener("click", closeEdit);
  // Click the dark backdrop (but not the modal itself) to close.
  document.getElementById("edit-modal").addEventListener("click", (e) => {
    if (e.target.id === "edit-modal") closeEdit();
  });

  // Products
  document.getElementById("open-products").addEventListener("click", () => switchView("products"));
  document.getElementById("products-back").addEventListener("click", () => switchView("profile"));
  document.getElementById("product-form").addEventListener("submit", submitProduct);
  document.getElementById("product-cancel").addEventListener("click", cancelEditProduct);

  // Sharing toggles → persist to profiles (respected by the SQL functions)
  document.getElementById("pv-stats").addEventListener("change", (e) => {
    state.privacy.shareStats = e.target.checked;
    dbSaveProfile({ share_stats: e.target.checked }).catch(dbFail("Couldn't save setting"));
  });
  document.getElementById("pv-leads").addEventListener("change", (e) => {
    state.privacy.shareLeads = e.target.checked;
    dbSaveProfile({ share_leads: e.target.checked }).catch(dbFail("Couldn't save setting"));
  });
  document.getElementById("pv-phone").addEventListener("change", (e) => {
    state.privacy.sharePhone = e.target.checked;
    dbSaveProfile({ share_phone: e.target.checked }).catch(dbFail("Couldn't save setting"));
  });

  // Friends (real requests)
  document.getElementById("open-friends").addEventListener("click", () => {
    switchView("friends");
    loadFriends();
  });
  document.getElementById("friends-back").addEventListener("click", () => switchView("profile"));
  document.getElementById("friend-search-form").addEventListener("submit", (e) => {
    e.preventDefault();
    searchFriends(document.getElementById("friend-search").value);
  });
  document.getElementById("friend-search").addEventListener("input", debounce((e) => searchFriends(e.target.value), 350));

  // Teams (company crews)
  document.getElementById("open-team").addEventListener("click", () => {
    switchView("teams");
    renderTeamManager(); // paint what we have, then refresh in the background
    refreshTeams();
  });
  document.getElementById("teams-back").addEventListener("click", () => switchView("profile"));
  document.getElementById("team-create-form").addEventListener("submit", onCreateTeam);
  document.getElementById("team-join-form").addEventListener("submit", onJoinTeam);

  // Team Info / Insights / Edit modals: close buttons + backdrop clicks.
  ["team-info-modal", "team-insights-modal", "team-edit-modal"].forEach((mid) =>
    document.getElementById(mid).addEventListener("click", (e) => {
      if (e.target.id === mid) closeModal(mid);
    })
  );
  document.getElementById("ti-close").addEventListener("click", () => closeModal("team-info-modal"));
  document.getElementById("ti-x").addEventListener("click", () => closeModal("team-info-modal"));
  document.getElementById("tin-close").addEventListener("click", () => closeModal("team-insights-modal"));
  document.getElementById("tin-x").addEventListener("click", () => closeModal("team-insights-modal"));

  // Team Intelligence: tab switching.
  document.getElementById("tin-tabs").addEventListener("click", (e) => {
    const btn = e.target.closest(".td-tab");
    if (!btn) return;
    tdTab = btn.dataset.tdtab;
    document.querySelectorAll("#tin-tabs .td-tab").forEach((b) => {
      const on = b === btn;
      b.classList.toggle("is-on", on);
      b.setAttribute("aria-selected", on ? "true" : "false");
    });
    renderTeamDash();
  });

  // Shared chart tooltip: any mark carrying data-tip shows it on hover/tap.
  // One delegated listener covers every chart, SVG marks included.
  const tip = document.getElementById("tin-tip");
  const dash = document.getElementById("team-insights-modal");
  const showTip = (el) => {
    const text = el.getAttribute("data-tip");
    if (!text) return;
    tip.textContent = text;
    tip.hidden = false;
    // Position against the tooltip's own containing block (.modal-dash), not
    // the overlay — they're different boxes, and using the wrong one puts the
    // tip off by the modal's offset.
    const box = (tip.offsetParent || dash).getBoundingClientRect();
    const r = el.getBoundingClientRect();
    // Clamp inside the modal so a tooltip near the edge never clips.
    const x = Math.min(Math.max(r.left + r.width / 2 - box.left, 60), box.width - 60);
    tip.style.left = x + "px";
    tip.style.top = Math.max(r.top - box.top - 8, 8) + "px";
  };
  const hideTip = () => { tip.hidden = true; };
  dash.addEventListener("pointermove", (e) => {
    const mark = e.target.closest("[data-tip]");
    if (mark) showTip(mark); else hideTip();
  });
  dash.addEventListener("pointerleave", hideTip);
  dash.addEventListener("scroll", hideTip, true);
  document.getElementById("te-x").addEventListener("click", () => closeModal("team-edit-modal"));
  document.getElementById("te-cancel").addEventListener("click", () => closeModal("team-edit-modal"));

  // Edit Team form: logo picker, remove, live description counter, submit.
  document.getElementById("team-edit-form").addEventListener("submit", submitEditTeam);
  document.getElementById("te-logo-btn").addEventListener("click", () =>
    document.getElementById("te-logo-input").click()
  );
  document.getElementById("te-logo-input").addEventListener("change", onLogoInputChange);
  document.getElementById("te-logo-remove").addEventListener("click", onRemoveLogoClick);
  document.getElementById("te-desc").addEventListener("input", (e) => {
    document.getElementById("te-desc-count").textContent = e.target.value.length;
  });

  // Escape closes any open modal (including the edit-lead modal).
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    document.querySelectorAll(".modal-overlay:not([hidden])").forEach((m) => (m.hidden = true));
  });
}

// Boot: wire listeners once, then hand off to the auth layer, which routes to
// the sign-in screen, onboarding, or the app (calling startApp when ready).
function boot() {
  wireEvents();
  if (window.Auth) Auth.begin(startApp);
  else startApp(); // safety fallback if the auth script didn't load
}
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
else boot();
