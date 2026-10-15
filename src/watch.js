// Turn records from a watch or phone (see netlify/lib/health-core.js) into days in the log.
// Steps from several devices overlap, so each interval only counts the part nobody already counted.
import { mapWorkoutType, newSession, kindsOf } from "./training.js";

const pad = (n) => String(n).padStart(2, "0");
export const localKey = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const startOfNextDay = (ms) => { const d = new Date(ms); return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime(); };

// Split one interval at local midnights, sharing its steps in proportion to the time in each day.
function splitByDay(r) {
  const len = Math.max(1, r.e - r.s);
  const parts = [];
  let a = r.s;
  while (a < r.e || parts.length === 0) {
    const cut = Math.min(r.e, startOfNextDay(a));
    parts.push({ day: localKey(a), s: a, e: Math.max(cut, a + 1), c: (r.c * Math.max(1, cut - a)) / len });
    if (cut >= r.e) break;
    a = cut;
  }
  return parts;
}

export function stepsByDay(records) {
  const byDay = new Map();
  for (const r of records) if (r.k === "steps") for (const p of splitByDay(r)) (byDay.get(p.day) || byDay.set(p.day, []).get(p.day)).push(p);
  const out = {};
  for (const [day, parts] of byDay) {
    parts.sort((x, y) => x.s - y.s || x.e - y.e);
    const covered = [];                     // merged ranges already counted
    let total = 0;
    for (const p of parts) {
      const len = p.e - p.s;
      let overlap = 0;
      for (const [cs, ce] of covered) overlap += Math.max(0, Math.min(p.e, ce) - Math.max(p.s, cs));
      overlap = Math.min(len, overlap);
      total += p.c * (1 - overlap / len);
      covered.push([p.s, p.e]);
      covered.sort((x, y) => x[0] - y[0]);
      for (let i = 0; i < covered.length - 1;) { if (covered[i][1] >= covered[i + 1][0]) { covered[i][1] = Math.max(covered[i][1], covered[i + 1][1]); covered.splice(i + 1, 1); } else i++; }
    }
    out[day] = Math.round(total);
  }
  return out;
}

/**
 * @returns { days, changed, steps, sessions, sleep } - days is a new object only if something changed.
 * Steps never go down (the larger of what you typed and what the watch says). Sleep only fills an empty box.
 * A workout you deleted stays deleted.
 */
export function applyWatch(days, records, deleted = {}, now = Date.now()) {
  const out = { ...days };
  const touch = (k) => { if (out[k] === days[k]) out[k] = { ...(days[k] || { foods: [], steps: "", weight: "", tags: [], sleep: "", workouts: [], sessions: [] }) }; return out[k]; };
  let steps = 0, sessions = 0, sleep = 0;

  const sbd = stepsByDay(records);
  for (const r of records) if (r.k === "day" && r.steps != null) sbd[r.d] = Math.max(sbd[r.d] || 0, r.steps);
  for (const [k, n] of Object.entries(sbd)) {
    if (!(n > 0) || (+days[k]?.steps || 0) >= n) continue;
    touch(k).steps = String(n); steps++;
  }

  const sleepSec = {};
  for (const r of records) if (r.k === "sleep") sleepSec[localKey(r.e)] = (sleepSec[localKey(r.e)] || 0) + r.sec;
  for (const r of records) if (r.k === "day" && r.sleepH != null) sleepSec[r.d] = Math.max(sleepSec[r.d] || 0, r.sleepH * 3600);
  for (const [k, sec] of Object.entries(sleepSec)) {
    const h = Math.round((Math.min(sec, 16 * 3600) / 3600) * 10) / 10;
    if (!(h > 0) || String(days[k]?.sleep ?? "").trim() !== "") continue;
    touch(k).sleep = String(h); sleep++;
  }

  for (const r of records) {
    if (r.k !== "ex" && r.k !== "wk") continue;
    const k = r.k === "ex" ? localKey(r.s) : r.d;
    const id = "w:" + r.id;
    if (deleted["sess:" + id] || (out[k]?.sessions || []).some((x) => x.id === id)) continue;
    const m = mapWorkoutType(r.t);
    const min = r.k === "ex" ? Math.round(r.sec / 60) : r.min;
    const s = newSession(m.kind, { id, focus: m.focus || "", min, effort: 2, src: "watch", name: r.t, u: now, ...(r.m ? { dist: String(Math.round((r.m / 1609.34) * 10) / 10) } : {}) });
    const d = touch(k);
    d.sessions = [...(d.sessions || []), s];
    d.tags = [...new Set([...(d.tags || []), ...kindsOf(d.sessions)])];
    sessions++;
  }
  const changed = steps + sessions + sleep > 0;
  return { days: changed ? out : days, changed, steps, sessions, sleep };
}
