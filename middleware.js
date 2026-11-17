// Password gate for the whole site: pages, API and every video.
// Viewers sign in with SITE_PASSWORD; the admin (edit, delete, restore) with
// ADMIN_PASSWORD. The Mac upload helper uses UPLOAD_KEY on /api/ingest only.
// All three live only in Vercel environment variables, and a missing value
// means nobody gets in with that role (the gate fails closed).
import { next } from "@vercel/functions";
import { VIEWER_COOKIE, ADMIN_COOKIE, viewerToken, adminToken, isViewer, isAdmin, safeEqual, cookie } from "./lib/auth.js";

const PUBLIC_PREFIXES = ["/fonts/"]; // the password screen needs its typeface

function safeNext(value) {
  return typeof value === "string" && value.startsWith("/") && !value.startsWith("//") ? value : "/";
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function loginPage({ nextPath = "/", error = false, status = 401, admin = false } = {}) {
  const action = admin ? "/admin/login" : "/login";
  const sub = admin ? "Admin sign-in" : "Video documentation";
  const cta = admin ? "Sign in" : "View videos";
  const label = admin ? "Admin password" : "Password";
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Reactive agent video documentation</title>
<meta property="og:title" content="Reactive agent video documentation">
<meta property="og:description" content="Password protected.">
<style>
  @font-face { font-family: "Inter"; src: url("/fonts/inter-latin-wght-normal.woff2") format("woff2-variations"); font-weight: 100 900; font-display: swap; }
  :root { --paper: #f8f8f6; --sheet: #fff; --ink: #1a1a1a; --mute: #9a9a9a; --rule: #e6e6e6; --blue: #2f6bff; --err: #c8372d; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { height: 100%; }
  body { background: var(--paper); color: var(--ink); font: 400 14px/1.5 "Inter", ui-sans-serif, system-ui, sans-serif;
         -webkit-font-smoothing: antialiased; display: grid; place-items: center; padding: 24px; }
  form { width: min(320px, 100%); opacity: 0; transform: translateY(6px); animation: rise .7s cubic-bezier(.2,.8,.2,1) .08s forwards; }
  @keyframes rise { to { opacity: 1; transform: none; } }
  h1 { font-size: 14px; font-weight: 600; letter-spacing: -0.01em; }
  .sub { color: var(--mute); margin-bottom: 32px; }
  label { display: block; font-size: 13px; font-weight: 500; color: #4a4a4a; margin-bottom: 8px; }
  .row { display: flex; gap: 8px; }
  input { flex: 1; min-width: 0; height: 40px; padding: 0 12px; border: 0; border-radius: 10px; background: var(--sheet);
          box-shadow: 0 0 0 1px var(--rule); font: inherit; color: inherit; transition: box-shadow .2s; }
  input:focus { outline: none; box-shadow: 0 0 0 1px var(--blue), 0 0 0 4px rgb(47 107 255 / .14); }
  button { height: 40px; padding: 0 16px; border: 0; border-radius: 10px; background: var(--ink); color: #fff;
           font: inherit; font-weight: 500; cursor: pointer; transition: opacity .2s; }
  button:hover { opacity: .86; }
  button:focus-visible { outline: 2px solid var(--blue); outline-offset: 3px; }
  .legal { margin-top: 40px; font-size: 12px; line-height: 1.5; color: var(--mute); }
  .legal strong { font-weight: 500; color: #4a4a4a; }
  .error { color: var(--err); font-size: 13px; margin-top: 10px; }
  .error + .row input, [aria-invalid="true"] { box-shadow: 0 0 0 1px var(--err); }
  @media (prefers-reduced-motion: reduce) { form { animation: none; opacity: 1; transform: none; } }
</style>
</head>
<body>
<form method="post" action="${action}">
  <h1>Reactive agent</h1>
  <p class="sub">${sub}</p>
  <label for="pw">${label}</label>
  <div class="row">
    <input id="pw" name="password" type="password" autocomplete="current-password" required autofocus${error ? ' aria-invalid="true" aria-describedby="err"' : ""}>
    <button type="submit">${cta}</button>
  </div>
  ${error ? '<p class="error" id="err" role="alert">That password didn’t work. Check it and try again.</p>' : ""}
  <input type="hidden" name="next" value="${escapeHtml(nextPath)}">
  <p class="legal"><strong>Confidential.</strong> Unpublished work in progress by Sander Randoja, Umeå Institute of Design, Umeå University. \u00a9 2026 Sander Randoja, protected under the Swedish Copyright Act (1960:729).</p>
</form>
<script>
  // Keep a deep link like #av01 through the password step.
  var n = document.querySelector('input[name="next"]');
  if (location.hash && n.value.indexOf("#") < 0) n.value += location.hash;
</script>
</body>
</html>`;
  return new Response(html, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "x-robots-tag": "noindex, nofollow",
    },
  });
}

const redirect = (location, extra = {}) =>
  new Response(null, { status: 303, headers: { location, "cache-control": "no-store", ...extra } });

async function signIn(request, { expected, tokenFn, cookieName, admin }) {
  const form = await request.formData();
  const given = String(form.get("password") || "");
  const nextPath = safeNext(String(form.get("next") || "/"));
  if (expected && given && safeEqual(given, expected)) {
    return redirect(nextPath, { "set-cookie": cookie(cookieName, await tokenFn(expected)) });
  }
  return loginPage({ nextPath, error: true, admin });
}

export default async function middleware(request) {
  const url = new URL(request.url);
  const { pathname } = url;

  if (PUBLIC_PREFIXES.some(p => pathname.startsWith(p))) return next();
  // The Mac helper checks its own upload key inside the function.
  if (pathname === "/api/ingest") return next();

  if (pathname === "/login" && request.method === "POST")
    return signIn(request, { expected: process.env.SITE_PASSWORD, tokenFn: viewerToken, cookieName: VIEWER_COOKIE });

  if (pathname === "/admin/login" && request.method === "POST")
    return signIn(request, { expected: process.env.ADMIN_PASSWORD, tokenFn: adminToken, cookieName: ADMIN_COOKIE, admin: true });

  if (pathname === "/admin/logout") return redirect("/", { "set-cookie": cookie(ADMIN_COOKIE, "", 0) });

  if (pathname === "/admin" || pathname === "/admin/") {
    if (await isAdmin(request)) return redirect("/");
    return loginPage({ nextPath: "/", admin: true });
  }

  if (await isViewer(request)) {
    if (pathname === "/login") return redirect("/");
    return next({ headers: { "x-robots-tag": "noindex, nofollow", "cache-control": "private, no-store" } });
  }

  if (pathname.startsWith("/api/"))
    return new Response(JSON.stringify({ error: "Sign in first." }), { status: 401, headers: { "content-type": "application/json" } });
  return loginPage({ nextPath: safeNext(pathname + url.search) });
}
