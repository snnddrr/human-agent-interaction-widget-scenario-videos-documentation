// POST /api/admin: review, edit, delete and restore. Admin sign-in required.
import { isAdmin } from "../lib/auth.js";
import { update, view, nextCode, codeFor } from "../lib/library.js";
import { remove } from "../lib/store.js";

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

const fail = (error, status = 400) => ({ error, status });

export async function POST(request) {
  if (!(await isAdmin(request))) return json({ error: "Sign in as admin to make changes." }, 401);
  let b;
  try { b = await request.json(); } catch { return json({ error: "Send JSON." }, 400); }

  let toRemove = [];
  const { data, result } = await update(lib => {
    if (b.action === "addCategory") {
      const name = String(b.name || "").trim().replace(/\s+/g, " ").slice(0, 60);
      if (!name) return fail("Give the category a name.");
      if (lib.categories.some(c => c.name.toLowerCase() === name.toLowerCase())) return { ok: true, category: name };
      lib.categories.push({ name, code: codeFor(lib, name) });
      return { ok: true, category: name };
    }
    const v = lib.videos.find(x => x.id === b.id);
    if (!v) return fail("That video no longer exists.", 404);
    const catOk = name => lib.categories.some(c => c.name === name);
    const setCategory = name => {
      if (name === v.category) return;
      v.category = name;
      if (v.status === "published") v.code = nextCode(lib, name);
    };

    switch (b.action) {
      case "update": {
        if (b.title !== undefined) {
          const t = String(b.title).trim().slice(0, 120);
          if (!t) return fail("Give the video a title.");
          v.title = t;
        }
        if (b.category !== undefined && b.category !== null) {
          if (!catOk(b.category)) return fail("Pick one of the categories.");
          setCategory(b.category);
        }
        if (b.date !== undefined) {
          if (!/^\d{4}-\d{2}-\d{2}$/.test(b.date)) return fail("Use a date like 2026-11-17.");
          v.date = b.date;
        }
        return { ok: true };
      }
      case "publish": {
        if (v.deletedAt) return fail("Restore the video before publishing it.");
        const category = b.category ?? v.category;
        if (!catOk(category)) return fail("Pick a category before publishing.");
        if (b.title !== undefined && String(b.title).trim()) v.title = String(b.title).trim().slice(0, 120);
        v.category = category;
        v.status = "published";
        if (!v.code || !v.code.startsWith(lib.categories.find(c => c.name === category).code)) v.code = nextCode(lib, category);
        v.publishedAt = new Date().toISOString();
        return { ok: true };
      }
      case "unpublish":
        v.status = "draft";
        return { ok: true };
      case "delete":
        v.deletedAt = new Date().toISOString();
        return { ok: true };
      case "restore":
        v.deletedAt = null;
        return { ok: true };
      case "purge":
        if (!v.deletedAt) return fail("Move the video to Recently deleted first.");
        lib.videos = lib.videos.filter(x => x !== v);
        toRemove = [v.video, v.poster];
        return { ok: true };
      default:
        return fail("Unknown action.");
    }
  });

  if (result.error) return json({ error: result.error }, result.status);
  if (toRemove.length) await remove(toRemove);
  return json({ ...view(data, { admin: true }), ...(result.category ? { category: result.category } : {}) });
}
