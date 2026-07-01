// =====================================================================
//  StopBack — Door-to-Door Sales Tracker
//  Plain JavaScript. Data saved on this device via localStorage.
// =====================================================================

const APP_NAME = "StopBack";
const STORAGE_KEY = "stopback-data-v1";

// ---- State (with defaults so old saves still load) -------------------
const DEFAULT_STATE = {
  contactsTally: 0,        // people talked to without getting a number
  leads: [],               // full stop-back records
  activeDays: [],          // "YYYY-MM-DD" strings — used for streaks
  profile: { name: "", dailyGoal: 5 },
  // Historical totals from before using the app — added on top of live data.
  baseline: { contacts: 0, stopbacks: 0, missed: 0, sales: 0 },
  products: [],            // things you sell (for the brochure)
  friends: [],             // people you've added to share highlights with
  likes: {},               // which feed posts you've reacted to
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
  } catch (e) {
    console.error("Could not read saved data:", e);
  }
}

function save() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

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
  if (!state.activeDays.includes(today)) state.activeDays.push(today);
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
const METHODS = ["Text", "Call", "Knock in person"];

// Pick up to 3 stop-backs to chase today; rotates day to day.
function dailyHitList() {
  const day = localDateStr();
  const dayIndex = Math.floor(Date.now() / 86400000);
  const candidates = state.leads.filter((l) => l.status === "stopback");

  return candidates
    .map((l) => ({ lead: l, score: hashStr(l.id + day) }))
    .sort((a, b) => a.score - b.score)
    .slice(0, 3)
    .map((item, i) => ({
      lead: item.lead,
      method: METHODS[(dayIndex + i) % METHODS.length],
    }));
}

// ---- Coaching content -------------------------------------------------
const APPROACH = {
  Friendly: "They already like you — that's your edge. Be direct and assume the sale: \"I'll get you set up real quick.\" Don't over-explain; warm leads cool off when you ramble.",
  Interested: "Hot lead. Follow up within 24 hours before the excitement fades, and lead with the exact benefit they reacted to. Speed wins these.",
  Neutral: "On the fence. Re-open with a sharp, specific value prop or a limited-time hook — give them a reason to act now, not \"someday.\"",
  Skeptical: "They have doubts. Lead with social proof (\"three of your neighbors just switched\") and a low-commitment next step. Lower the risk, don't push harder.",
  Hostile: "Low ROI — don't burn energy chasing. A short, polite text leaves the door open without the friction of another knock.",
  // Interest-level tags (new one-tap chips):
  Maybe: "On the fence. Re-open with one sharp benefit and a low-pressure next step — a quick demo or a no-commitment quote. Give them a reason to act now.",
  Unlikely: "Long shot. Don't over-invest — a short, friendly text keeps the door open without burning your energy chasing it.",
};

const OBJECTIONS = [
  { q: "I'm happy with my provider", a: "Agree first, then pivot: \"Totally fair — most of my customers were too, until they saw they were overpaying for slower speeds. Mind if I do a 30-second comparison?\"" },
  { q: "I don't have time right now", a: "\"I hear you — I'll be quick.\" Then get the micro-commitment: their number and a specific callback time. A scheduled no-rush follow-up beats a rushed pitch." },
  { q: "It's too expensive", a: "Reframe to value and break it to cost-per-day. Anchor against what they pay now (and the bill they'll drop), not against zero." },
  { q: "I need to ask my spouse", a: "\"Smart — let's get you both in the loop.\" Lock a callback when both are home and leave your brochure so the partner hears it right." },
  { q: "Just send me the info", a: "Use it: \"Happy to — what's the best number?\" Now it's a stop back. Text your brochure plus a specific follow-up time." },
];

const MOTIVATION = [
  "Every no is just data. The yes is closer than it feels.",
  "You miss 100% of the doors you don't knock.",
  "Consistency beats intensity. Show up, log it, repeat.",
  "The sale is in the follow-up. Most reps quit at one touch.",
  "Your only job at the door: earn the next conversation.",
];

// Demo friends so the social feed feels alive before cloud sync exists.
const DEMO_FRIENDS = [
  { id: "demo-marcus", name: "Marcus T." },
  { id: "demo-sasha", name: "Sasha R." },
];
const FRIEND_HIGHLIGHTS = [
  (n) => ({ text: `💰 Closed ${n} sales today`, tone: "" }),
  (n) => ({ text: `🔥 ${n}-day knock streak`, tone: "ink" }),
  (n) => ({ text: `📈 New record: ${n} stop backs`, tone: "" }),
  (n) => ({ text: `💪 Hit ${n * 15}% of the weekly goal`, tone: "ink" }),
];

