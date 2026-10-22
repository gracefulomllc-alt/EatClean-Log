import { getStore } from "@netlify/blobs";
import { handle } from "../lib/accounts-core.js";
import { keyFor } from "../lib/codekey.js";

// Erase everything stored under a sync code: the log, the watch data and the progress photos.
async function purge(code) {
  const key = await keyFor(code);
  if (!key) return;
  await getStore("cutlog-sync").delete(key);
  await getStore("cutlog-health").delete(key);
  const photos = getStore("cutlog-photos");
  const { blobs } = await photos.list({ prefix: `${key}/` });
  for (const b of blobs) await photos.delete(b.key);
}

const json = (status, o) => new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json" } });

export default async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const access = Netlify.env.get("ACCESS_CODE");
  if (access && req.headers.get("x-access-code") !== access) return new Response("Bad access code", { status: 401 });
  let body;
  try { body = await req.json(); } catch { return new Response("Bad JSON", { status: 400 }); }
  const r = await handle(getStore("cutlog-accounts"), body || {}, { purge, recoveryKey: Netlify.env.get("ADMIN_KEY") || "" });
  // The app shows the response text as the message, so errors are plain sentences.
  return r.status === 200 ? json(200, r.body) : new Response(r.body.error, { status: r.status });
};

export const config = { path: "/api/accounts" };
