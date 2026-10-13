// Pure decisions for the 10-minute alert tick. Nothing here touches the network or storage,
// so every rule can be tested. Each function returns what to send; the tick sends it and
// records it on the device so the same alert never goes out twice.
const H = 36e5;
export const FAST_MARK_FIRST = 24, FAST_MARK_EVERY = 12;

// Which check-in mark a fast has reached: -1 before 24h, 0 at 24h, 1 at 36h, 2 at 48h...
export const markIndex = (hrs) => (hrs < FAST_MARK_FIRST ? -1 : Math.floor((hrs - FAST_MARK_FIRST) / FAST_MARK_EVERY));

export function fastCheckDue(rec, now = Date.now()) {
  if (!rec.alerts?.fastCheck || !rec.start) return null;
  const k = markIndex((now - rec.start) / H);
  if (k < 0 || k <= (rec.fcMark ?? -1)) return null;
  const hrs = Math.floor((now - rec.start) / H);
  return { mark: k, title: `Still fasting? ${hrs}h in`, body: "Open Cut Log and tap yes or no so your crew knows where you are.", tag: "fast-check" };
}

const lastWord = (s) => String(s || "").trim().split(/\s+/).pop().toLowerCase();
export const teamInGame = (g, team) => !!team && [g.home?.name, g.away?.name].some((n) => lastWord(n) === lastWord(team));
const line = (g) => `${g.away.abbr} ${g.away.score} – ${g.home.abbr} ${g.home.score}`;

// Tip-off when a game goes live, final when it ends. `rec.games` remembers the last state
// we told this device about; entries older than a day are dropped by the caller.
export function gameAlerts(rec, games, now = Date.now()) {
  const team = rec.alerts?.team;
  if (!team) return [];
  const out = [];
  for (const g of games) {
    if (!teamInGame(g, team)) continue;
    const seen = rec.games?.[g.id];
    if (g.state === "in" && !seen) out.push({ id: g.id, state: "in", title: `Tip-off: ${g.away.abbr} at ${g.home.abbr}`, body: `${g.phase || "NBA"} game is live${g.tv ? " on " + g.tv : ""}.`, tag: "game-" + g.id });
    // A game that ended before we ever saw it live (device switched on late) is old news.
    else if (g.state === "post" && seen === "in") out.push({ id: g.id, state: "post", title: "Final", body: line(g), tag: "game-" + g.id });
  }
  return out;
}

// Texans have no live feed, so this is schedule-based: a tip-off note when the posted time
// arrives, once. Games marked TBA are skipped because there's no real time to go by.
export function spcAlert(rec, schedule, now = Date.now()) {
  if (!rec.alerts?.spc) return null;
  for (const g of schedule) {
    if (g.tba) continue;
    const t = Date.parse(g.start);
    if (!(now >= t && now < t + 25 * 60e3)) continue;
    const key = "spc-" + g.start;
    if (rec.games?.[key]) continue;
    return { id: key, state: "in", title: `Texans tip-off ${g.home === false ? "at" : "vs"} ${g.opp}`, body: g.event || (g.conf ? "Conference game." : "South Plains men's basketball."), tag: key };
  }
  return null;
}

export function nudgeAlerts(rec, gid, list) {
  if (!rec.alerts?.nudges) return [];
  const seen = rec.nseen?.[gid] || 0;
  return (list || []).filter((n) => n.at > seen).map((n) => ({
    at: n.at,
    title: n.kind === "cheer" ? `${n.from} sent you a cheer` : `${n.from} is checking on you`,
    body: n.kind === "cheer" ? "Keep going." : "Open Cut Log and let your crew know how you're doing.",
    tag: "nudge-" + n.from,
  }));
}

// Water ping at 11:00 and 16:00 and a weekly review on Sunday 18:00, in the device's own
// time zone. The caller supplies local date/mins/weekday so this stays timezone-free.
const WINDOW = 20;
export function routineDue(rec, local) {
  const a = rec.alerts;
  if (!a || !local) return null;
  const hit = (m) => local.mins >= m && local.mins < m + WINDOW;
  const sent = rec.rsent || [];
  if (a.water) for (const [t, m] of [["11:00", 660], ["16:00", 960]]) {
    const key = `${local.date}|w${t}`;
    if (hit(m) && !sent.includes(key)) return { key, title: "Water check", body: "Grab a glass and tap it in. Hydration is part of today's score.", tag: "water" };
  }
  if (a.review && local.weekday === 0 && hit(1080)) {
    const key = `${local.date}|review`;
    if (!sent.includes(key)) return { key, title: "Weekly film session", body: "Your week is in the books. Open Stats and look at the trend.", tag: "review" };
  }
  return null;
}