const dayNumber = () => Math.floor(Date.now() / 86400000);

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
// A coach message rendered as a chat bubble: avatar, timestamp, and (on first
// load) a typing shimmer that reveals the text after a short, staggered delay.
function coachCard(text, idx, animate) {
  const time = new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const node = el(`
    <article class="post post-coach">
      <div class="post-head">
        <span class="avatar avatar-ai">✦</span>
        <div><span class="post-author">StopBack Coach</span><span class="post-tag">${time}</span></div>
      </div>
      <div class="coach-bubble">
        <div class="typing"><span></span><span></span><span></span></div>
        <p class="coach-text" hidden>${text}</p>
      </div>
    </article>`);

  const reveal = () => {
    const typing = node.querySelector(".typing");
    const p = node.querySelector(".coach-text");
    if (typing) typing.remove();
    if (p) { p.hidden = false; p.classList.add("reveal"); }
  };

  if (animate) setTimeout(reveal, 350 + idx * 750);
  else reveal();
  return node;
}

// =====================================================================
//  PHASE 2 — REAL AI COACH (swap point)
//  Replace generateCoachMessages() below with an async call to the
//  Claude API (Anthropic). Send the same context we compute here
//  ({ profile, goal, todaysStats, streak, stopBackRate, bestCategory,
//  recentLeads }) as the prompt, and stream the reply into the coach
//  card — the typing shimmer already models the wait. Keep this
//  rules-based version as the offline fallback (works with no signal).
// =====================================================================

// Rotates within a situation's pool by day+hour so wording keeps changing.
function pick(pool, salt) {
  const i = (dayNumber() * 24 + new Date().getHours() + hashStr(salt)) % pool.length;
  return pool[i];
}

// The best-converting tag (interest/demeanor) among the rep's sales.
function bestCategoryTag() {
  const counts = {};
  state.leads.filter((l) => l.status === "sale").forEach((l) => {
    const t = l.interest || l.demeanor;
    if (t) counts[t] = (counts[t] || 0) + 1;
  });
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  return entries.length ? entries[0][0] : null;
}

