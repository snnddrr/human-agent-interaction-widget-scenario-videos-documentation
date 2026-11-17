// Shared sign-in helpers for the password gate (middleware) and the API.
// Two roles:
//   viewer: knows SITE_PASSWORD, can watch published videos.
//   admin:  knows ADMIN_PASSWORD, can also review, edit, delete and restore.
// Passwords live only in Vercel environment variables. A missing password
// means nobody can sign in with that role (fails closed).

export const VIEWER_COOKIE = "site_auth";
export const ADMIN_COOKIE = "site_admin";
export const MAX_AGE = 60 * 60 * 24 * 30; // 30 days

const secret = () => process.env.SITE_SECRET || "agent-widget-scenarios";

export async function sha256(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
}

// Kept identical to the original gate so existing viewers stay signed in.
export const viewerToken = password => sha256(`${password}\u0000${secret()}`);
export const adminToken = password => sha256(`admin\u0000${password}\u0000${secret()}`);

export function readCookie(request, name) {
  const header = request.headers.get("cookie") || "";
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return null;
}

// Compare two strings without leaking where they differ.
export function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

export async function isAdmin(request) {
  const pw = process.env.ADMIN_PASSWORD;
  const c = readCookie(request, ADMIN_COOKIE);
  return Boolean(pw && c && safeEqual(c, await adminToken(pw)));
}

export async function isViewer(request) {
  if (await isAdmin(request)) return true;
  const pw = process.env.SITE_PASSWORD;
  const c = readCookie(request, VIEWER_COOKIE);
  return Boolean(pw && c && safeEqual(c, await viewerToken(pw)));
}

// The Mac helper authenticates with a long random key instead of a cookie.
export function hasUploadKey(request) {
  const key = process.env.UPLOAD_KEY;
  const h = request.headers.get("authorization") || "";
  const given = h.startsWith("Bearer ") ? h.slice(7).trim() : "";
  return Boolean(key && key.length >= 32 && given && safeEqual(given, key));
}

export const cookie = (name, value, maxAge = MAX_AGE) =>
  `${name}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
