import { getStore } from "@netlify/blobs";
import { handle } from "../lib/accounts-core.js";

const json = (status, o) => new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json" } });

export default async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const access = Netlify.env.get("ACCESS_CODE");
  if (access && req.headers.get("x-access-code") !== access) return new Response("Bad access code", { status: 401 });
  let body;
  try { body = await req.json(); } catch { return new Response("Bad JSON", { status: 400 }); }
  const r = await handle(getStore("cutlog-accounts"), body || {});
  // The app shows the response text as the message, so errors are plain sentences.
  return r.status === 200 ? json(200, r.body) : new Response(r.body.error, { status: r.status });
};

export const config = { path: "/api/accounts" };