// Returns 1–3 short coach messages, data-driven and rotated.
function generateCoachMessages() {
  const name = escapeHtml((state.profile.name || "").split(" ")[0] || "");
  const hey = name ? name : "champ";
  const hour = new Date().getHours();
  const part = hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening";
  const goal = state.profile.dailyGoal || 0;
  const today = localDateStr();
  const todayLeads = state.leads.filter((l) => localDateStr(new Date(l.createdAt)) === today);
  const tSB = todayLeads.length;
  const tSales = todayLeads.filter((l) => l.status === "sale").length;
  const tMiss = todayLeads.filter((l) => l.status === "missed").length;
  const streak = currentStreak();
  const remaining = Math.max(0, goal - tSB);

  // Stop-back rate → how many doors to line up for the doors-needed nudge.
  let sbRate = contactsTotal() > 0 ? stopbacksTotal() / contactsTotal() : 0.25;
  sbRate = Math.min(0.9, Math.max(0.12, sbRate));
  const doors = remaining > 0 ? Math.ceil(remaining / sbRate) : 0;
  const ratePct = Math.round(sbRate * 100);
  const best = bestCategoryTag();

  const messages = [];

  // ---- Pick the primary situation (highest priority first) ----
  if (state.leads.length === 0) {
    messages.push(pick([
      `Fresh start, ${hey}. First move is simple: get one name and one number. That's a stop back — everything builds from there.`,
      `Blank slate this ${part}. Don't overthink the pitch — knock, be human, get a number. The pipeline starts with one.`,
      `Zero on the board, ${hey}. Perfect. Go earn your first stop back and I'll help you work it.`,
    ], "cold"));
  } else if (tMiss >= 2 && tSales === 0) {
    messages.push(pick([
      `Rough patch — ${tMiss} that didn't land. Shake it off, ${hey}. Those aren't losses, they're reps. Next door's clean.`,
      `${tMiss} misses, no yes yet. That happens to everyone who actually knocks. Reset, breathe, next one.`,
      `Tough run today. The math still works if you keep swinging — one yes erases the noise.`,
    ], "rough"));
  } else if (goal > 0 && tSB >= goal * 1.5) {
    messages.push(pick([
      `${tSB} stop backs?! You're on fire, ${hey}. Days like this are where months get made — ride it.`,
      `Way past goal and still moving. This is record pace. Don't let up now.`,
      `You're cooking this ${part}. ${tSB} on the board — keep the foot down.`,
    ], "crush"));
  } else if (goal > 0 && tSB >= goal) {
    messages.push(pick([
      `Goal hit — ${tSB} stop backs. 🔥 Everything from here is bonus. How many extra you got in you?`,
      `That's your number, ${hey}. Most reps coast now; the great ones keep knocking while they're hot.`,
      `${tSB}/${goal} — done. Bank it, then steal a few more before you call it.`,
    ], "hit"));
  } else if (goal > 0 && remaining <= 2 && tSB > 0) {
    messages.push(pick([
      `So close — ${remaining} more and the goal's yours. Don't coast now, ${hey}.`,
      `${remaining} away. This is where good reps finish. Two more doors.`,
      `Almost there: ${remaining} to go. Line up the next couple and close it out.`,
    ], "near"));
  } else if (goal > 0 && tSB > 0) {
    messages.push(pick([
      `${remaining} more to hit goal. You get a number at ~${ratePct}% of doors, so line up about ${doors}. Go.`,
      `You're at ${tSB}/${goal}, ${hey}. Not behind — just not done. ~${doors} more doors gets you there.`,
      `${remaining} to go. At your ~${ratePct}% rate that's roughly ${doors} knocks. Tighten the pitch and grind them out.`,
    ], "behind"));
  } else {
    // No stop backs yet today (has history)
    messages.push(pick([
      `${part === "morning" ? "Morning" : "Fresh"} reset, ${hey}. ${streak > 0 ? `${streak}-day streak says you know the drill.` : "You've done this before."} Go get today's first number.`,
      `Nothing logged yet today. First door's the hardest — knock it and the rest follow.`,
      `Clean slate for today. Line up your first few and let momentum do the work.`,
    ], "fresh"));
  }

  // ---- Secondary: your money pattern (if there's a clear one) ----
  if (best) {
    messages.push(pick([
      `Pattern I'm seeing: your sales cluster in your "${best}" leads. Re-touch those first — that's where your money is.`,
      `Your "${best}" leads convert best for you. Prioritize them today over cold ones.`,
    ], "best" + best));
  }

  // ---- Third: streak protect, or a quick objection rep ----
  if (streak >= 3) {
    messages.push(pick([
      `${streak} days straight. Consistency is the real edge here — protect the streak today.`,
      `Don't break the chain: ${streak} days and counting. One log keeps it alive.`,
    ], "streak"));
  } else {
    const obj = OBJECTIONS[dayNumber() % OBJECTIONS.length];
    messages.push(`Quick rep — when they say "${obj.q}": ${obj.a}`);
  }

  return messages.slice(0, 3);
}

function callbacksPost() {
  const due = dueCallbacks();
  if (!due.length) return null;
  const today = localDateStr();
  const node = el(`
    <article class="post">
      <div class="post-head">
        <span class="avatar" style="background:var(--red)">📞</span>
        <div><span class="post-author">Callbacks Due</span><span class="post-tag">Don't let these slip</span></div>
      </div>
      <div class="cb-rows"></div>
    </article>`);
  const rows = node.querySelector(".cb-rows");
  due.forEach((l) => {
    const digits = phoneDigits(l.phone);
    const label = l.callback === today ? "Due today" : "Overdue · " + formatDateShort(l.callback);
    const row = el(`
      <div class="hit">
        <span class="hit-rank" style="background:var(--red)">!</span>
        <div class="hit-info">
          <div class="hit-name">${escapeHtml(l.name)}</div>
          <div class="hit-method" style="color:var(--red)">${label}${l.address ? " · " + escapeHtml(l.address) : ""}</div>
        </div>
        <div class="hit-actions">
          <a href="tel:${digits}">Call</a>
          <a href="sms:${digits}">Text</a>
          <button class="cb-done" type="button">Done</button>
        </div>
      </div>`);
    row.querySelector(".cb-done").onclick = () => { l.callback = ""; render(); };
    rows.appendChild(row);
  });
  return node;
}

