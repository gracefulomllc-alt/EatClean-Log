import { getStore } from "@netlify/blobs";
import { handle } from "../lib/groups-core.js";

const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

export default async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const access = Netlify.env.get("ACCESS_CODE");
  if (access && req.headers.get("x-access-code") !== access) return new Response("Bad access code", { status: 401 });

  let body;
  try { body = await req.json(); } catch { return new Response("Bad JSON", { status: 400 }); }
  if (JSON.stringify(body).length > (body.op === "photo" ? 260000 : 12000)) return new Response("Too large", { status: 413 });

  const store = getStore("cutlog-groups");
  const lim = getStore("cutlog-limits");
  const ip = req.headers.get("x-nf-client-connection-ip") || "unknown";
  const hour = new Date().toISOString().slice(0, 13);
  // Simple per-hour counters (same approach as the AI proxy). Not atomic, fine at this scale.
  const limit = async (what, max) => {
    const k = `g:${hour}:${what.startsWith("nudge") ? what : what + ":" + ip}`;
    const cur = Number((await lim.get(k)) || 0);
    if (cur >= max) return false;
    await lim.set(k, String(cur + 1));
    return true;
  };

  const { status, error, ...rest } = await handle(store, body, { limit });
  return json(error ? { error } : rest, status);
};

export const config = { path: "/api/groups" };
