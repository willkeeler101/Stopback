// ---------------------------------------------------------------------------
// StopBack config — COPY THIS FILE TO "config.js" AND FILL IN YOUR VALUES.
//
// Where to find these: Supabase dashboard -> Project Settings -> API.
//   url      = "Project URL"
//   anonKey  = "anon public" key
//
// The anon key is SAFE to ship in the browser — Row-Level Security is what
// actually protects your data. NEVER put your service_role key or your
// Anthropic API key here (those live only in the Edge Function later).
//
// config.js is gitignored so your keys are not committed.
// ---------------------------------------------------------------------------
window.STOPBACK_CONFIG = {
  url: "https://YOUR-PROJECT-ref.supabase.co",
  anonKey: "YOUR-ANON-PUBLIC-KEY",
};
