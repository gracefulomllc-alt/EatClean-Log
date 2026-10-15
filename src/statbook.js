// Stat Book: roll the logged days up into one box score for a time range. Pure functions, no React.
// Days are { foods, weight, waist, water, steps, sleep, tags, workouts, lifts, rest, ... } keyed "YYYY-MM-DD".
export const RANGES = [
  { id: "7", label: "7 days", n: 7 },
  { id: "15", label: "15 days", n: 15 },
  { id: "30", label: "30 days", n: 30 },
  { id: "60", label: "60 days", n: 60 },
  { id: "all", label: "All time", n: null },
];

const keyOf = (dt) => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
const addDays = (key, n) => { const [y, m, d] = key.split("-").map(Number); return keyOf(new Date(y, m - 1, d + n)); };
const daysBetween = (a, b) => { const p = (k) => { const [y, m, d] = k.split("-").map(Number); return Date.UTC(y, m - 1, d); }; return Math.round((p(b) - p(a)) / 864e5); };
const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };
const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const max = (xs) => (xs.length ? Math.max(...xs) : null);

// The keys that fall in the window, oldest first. "All time" starts at the first day with anything logged.
export function windowKeys(days, endKey, n) {
  const logged = Object.keys(days || {}).filter((k) => k <= endKey && hasData(days[k])).sort();
  if (n == null) {
    if (!logged.length) return [endKey];
    const span = daysBetween(logged[0], endKey) + 1;
    return Array.from({ length: span }, (_, i) => addDays(logged[0], i));
  }
  return Array.from({ length: n }, (_, i) => addDays(endKey, i - (n - 1)));
}
const hasData = (d) => !!d && ((d.foods || []).length > 0 || d.weight !== "" && d.weight != null || !!d.water || !!d.steps || !!d.sleep || (d.workouts || []).length > 0 || (d.lifts || []).length > 0 || (d.tags || []).length > 0 || !!d.rest);

// What a logged item is called, so "Eggs, 2 eggs" and "Eggs, 1 egg" count as the same food.
export const foodLabel = (f) => String(f.baseName || f.name || "").replace(/,\s*[\d./]+\s*[^,]*$/, "").trim();

/**
 * @param days        all days
 * @param endKey      last day of the window (today)
 * @param n           number of days, or null for all time
 * @param targetsFor  (day) => { calories, protein }
 * @param scoreFn     (day, targets) => { total, parts:[{key, done}] }
 * @param gradeMeals  (day) => [{ score, letter }] one entry per meal that has food
 * @param fasts       [{ start, end }] in ms
 * @param onTrack     score that counts as an on-track day
 */
export function buildStatBook({ days, endKey, n, targetsFor, scoreFn, gradeMeals, fasts = [], waterGoal = 100, onTrack = 70 }) {
  const keys = windowKeys(days, endKey, n);
  const inDays = keys.map((k) => ({ k, d: days?.[k] })).filter((x) => x.d);
  const eaten = inDays.filter((x) => (x.d.foods || []).length > 0);
  const per = eaten.map(({ k, d }) => {
    const foods = d.foods || [];
    const sum = (f) => foods.reduce((a, x) => a + (+x[f] || 0), 0);
    const t = targetsFor(d) || {};
    const sc = scoreFn(d, t);
    return { k, d, cal: sum("calories"), p: sum("protein"), c: sum("carbs"), f: sum("fat"), t, sc };
  });

  const nutrition = {
    cal: avg(per.map((x) => x.cal)), protein: avg(per.map((x) => x.p)), carbs: avg(per.map((x) => x.c)), fat: avg(per.map((x) => x.f)),
    bestProtein: max(per.map((x) => x.p)),
    proteinDays: per.filter((x) => x.t.protein > 0 && x.p >= x.t.protein * 0.9).length,
    calDays: per.filter((x) => x.sc.parts?.find((p) => p.key === "cal")?.done).length,
  };

  const scores = per.map((x) => x.sc.total);
  const score = { avg: avg(scores), best: max(scores), onTrack: scores.filter((s) => s >= onTrack).length };

  const meals = per.flatMap((x) => gradeMeals(x.d) || []);
  const dist = { A: 0, B: 0, C: 0, D: 0, F: 0 };
  meals.forEach((m) => { dist[String(m.letter)[0]] = (dist[String(m.letter)[0]] || 0) + 1; });
  const grades = { count: meals.length, avg: avg(meals.map((m) => m.score)), best: max(meals.map((m) => m.score)), tier1: dist.A, dist };

  const wts = inDays.map((x) => ({ k: x.k, w: num(x.d.weight) })).filter((x) => x.w != null);
  const wst = inDays.map((x) => ({ k: x.k, w: num(x.d.waist) })).filter((x) => x.w != null);
  const body = {
    weightStart: wts[0]?.w ?? null, weightNow: wts.length ? wts[wts.length - 1].w : null,
    weightChange: wts.length > 1 ? wts[wts.length - 1].w - wts[0].w : null, weighIns: wts.length,
    waistStart: wst[0]?.w ?? null, waistNow: wst.length ? wst[wst.length - 1].w : null,
    waistChange: wst.length > 1 ? wst[wst.length - 1].w - wst[0].w : null,
  };

  const water = inDays.map((x) => +x.d.water || 0).filter((v) => v > 0);
  const steps = inDays.map((x) => +x.d.steps || 0).filter((v) => v > 0);
  const sleep = inDays.map((x) => num(x.d.sleep)).filter((v) => v != null && v > 0);
  const inWin = new Set(keys);
  const fk = (ms) => { const dt = new Date(ms); return keyOf(dt); };
  const fin = (fasts || []).filter((f) => f && f.end && f.start && inWin.has(fk(f.end)));
  const fh = fin.map((f) => (f.end - f.start) / 36e5);
  const habits = {
    waterAvg: avg(water), waterBest: max(water), waterDays: water.filter((v) => v >= waterGoal).length,
    stepsAvg: avg(steps), stepsBest: max(steps), sleepAvg: avg(sleep), sleepBest: max(sleep),
    activeDays: inDays.filter((x) => (x.d.workouts || []).length || (x.d.lifts || []).length || (x.d.tags || []).length).length,
    restDays: inDays.filter((x) => x.d.rest).length,
    workouts: inDays.reduce((a, x) => a + (x.d.sessions || []).length, 0),
    workoutMin: inDays.reduce((a, x) => a + (x.d.sessions || []).reduce((b, s2) => b + (+s2.min || 0), 0), 0),
    focus: inDays.reduce((a, x) => { (x.d.sessions || []).forEach((s2) => { if (s2.focus) a[s2.focus] = (a[s2.focus] || 0) + 1; }); return a; }, {}),
    fasts: fin.length, fastAvg: avg(fh), fastLongest: max(fh),
  };

  const counts = new Map();
  eaten.forEach(({ d }) => (d.foods || []).forEach((f) => {
    const label = foodLabel(f); if (!label) return;
    const key = label.toLowerCase();
    const e = counts.get(key) || { name: label, count: 0, cal: 0 };
    e.count += 1; e.cal += +f.calories || 0; counts.set(key, e);
  }));
  const top = [...counts.values()].sort((a, b) => b.count - a.count || b.cal - a.cal).slice(0, 5);

  return { keys, span: keys.length, logged: eaten.length, active: inDays.length, nutrition, score, grades, body, habits, top };
}
