import { getStore } from "@netlify/blobs";

const PREFIX = "cutlog:shared:v1:";
const MAX_BYTES = 200_000; // one person's rolling log

export default async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const code = Netlify.env.get("ACCESS_CODE");
  if (code && req.headers.get("x-access-code") !== code) {
    return new Response("Bad access code", { status: 401 });
  }

  let body;
  try { body = await req.json(); } catch { return new Response("Bad JSON", { status: 400 }); }

  const store = getStore("cutlog-group");
  const ok = (k) => typeof k === "string" && k.startsWith(PREFIX) && k.length < 160 && !/[\s/\\'"]/.test(k);

  if (body.op === "list") {
    const { blobs } = await store.list({ prefix: PREFIX });
    return json({ keys: blobs.map((b) => b.key) });
  }

  if (body.op === "get") {
    if (!ok(body.key)) return new Response("Bad key", { status: 400 });
    const value = await store.get(body.key);
    if (value === null) return new Response("Not found", { status: 404 });
    return json({ key: body.key, value });
  }

  if (body.op === "set") {
    if (!ok(body.key)) return new Response("Bad key", { status: 400 });
    if (typeof body.value !== "string" || body.value.length > MAX_BYTES) {
      return new Response("Payload too large", { status: 413 });
    }
    await store.set(body.key, body.value);
    return json({ key: body.key, value: body.value });
  }

  return new Response("Unknown op", { status: 400 });
};

const json = (o) => new Response(JSON.stringify(o), { headers: { "Content-Type": "application/json" } });

export const config = { path: "/api/group" };
