import { getStore } from "@netlify/blobs";
import { handleHealth, MAX_BODY } from "../lib/health-core.js";

// The address a watch or phone posts to. Your sync code is the key: it goes in the x-sync-code header
// (or ?code= for tools that can't set headers). The app reads the same records back with a GET.
export default async (req) => {
  const url = new URL(req.url);
  const code = req.headers.get("x-sync-code") || url.searchParams.get("code") || "";
  let body = null;
  if (req.method === "POST") {
    const text = await req.text();
    if (text.length > MAX_BODY) return new Response(JSON.stringify({ error: "That message is too large." }), { status: 413, headers: { "Content-Type": "application/json" } });
    try { body = JSON.parse(text); } catch { return new Response(JSON.stringify({ error: "That wasn't valid JSON." }), { status: 400, headers: { "Content-Type": "application/json" } }); }
  }
  const r = await handleHealth({ method: req.method, code, since: url.searchParams.get("since") || 0, days: url.searchParams.get("days") || 0, body, store: getStore("cutlog-health"), syncStore: getStore("cutlog-sync") });
  return new Response(JSON.stringify(r.json), { status: r.status, headers: { "Content-Type": "application/json" } });
};

export const config = { path: "/api/health" };
