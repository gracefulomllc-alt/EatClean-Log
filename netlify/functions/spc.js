import { parseRss } from "../lib/rss.js";
// South Plains has no live-score feed we can reach, so this reads the school's own news feed
// (game recaps and results). It tries the usual Sidearm address and fails quietly: the app
// just shows no headlines if the school changes it.
const FEEDS = ["https://www.spctexans.com/rss.aspx?path=mbkb", "https://spctexans.com/rss.aspx?path=mbkb"];
const json = (o, ttl = 0) => new Response(JSON.stringify(o), { headers: { "Content-Type": "application/json", "Cache-Control": ttl ? `public, max-age=${ttl}` : "no-store" } });

export default async (req) => {
  if (req.method !== "GET") return new Response("Method not allowed", { status: 405 });
  const access = Netlify.env.get("ACCESS_CODE");
  if (access && req.headers.get("x-access-code") !== access) return new Response("Bad access code", { status: 401 });
  for (const url of FEEDS) {
    try {
      const r = await fetch(url, { headers: { Accept: "application/rss+xml, application/xml, text/xml", "User-Agent": "Mozilla/5.0 (compatible; CutLog)" } });
      if (!r.ok) continue;
      const items = parseRss(await r.text());
      if (items.length) return json({ items, source: url }, 300);
    } catch { /* try the next one */ }
  }
  return json({ items: [], error: "feed unavailable" }, 120);
};

export const config = { path: "/api/spc" };
