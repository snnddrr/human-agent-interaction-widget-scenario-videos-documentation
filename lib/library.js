// The video library: one JSON document listing every video and its state.
//
// A video moves through these states:
//   uploading  -> the Mac helper has started an upload (admin only)
//   draft      -> uploaded, waiting for review in "New" (admin only)
//   published  -> visible to everyone with the viewing password
// Any of them can be soft-deleted (deletedAt set). Deleted videos sit in
// "Recently deleted" for RETENTION_DAYS, can be restored, and are then
// removed for good.
import { readJSON, writeJSON, remove, ConflictError } from "./store.js";

export const LIBRARY_PATH = "library.json";
export const RETENTION_DAYS = 30;
const DAY = 24 * 60 * 60 * 1000;

export const DEFAULT_CATEGORIES = [
  { name: "Scenarios", code: "SC", lead: true },
  { name: "Co-work in progress", code: "CW" },
  { name: "AI visualisation experimentations", code: "AV" },
];

export const emptyLibrary = () => ({ version: 1, categories: DEFAULT_CATEGORIES, videos: [] });

export async function load() {
  const res = await readJSON(LIBRARY_PATH);
  return res ? res : { data: emptyLibrary(), etag: null };
}

// Read-modify-write with a retry if someone else saved in between.
export async function update(mutator) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const { data, etag } = await load();
    const result = await mutator(data);
    try {
      await writeJSON(LIBRARY_PATH, data, etag);
      return { data, result };
    } catch (e) {
      if (!(e instanceof ConflictError) || attempt === 3) throw e;
      await new Promise(r => setTimeout(r, 150 * (attempt + 1)));
    }
  }
}

export const newId = () =>
  Date.now().toString(36).slice(-5) + Math.random().toString(36).slice(2, 7);

export function nextCode(lib, categoryName) {
  const cat = lib.categories.find(c => c.name === categoryName);
  if (!cat) return null;
  const used = lib.videos
    .map(v => v.code)
    .filter(c => c && c.startsWith(cat.code))
    .map(c => parseInt(c.slice(cat.code.length), 10) || 0);
  return cat.code + String((used.length ? Math.max(...used) : 0) + 1).padStart(2, "0");
}

export const daysLeft = v =>
  v.deletedAt ? Math.max(0, Math.ceil((Date.parse(v.deletedAt) + RETENTION_DAYS * DAY - Date.now()) / DAY)) : null;

// Remove deleted videos whose recovery window has passed, plus uploads
// that never finished within a day. Called lazily on admin reads.
export async function purgeExpired() {
  const now = Date.now();
  const isExpired = v =>
    (v.deletedAt && now - Date.parse(v.deletedAt) > RETENTION_DAYS * DAY) ||
    (v.status === "uploading" && now - Date.parse(v.createdAt) > DAY);
  const { data } = await load();
  if (!data.videos.some(isExpired)) return;
  const { result: gone } = await update(lib => {
    const out = lib.videos.filter(isExpired);
    lib.videos = lib.videos.filter(v => !isExpired(v));
    return out;
  });
  await remove(gone.flatMap(v => [v.video, v.poster]));
}

// What a given role may see, shaped for the page.
export function view(lib, { admin }) {
  const visible = lib.videos.filter(v =>
    admin ? v.status !== "uploading" : v.status === "published" && !v.deletedAt);
  return {
    admin,
    retentionDays: RETENTION_DAYS,
    categories: lib.categories,
    videos: visible.map(v => ({
      id: v.id,
      code: v.code || null,
      title: v.title,
      category: v.category || null,
      date: v.date,
      status: v.status,
      duration: v.duration || null,
      src: `/api/media?id=${v.id}`,
      poster: v.poster ? `/api/media?id=${v.id}&poster=1` : null,
      ...(admin ? { deletedAt: v.deletedAt || null, daysLeft: daysLeft(v), sourceName: v.sourceName || null } : {}),
    })),
  };
}
