import { getStore } from "@netlify/blobs";
import { keyFor } from "../lib/codekey.js";

// Your whole log, stored under a hash of your sync code - the code itself is never
// saved, so reading the store doesn't reveal which code opens which log.
const MAX_BYTES = 3_000_000;
const json = (o) => new Response(JSON.stringify(o), { headers: { "Content-Type": "application/json" } });


export default async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const access = Netlify.env.get("ACCESS_CODE");
  if (access && req.headers.get("x-access-code") !== access) return new Response("Bad access code", { status: 401 });

  let body;
  try { body = await req.json(); } catch { return new Response("Bad JSON", { status: 400 }); }
  const key = await keyFor(body.code);
  if (!key) return new Response("Sync code should be 16 letters and numbers", { status: 400 });

  const store = getStore("cutlog-sync");

  if (body.op === "get") {
    const raw = await store.get(key);
    return json({ data: raw ? JSON.parse(raw) : null });
  }

  if (body.op === "put") {
    if (!body.data || typeof body.data !== "object") return new Response("Nothing to save", { status: 400 });
    const raw = JSON.stringify(body.data);
    if (raw.length > MAX_BYTES) return new Response("Log is too large to sync", { status: 413 });
    await store.set(key, raw);
    return json({ ok: true });
  }

  return new Response("Unknown op", { status: 400 });
};

export const config = { path: "/api/sync" };
