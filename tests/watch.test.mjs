process.env.TZ = process.env.TZ || "America/Denver";
import { applyWatch, stepsByDay, localKey } from "../src/watch.js";
let ok = 0, bad = 0; const t = (c, m) => { c ? ok++ : (bad++, console.log("FAIL", m)); };
const U = (y, mo, d, h = 0, mi = 0) => Date.UTC(y, mo - 1, d, h, mi);
// Denver is UTC-6 in October (MDT). 2026-10-15 06:00Z is local midnight at the start of the 15th.
const st = (s, e, c) => ({ k: "steps", s, e, c, id: `s|${s}|${e}` });
let sb = stepsByDay([st(U(2026, 10, 15, 12), U(2026, 10, 15, 14), 3000), st(U(2026, 10, 15, 14), U(2026, 10, 15, 15), 1000)]);
t(sb["2026-10-15"] === 4000, "two back-to-back intervals add up: " + JSON.stringify(sb));
sb = stepsByDay([st(U(2026, 10, 15, 12), U(2026, 10, 15, 14), 3000), st(U(2026, 10, 15, 12), U(2026, 10, 15, 14), 3000)]);
t(sb["2026-10-15"] === 3000, "the same steps from phone and watch count once");
sb = stepsByDay([st(U(2026, 10, 15, 12), U(2026, 10, 15, 14), 3000), st(U(2026, 10, 15, 13), U(2026, 10, 15, 15), 2000)]);
t(sb["2026-10-15"] === 4000, "half-overlapping intervals count the new half only: " + JSON.stringify(sb));
sb = stepsByDay([st(U(2026, 10, 15, 0), U(2026, 10, 16, 0), 12000)]);
t(sb["2026-10-14"] + sb["2026-10-15"] === 12000 && sb["2026-10-14"] > 0 && sb["2026-10-15"] > 0, "a 24-hour interval is split at local midnight: " + JSON.stringify(sb));
t(localKey(U(2026, 10, 15, 3)) === "2026-10-14", "3am UTC is still the 14th in Denver");
const rec = [
  st(U(2026, 10, 15, 14), U(2026, 10, 15, 16), 5000),
  { k: "sleep", e: U(2026, 10, 15, 13), sec: 7.5 * 3600, id: "z|1" },
  { k: "ex", s: U(2026, 10, 15, 1), e: U(2026, 10, 15, 2), sec: 3600, t: "WEIGHTLIFTING", id: "x|1|WEIGHTLIFTING" },
  { k: "ex", s: U(2026, 10, 15, 15), e: U(2026, 10, 15, 15, 30), sec: 1800, t: "RUNNING", m: 5000, id: "x|2|RUNNING" },
];
const days = { "2026-10-15": { foods: [], steps: "", weight: "", tags: [], sleep: "", workouts: [], sessions: [] } };
let r = applyWatch(days, rec, {}, 1);
t(r.changed && r.days["2026-10-15"].steps === "5000", "steps land on the day");
t(r.days["2026-10-15"].sleep === "7.5", "sleep lands on the day it ended");
const s14 = r.days["2026-10-14"]?.sessions || [], s15 = r.days["2026-10-15"].sessions;
t(s14.length === 1 && s14[0].kind === "lift" && s14[0].min === 60 && s14[0].src === "watch", "a lift that started at 7pm local lands on the 14th as a lifting session");
t(s15.length === 1 && s15[0].kind === "cardio" && s15[0].dist === "3.1", "run on the 15th with distance in miles: " + JSON.stringify(s15[0]));
t(r.days["2026-10-15"].tags.includes("cardio") && days["2026-10-15"].steps === "", "tags follow, original not mutated");
const again = applyWatch(r.days, rec, {}, 2);
t(!again.changed && again.days === r.days, "running it twice changes nothing");
const del = applyWatch(days, rec, { "sess:w:x|2|RUNNING": 5 }, 1);
t((del.days["2026-10-15"].sessions || []).length === 0, "a workout you deleted stays deleted");
const typed = applyWatch({ "2026-10-15": { ...days["2026-10-15"], steps: "9000", sleep: "6" } }, rec, {}, 1);
t(typed.days["2026-10-15"].steps === "9000" && typed.days["2026-10-15"].sleep === "6", "what you typed wins when it's higher / already filled");
const flat = applyWatch({}, [{ k: "day", d: "2026-10-15", steps: 8200, sleepH: 7.4, id: "d|2026-10-15" }, { k: "wk", d: "2026-10-15", t: "Basketball", min: 50, id: "w|2026-10-15|Basketball|50" }], {}, 1);
t(flat.days["2026-10-15"].steps === "8200" && flat.days["2026-10-15"].sleep === "7.4" && flat.days["2026-10-15"].sessions[0].kind === "ball" && flat.days["2026-10-15"].sessions[0].min === 50, "flat iPhone note works on an empty day");
console.log(bad ? `${bad} failed` : `watch ok (${ok})`); process.exit(bad ? 1 : 0);
