// GET /api/media?id=…[&poster=1]: sends the browser to a short-lived signed
// link for one private file, after checking this visitor may see it.
import { isAdmin, isViewer } from "../lib/auth.js";
import { load } from "../lib/library.js";
import { signedGetUrl } from "../lib/store.js";

let cache = { at: 0, lib: null };
async function library() {
  if (Date.now() - cache.at > 10_000) cache = { at: Date.now(), lib: (await load()).data };
  return cache.lib;
}

export async function GET(request) {
  if (!(await isViewer(request))) return new Response("Sign in to watch.", { status: 401 });
  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  const wantPoster = url.searchParams.get("poster") === "1";
  let v = (await library()).videos.find(x => x.id === id);
  if (!v) { cache.at = 0; v = (await library()).videos.find(x => x.id === id); }
  if (!v) return new Response("Not found", { status: 404 });
  const hidden = v.status !== "published" || v.deletedAt;
  if (hidden && !(await isAdmin(request))) return new Response("Not found", { status: 404 });
  const pathname = wantPoster ? v.poster : v.video;
  if (!pathname) return new Response("Not found", { status: 404 });
  const location = await signedGetUrl(pathname);
  return new Response(null, { status: 302, headers: { location, "cache-control": "private, max-age=600" } });
}
