// db.js — Supabase data layer (Phase 2, commit 2).
// Loads a signed-in rep's data into the app's in-memory `state` shape and
// provides per-entity writes. RLS guarantees a rep only touches their own rows,
// so every query is implicitly scoped to the logged-in user.

let currentUserId = null;

async function dbUserId() {
  if (currentUserId) return currentUserId;
  const { data: { user } } = await sb.auth.getUser();
  currentUserId = user ? user.id : null;
  return currentUserId;
}

// Called on sign-out so the next rep doesn't inherit a stale id.
function dbResetUser() { currentUserId = null; }

// Surface a write failure without breaking the optimistic UI.
function dbFail(msg) {
  return (err) => {
    console.error("[StopBack] " + msg + ":", err);
    if (typeof toast === "function") toast("⚠ " + msg);
  };
}

// ---- row <-> app-shape mappers ----------------------------------------
function rowToLead(r) {
  return {
    id: r.id, name: r.name, phone: r.phone || "", address: r.address || "",
    interest: r.interest || "", demeanor: r.demeanor || "", notes: r.notes || "",
    callback: r.callback || "", status: r.status, createdAt: r.created_at,
  };
}
function rowToProduct(r) {
  return { id: r.id, name: r.name, price: r.price || "", features: r.features || "", createdAt: r.created_at };
}

// ---- load everything into a fresh state object ------------------------
async function dbLoadState() {
  const uid = await dbUserId();
  const s = structuredClone(DEFAULT_STATE);

  const [profileRes, leadsRes, productsRes, contactRes] = await Promise.all([
    sb.from("profiles").select("*").eq("id", uid).single(),
    sb.from("leads").select("*").eq("user_id", uid).order("created_at", { ascending: true }),
    sb.from("products").select("*").eq("user_id", uid).order("created_at", { ascending: true }),
    sb.from("log_events").select("id", { count: "exact", head: true }).eq("user_id", uid).eq("type", "contact"),
  ]);

  const profile = profileRes.data;
  if (profile) {
    s.profile = { name: profile.display_name || "", dailyGoal: profile.daily_goal || 5 };
    s.baseline = {
      contacts: profile.baseline_contacts || 0,
      stopbacks: profile.baseline_stopbacks || 0,
      missed: profile.baseline_missed || 0,
      sales: profile.baseline_sales || 0,
    };
    s.activeDays = Array.isArray(profile.active_days) ? profile.active_days.slice() : [];
    s.gamify = { ...DEFAULT_STATE.gamify, ...(profile.gamify || {}) };
    s.gamify.badges = (profile.gamify && profile.gamify.badges) || {};
  }
  s.leads = (leadsRes.data || []).map(rowToLead);
  s.products = (productsRes.data || []).map(rowToProduct);
  s.contactsTally = contactRes.count || 0;
  s.friends = []; // Phase 3
  try { s.likes = JSON.parse(localStorage.getItem("stopback-likes") || "{}"); } catch (_) { s.likes = {}; }

  return s;
}

// ---- leads -------------------------------------------------------------
async function dbAddLead(l) {
  const uid = await dbUserId();
  const { error } = await sb.from("leads").insert({
    id: l.id, user_id: uid, name: l.name, phone: l.phone, address: l.address,
    interest: l.interest || null, demeanor: l.demeanor || null, notes: l.notes,
    callback: l.callback || null, status: l.status, created_at: l.createdAt,
  });
  if (error) throw error;
}
async function dbUpdateLead(id, patch) {
  const p = { ...patch, updated_at: new Date().toISOString() };
  if ("callback" in p) p.callback = p.callback || null;
  if ("interest" in p) p.interest = p.interest || null;
  const { error } = await sb.from("leads").update(p).eq("id", id);
  if (error) throw error;
}
async function dbDeleteLead(id) {
  const { error } = await sb.from("leads").delete().eq("id", id);
  if (error) throw error;
}

// ---- contacts (log_events) --------------------------------------------
async function dbLogContact() {
  const uid = await dbUserId();
  const { error } = await sb.from("log_events").insert({ user_id: uid, type: "contact" });
  if (error) throw error;
}
async function dbUnlogContact() {
  const uid = await dbUserId();
  const { data } = await sb.from("log_events").select("id")
    .eq("user_id", uid).eq("type", "contact")
    .order("created_at", { ascending: false }).limit(1);
  if (data && data[0]) {
    const { error } = await sb.from("log_events").delete().eq("id", data[0].id);
    if (error) throw error;
  }
}

// ---- products ----------------------------------------------------------
async function dbAddProduct(p) {
  const uid = await dbUserId();
  const { error } = await sb.from("products").insert({
    id: p.id, user_id: uid, name: p.name, price: p.price, features: p.features, created_at: p.createdAt,
  });
  if (error) throw error;
}
async function dbUpdateProduct(id, patch) {
  const { error } = await sb.from("products").update(patch).eq("id", id);
  if (error) throw error;
}
async function dbDeleteProduct(id) {
  const { error } = await sb.from("products").delete().eq("id", id);
  if (error) throw error;
}

// ---- profile (name, goal, baselines, active_days, gamify) --------------
async function dbSaveProfile(patch) {
  const uid = await dbUserId();
  const { error } = await sb.from("profiles").update(patch).eq("id", uid);
  if (error) throw error;
}
