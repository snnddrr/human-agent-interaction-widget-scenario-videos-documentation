// Password gate for the whole site: page, posters and every video file.
// The password lives only in the SITE_PASSWORD environment variable on Vercel.
// If it is missing, nobody gets in (the gate fails closed).
import { next } from "@vercel/functions";

const COOKIE = "site_auth";
const MAX_AGE = 60 * 60 * 24 * 30; // 30 days
const PUBLIC_PREFIXES = ["/fonts/"]; // the password screen needs its typeface

async function sha256(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
}

function tokenFor(password) {
  // Changing SITE_PASSWORD (or SITE_SECRET) signs everyone out.
  return sha256(`${password}\u0000${process.env.SITE_SECRET || "agent-widget-scenarios"}`);
}

function readCookie(request, name) {
  const header = request.headers.get("cookie") || "";
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return null;
}

function safeNext(value) {
  return typeof value === "string" && value.startsWith("/") && !value.startsWith("//") ? value : "/";
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function loginPage({ nextPath = "/", error = false, status = 401 } = {}) {
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
  .error { color: var(--err); font-size: 13px; margin-top: 10px; }
  .error + .row input, [aria-invalid="true"] { box-shadow: 0 0 0 1px var(--err); }
  @media (prefers-reduced-motion: reduce) { form { animation: none; opacity: 1; transform: none; } }
</style>
</head>
<body>
<form method="post" action="/login">
  <h1>Reactive agent</h1>
  <p class="sub">Video documentation</p>
  <label for="pw">Password</label>
  <div class="row">
    <input id="pw" name="password" type="password" autocomplete="current-password" required autofocus${error ? ' aria-invalid="true" aria-describedby="err"' : ""}>
    <button type="submit">View videos</button>
  </div>
  ${error ? '<p class="error" id="err" role="alert">That password didn’t work. Check it and try again.</p>' : ""}
  <input type="hidden" name="next" value="${escapeHtml(nextPath)}">
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

export default async function middleware(request) {
  const url = new URL(request.url);
  const password = process.env.SITE_PASSWORD;

  if (PUBLIC_PREFIXES.some(p => url.pathname.startsWith(p))) return next();

  if (url.pathname === "/login" && request.method === "POST") {
    const form = await request.formData();
    const given = String(form.get("password") || "");
    const nextPath = safeNext(String(form.get("next") || "/"));
    if (password && given && (await tokenFor(given)) === (await tokenFor(password))) {
      return new Response(null, {
        status: 303,
        headers: {
          location: nextPath,
          "set-cookie": `${COOKIE}=${await tokenFor(password)}; Path=/; Max-Age=${MAX_AGE}; HttpOnly; Secure; SameSite=Lax`,
          "cache-control": "no-store",
        },
      });
    }
    return loginPage({ nextPath, error: true });
  }

  const cookie = readCookie(request, COOKIE);
  if (password && cookie && cookie === (await tokenFor(password))) {
    if (url.pathname === "/login") return Response.redirect(new URL("/", url), 303);
    return next({ headers: { "x-robots-tag": "noindex, nofollow", "cache-control": "private, no-store" } });
  }

  return loginPage({ nextPath: safeNext(url.pathname + url.search) });
}
