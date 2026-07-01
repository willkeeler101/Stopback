// supabase.js — creates the one shared Supabase client for the whole app.
// Loaded after the supabase-js UMD bundle and after config.js.
// If config is missing/invalid, `window.sb` stays null and the auth layer
// shows a helpful "add your keys" message instead of crashing.
let sb = null;
try {
  const cfg = window.STOPBACK_CONFIG;
  if (window.supabase && cfg && cfg.url && cfg.url.startsWith("https://") && cfg.anonKey) {
    sb = window.supabase.createClient(cfg.url, cfg.anonKey);
  } else {
    console.error(
      "StopBack: Supabase not configured. Copy config.example.js to config.js and add your Project URL + anon key."
    );
  }
} catch (e) {
  console.error("StopBack: failed to create Supabase client:", e);
}
window.sb = sb;
