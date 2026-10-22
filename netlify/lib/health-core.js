import { keyFor } from "./codekey.js";

// Steps, sleep and workouts sent from a watch or phone, kept under the same hashed key as the sync log.
// Two shapes are accepted: the Android "Health Connect Webhook" app's lists (steps, sleep, exercise), and a
// small flat note an iPhone Shortcut can build: { date, steps, sleep_hours, workouts: [{ type, minutes }] }.
export const MAX_BODY = 600_000;
export const KEEP_MS = 120 * 864e5;
export const MAX_RECORDS = 4000;

const ms = (v) => { const n = typeof v === "number" ? v : Date.parse(v); return Number.isFinite(n) ? n : null; };
const num = (v) => { const n = typeof v === "string" ? parseFloat(v) : v; return Number.isFinite(n) ? n : null; };
const dkey = (s) => (/^\d{4}-\d{2}-\d{2}$/.test(String(s || "")) ? String(s) : null);

export function normalize(body, now = Date.now()) {
  const out = [];
  const b = body && typeof body === "object" ? body : {};
  for (const x of Array.isArray(b.steps) ? b.steps : []) {
    const s = ms(x?.start_time), e = ms(x?.end_time), c = num(x?.count);
    if (s != null && e != null && e >= s && c != null && c >= 0 && c < 200000) out.push({ id: `s|${s}|${e}`, k: "steps", s, e, c: Math.round(c) });
  }
  for (const x of Array.isArray(b.sleep) ? b.sleep : []) {
    const e = ms(x?.session_end_time), sec = num(x?.duration_seconds);
    if (e != null && sec != null && sec > 0 && sec < 24 * 3600) out.push({ id: `z|${e}`, k: "sleep", e, sec: Math.round(sec) });
  }
  for (const x of Array.isArray(b.exercise) ? b.exercise : []) {
    const s = ms(x?.start_time), e = ms(x?.end_time);
    const sec = num(x?.duration_seconds) ?? (s != null && e != null ? (e - s) / 1000 : null);
    if (s == null || sec == null || sec < 60 || sec > 12 * 3600) continue;
    const r = { id: `x|${s}|${String(x?.type || "").slice(0, 40)}`, k: "ex", t: String(x?.type || "Workout").slice(0, 40), s, e: e ?? s + sec * 1000, sec: Math.round(sec) };
    const m = num(x?.distance_meters); if (m != null && m > 0) r.m = Math.round(m);
    out.push(r);
  }
  const d = dkey(b.date);
  if (d) {
    const steps = num(b.steps), sl = num(b.sleep_hours);
    if ((steps != null && steps >= 0 && steps < 200000 && !Array.isArray(b.steps)) || (sl != null && sl > 0 && sl < 24)) {
      const r = { id: `d|${d}`, k: "day", d };
      if (steps != null && !Array.isArray(b.steps)) r.steps = Math.round(steps);
      if (sl != null && sl > 0 && sl < 24) r.sleepH = Math.round(sl * 10) / 10;
      out.push(r);
    }
    for (const w of Array.isArray(b.workouts) ? b.workouts : []) {
      const min = num(w?.minutes);
      if (min != null && min >= 1 && min < 600) out.push({ id: `w|${d}|${String(w?.type || "Workout").slice(0, 40)}|${Math.round(min)}`, k: "wk", d, t: String(w?.type || "Workout").slice(0, 40), min: Math.round(min) });
    }
  }
  return out;
}

const when = (r) => r.e ?? r.s ?? (r.d ? Date.parse(r.d) : 0);

export async function handleHealth({ method, code, since = 0, days = 0, body, store, syncStore, now = Date.now() }) {
  const key = await keyFor(code);
  if (!key) return { status: 400, json: { error: "Your sync code should be 16 letters and numbers." } };
  if (!(await syncStore.get(key))) return { status: 404, json: { error: "Turn on sync in the app first, then try again." } };
  const raw = await store.get(key);
  const have = raw ? JSON.parse(raw) : { recs: {} };
  if (method === "GET") {
    // "since" gives only what arrived after a time; "days" gives everything from the last N days (steps need every interval of a day to add up).
    const cutoff = +days > 0 ? now - Math.min(+days, 120) * 864e5 : 0;
    const records = Object.values(have.recs).filter((r) => (r.r || 0) > (+since || 0) && when(r) >= cutoff).sort((a, b) => a.r - b.r);
    return { status: 200, json: { records, now } };
  }
  if (method !== "POST") return { status: 405, json: { error: "Use POST." } };
  const recs = normalize(body, now);
  if (!recs.length) {
    // The Health Connect Webhook app posts {timestamp, app_version, timezone} plus one list per type that had
    // new records. A batch with nothing we use (no new steps yet, or only heart rate) is a normal sync, not an
    // error: answer 200 so the phone doesn't count it as a failure and stop retrying good data.
    if (body && typeof body === "object" && typeof body.app_version === "string") return { status: 200, json: { ok: true, received: 0, added: 0, note: "Nothing to save in this batch (no steps, sleep or exercise)." } };
    return { status: 400, json: { error: "Nothing usable in that message. Send steps, sleep, exercise, or a date with steps." } };
  }
  let added = 0;
  for (const r of recs) {
    const prev = have.recs[r.id];
    if (!prev) added++;
    // Keep the first time we saw a record (so the app's pull never misses it), but take the newest values.
    have.recs[r.id] = { ...r, r: prev && JSON.stringify({ ...prev, r: 0 }) === JSON.stringify({ ...r, r: 0 }) ? prev.r : now };
  }
  let list = Object.values(have.recs).filter((r) => now - when(r) < KEEP_MS);
  if (list.length > MAX_RECORDS) list = list.sort((a, b) => when(b) - when(a)).slice(0, MAX_RECORDS);
  have.recs = Object.fromEntries(list.map((r) => [r.id, r]));
  await store.set(key, JSON.stringify(have));
  return { status: 200, json: { ok: true, received: recs.length, added } };
}
