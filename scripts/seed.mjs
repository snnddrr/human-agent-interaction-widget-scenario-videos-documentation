// One-time move of the original four videos from the repo into private storage.
// Runs during the Vercel build. It does nothing once the library exists,
// or when the files are no longer in the repo.
import { createReadStream, existsSync } from "node:fs";
import { Readable } from "node:stream";
import { readJSON, writeJSON, putFile } from "../lib/store.js";
import { LIBRARY_PATH, emptyLibrary } from "../lib/library.js";

const LEGACY = [
  { code: "SC01", title: "Resting, high energy", category: "Scenarios", date: "2026-11-14", file: "2026-11-14_SC01_scenario-resting-high-energy", duration: 20 },
  { code: "CW01", title: "Co-working session 01", category: "Co-work in progress", date: "2026-11-14", file: "2026-11-14_CW01_co-working-session-01", duration: 66 },
  { code: "CW02", title: "Co-working session 02", category: "Co-work in progress", date: "2026-11-14", file: "2026-11-14_CW02_co-working-session-02", duration: 42 },
  { code: "AV01", title: "Low alertness", category: "AI visualisation experimentations", date: "2026-11-10", file: "2026-11-10_AV01_low-alertness", duration: 174 },
];

async function main() {
  if (!process.env.BLOB_READ_WRITE_TOKEN && !process.env.STORE_MOCK_DIR && !process.env.VERCEL_OIDC_TOKEN) {
    console.log("seed: no storage credentials in this build, skipping");
    return;
  }
  if (await readJSON(LIBRARY_PATH)) { console.log("seed: library already exists, skipping"); return; }
  const present = LEGACY.filter(v => existsSync(`videos/${v.file}.mp4`));
  if (!present.length) { console.log("seed: no legacy files in repo, skipping"); return; }

  const lib = emptyLibrary();
  for (const v of present) {
    const video = `videos/${v.file}.mp4`;
    const poster = existsSync(`posters/${v.file}.jpg`) ? `posters/${v.file}.jpg` : null;
    console.log(`seed: uploading ${video}`);
    await putFile(video, Readable.toWeb(createReadStream(video)), "video/mp4");
    if (poster) await putFile(poster, Readable.toWeb(createReadStream(poster)), "image/jpeg");
    lib.videos.push({
      id: v.code.toLowerCase(), code: v.code, title: v.title, category: v.category, date: v.date,
      status: "published", deletedAt: null, video, poster, duration: v.duration,
      sourceName: `${v.file}.mp4`, createdAt: new Date().toISOString(), publishedAt: new Date().toISOString(),
    });
  }
  await writeJSON(LIBRARY_PATH, lib, null);
  console.log(`seed: library created with ${lib.videos.length} videos`);
}

main().catch(e => { console.error("seed failed:", e); process.exit(1); });
