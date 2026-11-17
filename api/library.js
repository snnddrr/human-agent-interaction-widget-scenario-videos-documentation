// GET /api/library: the videos this visitor may see.
import { isAdmin, isViewer } from "../lib/auth.js";
import { load, view, purgeExpired } from "../lib/library.js";

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

export async function GET(request) {
  if (!(await isViewer(request))) return json({ error: "Sign in to see the videos." }, 401);
  const admin = await isAdmin(request);
  if (admin) await purgeExpired().catch(() => {});
  const { data } = await load();
  return json(view(data, { admin }));
}
