// POST /api/ingest: used by the Mac helper, authenticated with UPLOAD_KEY.
//   { action: "start", filename, size, recordedAt, duration, poster, contentType }
//     -> { id, videoUrl, posterUrl }  (signed links to upload straight to storage)
//   { action: "complete", id }
//     -> { id, status: "draft" }       (now waiting for review in "New")
import { hasUploadKey } from "../lib/auth.js";
import { update, newId, load, nextCode } from "../lib/library.js";
import { signedPutUrl, exists } from "../lib/store.js";

const MAX_VIDEO_BYTES = 500 * 1024 * 1024;
const MAX_POSTER_BYTES = 5 * 1024 * 1024;
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// "Screen Recording 2026-11-17 at 13.47.12" -> "Recording 17 Nov, 13:47"
export function titleFrom(filename, recordedAt) {
  const base = String(filename || "").replace(/\.[^.]+$/, "").trim();
  const m = base.match(/(\d{4})-(\d{2})-(\d{2})\D+(\d{1,2})[.:](\d{2})/);
  if (m) return `Recording ${+m[3]} ${MONTHS[+m[2] - 1]}, ${m[4].padStart(2, "0")}:${m[5]}`;
  if (base && !/^screen ?recording$/i.test(base)) return base.slice(0, 120);
  const d = new Date(recordedAt || Date.now());
  return `Recording ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

export async function POST(request) {
  if (!hasUploadKey(request)) return json({ error: "Upload key missing or wrong." }, 401);
  let body;
  try { body = await request.json(); } catch { return json({ error: "Send JSON." }, 400); }

  if (body.action === "ping") {
    const { data } = await load();
    return json({ ok: true, categories: data.categories.map(c => c.name) });
  }

  if (body.action === "start") {
    const size = Number(body.size) || 0;
    if (size > MAX_VIDEO_BYTES) return json({ error: "File is larger than 500 MB after compression." }, 413);
    const isMov = /quicktime/.test(body.contentType || "");
    const contentType = isMov ? "video/quicktime" : "video/mp4";
    const recorded = new Date(body.recordedAt || Date.now());
    const date = isNaN(recorded) ? new Date().toISOString().slice(0, 10) : recorded.toISOString().slice(0, 10);
    const id = newId();
    const video = `videos/${date}_${id}.${isMov ? "mov" : "mp4"}`;
    const poster = body.poster ? `posters/${date}_${id}.jpg` : null;
    const givenTitle = String(body.title || "").trim().slice(0, 120);
    await update(lib => {
      const category = lib.categories.some(c => c.name === body.category) ? body.category : null;
      lib.videos.push({
        id, code: null, title: givenTitle || titleFrom(body.filename, body.recordedAt), category,
        publishOnArrival: Boolean(body.publish && category), date,
        status: "uploading", deletedAt: null, video, poster,
        duration: Number(body.duration) || null, size,
        sourceName: String(body.filename || "").slice(0, 200), createdAt: new Date().toISOString(),
      });
    });
    return json({
      id,
      videoUrl: await signedPutUrl(video, { contentTypes: [contentType], maxBytes: MAX_VIDEO_BYTES }),
      posterUrl: poster ? await signedPutUrl(poster, { contentTypes: ["image/jpeg"], maxBytes: MAX_POSTER_BYTES }) : null,
      contentType,
    });
  }

  if (body.action === "complete") {
    const { result } = await update(async lib => {
      const v = lib.videos.find(x => x.id === body.id);
      if (!v) return { error: "Unknown upload.", status: 404 };
      const file = await exists(v.video);
      if (!file) return { error: "The video file hasn't arrived in storage.", status: 409 };
      if (v.poster && !(await exists(v.poster))) v.poster = null;
      if (v.status === "uploading") {
        if (v.publishOnArrival && v.category) {
          v.status = "published";
          v.code = nextCode(lib, v.category);
          v.publishedAt = new Date().toISOString();
        } else v.status = "draft";
      }
      delete v.publishOnArrival;
      v.size = file.size;
      return { id: v.id, status: v.status, title: v.title, code: v.code || null, category: v.category };
    });
    return result.error ? json({ error: result.error }, result.status) : json(result);
  }

  return json({ error: "Unknown action." }, 400);
}
