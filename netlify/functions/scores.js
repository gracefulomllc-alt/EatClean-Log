// Today's NBA games from ESPN's public scoreboard. Fetched server-side so the browser never
// hits CORS, and trimmed to just what the app shows.
const json = (o, ttl = 0) => new Response(JSON.stringify(o), { headers: { "Content-Type": "application/json", "Cache-Control": ttl ? `public, max-age=${ttl}` : "no-store" } });

export default async (req) => {
  if (req.method !== "GET") return new Response("Method not allowed", { status: 405 });
  const access = Netlify.env.get("ACCESS_CODE");
  if (access && req.headers.get("x-access-code") !== access) return new Response("Bad access code", { status: 401 });

  const dates = new URL(req.url).searchParams.get("dates") || "";
  const qs = /^\d{8}$/.test(dates) ? `?dates=${dates}` : "";
  let r;
  try {
    r = await fetch(`https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard${qs}`, { headers: { Accept: "application/json" } });
  } catch { return json({ games: [], error: "unreachable" }); }
  if (!r.ok) return json({ games: [], error: `espn ${r.status}` });
  const j = await r.json();

  const games = (j.events || []).map((e) => {
    const c = e.competitions?.[0] || {};
    const side = (ha) => {
      const t = (c.competitors || []).find((x) => x.homeAway === ha) || {};
      return { name: t.team?.displayName || "", abbr: t.team?.abbreviation || "", score: t.score ?? "", record: t.records?.[0]?.summary || "", logo: t.team?.logo || "" };
    };
    return {
      id: e.id, start: e.date, state: e.status?.type?.state || "pre",   // pre | in | post
      status: e.status?.type?.shortDetail || "", away: side("away"), home: side("home"),
      // Preseason, regular season, play-in, playoffs all come through the same feed.
      phase: ({ 1: "Preseason", 3: "Playoffs", 4: "Offseason", 5: "Play-In" })[e.season?.type] || "",
      note: c.notes?.[0]?.headline || "",
      tv: (c.broadcasts || []).flatMap((b) => b.names || []).slice(0, 3).join(", "),
    };
  }).sort((a, b) => new Date(a.start) - new Date(b.start));
  return json({ games }, 30);
};

export const config = { path: "/api/scores" };
