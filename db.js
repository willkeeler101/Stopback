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
    callbackAt: r.callback_at || "", soldAt: r.sold_at || "",
    // Map coordinates (migration 5). Absent on pre-migration rows -> null.
    lat: r.lat == null ? null : r.lat, lng: r.lng == null ? null : r.lng,
    status: r.status, createdAt: r.created_at,
  };
}
function rowToProduct(r) {
  return { id: r.id, name: r.name, price: r.price || "", features: r.features || "", createdAt: r.created_at };
}

// ---- load everything into a fresh state object ------------------------
async function dbLoadState() {
  const uid = await dbUserId();
  const s = structuredClone(DEFAULT_STATE);

  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);

  const [profileRes, leadsRes, productsRes, contactRes, contactTodayRes] = await Promise.all([
    sb.from("profiles").select("*").eq("id", uid).single(),
    sb.from("leads").select("*").eq("user_id", uid).order("created_at", { ascending: true }),
    sb.from("products").select("*").eq("user_id", uid).order("created_at", { ascending: true }),
    sb.from("log_events").select("id", { count: "exact", head: true }).eq("user_id", uid).eq("type", "contact"),
    sb.from("log_events").select("id", { count: "exact", head: true }).eq("user_id", uid).eq("type", "contact")
      .gte("created_at", dayStart.toISOString()),
  ]);

  const profile = profileRes.data;
  if (profile) {
    s.profile = {
      name: profile.display_name || "",
      dailyGoal: profile.daily_goal || 5,
      salesGoal: profile.daily_sales_goal == null ? 2 : profile.daily_sales_goal,
      // Nullable on purpose: null = "unset", client falls back to salesGoal * 6.
      // Pre-migration-7 rows simply lack the column → undefined → null.
      weeklySalesGoal: profile.weekly_sales_goal == null ? null : profile.weekly_sales_goal,
    };
    s.baseline = {
      contacts: profile.baseline_contacts || 0,
      stopbacks: profile.baseline_stopbacks || 0,
      missed: profile.baseline_missed || 0,
      sales: profile.baseline_sales || 0,
    };
    s.activeDays = Array.isArray(profile.active_days) ? profile.active_days.slice() : [];
    s.gamify = { ...DEFAULT_STATE.gamify, ...(profile.gamify || {}) };
    s.gamify.badges = (profile.gamify && profile.gamify.badges) || {};
    s.privacy = {
      shareStats: profile.share_stats !== false, // default true
      shareLeads: !!profile.share_leads,
      sharePhone: !!profile.share_phone,
    };
  }
  s.leads = (leadsRes.data || []).map(rowToLead);
  s.products = (productsRes.data || []).map(rowToProduct);
  s.contactsTally = contactRes.count || 0;
  s.contactsTodayCount = contactTodayRes.count || 0;
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
    callback_at: l.callbackAt || null, status: l.status, created_at: l.createdAt,
  });
  if (error) throw error;
}
async function dbUpdateLead(id, patch) {
  const p = { ...patch, updated_at: new Date().toISOString() };
  if ("callback_at" in p) p.callback_at = p.callback_at || null;
  if ("sold_at" in p) p.sold_at = p.sold_at || null;
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

// ---- friends (Phase 3) -------------------------------------------------
async function dbSearchProfiles(q) {
  const { data, error } = await sb.rpc("search_profiles", { q });
  if (error) throw error;
  return data || [];
}
async function dbGetFriendships() {
  const { data, error } = await sb.rpc("get_friendships");
  if (error) throw error;
  return data || [];
}
// Stats overview for me + accepted friends who share stats (feeds the
// achievements on the team feed; later the leaderboard too).
async function dbGetFriendsOverview() {
  const { data, error } = await sb.rpc("get_friends_overview");
  if (error) throw error;
  return data || [];
}
// Own per-day history (v_daily_stats view; RLS-scoped to self). Used once on
// load to backfill personal records — including best-contacts day.
async function dbGetDailyStats() {
  const uid = await dbUserId();
  const { data, error } = await sb.from("v_daily_stats").select("*").eq("user_id", uid);
  if (error) throw error;
  return data || [];
}
async function dbSendRequest(otherId) {
  const uid = await dbUserId();
  const { error } = await sb.from("friendships")
    .insert({ requester_id: uid, addressee_id: otherId, status: "pending" });
  if (error) throw error;
}
async function dbAcceptFriendship(id) {
  const { error } = await sb.from("friendships")
    .update({ status: "accepted", updated_at: new Date().toISOString() }).eq("id", id);
  if (error) throw error;
}
async function dbDeleteFriendship(id) {
  const { error } = await sb.from("friendships").delete().eq("id", id);
  if (error) throw error;
}

// ---- teams (company crews — migration 5) -------------------------------
// All reads/writes go through SECURITY DEFINER RPCs; the client never touches
// teams/team_members across users directly. Membership implies stat-sharing
// within that team (no per-user toggle), so the board/insights always fill.
async function dbCreateTeam(name) {
  const { data, error } = await sb.rpc("create_team", { p_name: name });
  if (error) throw error;
  return (data && data[0]) || null;
}
async function dbJoinTeam(code) {
  const { data, error } = await sb.rpc("join_team_by_code", { p_code: code });
  if (error) throw error;
  return (data && data[0]) || null;
}
async function dbLeaveTeam(teamId) {
  const { error } = await sb.rpc("leave_team", { p_team: teamId });
  if (error) throw error;
}
async function dbDeleteTeam(teamId) {
  // Remove the logo via the Storage API FIRST — while we still own the team, so
  // the owner-only Storage policy authorizes it and the physical file is purged
  // (Postgres can't delete storage.objects directly). Best-effort: a missing or
  // failed removal must never block deleting the team.
  await sb.storage.from("team-logos").remove([`${teamId}/logo`]).catch(() => {});
  const { error } = await sb.rpc("delete_team", { p_team: teamId });
  if (error) throw error;
}
async function dbRemoveMember(teamId, userId) {
  const { error } = await sb.rpc("remove_member", { p_team: teamId, p_user: userId });
  if (error) throw error;
}
async function dbGetMyTeams() {
  const { data, error } = await sb.rpc("get_my_teams");
  if (error) throw error;
  return data || [];
}
// Ranking rows + insight inputs for one team (empty unless you're a member).
async function dbGetTeamOverview(teamId) {
  const { data, error } = await sb.rpc("get_team_overview", { p_team: teamId });
  if (error) throw error;
  return data || [];
}

// Binned door/sale density for the Heat map tab (migration 7). Returns null —
// not throw — when the RPC doesn't exist yet, so the tab can fall back to a
// self-only heat from local leads until the migration is run.
async function dbGetTeamHeat(teamId) {
  const { data, error } = await sb.rpc("get_team_heat", { p_team: teamId });
  if (error) return null;
  return data || [];
}

// Team info + edit (migration 6). Ownership is enforced server-side.
async function dbGetTeamMembers(teamId) {
  const { data, error } = await sb.rpc("get_team_members", { p_team: teamId });
  if (error) throw error;
  return data || [];
}
async function dbUpdateTeam(teamId, { name, description }) {
  const { error } = await sb.rpc("update_team", {
    p_team: teamId,
    p_name: name,
    p_description: description ?? null,
  });
  if (error) throw error;
}
async function dbSetTeamLogo(teamId, url) {
  const { error } = await sb.rpc("set_team_logo", { p_team: teamId, p_url: url });
  if (error) throw error;
}
// Upload to the public 'team-logos' bucket at '<team_id>/logo' (owner-only via
// Storage RLS), then persist a cache-busted public URL on the team.
async function dbUploadTeamLogo(teamId, file) {
  const path = `${teamId}/logo`;
  const { error: upErr } = await sb.storage
    .from("team-logos")
    .upload(path, file, { upsert: true, contentType: file.type });
  if (upErr) throw upErr;
  const { data: pub } = sb.storage.from("team-logos").getPublicUrl(path);
  const url = `${pub.publicUrl}?v=${Date.now()}`; // bust cache on replace
  await dbSetTeamLogo(teamId, url);
  return url;
}
async function dbRemoveTeamLogo(teamId) {
  await sb.storage.from("team-logos").remove([`${teamId}/logo`]).catch(() => {});
  await dbSetTeamLogo(teamId, null);
}
