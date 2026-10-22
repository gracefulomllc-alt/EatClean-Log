import { handleHealth, normalize, MAX_RECORDS } from "../netlify/lib/health-core.js";
import { keyFor } from "../netlify/lib/codekey.js";
let ok = 0, bad = 0; const t = (c, m) => { c ? ok++ : (bad++, console.log("FAIL", m)); };
const mem = () => { const m = new Map(); return { get: async (k) => m.get(k) ?? null, set: async (k, v) => { m.set(k, String(v)); }, m }; };
const store = mem(), syncStore = mem();
const CODE = "ABCD-EFGH-JKLM-NPQR", NOW = Date.UTC(2026, 9, 15, 12);
const H = (o) => handleHealth({ store, syncStore, now: NOW, code: CODE, ...o });
t((await H({ method: "POST", body: { steps: [] } })).status === 404, "unknown code is refused until sync is on");
await syncStore.set(await keyFor(CODE), "{}");
t((await H({ method: "POST", code: "short", body: {} })).status === 400, "bad code format");
t((await H({ method: "POST", body: { hello: 1 } })).status === 400, "nothing usable is explained");
{ const e = await H({ method: "POST", body: { timestamp: "2026-10-15T11:00:00Z", app_version: "2.1", timezone: "America/Denver", heart_rate: [{ bpm: 70, time: "2026-10-15T10:00:00Z" }] } });
  t(e.status === 200 && e.json.received === 0, "a Health Connect Webhook batch with nothing we use is a normal sync, not a failure"); }
const android = { timestamp: "2026-10-15T11:00:00Z", steps: [{ count: 4000, start_time: "2026-10-15T06:00:00Z", end_time: "2026-10-15T09:00:00Z" }, { count: 1200, start_time: "2026-10-15T09:00:00Z", end_time: "2026-10-15T10:00:00Z" }],
  sleep: [{ session_end_time: "2026-10-15T13:00:00Z", duration_seconds: 27000, stages: [] }],
  exercise: [{ type: "WEIGHTLIFTING", start_time: "2026-10-15T01:00:00Z", end_time: "2026-10-15T02:00:00Z", duration_seconds: 3600 }, { type: "RUNNING", start_time: "2026-10-14T01:00:00Z", end_time: "2026-10-14T01:30:00Z", duration_seconds: 1800, distance_meters: 5000 }] };
let r = await H({ method: "POST", body: android });
t(r.status === 200 && r.json.received === 5 && r.json.added === 5, "Android payload accepted: " + JSON.stringify(r.json));
r = await H({ method: "POST", body: android });
t(r.json.added === 0, "sending the same thing again adds nothing");
let g = await H({ method: "GET", since: 0 });
t(g.status === 200 && g.json.records.length === 5 && g.json.records.some((x) => x.k === "ex" && x.m === 5000), "app can read everything back");
t((await H({ method: "GET", since: NOW })).json.records.length === 0, "nothing new after the last pull");
const later = await handleHealth({ store, syncStore, now: NOW + 5000, code: CODE, method: "POST", body: { date: "2026-10-15", steps: 8200, sleep_hours: 7.4, workouts: [{ type: "Basketball", minutes: 50 }] } });
t(later.json.added === 2, "flat iPhone note: one day record and one workout: " + JSON.stringify(later.json));
g = await H({ method: "GET", since: NOW });
t(g.json.records.length === 2 && g.json.records.some((x) => x.k === "day" && x.steps === 8200 && x.sleepH === 7.4) && g.json.records.some((x) => x.k === "wk" && x.min === 50), "new records only after since");
t(normalize({ steps: [{ count: -5, start_time: "x", end_time: "y" }, { count: 100, start_time: "2026-10-15T00:00:00Z", end_time: "2026-10-14T00:00:00Z" }] }).length === 0, "bad steps rejected");
t(normalize({ exercise: [{ type: "RUNNING", start_time: "2026-10-15T00:00:00Z", duration_seconds: 10 }] }).length === 0, "10-second exercise ignored");
t(normalize({ date: "tomorrow", steps: 10 }).length === 0, "bad date ignored");
// old records are dropped, and the store never grows without bound
{ const rr = (await H({ method: "GET", days: 1 })).json.records; t(rr.length > 0 && !rr.some((x) => x.t === "RUNNING") && rr.some((x) => x.t === "WEIGHTLIFTING"), "days=1 leaves out the run from a day and a half ago"); }
const old = { exercise: [{ type: "RUNNING", start_time: "2026-01-01T00:00:00Z", end_time: "2026-01-01T01:00:00Z", duration_seconds: 3600 }] };
await H({ method: "POST", body: old });
t(!(await H({ method: "GET", since: 0 })).json.records.some((x) => x.s === Date.UTC(2026, 0, 1)), "records older than 120 days are pruned");
const many = { steps: Array.from({ length: MAX_RECORDS + 50 }, (_, i) => ({ count: 10, start_time: new Date(NOW - i * 60000).toISOString(), end_time: new Date(NOW - i * 60000 + 30000).toISOString() })) };
await H({ method: "POST", body: many });
t((await H({ method: "GET", since: 0 })).json.records.length <= MAX_RECORDS, "record count capped");
console.log(bad ? `${bad} failed` : `health ok (${ok})`); process.exit(bad ? 1 : 0);
