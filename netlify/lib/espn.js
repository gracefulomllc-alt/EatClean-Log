// ESPN's public NBA scoreboard, trimmed to what the app shows. Shared by the scores endpoint
// (what's on screen) and the 10-minute tick (who gets a tip-off or final alert).
export const SCOREBOARD = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard";

export function trimGames(j) {
  return (j?.events || []).map((e) => {
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
}

export async function fetchGames(dates = "") {
  const qs = /^\d{8}$/.test(dates) ? `?dates=${dates}` : "";
  const r = await fetch(SCOREBOARD + qs, { headers: { Accept: "application/json" } });
  if (!r.ok) throw new Error(`espn ${r.status}`);
  return trimGames(await r.json());
}
