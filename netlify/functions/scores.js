import { fetchGames } from "../lib/espn.js";
// Today's NBA games from ESPN's public scoreboard. Fetched server-side so the browser never
// hits CORS, and trimmed to just what the app shows.
const json = (o, ttl = 0) => new Response(JSON.stringify(o), { headers: { "Content-Type": "application/json", "Cache-Control": ttl ? `public, max-age=${ttl}` : "no-store" } });

export default async (req) => {
  if (req.method !== "GET") return new Response("Method not allowed", { status: 405 });
  const access = Netlify.env.get("ACCESS_CODE");
  if (access && req.headers.get("x-access-code") !== access) return new Response("Bad access code", { status: 401 });

  const dates = new URL(req.url).searchParams.get("dates") || "";
  try { return json({ games: await fetchGames(dates) }, 30); }
  catch (e) { return json({ games: [], error: /espn \d+/.test(e.message) ? e.message : "unreachable" }); }
};

export const config = { path: "/api/scores" };
