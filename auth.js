// auth.js — email/password auth + onboarding gate (Phase 2).
// Controls which screen is visible: sign-in, onboarding, or the app itself.
// The app (app.js) hands us a `ready` callback we invoke once a rep is signed
// in and has completed onboarding.
const Auth = (function () {
  let onReady = null;
  let appStarted = false;
  let mode = "signin"; // "signin" | "signup"

  // ---- screen visibility -------------------------------------------------
  function show(screen) {
    document.getElementById("auth-screen").hidden = screen !== "auth";
    document.getElementById("onboarding-screen").hidden = screen !== "onboarding";
    const inApp = screen === "app";
    document.querySelector(".app-header").hidden = !inApp;
    document.querySelector("main.container").hidden = !inApp;
    document.querySelector(".bottom-nav").hidden = !inApp;
  }

  function authError(msg) {
    const el = document.getElementById("auth-error");
    el.textContent = msg || "";
    el.hidden = !msg;
  }
  function obError(msg) {
    const el = document.getElementById("ob-error");
    el.textContent = msg || "";
    el.hidden = !msg;
  }

  // ---- routing -----------------------------------------------------------
  async function currentProfile() {
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return null;
    const { data } = await sb.from("profiles").select("*").eq("id", user.id).single();
    return data;
  }

  async function route() {
    try {
      const { data: { session } } = await sb.auth.getSession();
      if (!session) {
        appStarted = false;
        show("auth");
        return;
      }
      const profile = await currentProfile();
      if (!profile || !profile.display_name) {
        // Pre-fill onboarding with any defaults we already have.
        if (profile && profile.username && !profile.username.startsWith("rep_")) {
          document.getElementById("ob-username").value = profile.username;
        }
        show("onboarding");
        return;
      }
      // Signed in + onboarded → show the app and boot it once.
      document.getElementById("account-email").textContent = session.user.email;
      show("app");
      if (!appStarted) {
        appStarted = true;
        if (onReady) onReady(profile);
      }
    } catch (err) {
      console.error("StopBack route error:", err);
      show("auth");
      authError(err.message || "Couldn't load your profile — is the schema.sql run in Supabase?");
    }
  }

  // ---- form wiring -------------------------------------------------------
  function setMode(next) {
    mode = next;
    document.getElementById("auth-submit").textContent = mode === "signin" ? "Sign in" : "Create account";
    document.getElementById("auth-toggle-text").textContent =
      mode === "signin" ? "New here?" : "Already have an account?";
    document.getElementById("auth-toggle-btn").textContent =
      mode === "signin" ? "Create an account" : "Sign in";
    document.getElementById("auth-password").setAttribute(
      "autocomplete",
      mode === "signin" ? "current-password" : "new-password"
    );
    authError("");
  }

  function wireForms() {
    document.getElementById("auth-toggle-btn").addEventListener("click", () =>
      setMode(mode === "signin" ? "signup" : "signin")
    );

    document.getElementById("auth-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      authError("");
      const email = document.getElementById("auth-email").value.trim();
      const password = document.getElementById("auth-password").value;
      const btn = document.getElementById("auth-submit");
      btn.disabled = true;
      try {
        if (mode === "signup") {
          const { data, error } = await sb.auth.signUp({ email, password });
          if (error) throw error;
          if (!data.session) {
            authError("Account created — check your email to confirm, then sign in.");
            setMode("signin");
            return;
          }
        } else {
          const { error } = await sb.auth.signInWithPassword({ email, password });
          if (error) throw error;
        }
        // onAuthStateChange -> route() takes it from here.
      } catch (err) {
        authError(err.message || "Something went wrong. Try again.");
      } finally {
        btn.disabled = false;
      }
    });

    document.getElementById("onboarding-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      obError("");
      const username = document.getElementById("ob-username").value.trim();
      const display_name = document.getElementById("ob-name").value.trim();
      const daily_goal = parseInt(document.getElementById("ob-goal").value, 10) || 5;
      const { data: { user } } = await sb.auth.getUser();
      const { error } = await sb
        .from("profiles")
        .update({ username, display_name, daily_goal })
        .eq("id", user.id);
      if (error) {
        obError(
          error.code === "23505"
            ? "That username is taken — try another."
            : error.message || "Could not save your profile."
        );
        return;
      }
      // Keep the interim localStorage app in sync until the data layer swaps in.
      patchLocalProfile(display_name, daily_goal);
      route();
    });

    document.getElementById("logout-btn").addEventListener("click", async () => {
      await sb.auth.signOut();
      // onAuthStateChange -> route() shows the sign-in screen.
    });
  }

  // Interim helper (removed in the data-layer commit): mirror onboarding
  // values into the existing localStorage blob so the app shows them now.
  function patchLocalProfile(name, goal) {
    try {
      const raw = localStorage.getItem("stopback-data-v1");
      const data = raw ? JSON.parse(raw) : {};
      data.profile = { ...(data.profile || {}), name, dailyGoal: goal };
      localStorage.setItem("stopback-data-v1", JSON.stringify(data));
    } catch (_) {}
  }

  // ---- entry point -------------------------------------------------------
  async function begin(readyCb) {
    onReady = readyCb;
    wireForms();
    setMode("signin");

    if (!window.sb) {
      show("auth");
      authError("Supabase isn't configured yet. Copy config.example.js to config.js and add your Project URL + anon key.");
      document.getElementById("auth-submit").disabled = true;
      return;
    }

    await route();
    // IMPORTANT: defer out of the callback. Calling Supabase (getSession,
    // .from()...) directly inside onAuthStateChange can deadlock because the
    // auth client holds a lock during the callback.
    sb.auth.onAuthStateChange(() => { setTimeout(route, 0); });
  }

  return { begin };
})();
window.Auth = Auth;