function hitListPost() {
  const hits = dailyHitList();
  if (!hits.length) return null;
  const node = el(`
    <article class="post">
      <div class="post-head">
        <span class="avatar avatar-ai">🎯</span>
        <div><span class="post-author">Today's Hit List</span><span class="post-tag">Smart picks · rotates daily</span></div>
      </div>
      <div class="hl-rows"></div>
    </article>`);
  const rows = node.querySelector(".hl-rows");
  hits.forEach((h, i) => {
    const digits = phoneDigits(h.lead.phone);
    rows.appendChild(el(`
      <div class="hit">
        <span class="hit-rank">${i + 1}</span>
        <div class="hit-info">
          <div class="hit-name">${escapeHtml(h.lead.name)}</div>
          <div class="hit-method">Today: ${h.method}${h.lead.address ? " · " + escapeHtml(h.lead.address) : ""}</div>
        </div>
        <div class="hit-actions">
          <a href="tel:${digits}">Call</a>
          <a href="sms:${digits}">Text</a>
        </div>
      </div>`));
  });
  return node;
}

function yourHighlightPosts() {
  const out = [];
  const me = state.profile.name || "You";
  const av = `<span class="avatar avatar-you">${initials(me)}</span>`;
  const streak = currentStreak();
  const sales = salesTotal();
  const today = localDateStr();
  const todays = state.leads.filter((l) => localDateStr(new Date(l.createdAt)) === today).length;
  const best = bestDay();

  const hl = (id, banner, tone, body) => {
    const node = el(`
      <article class="post post-highlight">
        <div class="post-head">${av}<div><span class="post-author">${escapeHtml(me)}</span><span class="post-tag">Your highlight</span></div></div>
        <div class="highlight-banner ${tone}">${banner}</div>
        <p class="post-body">${body}</p>
        <div class="post-foot"><button class="react" type="button">🔥 <span>0</span></button></div>
      </article>`);
    attachReact(node, id);
    return node;
  };

  if (streak >= 2) out.push(hl("you-streak-" + streak, `🔥 ${streak}-day streak`, "", `${streak} days straight. Consistency is the whole game in D2D.`));
  if (sales >= 1) out.push(hl("you-sales-" + sales, `💰 ${sales} lifetime sale${sales > 1 ? "s" : ""}`, "ink", sales === 1 ? "First one's on the board. Go get the next." : "Sales are stacking up — your pipeline works."));
  if (todays > 0 && best > 0 && todays >= best) out.push(hl("you-record-" + today, `📈 ${todays} stop backs today`, "", "That ties or beats your best day. Record pace."));
  return out;
}

