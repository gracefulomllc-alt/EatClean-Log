import { getStore } from "@netlify/blobs";
import { keyFor } from "../lib/codekey.js";

// Progress photos, stored under the hash of your sync code. Only reachable with the code.
const MAX_BYTES = 2_500_000;
const json = (o) => new Response(JSON.stringify(o), { headers: { "Content-Type": "application/json" } });
const okId = (id) => typeof id === "string" && /^[0-9a-f-]{36}$/i.test(id);

export default async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const access = Netlify.env.get("ACCESS_CODE");
  if (access && req.headers.get("x-access-code") !== access) return new Response("Bad access code", { status: 401 });

  let body;
  try { body = await req.json(); } catch { return new Response("Bad JSON", { status: 400 }); }
  const owner = await keyFor(body.code);
  if (!owner) return new Response("Sync code should be 16 letters and numbers", { status: 400 });
  if (!okId(body.id)) return new Response("Bad photo id", { status: 400 });

  const store = getStore("cutlog-photos");
  const key = `${owner}/${body.id}`;

  if (body.op === "put") {
    const img = String(body.image || "");
    if (!img.startsWith("data:image/")) return new Response("Not an image", { status: 400 });
    if (img.length > MAX_BYTES) return new Response("Photo too large", { status: 413 });
    await store.set(key, img);
    return json({ ok: true });
  }
  if (body.op === "get") {
    const img = await store.get(key);
    return img ? json({ image: img }) : new Response("Not found", { status: 404 });
  }
  if (body.op === "delete") {
    await store.delete(key);
    return json({ ok: true });
  }
  return new Response("Unknown op", { status: 400 });
};

export const config = { path: "/api/photos" };
