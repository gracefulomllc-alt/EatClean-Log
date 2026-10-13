import { getStore } from "@netlify/blobs";
import { pushStore, pusher, stageAt, hoursSince } from "../lib/push-shared.js";
import { fetchGames } from "../lib/espn.js";
import { fastCheckDue, gameAlerts, spcAlert, nudgeAlerts, routineDue } from "../lib/alerts-core.js";
import { SPC_GAMES } from "../../src/spcSchedule.js";

// Runs every 10 minutes and does two jobs per subscribed device:
//  1. Fasting: if the fast has crossed into a stage it hasn't announced, send one note.
//  2. Logging reminders: at each reminder time, nudge - unless something was logged in
//     the last 4 hours, or a fast is running (a "log your lunch" at hour 17 would be wrong).
const REMINDER_WINDOW_MIN = 20;          // catch the reminder even if a tick runs a little late
const QUIET_IF_LOGGED_WITHIN = 4 * 36e5;

export function localNow(tz, now = Date.now()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23", weekday: "short",
  }).formatToParts(new Date(now)).map((p) => [p.type, p.value]));
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.weekday);
  return { date: `${parts.year}-${parts.month}-${parts.day}`, mins: +parts.hour * 60 + +parts.minute, weekday };
}
const toMins = (t) => +t.slice(0, 2) * 60 + +t.slice(3, 5);

export function dueReminder(rec, now = Date.now()) {
  const r = rec.reminders;
  if (!r?.times?.length || !r.tz) return null;
  const { date, mins } = localNow(r.tz, now);
  for (const t of r.times) {
    const m = toMins(t);
    if (mins < m || mins >= m + REMINDER_WINDOW_MIN) continue;
    const key = `${date}|${t}`;
    if ((rec.sent || []).includes(key)) continue;
    const skip = !!rec.start || (rec.lastLog && now - rec.lastLog < QUIET_IF_LOGGED_WITHIN);
    return { key, skip };
  }
  return null;
}

async function send(wp, store, key, rec, payload) {
  try {
    await wp.sendNotification(rec.sub, JSON.stringify(payload));
    return true;
  } catch (e) {
    if (e.statusCode === 404 || e.statusCode === 410) { await store.delete(key); rec._gone = true; return "gone"; }
    return false;
  }
}

export default async () => {
  const store = pushStore();
  const { blobs } = await store.list({ prefix: "dev:" });
  const groups = getStore("cutlog-groups");
  let wp = null, games = null;
  const now = Date.now();
  // One scoreboard fetch per tick, and only if someone actually follows an NBA team.
  const loadGames = async () => { if (games) return games; try { games = await fetchGames(); } catch { games = []; } return games; };

  for (const { key } of blobs) {
    const rec = await store.get(key, { type: "json" });
    if (!rec?.sub) continue;
    let dirty = false;

    // 1. fasting stages
    if (rec.start) {
      const hrs = hoursSince(rec.start);
      const st = stageAt(hrs);
      if (hrs <= 72 && st.at > 0 && st.at > (rec.lastAt ?? -1)) {
        wp = wp || await pusher();
        const ok = await send(wp, store, key, rec, { title: `${st.name} · ${Math.floor(hrs)}h`, body: st.body, tag: "fast-stage" });
        if (ok === "gone") continue;
        if (ok) { rec.lastAt = st.at; dirty = true; }
      }
    }

    // 2. logging reminders
    const due = dueReminder(rec, now);
    if (due) {
      rec.sent = [...(rec.sent || []), due.key].slice(-12);
      dirty = true;
      if (!due.skip) {
        wp = wp || await pusher();
        const last = rec.lastLog
          ? new Intl.DateTimeFormat("en-US", { timeZone: rec.reminders.tz, hour: "numeric", minute: "2-digit" }).format(new Date(rec.lastLog))
          : null;
        const ok = await send(wp, store, key, rec, {
          title: "Log what you've eaten?",
          body: last ? `Nothing logged since ${last}. Twenty seconds now saves guessing tonight.` : "Nothing logged yet today.",
          tag: "log-reminder",
        });
        if (ok === "gone") continue;
      }
    }

    // 3. fast check-in prompt (the same marks the app uses: 24h, then every 12h)
    const fc = fastCheckDue(rec, now);
    if (fc) {
      wp = wp || await pusher();
      const ok = await send(wp, store, key, rec, fc);
      if (ok === "gone") continue;
      if (ok) { rec.fcMark = fc.mark; dirty = true; }
    }

    if (rec._gone) continue;

    // 4. NBA tip-off / final for the team this person follows, and Texans tip-off
    const todo = [];
    if (rec.alerts?.team) todo.push(...gameAlerts(rec, await loadGames(), now));
    const spc = spcAlert(rec, SPC_GAMES, now);
    if (spc) todo.push(spc);
    for (const a of todo) {
      wp = wp || await pusher();
      const ok = await send(wp, store, key, rec, a);
      if (ok === "gone") break;
      if (ok) { rec.games = { ...(rec.games || {}), [a.id]: a.state }; dirty = true; }
    }
    // keep the memory of past games short
    if (rec.games && Object.keys(rec.games).length > 30) rec.games = Object.fromEntries(Object.entries(rec.games).slice(-20));

    if (rec._gone) continue;

    // 5. nudges from friends
    for (const l of rec.links || []) {
      const list = (await groups.get(`n:${l.gid}:${l.mid}`, { type: "json" })) || [];
      const fresh = nudgeAlerts(rec, l.gid, list);
      for (const n of fresh.slice(-3)) {
        wp = wp || await pusher();
        const ok = await send(wp, store, key, rec, n);
        if (ok === "gone") break;
      }
      if (fresh.length) { rec.nseen = { ...(rec.nseen || {}), [l.gid]: Math.max(...fresh.map((n) => n.at)) }; dirty = true; }
    }

    if (rec._gone) continue;

    // 6. water and weekly review
    if (rec.tz && (rec.alerts?.water || rec.alerts?.review)) {
      const r = routineDue(rec, localNow(rec.tz, now));
      if (r) {
        rec.rsent = [...(rec.rsent || []), r.key].slice(-12); dirty = true;
        wp = wp || await pusher();
        await send(wp, store, key, rec, r);
      }
    }

    if (dirty && !rec._gone) await store.setJSON(key, rec);
  }
};

export const config = { schedule: "*/10 * * * *" };