function friendPosts() {
  const friends = [...DEMO_FRIENDS, ...state.friends];
  return friends.map((f) => {
    const seed = hashStr(f.id + localDateStr());
    const n = (seed % 5) + 2;
    const hi = FRIEND_HIGHLIGHTS[seed % FRIEND_HIGHLIGHTS.length](n);
    const id = "fr-" + f.id + "-" + dayNumber();
    const node = el(`
      <article class="post post-friend">
        <div class="post-head">
          <span class="avatar" style="background:var(--green-deep)">${initials(f.name)}</span>
          <div><span class="post-author">${escapeHtml(f.name)}</span><span class="post-tag">Friend · today</span></div>
        </div>
        <div class="highlight-banner ${hi.tone}">${hi.text}</div>
        <div class="post-foot"><button class="react" type="button">🔥 <span>0</span></button></div>
      </article>`);
    attachReact(node, id);
    return node;
  });
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

function motivationPost() {
  const quote = MOTIVATION[dayNumber() % MOTIVATION.length];
  return el(`
    <article class="post post-coach">
      <div class="post-head">
        <span class="avatar avatar-ai">✦</span>
        <div><span class="post-author">StopBack Coach</span><span class="post-tag">Daily fuel</span></div>
      </div>
      <p class="post-body" style="font-size:1.05rem;font-family:var(--font-display);">"${quote}"</p>
    </article>`);
}

// Circular progress toward today's stop-back goal.
function goalPost(animate) {
  const goal = state.profile.dailyGoal || 0;
  if (goal <= 0) return null;
  const today = localDateStr();
  const todays = state.leads.filter((l) => localDateStr(new Date(l.createdAt)) === today).length;
  const frac = Math.min(todays / goal, 1);
  const pctText = Math.round(frac * 100) + "%";
  const r = 34;
  const circ = 2 * Math.PI * r;
  const offset = circ * (1 - frac);
  const done = todays >= goal;
  const msg = done
    ? "Goal crushed — everything from here is bonus. 🔥"
    : `${goal - todays} more stop back${goal - todays > 1 ? "s" : ""} to hit today's goal.`;

  // Start empty and fill to target so the ring animates on first load.
  const startOffset = animate ? circ : offset;

  const node = el(`
    <article class="post post-goal">
      <div class="goal-ring">
        <svg viewBox="0 0 80 80">
          <circle class="ring-bg" cx="40" cy="40" r="${r}"></circle>
          <circle class="ring-fg ${done ? "done" : ""}" cx="40" cy="40" r="${r}"
            stroke-dasharray="${circ.toFixed(1)}" stroke-dashoffset="${startOffset.toFixed(1)}"></circle>
        </svg>
        <div class="goal-ring-center">
          <span class="goal-num">${todays}</span><span class="goal-of">/ ${goal}</span>
        </div>
      </div>
      <div class="goal-text">
        <span class="post-tag">Today's goal</span>
        <h3 class="post-title">${pctText} there</h3>
        <p class="post-body">${msg}</p>
      </div>
    </article>`);

  if (animate) {
    const fg = node.querySelector(".ring-fg");
    // Two rAFs so the browser paints the empty state before transitioning.
    requestAnimationFrame(() =>
      requestAnimationFrame(() => { fg.style.strokeDashoffset = offset.toFixed(1); })
    );
  }
  return node;
}

// Round-robin merge so the feed mixes coach / you / friends.
function interleave(...lists) {
  const out = [];
  const max = Math.max(0, ...lists.map((l) => l.length));
  for (let i = 0; i < max; i++) lists.forEach((l) => l[i] && out.push(l[i]));
  return out;
}

// Animations (typing, card enter, ring fill) play on the FIRST feed build only,
// so later re-renders (after logging, liking, etc.) don't re-type or re-jump.
let feedAnimated = false;

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

  const coach = generateCoachMessages().map((m, i) => coachCard(m, i, animate));
  const friends = friendPosts();
  const highlights = yourHighlightPosts();

  // Actionable stuff first, then an interleaved social mix.
  const posts = [
    goalPost(animate),
    callbacksPost(),
    coach[0],
    hitListPost(),
    ...interleave(highlights, friends, coach.slice(1)),
    weeklyRecapPost(),
    motivationPost(),
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
  const seen = +(localStorage.getItem("stopback-streak-seen") || 0);
  const chip = document.querySelector(".streak-chip");
  if (chip && cur > seen) {
    chip.classList.remove("pop");
    void chip.offsetWidth; // restart the animation
    chip.classList.add("pop");
  }
  localStorage.setItem("stopback-streak-seen", cur);
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

// Leads with a callback date that's today or in the past (still open).
function dueCallbacks() {
  const today = localDateStr();
  return state.leads
    .filter((l) => l.status === "stopback" && l.callback && l.callback <= today)
    .sort((a, b) => a.callback.localeCompare(b.callback));
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

  emptyEl.style.display = state.leads.length ? "none" : "block";
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
      <div class="lead-name">${escapeHtml(l.name)}</div>
      <div class="lead-phone">${escapeHtml(l.phone)}</div>
      ${l.address ? `<div class="lead-addr">📍 ${escapeHtml(l.address)}</div>` : ""}
      ${l.notes ? `<div class="lead-notes">${escapeHtml(l.notes)}</div>` : ""}
      <div class="lead-badges">
        ${statusBadge}
        ${l.interest ? `<span class="badge interest-${l.interest.toLowerCase()}">${escapeHtml(l.interest)}</span>` : ""}
        ${l.demeanor ? `<span class="badge demeanor">${escapeHtml(l.demeanor)}</span>` : ""}
        ${l.callback ? `<span class="badge callback">📞 ${formatDateShort(l.callback)}</span>` : ""}
      </div>
      <div class="lead-actions">
        <button class="call">Call</button>
        <button class="text">Text</button>
        <button class="mark-missed ${l.status === "missed" ? "on" : ""}">Missed</button>
        <button class="mark-sale ${l.status === "sale" ? "on" : ""}">Sale</button>
        <button class="edit">Edit</button>
        <button class="del">Delete</button>
      </div>`;

    li.querySelector(".call").onclick = () => (window.location.href = "tel:" + digits);
    li.querySelector(".text").onclick = () => (window.location.href = "sms:" + digits);
    li.querySelector(".mark-missed").onclick = () => toggleStatus(l.id, "missed");
    li.querySelector(".mark-sale").onclick = () => toggleStatus(l.id, "sale");
    li.querySelector(".edit").onclick = () => openEdit(l.id);
    li.querySelector(".del").onclick = () => deleteLead(l.id);
    listEl.appendChild(li);
  });
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
function renderProfile() {
  document.getElementById("p-name").value = state.profile.name;
  document.getElementById("p-goal").value = state.profile.dailyGoal;
  document.getElementById("p-contacts").textContent = contactsTotal();
  document.getElementById("p-stopbacks").textContent = stopbacksTotal();
  document.getElementById("p-sales").textContent = salesTotal();
  document.getElementById("p-days").textContent = state.activeDays.length;

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
  renderFriends();
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

  state.leads.push({
    id: Date.now(),
    name,
    phone,
    address: document.getElementById("f-address").value.trim(),
    demeanor: "",                                       // legacy field, kept for old data
    interest: document.getElementById("f-interest").value || "", // Interested | Maybe | Unlikely
    notes: document.getElementById("f-notes").value.trim(),
    callback: document.getElementById("f-callback").value || "",
    status: "stopback",
    createdAt: new Date().toISOString(),
  });

  markActiveToday();
  render();
  e.target.reset();
  clearInterestChips();
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
  markActiveToday();
  render();
}

function deleteLead(id) {
  if (!confirm("Delete this lead?")) return;
  state.leads = state.leads.filter((l) => l.id !== id);
  render();
}

function bumpTally(amount) {
  state.contactsTally = Math.max(0, state.contactsTally + amount);
  if (amount > 0) markActiveToday();
  render();
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
  document.getElementById("e-callback").value = l.callback || "";
  document.getElementById("edit-modal").hidden = false;
}

function closeEdit() {
  document.getElementById("edit-modal").hidden = true;
}

function submitEdit(e) {
  e.preventDefault();
  const id = parseInt(document.getElementById("e-id").value, 10);
  const l = state.leads.find((x) => x.id === id);
  if (!l) return;
  l.name = document.getElementById("e-name").value.trim();
  l.phone = document.getElementById("e-phone").value.trim();
  l.address = document.getElementById("e-address").value.trim();
  l.demeanor = document.getElementById("e-demeanor").value;
  l.notes = document.getElementById("e-notes").value.trim();
  l.callback = document.getElementById("e-callback").value || "";
  closeEdit();
  render();
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
    }
    cancelEditProduct();
  } else {
    state.products.push({
      id: Date.now(),
      name,
      price,
      features,
      createdAt: new Date().toISOString(),
    });
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
}

// ---- Friends ---------------------------------------------------------
function renderFriends() {
  const list = document.getElementById("friends-list");
  const empty = document.getElementById("friends-empty");
  empty.style.display = state.friends.length ? "none" : "block";
  list.innerHTML = "";

  state.friends.forEach((f) => {
    const li = el(`
      <li class="friend-item">
        <span class="avatar" style="background:var(--green-deep)">${initials(f.name)}</span>
        <span class="friend-name">${escapeHtml(f.name)}</span>
        <button class="frdel" type="button">Remove</button>
      </li>`);
    li.querySelector(".frdel").onclick = () => deleteFriend(f.id);
    list.appendChild(li);
  });
}

function addFriend(e) {
  e.preventDefault();
  const name = document.getElementById("fr-name").value.trim();
  if (!name) return;
  state.friends.push({ id: "f" + Date.now(), name });
  e.target.reset();
  save();
  renderFriends();
  renderFeed();
}

function deleteFriend(id) {
  state.friends = state.friends.filter((f) => f.id !== id);
  save();
  renderFriends();
  renderFeed();
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
    l.callback || "",
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
function init() {
  load();

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

  // Profile fields save as you type.
  document.getElementById("p-name").addEventListener("input", (e) => {
    state.profile.name = e.target.value;
    save();
    renderFeed();
  });
  document.getElementById("p-goal").addEventListener("input", (e) => {
    state.profile.dailyGoal = parseInt(e.target.value, 10) || 0;
    save();
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
    btn.addEventListener("click", () => switchView(btn.dataset.view));
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

  // Friends
  document.getElementById("open-friends").addEventListener("click", () => switchView("friends"));
  document.getElementById("friends-back").addEventListener("click", () => switchView("profile"));
  document.getElementById("friend-form").addEventListener("submit", addFriend);

  render();
}

init();
