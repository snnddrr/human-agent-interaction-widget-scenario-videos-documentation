// Storage layer: Vercel Blob (private) in production.
// Set STORE_MOCK_DIR to use a local folder instead, for offline tests.
import { createHmac } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

const MOCK = process.env.STORE_MOCK_DIR;

let blobLib;
const blob = async () => (blobLib ??= await import("@vercel/blob"));

// ---------- JSON documents (the library) ----------

export async function readJSON(pathname) {
  if (MOCK) {
    try {
      const text = await fs.readFile(path.join(MOCK, pathname), "utf8");
      return { data: JSON.parse(text), etag: createHmac("sha1", "e").update(text).digest("hex") };
    } catch (e) { if (e.code === "ENOENT") return null; throw e; }
  }
  const { get, head } = await blob();
  // The etag for a conditional write must come from the storage API (head),
  // not from the download response, which can carry a different form.
  let meta;
  try { meta = await head(pathname); } catch { return null; }
  const res = await get(pathname, { access: "private", useCache: false });
  if (!res || res.statusCode !== 200) return null;
  const text = await new Response(res.stream).text();
  return { data: JSON.parse(text), etag: meta.etag };
}

export class ConflictError extends Error {}

export async function writeJSON(pathname, data, etag) {
  const text = JSON.stringify(data, null, 2);
  if (MOCK) {
    const file = path.join(MOCK, pathname);
    if (etag) {
      const cur = await readJSON(pathname);
      if (cur && cur.etag !== etag) throw new ConflictError("changed");
    }
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, text);
    return;
  }
  const { put } = await blob();
  try {
    await put(pathname, text, {
      access: "private", contentType: "application/json", addRandomSuffix: false,
      allowOverwrite: true, cacheControlMaxAge: 60, ...(etag ? { ifMatch: etag } : {}),
    });
  } catch (e) {
    const msg = String(e?.message || e);
    if (/precondition|etag|412|if-?match/i.test(msg)) {
      console.warn(`library write conflict: ${msg}`);
      throw new ConflictError("changed");
    }
    throw e;
  }
}

// ---------- Files ----------

export async function putFile(pathname, body, contentType) {
  if (MOCK) {
    const file = path.join(MOCK, pathname);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, Buffer.from(await new Response(body).arrayBuffer()));
    return;
  }
  const { put } = await blob();
  await put(pathname, body, { access: "private", contentType, addRandomSuffix: false, allowOverwrite: true, multipart: true });
}

export async function exists(pathname) {
  if (MOCK) {
    try { const s = await fs.stat(path.join(MOCK, pathname)); return { size: s.size }; }
    catch { return null; }
  }
  const { head } = await blob();
  try { const h = await head(pathname); return { size: h.size }; }
  catch { return null; }
}

export async function remove(pathnames) {
  const list = pathnames.filter(Boolean);
  if (!list.length) return;
  if (MOCK) { await Promise.all(list.map(p => fs.rm(path.join(MOCK, p), { force: true }))); return; }
  const { del } = await blob();
  await del(list);
}

// ---------- Signed links ----------
// Playback: one store-wide read token, reused until close to expiry, so
// signing a link is a local calculation rather than an API call.
let readToken = null;
async function getReadToken() {
  const { issueSignedToken } = await blob();
  if (!readToken || readToken.until - Date.now() < 2 * 60 * 60 * 1000) {
    const until = Date.now() + 12 * 60 * 60 * 1000;
    readToken = { token: await issueSignedToken({ pathname: "*", operations: ["get"], validUntil: until }), until };
  }
  return readToken.token;
}

const mockSign = (op, pathname, exp) =>
  createHmac("sha256", "mock").update(`${op}:${pathname}:${exp}`).digest("hex");

export async function signedGetUrl(pathname, ttlMs = 6 * 60 * 60 * 1000) {
  const exp = Date.now() + ttlMs;
  if (MOCK) return `/__mock_blob/${pathname}?op=get&exp=${exp}&sig=${mockSign("get", pathname, exp)}`;
  const { presignUrl } = await blob();
  const { presignedUrl } = await presignUrl(await getReadToken(), { operation: "get", pathname, validUntil: exp });
  return presignedUrl;
}

export async function signedPutUrl(pathname, { contentTypes, maxBytes, ttlMs = 2 * 60 * 60 * 1000 }) {
  const exp = Date.now() + ttlMs;
  if (MOCK) return `/__mock_blob/${pathname}?op=put&exp=${exp}&sig=${mockSign("put", pathname, exp)}`;
  const { issueSignedToken, presignUrl } = await blob();
  const token = await issueSignedToken({
    pathname, operations: ["put"], validUntil: exp,
    allowedContentTypes: contentTypes, maximumSizeInBytes: maxBytes,
  });
  const { presignedUrl } = await presignUrl(token, {
    operation: "put", pathname, validUntil: exp,
    allowedContentTypes: contentTypes, maximumSizeInBytes: maxBytes,
    addRandomSuffix: false, allowOverwrite: true,
  });
  return presignedUrl;
}

export { mockSign };
