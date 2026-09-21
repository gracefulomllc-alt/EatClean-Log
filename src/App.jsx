import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { LineChart, Line, XAxis, YAxis, ResponsiveContainer, Tooltip, ReferenceLine, CartesianGrid } from "recharts";
import { Timer, Scale, Users, CalendarDays, Settings as Cog, Plus, X, Star, ChevronLeft, ChevronRight, ChefHat, MessageCircle } from "lucide-react";

/* ---------- storage: local for personal, server for the shared group ---------- */
const ACCESS = () => localStorage.getItem("cutlog:code") || "";
async function group(method, body) {
  const r = await fetch("/api/group", {
    method,
    headers: { "Content-Type": "application/json", "x-access-code": ACCESS() },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}
const store = {
  async get(key, shared) {
    if (shared) return group("POST", { op: "get", key });
    const v = localStorage.getItem(key);
    if (v === null) throw new Error("missing");
    return { key, value: v };
  },
  async set(key, value, shared) {
    if (shared) return group("POST", { op: "set", key, value });
    localStorage.setItem(key, value);
    return { key, value };
  },
  async list(prefix, shared) {
    if (shared) return group("POST", { op: "list", prefix });
    return { keys: Object.keys(localStorage).filter((k) => k.startsWith(prefix)) };
  },
};

/* ---------- sync: merging two copies of the log ---------- */
// Every item carries `u`, the time it was last edited. Deleting leaves a
// tombstone in `deleted` stamped with the deletion time. An item is dead only
// if it was deleted AFTER its last edit - so re-adding something you once
// deleted still works, and a stale device can't resurrect what you removed.
const TOMB_TTL = 90 * 864e5;
function mergeData(a, b) {
  if (!b) return a;
  if (!a) return b;
  const tomb = { ...(b.deleted || {}) };
  for (const [k, t] of Object.entries(a.deleted || {})) tomb[k] = Math.max(tomb[k] || 0, t);
  const now = Date.now();
  for (const k of Object.keys(tomb)) if (now - tomb[k] > TOMB_TTL) delete tomb[k];
  const alive = (key, it) => !(tomb[key] >= (it?.u || 0));
  const newer = (x, y) => ((x?.u || 0) >= (y?.u || 0) ? x : y);
  const byKey = (xs, ys, keyOf, prefix) => {
    const m = new Map();
    for (const it of [...(xs || []), ...(ys || [])]) {
      const k = keyOf(it);
      if (k == null || !alive(prefix + k, it)) continue;
      m.set(k, m.has(k) ? newer(m.get(k), it) : it);
    }
    return [...m.values()];
  };
  const days = {};
  for (const k of new Set([...Object.keys(a.days || {}), ...Object.keys(b.days || {})])) {
    const da = a.days?.[k], db = b.days?.[k];
    const base = !da ? db : !db ? da : newer(da, db);
    days[k] = { ...base, foods: byKey(da?.foods, db?.foods, (f) => f.id, "food:") };
  }
  const top = newer(a, b);
  return {
    ...top, days,
    fasts: byKey(a.fasts, b.fasts, (f) => f.end, "fast:").sort((x, y) => y.end - x.end).slice(0, 30),
    favorites: byKey(a.favorites, b.favorites, (f) => f.name, "fav:"),
    labs: byKey(a.labs, b.labs, (l) => l.id, "lab:"),
    list: byKey(a.list, b.list, (l) => l.id, "list:"),
    recipes: byKey(a.recipes, b.recipes, (r) => r.id, "recipe:"),
    photos: byKey(a.photos, b.photos, (p) => p.id, "photo:"),
    deleted: tomb,
    u: Math.max(a.u || 0, b.u || 0),
  };
}
const tombstone = (d, key) => ({ ...(d.deleted || {}), [key]: Date.now() });

async function api(path, payload) {
  const r = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-access-code": ACCESS() },
    body: JSON.stringify(payload),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}
const syncApi = (p) => api("/api/sync", p);
const pushApi = (p) => api("/api/push", p);

// 16 characters from an alphabet with no look-alikes (no 0/O, 1/I/L) - about 79 bits.
const genCode = () => {
  const A = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const b = crypto.getRandomValues(new Uint8Array(16));
  return [...b].map((x) => A[x % A.length]).join("").match(/.{4}/g).join("-");
};
const normCode = (s) => {
  const c = String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return c.length === 16 ? c.match(/.{4}/g).join("-") : null;
};
const deviceId = () => {
  let id = localStorage.getItem("cutlog:device");
  if (!id) { id = crypto.randomUUID(); localStorage.setItem("cutlog:device", id); }
  return id;
};
const b64ToBytes = (b64) => {
  const s = (b64 + "=".repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
};

// "6oz", "250g", "2 servings", "1 scoop"
const fmtQty = (q, unit) => (unit === "g" || unit === "oz") ? `${q}${unit}`
  : unit === "serving" ? `${q} serving${+q === 1 ? "" : "s"}` : `${q} ${unit}`;

/* ---------- progress photos: kept in this browser, and on your server if sync is on ---------- */
const photoDb = (() => {
  let dbp;
  const open = () => dbp || (dbp = new Promise((res, rej) => {
    const r = indexedDB.open("cutlog", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("photos");
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  }));
  const run = async (mode, fn) => {
    const db = await open();
    return new Promise((res, rej) => {
      const t = db.transaction("photos", mode);
      const q = fn(t.objectStore("photos"));
      t.oncomplete = () => res(q?.result);
      t.onerror = () => rej(t.error);
    });
  };
  return {
    get: (k) => run("readonly", (st) => st.get(k)),
    put: (k, v) => run("readwrite", (st) => st.put(v, k)),
    del: (k) => run("readwrite", (st) => st.delete(k)),
  };
})();

// Phone photos are 3-5 MB. Shrink to 1080px JPEG (~200 KB) before storing anything.
async function shrinkPhoto(file, max = 1080, quality = 0.82) {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", quality);
}

async function loadPhoto(id) {
  const local = await photoDb.get(id).catch(() => null);
  if (local) return local;
  const code = localStorage.getItem("cutlog:sync");
  if (!code) return null;
  try {
    const { image } = await api("/api/photos", { op: "get", code, id });
    if (image) photoDb.put(id, image).catch(() => {});
    return image || null;
  } catch { return null; }
}

const KEY = "cutlog:v2";
const SHARE_PREFIX = "cutlog:shared:v1:";
const slug = (s) => s.trim().toLowerCase().replace(/[^a-z0-9]/g, "") || "anon";

/* ---------- dates ---------- */
const dayKey = (d = new Date()) => {
  const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return z.toISOString().slice(0, 10);
};
const prettyDay = (k) => {
  const [y, m, d] = k.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
};
const shiftDay = (k, n) => {
  const [y, m, d] = k.split("-").map(Number);
  return dayKey(new Date(y, m - 1, d + n));
};
const clock = (ms) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};

/* ---------- fasting stages ---------- */
const STAGES = [
  { at: 0, name: "Fed", body: "Insulin is up and you're absorbing the meal. Nothing is coming out of storage yet." },
  { at: 4, name: "Post-absorptive", body: "Insulin is falling. Your liver starts releasing stored glucose to hold blood sugar steady." },
  { at: 8, name: "Glycogen drawdown", body: "Liver glycogen is running down and fat is starting to cover more of the load." },
  { at: 12, name: "Fat burning", body: "Most of your fuel is now fat. Hunger comes in waves here rather than steadily — it passes." },
  { at: 16, name: "Ketosis building", body: "Ketones are climbing. Appetite usually flattens out and focus often sharpens." },
  { at: 18, name: "Growth hormone rise", body: "Growth hormone trends upward. Part of why muscle holds up reasonably well through a fast." },
  { at: 20, name: "Autophagy window", body: "Cellular cleanup is thought to step up here. The human timing is poorly pinned down and most hard data is from animals." },
  { at: 24, name: "Deep fast", body: "Liver glycogen is largely gone and ketones are the main fuel. Mind your electrolytes and don't train hard in here." },
];
STAGES.forEach((st, i) => Object.defineProperty(st, "hue", { get: () => PALETTES[THEME].stages[i], enumerable: true }));
const stageAt = (h) => STAGES.reduce((a, s) => (h >= s.at ? s : a), STAGES[0]);
const nextStage = (h) => STAGES.find((s) => s.at > h) || null;

/* ---------- targets ---------- */
const ACTIVITY = {
  sedentary: { label: "Mostly desk and driving", mult: 1.2 },
  light: { label: "On my feet some days", mult: 1.375 },
  moderate: { label: "Active most days", mult: 1.55 },
  high: { label: "Hard physical work or training", mult: 1.725 },
};
const TAGS = { lift: { label: "Lifted", cal: 180 }, ball: { label: "Played ball", cal: 400 }, site: { label: "Job site", cal: 300 } };

/* ---------- adaptive maintenance: what your own results say ---------- */
// Energy balance: what you ate, minus what the scale says you lost, is what you burned.
//   maintenance ≈ average intake − (pounds lost × 3500 ÷ days)
// Pounds lost comes from a straight-line fit through your weigh-ins, which cancels out
// day-to-day water swings. The result is blended with the formula until there's enough
// data to trust it on its own, and clamped so a stretch of missed logging can't drag it
// somewhere absurd.
const ADAPT = { window: 28, minSpan: 21, minLogged: 14, minWeighIns: 8, completeDay: 800 };
function estimateTdee(days, formulaTdee, today = dayKey()) {
  const start = shiftDay(today, -(ADAPT.window - 1));
  const inWin = (k) => k >= start && k <= today;
  const keys = Object.keys(days || {}).sort();
  const firstW = keys.find((k) => +days[k]?.weight > 0);
  const base = { ready: false, formula: Math.round(formulaTdee), tdee: Math.round(formulaTdee) };
  if (!firstW) return { ...base, loggedDays: 0, weighIns: 0, span: 0, need: "Log your weight most mornings." };

  const dayNum = (k) => Math.round((new Date(k + "T12:00") - new Date(start + "T12:00")) / 864e5);
  const pts = keys.filter((k) => inWin(k) && +days[k]?.weight > 0).map((k) => [dayNum(k), +days[k].weight]);
  const intakes = keys.filter(inWin)
    .map((k) => (days[k].foods || []).reduce((a, f) => a + (+f.calories || 0), 0))
    .filter((c) => c >= ADAPT.completeDay);
  const span = Math.round((new Date(today + "T12:00") - new Date(firstW + "T12:00")) / 864e5) + 1;
  const stats = { loggedDays: intakes.length, weighIns: pts.length, span };

  if (span < ADAPT.minSpan || intakes.length < ADAPT.minLogged || pts.length < ADAPT.minWeighIns) {
    const need = [];
    if (span < ADAPT.minSpan) need.push(`${ADAPT.minSpan - span} more day${ADAPT.minSpan - span === 1 ? "" : "s"} of history`);
    if (intakes.length < ADAPT.minLogged) need.push(`${ADAPT.minLogged - intakes.length} more fully logged day${ADAPT.minLogged - intakes.length === 1 ? "" : "s"}`);
    if (pts.length < ADAPT.minWeighIns) need.push(`${ADAPT.minWeighIns - pts.length} more weigh-in${ADAPT.minWeighIns - pts.length === 1 ? "" : "s"}`);
    return { ...base, ...stats, need: `Needs ${need.join(", ")}.` };
  }

  const n = pts.length, mx = pts.reduce((a, p) => a + p[0], 0) / n, my = pts.reduce((a, p) => a + p[1], 0) / n;
  const slope = pts.reduce((a, p) => a + (p[0] - mx) * (p[1] - my), 0) / (pts.reduce((a, p) => a + (p[0] - mx) ** 2, 0) || 1);
  const avgIntake = intakes.reduce((a, c) => a + c, 0) / intakes.length;
  const raw = avgIntake - slope * 3500;                     // slope is lb/day; negative when losing
  const est = Math.min(formulaTdee * 1.35, Math.max(formulaTdee * 0.7, raw));
  // Sparse weigh-ins make the slope noisy, so trust grows with how many there are - full at ~20 in 4 weeks.
  const trust = Math.min(1, intakes.length / ADAPT.window) * Math.min(1, pts.length / 20);
  const tdee = Math.round((trust * est + (1 - trust) * formulaTdee) / 10) * 10;
  return { ...base, ...stats, ready: true, tdee, raw: Math.round(raw), avgIntake: Math.round(avgIntake),
    lbPerWeek: +(slope * 7).toFixed(2), clamped: raw !== est, trust: Math.round(trust * 100) };
}

function computeTargets(p, tags = [], tdeeOverride = null) {
  const bmr = 10 * (p.weight * 0.4536) + 6.25 * (p.heightIn * 2.54) - 5 * p.age + (p.sex === "male" ? 5 : -161);
  const tdee = tdeeOverride || bmr * ACTIVITY[p.activity].mult;
  const floor = p.sex === "male" ? 1500 : 1200;
  const raw = tdee - p.pace * 500;
  const base = Math.max(floor, Math.round(raw / 10) * 10);
  const earned = Math.min(500, tags.reduce((a, t) => a + (TAGS[t]?.cal || 0), 0));
  const calories = base + earned;
  const protein = Math.round(p.goalWeight * (tags.length ? 1.0 : 0.8));
  const fat = Math.round((calories * 0.27) / 9);
  const carbs = Math.max(0, Math.round((calories - protein * 4 - fat * 9) / 4));
  return { bmr: Math.round(bmr), tdee: Math.round(tdee), base, earned, calories, protein, fat, carbs,
    clamped: raw < floor, actualPace: (tdee - base) / 500 };
}

/* ---------- how big should this one meal be? ----------
   Two answers, because they disagree and both are worth knowing:
     even split   - what's left today, divided by the meals you haven't eaten yet
     typical share - the slice of the whole day's budget a meal of this kind usually takes
   The even split is the number to cook to; the two together give you a band to land inside.
   Weighing everything is what makes either number mean anything, so both are stated in
   calories you can actually hit on a scale rather than a vague "light dinner". */
const MEAL_SHARE = { Breakfast: 0.25, Lunch: 0.3, Dinner: 0.35, Snack: 0.1 };

function mealTarget(slot, targets, day, remainCal, remainP) {
  const eaten = new Set((day.foods || []).map((f) => f.meal));
  // Still to come: every meal with nothing logged against it, plus the one being planned.
  const mealsLeft = Math.max(1, MEALS.filter((m) => !eaten.has(m) || m === slot).length);
  const even = Math.max(0, Math.round(remainCal / mealsLeft));
  const typical = Math.round(targets.calories * (MEAL_SHARE[slot] ?? 0.25));
  return {
    even, typical, mealsLeft,
    lo: Math.min(even, typical), hi: Math.max(even, typical),
    protein: Math.max(0, Math.round(remainP / mealsLeft)),
    over: remainCal <= 0,
  };
}

/* ---------- food table (per 100 g as eaten) ---------- */
const FOODS = [
  { n: "Chicken breast, cooked", m: [165, 31, 0, 3.6], r: 1 },
  { n: "Chicken thigh, cooked", m: [209, 26, 0, 10.9], r: 1 },
  { n: "Ground beef 93/7, cooked", m: [182, 26, 0, 8], r: 1 },
  { n: "Ground beef 85/15, cooked", m: [250, 26, 0, 15], r: 1 },
  { n: "Ground turkey 93%, cooked", m: [203, 27, 0, 10], r: 1 },
  { n: "Sirloin steak, cooked", m: [212, 31, 0, 9], r: 1 },
  { n: "Pork chop, cooked", m: [231, 27, 0, 13], r: 1 },
  { n: "Salmon, cooked", m: [208, 22, 0, 13], r: 1 },
  { n: "White fish, cooked", m: [128, 26, 0, 2.7], r: 1 },
  { n: "Shrimp, cooked", m: [99, 24, 0.2, 0.3], r: 1 },
  { n: "Bacon, cooked", m: [541, 37, 1.4, 42] },
  { n: "Eggs", m: [143, 12.6, 0.7, 9.5], s: { label: "egg", g: 50 } },
  { n: "Greek yogurt, nonfat", m: [59, 10, 3.6, 0.4], s: { label: "cup", g: 227 } },
  { n: "Cottage cheese 2%", m: [84, 11, 4.3, 2.3], s: { label: "cup", g: 226 } },
  { n: "Cheddar cheese", m: [403, 25, 1.3, 33] },
  { n: "Whey protein powder", m: [400, 80, 8, 5], s: { label: "scoop", g: 30 } },
  { n: "White rice, cooked", m: [130, 2.7, 28, 0.3], s: { label: "cup", g: 158 } },
  { n: "Brown rice, cooked", m: [123, 2.7, 26, 1], s: { label: "cup", g: 195 } },
  { n: "Pasta, cooked", m: [158, 5.8, 31, 0.9], s: { label: "cup", g: 140 } },
  { n: "Oats, dry", m: [379, 13, 67, 6.5], s: { label: "half cup", g: 40 } },
  { n: "Potato, baked", m: [93, 2.5, 21, 0.1] },
  { n: "Sweet potato, baked", m: [90, 2, 21, 0.15] },
  { n: "Black beans, cooked", m: [132, 8.9, 24, 0.5], s: { label: "cup", g: 172 } },
  { n: "Bread", m: [265, 9, 49, 3.2], s: { label: "slice", g: 28 } },
  { n: "Flour tortilla", m: [306, 8, 51, 7.5], s: { label: "tortilla", g: 45 } },
  { n: "Broccoli, cooked", m: [35, 2.4, 7, 0.4] },
  { n: "Mixed greens", m: [20, 1.5, 3, 0.2] },
  { n: "Avocado", m: [160, 2, 8.5, 15] },
  { n: "Banana", m: [89, 1.1, 23, 0.3], s: { label: "banana", g: 118 } },
  { n: "Apple", m: [52, 0.3, 14, 0.2], s: { label: "apple", g: 182 } },
  { n: "Peanut butter", m: [588, 25, 20, 50], s: { label: "tbsp", g: 16 } },
  { n: "Almonds", m: [579, 21, 22, 50] },
  { n: "Olive oil", m: [884, 0, 0, 100], s: { label: "tbsp", g: 13.5 } },
  { n: "Butter", m: [717, 0.9, 0.1, 81], s: { label: "tbsp", g: 14 } },
];

const MEALS = ["Breakfast", "Lunch", "Dinner", "Snack"];
const tsToHHMM = (ts) => (ts ? new Date(ts).toTimeString().slice(0, 5) : "");
const hhmmToTs = (dk, hhmm) => {
  const [y, m, d] = dk.split("-").map(Number);
  const [H, M] = hhmm.split(":").map(Number);
  return new Date(y, m - 1, d, H || 0, M || 0).getTime();
};
// Right now's clock time, but on the day being viewed - so logging something
// to yesterday doesn't stamp it with today's date.
const stampFor = (dk) => (dk === dayKey() ? Date.now() : hhmmToTs(dk, tsToHHMM(Date.now())));
const prettyTime = (ts) => (ts ? new Date(ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "");
/* ---------- themes ----------
   Every color the components set themselves lives here, in both looks. C and MEAL_COLOR
   read from whichever theme is active, so no screen can end up half-switched.
   Glow effects append an alpha byte ("#6EE7F988"), so every entry used that way stays 6-digit hex. */
const PALETTES = {
  glass: {
    cal: "#6EE7F9", protein: "#A3E635", carbs: "#A78BFA", fat: "#FBBF24", bad: "#FB7185",
    water: "#7DD3FC", warn: "#FBBF24", idle: "#64748B",
    track: "rgba(255,255,255,0.09)", tickOff: "rgba(255,255,255,0.25)", dimText: "rgba(255,255,255,0.55)", faint: "rgba(255,255,255,0.28)",
    grid: "rgba(255,255,255,0.07)", axis: "rgba(255,255,255,0.45)",
    tip: { fontSize: 12, borderRadius: 12, border: "1px solid rgba(255,255,255,0.15)", background: "rgba(20,22,40,0.92)", color: "#fff" },
    cap: "round", glow: true, ringFade: 0.55,
    meal: { Breakfast: "#6EE7F9", Lunch: "#A3E635", Dinner: "#A78BFA", Snack: "#FBBF24" },
    stages: ["#94A3B8", "#7DD3FC", "#6EE7F9", "#5EEAD4", "#A3E635", "#FBBF24", "#FB923C", "#FB7185"],
  },
  retro: {
    cal: "#000080", protein: "#006B00", carbs: "#7A007A", fat: "#8A5A00", bad: "#C00000",
    water: "#00688A", warn: "#A04000", idle: "#808080",
    track: "#FFFFFF", tickOff: "#808080", dimText: "#404040", faint: "#909090",
    grid: "#A8A8A8", axis: "#000000",
    tip: { fontSize: 12, borderRadius: 0, border: "1px solid #000", background: "#FFFFE1", color: "#000" },
    cap: "butt", glow: false, ringFade: 1,
    meal: { Breakfast: "#000080", Lunch: "#006B00", Dinner: "#7A007A", Snack: "#8A5A00" },
    stages: ["#606060", "#00608A", "#000080", "#006B6B", "#006B00", "#8A5A00", "#A04000", "#C00000"],
  },
};
let THEME = "glass";
const C = new Proxy({}, { get: (_, k) => PALETTES[THEME][k] });
const MEAL_COLOR = new Proxy({}, { get: (_, k) => PALETTES[THEME].meal[k] });
const blankDay = () => ({ foods: [], steps: "", weight: "", tags: [], sleep: "", workouts: [] });
const guessMeal = () => { const h = new Date().getHours(); return h < 10 ? "Breakfast" : h < 15 ? "Lunch" : h < 21 ? "Dinner" : "Snack"; };
const reduced = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

async function foodApi(payload) {
  const r = await fetch("/api/food", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-access-code": ACCESS() },
    body: JSON.stringify(payload),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

async function askClaude(content, maxTokens = 2000) {
  const r = await fetch("/api/claude", {
    method: "POST", headers: { "Content-Type": "application/json", "x-access-code": ACCESS() },
    body: JSON.stringify({ max_tokens: maxTokens, messages: [{ role: "user", content }] }),
  });
  if (!r.ok) throw new Error(await r.text());
  const j = await r.json();
  const txt = j.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  return JSON.parse(txt.replace(/```json|```/g, "").trim());
}

/* ---------- motion helpers ---------- */
function useCountUp(value, ms = 700) {
  const [v, setV] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    if (reduced()) { from.current = value; setV(value); return; }
    const a = from.current, b = value, t0 = performance.now();
    let raf;
    const step = (t) => {
      const p = Math.min(1, (t - t0) / ms);
      setV(a + (b - a) * (1 - Math.pow(1 - p, 3)));
      if (p < 1) raf = requestAnimationFrame(step); else from.current = b;
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, ms]);
  return v;
}

function Ring({ pct, color, size = 240, stroke = 16, ticks = [], children, glow = true }) {
  const r = (size - stroke) / 2 - 8;
  const circ = 2 * Math.PI * r;
  const p = Number.isFinite(pct) ? Math.max(0, Math.min(1, pct)) : 0;
  return (
    <div className="ringwrap" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="ring">
        <defs>
          <linearGradient id="rg" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={C.ringFade} />
            <stop offset="100%" stopColor={color} />
          </linearGradient>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={C.track} strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="url(#rg)" strokeWidth={stroke}
          strokeLinecap={C.cap} strokeDasharray={circ} strokeDashoffset={circ * (1 - p)}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{ transition: reduced() ? "none" : "stroke-dashoffset 900ms cubic-bezier(.22,1,.36,1)", filter: glow && C.glow ? `drop-shadow(0 0 10px ${color}88)` : "none" }} />
        {ticks.map((t, i) => {
          const a = (t.at * 2 * Math.PI) - Math.PI / 2;
          return <circle key={i} cx={size / 2 + Math.cos(a) * r} cy={size / 2 + Math.sin(a) * r} r={t.hit ? 3.5 : 2.5}
            fill={t.hit ? t.color : C.tickOff} />;
        })}
      </svg>
      <div className="ringinner">{children}</div>
    </div>
  );
}

function Bar({ label, have, want, color }) {
  const shown = useCountUp(have);
  const met = have >= want;
  return (
    <div className="bar">
      <div className="row tiny"><span>{label}</span><span style={{ color: met ? color : C.dimText }}>{Math.round(shown)} / {want}g</span></div>
      <div className="track"><div style={{ width: `${Math.min(100, (have / want) * 100)}%`, background: color, boxShadow: `0 0 12px ${color}77` }} /></div>
    </div>
  );
}

/* ---------- app ---------- */
export default function CutLog() {
  const [data, setRawData] = useState(null);
  // Every edit you make stamps the log with the time, so sync can tell which copy is newer.
  // Loading from storage and merging from the server use setRawData, which doesn't stamp.
  const setData = useCallback((fn) => setRawData((d) => {
    const n = typeof fn === "function" ? fn(d) : fn;
    return n && n !== d ? { ...n, u: Date.now() } : n;
  }), []);
  const [locked, setLocked] = useState(null);
  THEME = data?.theme === "glass" ? "glass" : "retro";
  const [sync, setSync] = useState({ state: localStorage.getItem("cutlog:sync") ? "idle" : "off" });
  const dataRef = useRef(null);
  const syncBusy = useRef(false);
  const syncTimer = useRef(null);
  const didFirstSync = useRef(false);
  dataRef.current = data;

  const syncNow = useCallback(async () => {
    const code = localStorage.getItem("cutlog:sync");
    if (!code || syncBusy.current || !dataRef.current) return;
    syncBusy.current = true;
    setSync((x) => ({ ...x, state: "syncing" }));
    try {
      const remote = (await syncApi({ op: "get", code })).data;
      // Merge against whatever is current at the moment React applies it, and hand back the
      // same object when nothing changed - that's what stops sync from looping on itself.
      if (remote) setRawData((cur) => { const m = mergeData(cur, remote); return JSON.stringify(m) === JSON.stringify(cur) ? cur : m; });
      await syncApi({ op: "put", code, data: remote ? mergeData(dataRef.current, remote) : dataRef.current });
      setSync({ state: "ok", at: Date.now() });
    } catch (e) {
      setSync({ state: "error", at: Date.now(), err: String(e.message || e).slice(0, 160) });
    }
    syncBusy.current = false;
  }, []);

  const startSync = useCallback(async () => {
    const code = genCode();
    localStorage.setItem("cutlog:sync", code);
    setSync({ state: "idle" });
    await syncNow();
    return code;
  }, [syncNow]);

  const joinSync = useCallback(async (raw) => {
    const code = normCode(raw);
    if (!code) throw new Error("That code should be 16 letters and numbers.");
    const remote = (await syncApi({ op: "get", code })).data;
    if (!remote) throw new Error("No log found for that code. Check it on your other device.");
    localStorage.setItem("cutlog:sync", code);
    setRawData((cur) => mergeData(cur, remote));
    setSync({ state: "ok", at: Date.now() });
  }, []);

  const leaveSync = useCallback(() => {
    localStorage.removeItem("cutlog:sync");
    setSync({ state: "off" });
  }, []);

  // The strip above the app (phone status bar, page edges) matches the theme too
  useEffect(() => {
    const retro = data?.theme !== "glass";
    document.body.style.background = retro ? "#008080" : "#0A0E1F";
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", retro ? "#000080" : "#0A0E1F");
  }, [data?.theme]);

  // First sync once the local copy has loaded
  useEffect(() => {
    if (data && !didFirstSync.current) { didFirstSync.current = true; syncNow(); }
  }, [data, syncNow]);

  // Pull when you come back to the app, and every few minutes while it's open
  useEffect(() => {
    const onVis = () => document.visibilityState === "visible" && syncNow();
    document.addEventListener("visibilitychange", onVis);
    const t = setInterval(() => document.visibilityState === "visible" && syncNow(), 180000);
    return () => { document.removeEventListener("visibilitychange", onVis); clearInterval(t); };
  }, [syncNow]);

  // Tell the alert server when you last logged, so reminders stay quiet if you already did
  const lastLog = useMemo(() => {
    let m = 0;
    for (const d of Object.values(data?.days || {})) for (const f of d.foods || []) if ((f.at || 0) > m) m = f.at;
    return m;
  }, [data?.days]);
  useEffect(() => {
    if (!lastLog || localStorage.getItem("cutlog:alerts") !== "1") return;
    pushApi({ op: "logged", deviceId: deviceId(), at: lastLog }).catch(() => {});
  }, [lastLog]);

  // Tell the alert server when a fast starts or ends on this device
  useEffect(() => {
    if (!data || localStorage.getItem("cutlog:alerts") !== "1") return;
    pushApi({ op: "fast", deviceId: deviceId(), start: data.fast?.start || null }).catch(() => {});
  }, [data?.fast?.start]);
  const [tab, setTab] = useState("now");
  const [viewDay, setViewDay] = useState(dayKey());
  const [saveErr, setSaveErr] = useState(false);
  const first = useRef(true);

  useEffect(() => {
    (async () => {
      try { await group("POST", { op: "list", prefix: SHARE_PREFIX }); setLocked(false); }
      catch (e) { setLocked(/access code/i.test(String(e.message))); }
    })();
  }, []);

  useEffect(() => {
    (async () => {
      const empty = { profile: null, days: {}, favorites: [], fast: null, fasts: [], share: false, calib: [], list: [], labs: [], menus: {}, recipes: [], deleted: {} };
      try { setRawData({ ...empty, ...JSON.parse((await store.get(KEY)).value) }); }
      catch { setRawData(empty); }
    })();
  }, []);

  useEffect(() => {
    if (!data) return;
    if (first.current) { first.current = false; return; }
    (async () => {
      try { await store.set(KEY, JSON.stringify(data)); setSaveErr(false); } catch { setSaveErr(true); }
      if (localStorage.getItem("cutlog:sync")) {
        clearTimeout(syncTimer.current);
        syncTimer.current = setTimeout(syncNow, 1500);
      }
      if (data.share && data.profile?.name) {
        const recent = {};
        Object.keys(data.days).sort().slice(-21).forEach((k) => { recent[k] = data.days[k]; });
        const t = computeTargets(data.profile, []);
        try {
          await store.set(SHARE_PREFIX + slug(data.profile.name), JSON.stringify({
            name: data.profile.name.trim(), updated: Date.now(), start: data.profile.weight,
            goal: data.profile.goalWeight, target: t.base, proteinTarget: t.protein, days: recent }), true);
        } catch { /* best effort */ }
      }
    })();
  }, [data]);

  const day = { ...blankDay(), ...(data?.days?.[viewDay] || {}) };
  // Once there are ~3 weeks of weigh-ins and logged days, your real results replace the formula.
  const adaptive = useMemo(() => (data?.profile ? estimateTdee(data.days, computeTargets(data.profile, []).tdee) : null), [data?.days, data?.profile]);
  const useAdaptive = data?.useAdaptive !== false && !!adaptive?.ready;
  const targets = useMemo(() => (data?.profile ? computeTargets(data.profile, day.tags, useAdaptive ? adaptive.tdee : null) : null),
    [data?.profile, day.tags, useAdaptive, adaptive]);
  const updateDay = useCallback((k, fn) => setData((d) => ({ ...d, days: { ...d.days, [k]: { ...fn(d.days[k] || blankDay()), u: Date.now() } } })), [setData]);

  if (locked) return <Shell theme={THEME}><Gate onOk={() => setLocked(false)} /></Shell>;
  if (!data) return <Shell theme={THEME}><div className="glass pad center"><p className="dim">Waking up…</p></div></Shell>;
  if (!data.profile) return <Shell theme={THEME}>
    <JoinSync onJoin={joinSync} />
    <ProfileForm
      initial={{ name: "", sex: "male", age: 40, heightIn: 70, weight: 224, goalWeight: 180, activity: "light", pace: 1.5 }}
      title="Set your numbers" cta="Start" intro="Sets your daily budget. Change any of it later."
      onSave={(profile) => setData((d) => ({ ...d, profile }))} /></Shell>;

  const TABS = START_ITEMS;

  return (
    <Shell theme={THEME}>
      {THEME === "retro" && <RetroBoot />}
      {saveErr && <div className="glass pad alert">That change didn’t save. Back up from Setup before closing.</div>}
      <div key={tab} className="fadein">
        {tab === "now" && <Now {...{ data, setData, dayId: viewDay, setDayId: setViewDay, day, targets, updateDay }} />}
        {tab === "plan" && <Plan data={data} setData={setData} targets={targets} day={day} updateDay={updateDay} />}
        {tab === "weight" && <Weight data={data} setData={setData} targets={targets} updateDay={updateDay} />}
        {tab === "coach" && <Coach data={data} setData={setData} targets={targets} adaptive={adaptive} />}
        {tab === "log" && <LogTab data={data} setData={setData} onPick={(k) => { setViewDay(k); setTab("now"); }} />}
        {tab === "setup" && <Settings data={data} setData={setData} onSave={(p) => setData((d) => ({ ...d, profile: p }))} adaptive={adaptive} useAdaptive={useAdaptive}
          sync={sync} syncNow={syncNow} startSync={startSync} joinSync={joinSync} leaveSync={leaveSync} />}
      </div>
      <nav className="dock">
        {THEME === "retro" && <StartMenu setTab={setTab} />}
        {TABS.map(([id, label, Icon]) => (
          <button key={id} className={tab === id ? "dockbtn on" : "dockbtn"} onClick={() => setTab(id)}>
            <Icon size={19} strokeWidth={1.7} /><span>{label}</span>
          </button>
        ))}
        <TrayClock />
      </nav>
    </Shell>
  );
}

// The tab list, shared by the taskbar and the Start menu.
const START_ITEMS = [["now", "Now", Timer], ["plan", "Plan", ChefHat], ["coach", "Coach", MessageCircle],
  ["weight", "Weight", Scale], ["log", "Log", CalendarDays], ["setup", "Setup", Cog]];

/* ---------- 90s desktop furniture: boot splash and a Start menu ---------- */
// Shown once per browser session, and never when the OS asks for reduced motion.
function RetroBoot() {
  const [done, setDone] = useState(() => reduced() || sessionStorage.getItem("cutlog:booted") === "1");
  const finish = useCallback(() => { sessionStorage.setItem("cutlog:booted", "1"); setDone(true); }, []);
  useEffect(() => {
    if (done) return;
    const t = setTimeout(finish, 1700);
    return () => clearTimeout(t);
  }, [done, finish]);
  if (done) return null;
  return (
    <div className="boot" onClick={finish} role="presentation">
      <div className="bootbox">
        <div className="bootlogo">Cut Log<span>95</span></div>
        <div className="bootbar"><div /></div>
        <p className="boottip">Starting Cut Log…</p>
      </div>
    </div>
  );
}

const StartFlag = () => (
  <svg width="15" height="15" viewBox="0 0 15 15" shapeRendering="crispEdges" aria-hidden="true">
    <rect x="0" y="1" width="6" height="6" fill="#FF3B30" /><rect x="7" y="0" width="7" height="7" fill="#34C759" />
    <rect x="0" y="8" width="6" height="6" fill="#0A84FF" /><rect x="7" y="8" width="7" height="7" fill="#FFCC00" />
  </svg>
);

function StartMenu({ setTab }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const onKey = (e) => { if (e.key === "Escape") close(); };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("pointerdown", close); window.removeEventListener("keydown", onKey); };
  }, [open]);
  return (
    <>
      <button className="startbtn" aria-expanded={open} aria-label="Start"
        onPointerDown={(e) => { e.stopPropagation(); setOpen((o) => !o); }}>
        <StartFlag /><span>Start</span>
      </button>
      {open && (
        <div className="startmenu" onPointerDown={(e) => e.stopPropagation()}>
          <div className="startstripe"><span>Cut Log 95</span></div>
          <div className="startitems">
            {START_ITEMS.map(([id, label, Icon]) => (
              <button key={id} className="startitem" onClick={() => { setTab(id); setOpen(false); }}>
                <Icon size={17} strokeWidth={1.8} />{label}
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

function TrayClock() {
  const [t, setT] = useState(() => new Date());
  useEffect(() => { const i = setInterval(() => setT(new Date()), 20000); return () => clearInterval(i); }, []);
  return <span className="tray">{t.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>;
}

/* ---------- now ---------- */
function Now({ data, setData, dayId, setDayId, day, targets, updateDay }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const removeFood = (id) => setData((d) => ({ ...d, deleted: tombstone(d, "food:" + id),
    days: { ...d.days, [dayId]: { ...(d.days[dayId] || blankDay()), foods: (d.days[dayId]?.foods || []).filter((x) => x.id !== id), u: Date.now() } } }));
  const [showStages, setShowStages] = useState(false);
  const [now, setNow] = useState(Date.now());
  const fast = data.fast;
  const isToday = dayId === dayKey();

  useEffect(() => {
    if (!fast) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [fast]);

  const t = day.foods.reduce((a, f) => ({ cal: a.cal + f.calories, p: a.p + f.protein, c: a.c + f.carbs, ft: a.ft + f.fat }), { cal: 0, p: 0, c: 0, ft: 0 });
  const left = targets.calories - t.cal;
  const shownLeft = useCountUp(Math.abs(left));
  const hours = fast ? (now - fast.start) / 36e5 : 0;
  const st = fast ? stageAt(hours) : null;
  const nx = fast ? nextStage(hours) : null;

  return (
    <>
      {fast ? (
        <div className="glass hero">
          <Ring pct={Math.min(1, hours / 24)} color={st.hue}
            ticks={STAGES.map((sg) => ({ at: sg.at / 24, hit: hours >= sg.at, color: sg.hue }))}>
            <div className="mono huge">{clock(now - fast.start)}</div>
            <div className="stagename" style={{ color: st.hue }}>{st.name}</div>
            <div className="dim tiny">{nx ? `${nx.name} in ${(nx.at - hours).toFixed(1)}h` : "deep fast"}</div>
          </Ring>
          <p className="stagebody">{st.body}</p>
          <div className="rowbtns">
            <button className="btn ghost" onClick={() => setShowStages(!showStages)}>{showStages ? "Hide" : "All stages"}</button>
            <button className="btn ghost" onClick={() => setData((d) => ({ ...d, fast: { ...d.fast, start: d.fast.start - 18e5 } }))}>−30m</button>
            <button className="btn solid" onClick={() => setData((d) => ({ ...d, fast: null,
              fasts: [{ end: Date.now(), hours: +((Date.now() - d.fast.start) / 36e5).toFixed(1) }, ...(d.fasts || [])].slice(0, 30) }))}>Break it</button>
          </div>
        </div>
      ) : (
        <div className="glass hero">
          <Ring pct={0} color={C.idle} glow={false}>
            <div className="mono huge dim">0:00:00</div>
            <div className="dim tiny">not fasting</div>
          </Ring>
          <button className="btn solid wide big" onClick={() => setData((d) => ({ ...d, fast: { start: Date.now() } }))}>Start fasting</button>
          {(data.fasts || [])[0] && <p className="dim tiny center">Last fast: {data.fasts[0].hours}h</p>}
        </div>
      )}

      {showStages && (
        <div className="glass fadein">
          {STAGES.map((s) => (
            <div key={s.at} className={st && s.at === st.at ? "stagerow on" : "stagerow"}>
              <span className="mono hr" style={{ color: hours >= s.at && fast ? s.hue : undefined }}>{s.at}h</span>
              <div><div className="sname">{s.name}</div><div className="dim tiny">{s.body}</div></div>
            </div>
          ))}
          <p className="dim tiny pad">Rough averages. Your own switchover depends on your last meal, your training, and how depleted you already were.</p>
        </div>
      )}

      <div className="daynav">
        <button className="icon" onClick={() => setDayId(shiftDay(dayId, -1))} aria-label="Previous day"><ChevronLeft size={18} /></button>
        <span>{isToday ? "Today" : prettyDay(dayId)}</span>
        <button className="icon" onClick={() => setDayId(shiftDay(dayId, 1))} disabled={isToday} aria-label="Next day"><ChevronRight size={18} /></button>
      </div>

      <div className="glass pad">
        <div className="fuelhead">
          <div>
            <div className="bignum" style={{ color: left < 0 ? C.bad : "#fff" }}>{Math.round(shownLeft).toLocaleString()}</div>
            <div className="dim tiny">{left < 0 ? "over budget" : "calories left"}</div>
          </div>
          <div className="right dim tiny">
            <div>{t.cal.toLocaleString()} in</div>
            <div>{targets.calories.toLocaleString()} budget{targets.earned ? ` +${targets.earned}` : ""}</div>
          </div>
        </div>
        <div className="fuel">
          {day.foods.map((f) => <div key={f.id} style={{ width: `${(f.calories / Math.max(targets.calories, t.cal)) * 100}%`, background: MEAL_COLOR[f.meal], boxShadow: `0 0 10px ${MEAL_COLOR[f.meal]}88` }} />)}
          {t.cal > targets.calories && <div className="overtick" style={{ left: `${(targets.calories / t.cal) * 100}%` }} />}
        </div>
        <div className="bars">
          <Bar label="Protein" have={t.p} want={targets.protein} color={C.protein} />
          <Bar label="Carbs" have={t.c} want={targets.carbs} color={C.carbs} />
          <Bar label="Fat" have={t.ft} want={targets.fat} color={C.fat} />
        </div>
      </div>

      <div className="glass pad">
        <div className="chips">
          {Object.entries(TAGS).map(([k, v]) => (
            <button key={k} className={day.tags.includes(k) ? "chip on" : "chip"}
              onClick={() => updateDay(dayId, (d) => ({ ...d, tags: d.tags.includes(k) ? d.tags.filter((x) => x !== k) : [...d.tags, k] }))}>{v.label}</button>
          ))}
        </div>
        <p className="dim tiny">{day.tags.length ? `Protein up to ${targets.protein}g, ${targets.earned} calories back. Use sparingly — earned calories are the easiest place to overshoot.` : "Tag a workout or a job-site day to move your protein target and budget."}</p>
        {fast && day.tags.some((x) => x === "lift" || x === "ball") && (
          <p className="cue">Trained fasted. Get protein in within two hours of breaking this — that decides whether what comes off is fat or muscle.</p>
        )}
        {fast && hours >= 16 && <p className="cue">Past 16h on water, headaches and cramps are sodium. A pinch of salt handles it.</p>}
        {fast && targets.protein - t.p > 0 && <p className="cue">{Math.round(targets.protein - t.p)}g of protein still to go. Front-load it when you break.</p>}
      </div>

      {(() => {
        const ts = day.foods.map((f) => f.at).filter(Boolean);
        if (ts.length < 2) return null;
        const a = Math.min(...ts), b = Math.max(...ts), mins = (b - a) / 60000;
        return <p className="dim tiny center" style={{ marginBottom: 8 }}>Eating window {prettyTime(a)} – {prettyTime(b)} · {Math.floor(mins / 60)}h {Math.round(mins % 60)}m</p>;
      })()}

      <div className="glass">
        {day.foods.length === 0 ? <p className="dim center pad">Nothing logged yet.</p> :
          MEALS.filter((m) => day.foods.some((f) => f.meal === m)).map((m) => (
            <div key={m}>
              <div className="mealhead"><span className="dot" style={{ background: MEAL_COLOR[m], boxShadow: `0 0 8px ${MEAL_COLOR[m]}` }} />{m}
                <span className="right dim">{day.foods.filter((f) => f.meal === m).reduce((a, f) => a + f.calories, 0)}</span></div>
              {day.foods.slice().sort((a, b) => (a.at || 0) - (b.at || 0)).filter((f) => f.meal === m).map((f) => (
                <React.Fragment key={f.id}>
                <div className="fooditem">
                  <div className="tapable" onClick={() => setEditing(editing === f.id ? null : f.id)}>
                    <div>{f.name}</div>
                    <div className="dim tiny timerow">
                      <input className="timeinput" type="time" value={tsToHHMM(f.at)} onClick={(e) => e.stopPropagation()}
                        onChange={(e) => updateDay(dayId, (d) => ({ ...d, foods: d.foods.map((x) => x.id === f.id ? { ...x, at: hhmmToTs(dayId, e.target.value), u: Date.now() } : x) }))} />
                      <span>{Math.round(f.protein)}p · {Math.round(f.carbs)}c · {Math.round(f.fat)}f</span>
                    </div>
                  </div>
                  <div className="fright">
                    <span className="mono">{f.calories}</span>
                    <button className="icon" title="Save as favorite" onClick={() => setData((d) => ({ ...d, favorites: [{ name: f.name, calories: f.calories, protein: f.protein, carbs: f.carbs, fat: f.fat, per: f.per, qty: f.qty, unit: f.unit, baseName: f.baseName, raw: f.raw, u: Date.now() }, ...d.favorites.filter((x) => x.name !== f.name)].slice(0, 40) }))}><Star size={15} /></button>
                    <button className="icon" title="Remove" onClick={() => removeFood(f.id)}><X size={15} /></button>
                  </div>
                </div>
                {editing === f.id && <EditFood food={f} onClose={() => setEditing(null)}
                  onDelete={() => { removeFood(f.id); setEditing(null); }}
                  onSave={(nf) => { updateDay(dayId, (d) => ({ ...d, foods: d.foods.map((x) => x.id === f.id ? { ...nf, u: Date.now() } : x) })); setEditing(null); }} />}
                </React.Fragment>
              ))}
            </div>
          ))}
      </div>

      {data.favorites.length > 0 && (
        <div className="chips">
          {data.favorites.map((f) => (
            <button key={f.name} className="chip"
              onClick={() => updateDay(dayId, (d) => ({ ...d, foods: [...d.foods, { ...f, id: crypto.randomUUID(), meal: guessMeal(), at: stampFor(dayId), u: Date.now() }] }))}
              onContextMenu={(e) => { e.preventDefault(); setData((d) => ({ ...d, deleted: tombstone(d, "fav:" + f.name), favorites: d.favorites.filter((x) => x.name !== f.name) })); }}>
              {f.name} <span className="dim">{f.calories}</span>
            </button>
          ))}
        </div>
      )}

      {open ? <AddFood onCancel={() => setOpen(false)} calib={data.calib || []} recipes={data.recipes || []} setData={setData}
        onCalib={(n) => setData((d) => ({ ...d, calib: [n, ...(d.calib || [])].slice(0, 12) }))}
        onAdd={(items) => { updateDay(dayId, (d) => ({ ...d, foods: [...d.foods, ...items.map((i) => ({ at: stampFor(dayId), ...i, u: Date.now() }))] })); setOpen(false); }} />
        : <button className="btn solid wide big" onClick={() => setOpen(true)}><Plus size={18} /> Add food</button>}

      {(() => {
        const goal = data.profile.waterOz || 100, have = +day.water || 0;
        return (
          <div className="glass pad">
            <div className="row"><label style={{ margin: 0 }}>Water</label>
              <span className="mono" style={{ color: have >= goal ? C.water : undefined }}>{have} / {goal} oz</span></div>
            <div className="track"><div style={{ width: `${Math.min(100, (have / goal) * 100)}%`, background: C.water, boxShadow: `0 0 10px ${C.water}88` }} /></div>
            <div className="chips" style={{ marginTop: 10, marginBottom: 0 }}>
              {[8, 16, 24].map((n) => (
                <button key={n} className="chip" onClick={() => updateDay(dayId, (d) => ({ ...d, water: (+d.water || 0) + n }))}>+{n} oz</button>))}
              <button className="chip" disabled={!have} onClick={() => updateDay(dayId, (d) => ({ ...d, water: Math.max(0, (+d.water || 0) - 8) }))}>−8</button>
            </div>
          </div>
        );
      })()}

      <div className="glass pad">
        <div className="row"><label>Steps</label>
          <input className="mini" type="number" inputMode="numeric" placeholder="—" value={day.steps}
            onChange={(e) => updateDay(dayId, (d) => ({ ...d, steps: e.target.value }))} /></div>
        <div className="row"><label>Sleep (h)</label>
          <input className="mini" type="number" step="0.1" inputMode="decimal" placeholder="—" value={day.sleep || ""}
            onChange={(e) => updateDay(dayId, (d) => ({ ...d, sleep: e.target.value }))} /></div>
        {(day.workouts || []).map((w, i) => <div key={i} className="dim tiny">{w.name} · {Math.round(w.minutes)} min</div>)}
        {day.sleep && +day.sleep < 6 && <p className="cue">Under six hours. Short sleep pushes appetite up hard — if today is a fight, that's why, not willpower.</p>}
      </div>
    </>
  );
}


/* ---------- edit a logged entry ---------- */
// Anything logged by weight, label or recipe knows its per-unit values, so changing
// the amount rescales everything. Photo and describe entries are treated as one
// portion, so you can still say "that was actually 1.5 of those".
function EditFood({ food, onSave, onDelete, onClose }) {
  const per = food.per || [food.calories, food.protein, food.carbs, food.fat];
  const unit = food.per ? food.unit : "portion";
  const [qty, setQty] = useState(String(food.per ? food.qty : 1));
  const [name, setName] = useState(food.name);
  const [nameTouched, setNameTouched] = useState(false);
  const [meal, setMeal] = useState(food.meal);
  const [v, setV] = useState({ calories: food.calories, protein: food.protein, carbs: food.carbs, fat: food.fat });

  const rescale = (q) => {
    setQty(q);
    const n = +q || 0;
    setV({ calories: Math.round(per[0] * n), protein: +(per[1] * n).toFixed(1), carbs: +(per[2] * n).toFixed(1), fat: +(per[3] * n).toFixed(1) });
    if (food.baseName && !nameTouched && n) setName(`${food.baseName}, ${fmtQty(q, unit)}${food.raw ? " raw" : ""}`);
  };

  const save = () => {
    const n = +qty || 0;
    const vals = { calories: Math.round(+v.calories || 0), protein: +v.protein || 0, carbs: +v.carbs || 0, fat: +v.fat || 0 };
    onSave({ ...food, name: name.trim() || food.name, meal, ...vals,
      // Keep the per-unit values in step with whatever was typed, so the next edit still scales right.
      ...(n > 0 ? { qty: n, unit, per: [vals.calories / n, vals.protein / n, vals.carbs / n, vals.fat / n] } : {}) });
  };

  return (
    <div className="editbox fadein">
      <input value={name} onChange={(e) => { setName(e.target.value); setNameTouched(true); }} />
      <div className="row gap">
        <label style={{ margin: 0, flex: 1 }}>Amount</label>
        <input className="mini" type="number" step="any" inputMode="decimal" value={qty} onChange={(e) => rescale(e.target.value)} />
        <span className="dim small" style={{ minWidth: 56 }}>{unit === "portion" ? "× portion" : unit}</span>
      </div>
      {unit === "portion" && (
        <div className="chips">{["0.5", "0.75", "1", "1.25", "1.5", "2"].map((q) => (
          <button key={q} className={qty === q ? "chip on" : "chip"} onClick={() => rescale(q)}>{q}×</button>))}</div>
      )}
      <div className="quad small">
        {[["calories", "Cal"], ["protein", "P"], ["carbs", "C"], ["fat", "F"]].map(([k, l]) => (
          <div key={k}><label>{l}</label><input type="number" inputMode="decimal" value={v[k]}
            onChange={(e) => setV((x) => ({ ...x, [k]: e.target.value }))} /></div>))}
      </div>
      <MealPick meal={meal} setMeal={setMeal} />
      <div className="rowbtns">
        <button className="btn ghost" onClick={onDelete}>Delete</button>
        <button className="btn ghost wide" onClick={onClose}>Cancel</button>
        <button className="btn solid wide" onClick={save}>Save</button>
      </div>
    </div>
  );
}

/* ---------- join an existing log from a new device ---------- */
function JoinSync({ onJoin }) {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const go = async () => {
    setBusy(true); setErr("");
    try { await onJoin(code); } catch (e) { setErr(String(e.message || e)); }
    setBusy(false);
  };
  if (!open) return (
    <button className="btn ghost wide" style={{ marginBottom: 12 }} onClick={() => setOpen(true)}>
      Already use Cut Log on another device?</button>
  );
  return (
    <div className="glass pad stack">
      <h2>Bring your log over</h2>
      <p className="dim small">On your other device, open Setup → Sync and copy the code shown there.</p>
      <input placeholder="XXXX-XXXX-XXXX-XXXX" value={code} autoCapitalize="characters"
        onChange={(e) => setCode(e.target.value)} onKeyDown={(e) => e.key === "Enter" && go()} />
      <button className="btn accent wide" onClick={go} disabled={busy || !code.trim()}>{busy ? "Pulling your log…" : "Connect"}</button>
      {err && <p className="alert">{err}</p>}
    </div>
  );
}

/* ---------- add food ---------- */
function AddFood({ onAdd, onCancel, calib, onCalib, recipes, setData }) {
  const [mode, setMode] = useState("weigh");
  const [meal, setMeal] = useState(guessMeal());
  return (
    <div className="glass pad stack fadein">
      <div className="chips">
        {[["weigh", "Weigh"], ["label", "Label"], ["recipe", "Recipe"], ["photo", "Photo"], ["desc", "Describe"]].map(([k, l]) => (
          <button key={k} className={mode === k ? "chip on" : "chip"} onClick={() => setMode(k)}>{l}</button>))}
      </div>
      {mode === "recipe" && <Recipes recipes={recipes} setData={setData} meal={meal} setMeal={setMeal} onAdd={onAdd} onCancel={onCancel} />}
      {mode === "weigh" && <WeighIt meal={meal} setMeal={setMeal} onAdd={onAdd} onCancel={onCancel} />}
      {mode === "label" && <LabelIt meal={meal} setMeal={setMeal} onAdd={onAdd} onCancel={onCancel} />}
      {mode === "photo" && <SnapIt meal={meal} setMeal={setMeal} onAdd={onAdd} onCancel={onCancel} calib={calib} onCalib={onCalib} />}
      {mode === "desc" && <DescribeIt meal={meal} setMeal={setMeal} onAdd={onAdd} onCancel={onCancel} />}
    </div>
  );
}

/* ---------- recipes: home-cooked dishes, logged by the gram ---------- */
const sumMacros = (items) => items.reduce((a, i) => [a[0] + (+i.calories || 0), a[1] + (+i.protein || 0), a[2] + (+i.carbs || 0), a[3] + (+i.fat || 0)], [0, 0, 0, 0]);

function Recipes({ recipes, setData, meal, setMeal, onAdd, onCancel }) {
  const [building, setBuilding] = useState(null);   // null | "new" | a recipe being edited
  const [pick, setPick] = useState(null);
  const [by, setBy] = useState("g");
  const [amt, setAmt] = useState("");

  if (building) return (
    <RecipeBuilder initial={building === "new" ? null : building}
      onDone={(r) => {
        if (r) setData((d) => ({ ...d, recipes: [...(d.recipes || []).filter((x) => x.id !== r.id), { ...r, u: Date.now() }] }));
        setBuilding(null);
      }} />
  );

  if (pick) {
    const tot = sumMacros(pick.items);
    const div = by === "g" ? pick.cookedG : pick.servings;
    const per = tot.map((v) => v / (div || 1));
    const n = +amt || 0;
    const m = per.map((v) => v * n);
    const unit = by === "g" ? "g" : "serving";
    return (
      <>
        <div className="row"><h2>{pick.name}</h2><button className="icon" onClick={() => setPick(null)}><X size={16} /></button></div>
        <p className="dim tiny">Whole recipe: {Math.round(tot[0]).toLocaleString()} cal · {Math.round(tot[1])}g protein
          {pick.cookedG ? ` · ${pick.cookedG}g finished` : ""}{pick.servings ? ` · ${pick.servings} servings` : ""}</p>
        {pick.cookedG > 0 && pick.servings > 0 && (
          <div className="chips">
            <button className={by === "g" ? "chip on" : "chip"} onClick={() => setBy("g")}>By weight</button>
            <button className={by === "serving" ? "chip on" : "chip"} onClick={() => setBy("serving")}>By servings</button>
          </div>
        )}
        <div className="row gap">
          <input autoFocus type="number" inputMode="decimal" placeholder={by === "g" ? "Grams on your plate" : "Servings"}
            value={amt} onChange={(e) => setAmt(e.target.value)} />
          <span className="dim small">{by === "g" ? "g" : "servings"}</span>
        </div>
        <div className="quad">
          {[["calories", m[0]], ["protein", m[1]], ["carbs", m[2]], ["fat", m[3]]].map(([l, v], i) => (
            <div key={l}><div className="midnum" style={{ color: [C.cal, C.protein, C.carbs, C.fat][i] }}>{Math.round(v)}</div><div className="dim tiny">{l}</div></div>))}
        </div>
        <MealPick meal={meal} setMeal={setMeal} />
        <div className="rowbtns">
          <button className="btn ghost wide" onClick={() => setPick(null)}>Back</button>
          <button className="btn solid wide" disabled={!n} onClick={() => onAdd([{
            id: crypto.randomUUID(), meal, name: `${pick.name}, ${fmtQty(amt, unit)}`,
            baseName: pick.name, unit, qty: n, per: per.map((v) => +v.toFixed(4)),
            calories: Math.round(m[0]), protein: +m[1].toFixed(1), carbs: +m[2].toFixed(1), fat: +m[3].toFixed(1) }])}>Log</button>
        </div>
      </>
    );
  }

  return (
    <>
      {!recipes.length && <p className="dim small">Build a dish once — chili, a casserole, overnight oats — and log any portion of it by weight after that.</p>}
      {recipes.map((r) => {
        const t = sumMacros(r.items);
        return (
          <div key={r.id} className="recipeRow">
            <button className="listbtn" style={{ flex: 1 }} onClick={() => { setPick(r); setBy(r.cookedG ? "g" : "serving"); setAmt(""); }}>
              {r.name}
              <span className="dim tiny" style={{ display: "block" }}>
                {r.cookedG ? `${Math.round((t[0] / r.cookedG) * 100)} cal per 100g` : `${Math.round(t[0] / r.servings)} cal per serving`}
              </span>
            </button>
            <button className="icon" title="Edit" onClick={() => setBuilding(r)}>✎</button>
            <button className="icon" title="Delete" onClick={() => setData((d) => ({ ...d, deleted: tombstone(d, "recipe:" + r.id),
              recipes: (d.recipes || []).filter((x) => x.id !== r.id) }))}><X size={15} /></button>
          </div>
        );
      })}
      <div className="rowbtns">
        <button className="btn ghost wide" onClick={onCancel}>Cancel</button>
        <button className="btn accent wide" onClick={() => setBuilding("new")}>+ New recipe</button>
      </div>
    </>
  );
}

function RecipeBuilder({ initial, onDone }) {
  const [name, setName] = useState(initial?.name || "");
  const [items, setItems] = useState(initial?.items || []);
  const [cookedG, setCookedG] = useState(initial?.cookedG ? String(initial.cookedG) : "");
  const [servings, setServings] = useState(initial?.servings ? String(initial.servings) : "");
  const [adding, setAdding] = useState(initial ? null : "weigh");
  const noop = () => {};
  const tot = sumMacros(items);
  const addItems = (its) => { setItems((x) => [...x, ...its]); setAdding(null); };
  const ready = name.trim() && items.length && (+cookedG > 0 || +servings > 0);

  return (
    <>
      <h2>{initial ? "Edit recipe" : "New recipe"}</h2>
      <input placeholder="Name it — e.g. Turkey chili" value={name} onChange={(e) => setName(e.target.value)} />

      {items.length > 0 && (
        <div className="ingredients">
          {items.map((i, n) => (
            <div key={i.id || n} className="row small ingrow">
              <span style={{ flex: 1 }}>{i.name}</span>
              <span className="mono dim">{Math.round(i.calories)}</span>
              <button className="icon" onClick={() => setItems((x) => x.filter((_, k) => k !== n))}><X size={13} /></button>
            </div>
          ))}
          <div className="row small" style={{ paddingTop: 8 }}>
            <strong>Total</strong>
            <span className="mono">{Math.round(tot[0]).toLocaleString()} cal · {Math.round(tot[1])}p · {Math.round(tot[2])}c · {Math.round(tot[3])}f</span>
          </div>
        </div>
      )}

      {adding ? (
        <div className="subpanel stack">
          <div className="chips">
            {[["weigh", "Weigh"], ["label", "Label"], ["desc", "Describe"]].map(([k, l]) => (
              <button key={k} className={adding === k ? "chip on" : "chip"} onClick={() => setAdding(k)}>{l}</button>))}
          </div>
          <p className="dim tiny">Weigh ingredients before they go in. For meat, pick a raw USDA entry or tick "Weighed raw". Don't forget the oil.</p>
          {adding === "weigh" && <WeighIt meal="Dinner" setMeal={noop} hideMeal cta="Add" onAdd={addItems} onCancel={() => setAdding(null)} />}
          {adding === "label" && <LabelIt meal="Dinner" setMeal={noop} hideMeal cta="Add" onAdd={addItems} onCancel={() => setAdding(null)} />}
          {adding === "desc" && <DescribeIt meal="Dinner" setMeal={noop} hideMeal cta="Add" onAdd={addItems} onCancel={() => setAdding(null)} />}
        </div>
      ) : (
        <button className="btn ghost wide" onClick={() => setAdding("weigh")}>+ Add ingredient</button>
      )}

      <div className="subpanel stack">
        <div className="row gap"><label style={{ margin: 0, flex: 1 }}>Finished weight</label>
          <input className="mini" type="number" inputMode="decimal" placeholder="grams" value={cookedG} onChange={(e) => setCookedG(e.target.value)} /></div>
        <p className="dim tiny">Weigh the full pot when it's done, then subtract what the empty pot weighs. Cooking drives off water, so this — not the raw total — is what makes each portion exact.</p>
        <div className="row gap"><label style={{ margin: 0, flex: 1 }}>Or servings it makes</label>
          <input className="mini" type="number" inputMode="decimal" placeholder="e.g. 6" value={servings} onChange={(e) => setServings(e.target.value)} /></div>
      </div>

      <div className="rowbtns">
        <button className="btn ghost wide" onClick={() => onDone(null)}>Cancel</button>
        <button className="btn solid wide" disabled={!ready} onClick={() => onDone({
          id: initial?.id || crypto.randomUUID(), name: name.trim(), items,
          cookedG: +cookedG || 0, servings: +servings || 0 })}>Save recipe</button>
      </div>
    </>
  );
}

const MealPick = ({ meal, setMeal }) => (
  <div className="chips">{MEALS.map((m) => <button key={m} className={meal === m ? "chip on" : "chip"} onClick={() => setMeal(m)}>{m}</button>)}</div>
);

function Scanner({ onCode, onClose }) {
  const ref = useRef(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    let stream, raf, stop = false;
    (async () => {
      if (!("BarcodeDetector" in window)) {
        setErr("This browser can't scan barcodes. Type the number instead.");
        return;
      }
      try {
        const det = new window.BarcodeDetector({ formats: ["ean_13", "ean_8", "upc_a", "upc_e", "code_128"] });
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        ref.current.srcObject = stream;
        await ref.current.play();
        const tick = async () => {
          if (stop) return;
          try {
            const codes = await det.detect(ref.current);
            if (codes[0]?.rawValue) { stop = true; onCode(codes[0].rawValue); return; }
          } catch { /* frame not ready */ }
          raf = requestAnimationFrame(tick);
        };
        tick();
      } catch {
        setErr("Couldn't open the camera. Allow camera access, or type the number.");
      }
    })();
    return () => { stop = true; cancelAnimationFrame(raf); stream?.getTracks().forEach((t) => t.stop()); };
  }, [onCode]);

  return (
    <div className="qbox">
      <video ref={ref} className="shot" playsInline muted />
      <p className="dim tiny">Hold the barcode steady in frame.</p>
      {err && <p className="alert">{err}</p>}
      <button className="btn ghost wide" onClick={onClose}>Close scanner</button>
    </div>
  );
}

function LabelIt({ meal, setMeal, onAdd, onCancel, hideMeal, cta = "Log" }) {
  const [img, setImg] = useState(null);
  const [busy, setBusy] = useState(false);
  const [panel, setPanel] = useState(null);
  const [servings, setServings] = useState("1");
  const [err, setErr] = useState("");

  const pickFile = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const b64 = await new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result.split(",")[1]); r.onerror = () => rej(); r.readAsDataURL(f);
    });
    setImg({ data: b64, type: f.type, url: URL.createObjectURL(f) });
    setPanel(null); setErr("");
  };

  const read = async () => {
    setBusy(true); setErr("");
    try {
      const p = await askClaude([
        { type: "image", source: { type: "base64", media_type: img.type, data: img.data } },
        { type: "text", text: `This is a photograph of a Nutrition Facts panel. Transcribe it exactly as printed. Do not estimate, infer, or correct anything - if a number is unreadable, use null rather than guessing.

Respond with ONLY JSON:
{"name":"product name if visible, else null","servingSize":"the serving size exactly as printed, e.g. 2/3 cup (55g)","servingGrams":the serving weight in grams as a number, or null if not printed,"servingsPerContainer":number or null,"calories":number,"protein":number,"carbs":number,"fat":number}

The macro numbers are PER SERVING, exactly as the panel states them.` }]);
      if (!p.calories) throw new Error();
      setPanel(p);
    } catch { setErr("Couldn't read that panel. Get closer, straight on, good light."); }
    setBusy(false);
  };

  const n = +servings || 0;
  const total = panel ? {
    calories: Math.round(panel.calories * n), protein: Math.round((panel.protein || 0) * n),
    carbs: Math.round((panel.carbs || 0) * n), fat: Math.round((panel.fat || 0) * n),
  } : null;

  return (
    <>
      {!img ? (
        <>
          <label className="dropzone">Photograph the Nutrition Facts panel
            <input type="file" accept="image/*" capture="environment" onChange={pickFile} style={{ display: "none" }} /></label>
          <p className="dim tiny">Fill the frame with the panel and shoot straight on. This reads the printed numbers rather than estimating, so it's the most accurate way to log anything packaged.</p>
        </>
      ) : (
        <>
          <img src={img.url} alt="Nutrition label" className="shot" />
          {!panel && <button className="btn accent wide" onClick={read} disabled={busy}>{busy ? "Reading the panel…" : "Read this label"}</button>}
        </>
      )}

      {panel && (
        <div className="fadein stack">
          <input value={panel.name || ""} placeholder="Product name"
            onChange={(e) => setPanel((p) => ({ ...p, name: e.target.value }))} />
          <p className="dim tiny">
            Panel says: {panel.calories} cal per serving{panel.servingSize ? ` (${panel.servingSize})` : ""}
            {panel.servingsPerContainer ? ` · ${panel.servingsPerContainer} servings per container` : ""}
          </p>
          <div className="row"><label>How many servings did you eat?</label>
            <input className="mini" type="number" step="0.25" inputMode="decimal" value={servings}
              onChange={(e) => setServings(e.target.value)} /></div>
          <div className="quad">
            {[["calories", total.calories], ["protein", total.protein], ["carbs", total.carbs], ["fat", total.fat]].map(([l, v], i) => (
              <div key={l}><div className="midnum" style={{ color: [C.cal, C.protein, C.carbs, C.fat][i] }}>{v}</div><div className="dim tiny">{l}</div></div>))}
          </div>
          {!hideMeal && <MealPick meal={meal} setMeal={setMeal} />}
        </div>
      )}

      {err && <p className="alert">{err}</p>}
      <div className="rowbtns">
        <button className="btn ghost wide" onClick={onCancel}>Cancel</button>
        <button className="btn solid wide" disabled={!panel || !n} onClick={() => onAdd([{
          id: crypto.randomUUID(), meal,
          name: `${panel.name || "Packaged food"}, ${fmtQty(servings, "serving")}`,
          baseName: panel.name || "Packaged food", unit: "serving", qty: n,
          per: [panel.calories, panel.protein || 0, panel.carbs || 0, panel.fat || 0],
          ...total }])}>{cta}</button>
      </div>
    </>
  );
}

function WeighIt({ meal, setMeal, onAdd, onCancel, hideMeal, cta = "Log" }) {
  const [q, setQ] = useState(""); const [pick, setPick] = useState(null);
  const [amt, setAmt] = useState(""); const [unit, setUnit] = useState("g"); const [raw, setRaw] = useState(false);
  const [remote, setRemote] = useState([]); const [searching, setSearching] = useState(false); const [searchErr, setSearchErr] = useState("");
  const [bc, setBc] = useState(""); const [note, setNote] = useState(""); const [scanning, setScanning] = useState(false);

  const local = q.trim() && !pick ? FOODS.filter((f) => f.n.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 5) : [];

  // USDA lookup, debounced, only once the query is worth sending
  useEffect(() => {
    if (pick || q.trim().length < 3) { setRemote([]); return; }
    const t = setTimeout(async () => {
      setSearching(true);
      setSearchErr("");
      try { const d = await foodApi({ op: "search", query: q.trim() }); setRemote(d.foods || []); }
      catch (e) {
        setRemote([]);
        setSearchErr(/429/.test(String(e.message)) ? "USDA lookups are rate-limited right now — add a USDA_API_KEY or wait an hour."
          : "USDA search isn't responding. The built-in foods above still work.");
      }
      setSearching(false);
    }, 450);
    return () => clearTimeout(t);
  }, [q, pick]);

  const take = (f, src) => { setPick({ n: f.n || f.name, m: f.m, s: f.s, r: f.r, src }); setQ(f.n || f.name); setUnit(f.s ? "s" : "g"); setRaw(false); setNote(""); };

  const scanCode = async (codeIn) => {
    const codeStr = String(codeIn || bc).trim();
    if (!codeStr) return;
    setNote("Looking it up…");
    try {
      const d = await foodApi({ op: "barcode", barcode: codeStr });
      if (d.food) { take(d.food, "Label"); setBc(""); }
      else setNote(d.reason || "Not found.");
    } catch { setNote("Lookup failed."); }
  };
  const scan = () => scanCode(bc);

  const entered = pick ? (unit === "g" ? +amt || 0 : unit === "oz" ? (+amt || 0) * 28.35 : (+amt || 0) * (pick.s?.g || 0)) : 0;
  const grams = raw ? entered * 0.75 : entered;
  const m = pick ? pick.m.map((v) => (v * grams) / 100) : [0, 0, 0, 0];

  return (
    <>
      <input autoFocus placeholder="chicken breast, rice, whey…" value={q}
        onChange={(e) => { setQ(e.target.value); setPick(null); }} />

      {!pick && !scanning && (
        <>
          <button className="btn ghost wide" onClick={() => setScanning(true)}>Scan a barcode</button>
          <div className="row gap">
            <input placeholder="Or type the number" value={bc} inputMode="numeric"
              onChange={(e) => setBc(e.target.value)} onKeyDown={(e) => e.key === "Enter" && scan()} />
            <button className="btn ghost" onClick={scan} disabled={!bc.trim()}>Look up</button>
          </div>
        </>
      )}
      {scanning && <Scanner onClose={() => setScanning(false)}
        onCode={(code) => { setScanning(false); setBc(code); setTimeout(() => scanCode(code), 0); }} />}
      {note && <p className="dim tiny">{note}</p>}

      {local.map((f) => (
        <button key={f.n} className="listbtn" onClick={() => take(f, "Table")}>
          {f.n}<span className="badge good" style={{ marginLeft: 8 }}>quick</span>
        </button>
      ))}
      {searching && <p className="dim tiny">Searching USDA…</p>}
      {remote.map((f, i) => (
        <button key={`u${i}`} className="listbtn" onClick={() => take(f, "USDA")}>
          {f.name}<span className="badge" style={{ marginLeft: 8 }}>USDA</span>
        </button>
      ))}
      {searchErr && !pick && <p className="alert">{searchErr}</p>}
      {q.trim().length >= 3 && !pick && !searching && !searchErr && !local.length && !remote.length &&
        <p className="dim tiny">Nothing found. Try the barcode, a photo, or describe it.</p>}

      {pick && (
        <>
          <p className="dim tiny">{pick.m[0]} cal per 100g · {pick.src === "USDA" ? "USDA lab data" : pick.src === "Label" ? "off the package label" : "built-in table"}</p>
          <div className="row gap">
            <input autoFocus type="number" inputMode="decimal" placeholder="Amount" value={amt} onChange={(e) => setAmt(e.target.value)} />
            <div className="chips">
              <button className={unit === "g" ? "chip on" : "chip"} onClick={() => setUnit("g")}>g</button>
              <button className={unit === "oz" ? "chip on" : "chip"} onClick={() => setUnit("oz")}>oz</button>
              {pick.s && <button className={unit === "s" ? "chip on" : "chip"} onClick={() => setUnit("s")}>{pick.s.label}</button>}
            </div>
          </div>
          {pick.r && <button className={raw ? "listbtn on" : "listbtn"} onClick={() => setRaw(!raw)}>{raw ? "✓ " : ""}Weighed raw (−25% for cooking loss)</button>}
          <div className="quad">
            {[["calories", m[0]], ["protein", m[1]], ["carbs", m[2]], ["fat", m[3]]].map(([l, v], i) => (
              <div key={l}><div className="midnum" style={{ color: [C.cal, C.protein, C.carbs, C.fat][i] }}>{Math.round(v)}</div><div className="dim tiny">{l}</div></div>))}
          </div>
          {!hideMeal && <MealPick meal={meal} setMeal={setMeal} />}
          <div className="rowbtns">
            <button className="btn ghost wide" onClick={onCancel}>Cancel</button>
            <button className="btn solid wide" disabled={!grams} onClick={() => {
              const unitLabel = unit === "s" ? pick.s.label : unit;
              const gPerUnit = (unit === "g" ? 1 : unit === "oz" ? 28.35 : pick.s.g) * (raw ? 0.75 : 1);
              onAdd([{ id: crypto.randomUUID(), meal,
                name: `${pick.n}, ${fmtQty(amt, unitLabel)}${raw ? " raw" : ""}`,
                baseName: pick.n, raw, unit: unitLabel, qty: +amt,
                per: pick.m.map((v) => +((v * gPerUnit) / 100).toFixed(4)),
                calories: Math.round(m[0]), protein: +m[1].toFixed(1), carbs: +m[2].toFixed(1), fat: +m[3].toFixed(1) }]);
            }}>{cta}</button>
          </div>
        </>
      )}
    </>
  );
}

function SnapIt({ meal, setMeal, onAdd, onCancel, calib, onCalib }) {
  const [img, setImg] = useState(null);
  const [busy, setBusy] = useState(false);
  const [items, setItems] = useState(null);
  const [original, setOriginal] = useState(null);
  const [questions, setQuestions] = useState([]);
  const [answers, setAnswers] = useState({});
  const [notes, setNotes] = useState("");
  const [err, setErr] = useState("");

  const pickFile = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const b64 = await new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result.split(",")[1]); r.onerror = () => rej(); r.readAsDataURL(f);
    });
    setImg({ data: b64, type: f.type, url: URL.createObjectURL(f) });
    setItems(null); setQuestions([]); setAnswers({}); setNotes(""); setErr("");
  };

  const analyze = async (extra) => {
    if (!img) return;
    setBusy(true); setErr("");
    try {
      const p = await askClaude([
        { type: "image", source: { type: "base64", media_type: img.type, data: img.data } },
        { type: "text", text: `Estimate what is on this plate for a calorie log. Two steps.

Step 1 — portions. For each distinct food, estimate served weight in grams. Scale against whatever is visible: dinner plate ~27cm, side plate ~20cm, fork ~19cm, a can, a hand. Say what you scaled against.

Step 2 — hidden calories. List cooking oil, butter, dressing, sauce, cheese and glaze as separate items. These are the most commonly missed calories and usually the difference between a right answer and one 300 calories light. Glossy, seared, fried or dressed food has fat on it — estimate it rather than omitting it.

Where a food matches one of these keys, use the key exactly so the app can apply real per-100g data:
${FOODS.map((f) => f.n).join(" | ")}
${calib?.length ? `\nThis user's past corrections, calibrate against them:\n${calib.join("\n")}` : ""}${extra ? `\n\nExtra detail from the user:\n${extra}` : ""}

Respond with ONLY JSON:
{"items":[{"name":"short label","grams":number,"tableKey":"exact key or null","calories":number,"protein":number,"carbs":number,"fat":number,"confidence":"high"|"medium"|"low"}],
"questions":["up to two short questions whose answers would most change this estimate"],
"notes":"one short line on what you scaled against and what you can't see"}` }]);

      const mapped = p.items.map((i) => {
        const table = FOODS.find((f) => f.n === i.tableKey);
        const g = +i.grams || 0;
        const mm = table && g ? table.m.map((v) => (v * g) / 100) : [i.calories, i.protein, i.carbs, i.fat];
        return { id: crypto.randomUUID(), name: i.name, grams: Math.round(g), fromTable: !!table,
          confidence: i.confidence || "medium", calories: Math.round(mm[0]), protein: Math.round(mm[1]),
          carbs: Math.round(mm[2]), fat: Math.round(mm[3]) };
      });
      setItems(mapped);
      setOriginal(mapped.map((i) => ({ name: i.name, calories: i.calories })));
      setQuestions(extra ? [] : (p.questions || []).slice(0, 2));
      setNotes(p.notes || "");
    } catch { setErr("Couldn’t read that photo. Better light and a straight-on angle, or describe it instead."); }
    setBusy(false);
  };

  const total = (items || []).reduce((a, i) => a + i.calories, 0);
  const logIt = () => {
    if (onCalib && original) items.forEach((i) => {
      const o = original.find((x) => x.name === i.name);
      if (o?.calories && Math.abs(i.calories - o.calories) / o.calories > 0.15)
        onCalib(`${i.name}: estimated ${o.calories} cal, corrected to ${i.calories}`);
    });
    onAdd(items.map(({ id, name, calories, protein, carbs, fat }) => ({ id, name, calories, protein, carbs, fat, meal })));
  };

  return (
    <>
      {!img ? (
        <>
          <label className="dropzone">Take or choose a photo
            <input type="file" accept="image/*" capture="environment" onChange={pickFile} style={{ display: "none" }} /></label>
          <p className="dim tiny">Shoot at an angle, not straight down, and leave a fork or your hand in frame. Depth is what a photo hides.</p>
        </>
      ) : (
        <>
          <img src={img.url} alt="Your meal" className="shot" />
          {!items && <button className="btn accent wide" onClick={() => analyze("")} disabled={busy}>{busy ? "Working through it…" : "Estimate this meal"}</button>}
        </>
      )}

      {questions.length > 0 && (
        <div className="qbox fadein">
          <p className="dim tiny">Answer these and it re-runs with better information.</p>
          {questions.map((q, i) => (
            <div key={i}><label>{q}</label>
              <input value={answers[i] || ""} onChange={(e) => setAnswers((a) => ({ ...a, [i]: e.target.value }))} /></div>
          ))}
          <button className="btn accent wide" onClick={() => analyze(questions.map((q, i) => `${q} — ${answers[i] || "not sure"}`).join("\n"))} disabled={busy}>
            {busy ? "Redoing it…" : "Re-estimate"}</button>
        </div>
      )}

      {items && (
        <div className="fadein stack">
          {notes && <p className="dim tiny">{notes}</p>}
          {items.map((i) => (
            <div key={i.id} className="itemcard">
              <div className="row gap">
                <input value={i.name} onChange={(e) => setItems((s) => s.map((x) => x.id === i.id ? { ...x, name: e.target.value } : x))} />
                <span className={`badge ${i.fromTable ? "good" : i.confidence}`}>{i.fromTable ? "table" : i.confidence}</span>
              </div>
              {i.grams > 0 && (
                <div className="row"><label>Grams</label>
                  <input className="mini" type="number" inputMode="numeric" value={i.grams}
                    onChange={(e) => setItems((s) => s.map((x) => {
                      if (x.id !== i.id) return x;
                      const g = +e.target.value || 0, f = x.grams ? g / x.grams : 1;
                      return { ...x, grams: g, calories: Math.round(x.calories * f), protein: Math.round(x.protein * f),
                        carbs: Math.round(x.carbs * f), fat: Math.round(x.fat * f) };
                    }))} /></div>
              )}
              <div className="quad small">
                {[["calories", "Cal"], ["protein", "P"], ["carbs", "C"], ["fat", "F"]].map(([k, l]) => (
                  <div key={k}><label>{l}</label>
                    <input type="number" inputMode="numeric" value={i[k]}
                      onChange={(e) => setItems((s) => s.map((x) => x.id === i.id ? { ...x, [k]: +e.target.value || 0 } : x))} /></div>))}
              </div>
              <button className="linkbtn" onClick={() => setItems((s) => s.filter((x) => x.id !== i.id))}>Remove</button>
            </div>
          ))}
          <div className="center">
            <div className="bignum" style={{ color: C.cal }}>{total.toLocaleString()}</div>
            <div className="dim tiny">calories · likely {Math.round(total * 0.8).toLocaleString()}–{Math.round(total * 1.25).toLocaleString()}</div>
          </div>
          <MealPick meal={meal} setMeal={setMeal} />
        </div>
      )}
      {err && <p className="alert">{err}</p>}
      <div className="rowbtns">
        <button className="btn ghost wide" onClick={onCancel}>Cancel</button>
        <button className="btn solid wide" disabled={!items?.length} onClick={logIt}>Log {items?.length || ""}</button>
      </div>
    </>
  );
}

function DescribeIt({ meal, setMeal, onAdd, onCancel, hideMeal, cta = "Log" }) {
  const [desc, setDesc] = useState("");
  const [v, setV] = useState({ calories: "", protein: "", carbs: "", fat: "" });
  const [busy, setBusy] = useState(false); const [err, setErr] = useState("");
  const estimate = async () => {
    if (!desc.trim()) return;
    setBusy(true); setErr("");
    try {
      const p = await askClaude([{ type: "text", text: `Estimate nutrition for this food as eaten: "${desc}". If no portion is stated assume one typical serving. Count cooking fat and sauces. Respond with ONLY JSON: {"name": short label under 40 chars, "calories": number, "protein": number, "carbs": number, "fat": number}` }]);
      setDesc(p.name || desc);
      setV({ calories: String(Math.round(p.calories)), protein: String(Math.round(p.protein)), carbs: String(Math.round(p.carbs)), fat: String(Math.round(p.fat)) });
    } catch { setErr("Couldn’t estimate that. Type the numbers in yourself."); }
    setBusy(false);
  };
  return (
    <>
      <input autoFocus placeholder="Chipotle bowl, double chicken, no rice" value={desc} onChange={(e) => setDesc(e.target.value)} />
      <button className="btn accent wide" onClick={estimate} disabled={busy}>{busy ? "Working it out…" : "Estimate the macros"}</button>
      <div className="quad small">
        {[["calories", "Cal"], ["protein", "P"], ["carbs", "C"], ["fat", "F"]].map(([k, l]) => (
          <div key={k}><label>{l}</label><input type="number" inputMode="numeric" value={v[k]}
            onChange={(e) => setV((x) => ({ ...x, [k]: e.target.value }))} /></div>))}
      </div>
      {!hideMeal && <MealPick meal={meal} setMeal={setMeal} />}
      {err && <p className="alert">{err}</p>}
      <div className="rowbtns">
        <button className="btn ghost wide" onClick={onCancel}>Cancel</button>
        <button className="btn solid wide" onClick={() => {
          if (!desc.trim() || v.calories === "") { setErr("Needs a name and a calorie number."); return; }
          onAdd([{ id: crypto.randomUUID(), meal, name: desc.trim(), calories: +v.calories || 0, protein: +v.protein || 0, carbs: +v.carbs || 0, fat: +v.fat || 0 }]);
        }}>{cta}</button>
      </div>
    </>
  );
}

/* ---------- plan ---------- */
const LAB_PRESETS = ["Total cholesterol", "LDL", "HDL", "Triglycerides", "A1c", "Fasting glucose",
  "ALT", "AST", "Vitamin D", "Ferritin", "TSH", "Creatinine", "eGFR", "CRP", "Uric acid"];

// Menus saved before weights existed kept ingredients as plain strings under recipe.ingredients,
// and only for "cook" dishes. Read both shapes so an old saved menu still opens.
function weighList(m) {
  if (Array.isArray(m.weigh) && m.weigh.length) return m.weigh;
  const old = m.recipe?.ingredients;
  if (Array.isArray(old)) return old.map((i) => (typeof i === "string" ? { item: i } : i));
  return [];
}

// If you're weighing every line, what you eat is the sum of those lines - not whatever total
// the model wrote next to the dish name. Its own arithmetic drifts a few percent often enough
// to matter, so the weighed sum wins and the card, the table and the log all show one number.
function dishCal(m) {
  const sum = weighList(m).reduce((a, i) => a + (+i.calories || 0), 0);
  return Math.round(sum > 0 ? sum : +m.calories || 0);
}

function Plan({ data, setData, targets, day, updateDay }) {
  const today = dayKey();
  const menu = data.menus?.[today] || null;
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [openRecipe, setOpenRecipe] = useState(null);
  const [showLabs, setShowLabs] = useState(false);
  const [showList, setShowList] = useState(false);
  const [craving, setCraving] = useState("");
  const [slot, setSlot] = useState(guessMeal());
  const [mode, setMode] = useState("today");

  const eaten = day.foods.reduce((a, f) => ({ cal: a.cal + f.calories, p: a.p + f.protein }), { cal: 0, p: 0 });
  const remainCal = targets.calories - eaten.cal;
  const remainP = targets.protein - eaten.p;
  const mt = mealTarget(slot, targets, day, remainCal, remainP);
  const labs = data.labs || [];

  const build = async () => {
    setBusy(true); setErr("");
    try {
      const likes = (data.favorites || []).map((f) => f.name).slice(0, 12);
      const p = await askClaude([{ type: "text", text: `Give someone cutting weight exactly three ${slot.toLowerCase()} options to choose between.

${craving.trim() ? `What they're in the mood for: "${craving.trim()}". Take this seriously — all three options should satisfy that craving, worked into their numbers rather than replaced with something virtuous.` : "No particular craving — give three genuinely different options."}

Their numbers: ${targets.calories} calorie budget today, ${targets.protein}g protein target. ${remainCal} calories and ${Math.max(0, Math.round(remainP))}g protein left for the rest of the day, across ${mt.mealsLeft} remaining meal${mt.mealsLeft === 1 ? "" : "s"}.

Size all three options to about ${mt.even} calories each — anywhere in ${mt.lo}-${mt.hi} is fine — with roughly ${mt.protein}g protein. Do not go over ${mt.hi}. This is the number that matters; hit it.
${data.fast ? "They are fasting right now, so this will break the fast — lead with protein." : ""}
${likes.length ? `Foods they already eat: ${likes.join(", ")}.` : ""}
${labs.length ? `\nLab values they entered:\n${labs.slice(0, 12).map((l) => `${l.name}: ${l.value}${l.unit ? " " + l.unit : ""} (${l.date})`).join("\n")}\n\nUse these ONLY to lean on well-established dietary patterns. Do NOT diagnose or name conditions. If a value looks meaningfully out of range, put one plain sentence in "flag" telling them to raise it with their doctor.` : ""}

Repetition is fine — do not avoid obvious or familiar meals. Real food, honestly counted, including the oil it's cooked in.

"effort": "grab" is no cooking, "simple" is under 10 minutes, "cook" is a real recipe. Include "steps" ONLY for "cook".

They weigh everything on a digital scale, so every option — including the no-cook ones — needs a "weigh" list: each component with its weight in grams and the calories that weight contributes. Use raw weights for things that get cooked, and say so in the item name ("chicken breast, raw"). Count the cooking oil as its own line. The "weigh" list is for ONE serving — exactly the portion they sit down and eat — and its calories must add up to that dish's "calories" to within about 3%, because they are going to weigh it out and expect the total to land. Never give batch weights. Add the line calories up yourself and set the dish "calories" to exactly that sum.

Respond with ONLY JSON:
{"menu":[{"name":"short dish name","blurb":"one short line","calories":number,"protein":number,"carbs":number,"fat":number,"effort":"grab"|"simple"|"cook","weigh":[{"item":"ingredient, prep state","grams":number,"calories":number}],"recipe":{"steps":["step"]}}],
"note":"one line on how this fits today",
"flag":"one sentence about a lab value worth raising with a doctor, or null"}` }]);

      const items = (p.menu || []).slice(0, 3).map((m) => ({ ...m, slot, id: crypto.randomUUID() }));
      setData((d) => ({ ...d, menus: { [today]: { items, note: p.note, flag: p.flag, slot, craving: craving.trim(),
        target: { even: mt.even, lo: mt.lo, hi: mt.hi, protein: mt.protein } } } }));
      setOpenRecipe(null);
    } catch { setErr("Couldn't put a menu together just now. Try again in a moment."); }
    setBusy(false);
  };

  const addToList = (m) => {
    const wl = weighList(m);
    if (!wl.length) return;
    setData((d) => {
      // Replacing a dish of the same name: mark the old one deleted so another device can't bring it back.
      const old = (d.list || []).filter((x) => x.name === m.name);
      const deleted = old.reduce((acc, x) => ({ ...acc, ["list:" + x.id]: Date.now() }), d.deleted || {});
      return { ...d, deleted, list: [...(d.list || []).filter((x) => x.name !== m.name),
        { id: crypto.randomUUID(), name: m.name, servings: 1, u: Date.now(),
          items: wl.map((i) => ({ text: i.grams ? `${Math.round(i.grams)} g ${i.item}` : i.item, done: false })) }] };
    });
    setShowList(true);
  };

  const choose = (m) => {
    updateDay(today, (d) => ({ ...d, foods: [...d.foods, { id: crypto.randomUUID(), meal: m.slot, name: m.name, at: Date.now(),
      calories: dishCal(m), protein: Math.round(m.protein), carbs: Math.round(m.carbs), fat: Math.round(m.fat) }] }));
  };

  const logToday = (item) => updateDay(today, (d) => ({ ...d, foods: [...d.foods, { id: crypto.randomUUID(), at: Date.now(), u: Date.now(), ...item }] }));
  return (
    <>
      <div className="chips">
        {[["today", "Today"], ["out", "Eating out"], ["week", "Week"]].map(([k, l]) => (
          <button key={k} className={mode === k ? "chip on" : "chip"} onClick={() => setMode(k)}>{l}</button>))}
      </div>
      {mode === "out" && <EatingOut remainCal={remainCal} remainP={remainP} onLog={logToday} />}
      {mode === "week" && <WeekPlan data={data} setData={setData} onLog={logToday} onOpenList={() => setShowList(true)} />}
      {mode === "today" && (<>
      <div className="glass pad stack">
        <div className="row"><h2>What sounds good?</h2>
          <span className="dim tiny">{remainCal.toLocaleString()} cal · {Math.max(0, Math.round(remainP))}g left</span></div>
        <div className="chips">{MEALS.map((s) => (
          <button key={s} className={slot === s ? "chip on" : "chip"} onClick={() => setSlot(s)}>{s}</button>))}</div>

        <div className="mealtarget">
          <div className="row gap">
            <div>
              <div className="dim tiny">This {slot.toLowerCase()} should be</div>
              <div><span className="midnum mono" style={{ color: C.cal }}>{mt.even.toLocaleString()}</span><span className="dim tiny"> cal</span></div>
            </div>
            {!mt.over && (
              <div className="right">
                <div className="dim tiny">Aim inside</div>
                <div className="mono">{mt.lo.toLocaleString()}–{mt.hi.toLocaleString()}</div>
                <div className="dim tiny">{mt.protein}g protein</div>
              </div>
            )}
          </div>
          <p className="dim tiny">
            {mt.over
              ? `You've used today's budget, so anything now puts you over. For reference, a typical ${slot.toLowerCase()} is ${mt.typical.toLocaleString()} cal of a ${targets.calories.toLocaleString()} day.`
              : `${remainCal.toLocaleString()} cal left, split evenly across the ${mt.mealsLeft} meal${mt.mealsLeft === 1 ? "" : "s"} you've not eaten. A typical ${slot.toLowerCase()} runs ${mt.typical.toLocaleString()} cal of a ${targets.calories.toLocaleString()} day — the range covers both. Weigh everything and these numbers hold.`}
          </p>
        </div>

        <input placeholder="burgers, something Mexican, steak — or leave it blank" value={craving}
          onChange={(e) => setCraving(e.target.value)} onKeyDown={(e) => e.key === "Enter" && build()} />
        <button className="btn accent wide" onClick={build} disabled={busy}>
          {busy ? "Thinking…" : `Give me three ${slot.toLowerCase()} options`}</button>
        {err && <p className="alert">{err}</p>}
      </div>

      {menu && (
        <div className="glass fadein">
          <div className="mealhead">
            <span className="dot" style={{ background: MEAL_COLOR[menu.slot], boxShadow: `0 0 8px ${MEAL_COLOR[menu.slot]}` }} />
            {menu.slot}{menu.craving ? ` · ${menu.craving}` : ""}
          </div>
          {menu.target && <p className="dim tiny pad" style={{ paddingBottom: 0 }}>
            Sized for about {menu.target.even.toLocaleString()} cal and {menu.target.protein}g protein.</p>}
          {menu.note && <p className="dim tiny pad" style={{ paddingBottom: 0 }}>{menu.note}</p>}
          {menu.flag && <p className="cue" style={{ color: C.warn, borderColor: `${C.warn}55`, margin: "10px 16px 0" }}>{menu.flag}</p>}
          {menu.items.map((m) => {
            const wl = weighList(m);
            const wcal = wl.reduce((a, i) => a + (+i.calories || 0), 0);
            const wg = wl.reduce((a, i) => a + (+i.grams || 0), 0);
            const steps = m.recipe?.steps || [];
            return (
            <div key={m.id} className="dish">
              <div className="row gap">
                <div><div className="dishname">{m.name}</div><div className="dim tiny">{m.blurb}</div></div>
                <span className={`badge ${m.effort === "cook" ? "" : "good"}`}>{m.effort}</span>
              </div>
              <div className="dishmacros">
                <span className="mono" style={{ color: C.cal }}>{dishCal(m)}</span>
                <span className="dim tiny">{Math.round(m.protein)}p · {Math.round(m.carbs)}c · {Math.round(m.fat)}f</span>
              </div>
              <div className="rowbtns">
                {wl.length > 0 && <button className="btn ghost wide" onClick={() => setOpenRecipe(openRecipe === m.id ? null : m.id)}>
                  {openRecipe === m.id ? "Hide" : steps.length ? "Weigh + cook" : "Weigh it"}</button>}
                {wl.length > 0 && <button className="btn ghost wide" onClick={() => addToList(m)}>+ List</button>}
                <button className="btn solid wide" onClick={() => choose(m)}>Eat this</button>
              </div>
              {openRecipe === m.id && wl.length > 0 && (
                <div className="recipe fadein">
                  <div className="dim tiny">One serving. Weigh each line raw unless it says otherwise.</div>
                  <table className="weightbl">
                    <thead><tr><th>Put on the scale</th><th className="right">Grams</th><th className="right">Cal</th></tr></thead>
                    <tbody>
                      {wl.map((i, n) => (
                        <tr key={n}>
                          <td>{i.item}</td>
                          <td className="right mono">{i.grams ? Math.round(i.grams) : "—"}</td>
                          <td className="right mono">{i.calories != null ? Math.round(i.calories) : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                    {wcal > 0 && (
                      <tfoot><tr><td>Total</td><td className="right mono">{Math.round(wg)}</td><td className="right mono">{Math.round(wcal)}</td></tr></tfoot>
                    )}
                  </table>
                  {steps.length > 0 && <ol>{steps.map((t, n) => <li key={n}>{t}</li>)}</ol>}
                </div>
              )}
            </div>
            );
          })}
        </div>
      )}
      </>)}

      <button className="btn ghost wide" onClick={() => setShowList(!showList)}>
        {showList ? "Hide shopping list" : `Shopping list${(data.list || []).length ? ` (${(data.list || []).length})` : ""}`}</button>
      {showList && <Shopping data={data} setData={setData} />}

      <button className="btn ghost wide" onClick={() => setShowLabs(!showLabs)}>
        {showLabs ? "Hide lab work" : `Lab work${labs.length ? ` (${labs.length})` : ""}`}</button>
      {showLabs && <Labs data={data} setData={setData} />}
    </>
  );
}
/* ---------- eating out: best orders from a menu photo or a restaurant name ---------- */
function EatingOut({ remainCal, remainP, onLog }) {
  const [where, setWhere] = useState("");
  const [img, setImg] = useState(null);
  const [slot, setSlot] = useState(guessMeal());
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState(null);
  const [err, setErr] = useState("");
  const [logged, setLogged] = useState({});

  const pick = async (e) => {
    const f = e.target.files?.[0]; e.target.value = "";
    if (!f) return;
    try { setImg(await shrinkPhoto(f, 1600, 0.85)); setRes(null); } catch { setErr("Couldn't read that photo."); }
  };

  const go = async () => {
    setBusy(true); setErr(""); setRes(null); setLogged({});
    try {
      const content = [];
      if (img) content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: img.split(",")[1] } });
      content.push({ type: "text", text: `Someone cutting weight is eating out${where.trim() ? ` at ${where.trim()}` : ""}. This is ${slot.toLowerCase()}.
${img ? "The photo is the menu. Only recommend items actually on it." : "There's no menu photo. Use what you genuinely know of this restaurant's menu. If you don't know it, set known to false and give picks that would exist at a typical place of that kind."}
They have ${Math.max(0, remainCal)} calories and ${Math.max(0, Math.round(remainP))}g protein left today.

Pick the 3 best orders that fit what's left, best protein-per-calorie first. Where you know a chain's published nutrition, use it; otherwise estimate honestly — count the oil, sauce, cheese and sides, and lean high rather than low. For each, give concrete ordering tweaks that cut calories without ruining the meal.

Respond with ONLY JSON:
{"known":true|false,"picks":[{"name":"exactly how to order it","why":"one short line","calories":number,"protein":number,"carbs":number,"fat":number,"tweaks":["short tweak"]}],"avoid":"the one item on this menu that looks healthy but isn't, or null","note":"one line"}` });
      const p = await askClaude(content, 2500);
      if (!p.picks?.length) throw new Error("No picks came back.");
      setRes(p);
    } catch (e) { setErr(String(e.message || e).slice(0, 200)); }
    setBusy(false);
  };

  return (
    <>
      <div className="glass pad stack">
        <div className="row"><h2>Eating out</h2><span className="dim tiny">{Math.max(0, remainCal).toLocaleString()} cal · {Math.max(0, Math.round(remainP))}g left</span></div>
        <div className="chips">{MEALS.map((m) => <button key={m} className={slot === m ? "chip on" : "chip"} onClick={() => setSlot(m)}>{m}</button>)}</div>
        <input placeholder="Where? e.g. Chipotle, Texas Roadhouse, the diner" value={where} onChange={(e) => setWhere(e.target.value)} />
        {img ? (
          <div className="row gap"><img src={img} alt="Menu" className="menuthumb" /><button className="btn ghost" onClick={() => setImg(null)}>Remove photo</button></div>
        ) : (
          <label className="dropzone">Photograph the menu (optional)
            <input type="file" accept="image/*" capture="environment" onChange={pick} style={{ display: "none" }} /></label>
        )}
        <button className="btn accent wide" onClick={go} disabled={busy || (!where.trim() && !img)}>{busy ? "Reading the menu…" : "What should I order?"}</button>
        {err && <p className="alert">{err}</p>}
      </div>

      {res && (
        <div className="glass fadein">
          {res.known === false && <p className="cue" style={{ margin: "14px 16px 0", color: C.warn, borderColor: `${C.warn}55` }}>It doesn't know this place's menu well — treat these as ballpark. A menu photo gets you real items.</p>}
          {res.note && <p className="dim tiny pad" style={{ paddingBottom: 0 }}>{res.note}</p>}
          {res.picks.map((m, i) => (
            <div key={i} className="dish">
              <div><div className="dishname">{m.name}</div><div className="dim tiny">{m.why}</div></div>
              <div className="dishmacros">
                <span className="mono" style={{ color: C.cal }}>{Math.round(m.calories)}</span>
                <span className="dim tiny">{Math.round(m.protein)}p · {Math.round(m.carbs)}c · {Math.round(m.fat)}f · estimate</span>
              </div>
              {m.tweaks?.length > 0 && <ul className="tweaks">{m.tweaks.map((t, j) => <li key={j}>{t}</li>)}</ul>}
              <button className="btn solid wide" disabled={logged[i]} onClick={() => {
                onLog({ meal: slot, name: `${m.name}${where.trim() ? ` (${where.trim()})` : ""}`, calories: Math.round(m.calories),
                  protein: Math.round(m.protein), carbs: Math.round(m.carbs), fat: Math.round(m.fat) });
                setLogged((x) => ({ ...x, [i]: true }));
              }}>{logged[i] ? "Logged ✓" : "Eat this"}</button>
            </div>
          ))}
          {res.avoid && <p className="cue" style={{ margin: "0 16px 14px" }}>Skip: {res.avoid}</p>}
        </div>
      )}
    </>
  );
}

/* ---------- week: batch-cook meal prep, one grocery list ---------- */
function WeekPlan({ data, setData, onLog, onOpenList }) {
  const week = data.week;
  const base = computeTargets(data.profile, []);
  const fasts = (data.fasts || []).length >= 3;
  const [ifMode, setIfMode] = useState(fasts);
  const [prefs, setPrefs] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [open, setOpen] = useState(null);
  const [saved, setSaved] = useState({});
  const [logged, setLogged] = useState({});

  const since = week ? Math.round((new Date(dayKey() + "T12:00") - new Date(week.start + "T12:00")) / 864e5) : 0;
  const [dayIdx, setDayIdx] = useState(Math.min(6, Math.max(0, since)));

  const build = async () => {
    setBusy(true); setErr("");
    try {
      const likes = (data.favorites || []).map((f) => f.name).slice(0, 12);
      const p = await askClaude([{ type: "text", text: `Plan 7 days of meal prep for someone cutting weight, around a small set of batch-cooked dishes that repeat through the week — they cook twice and eat all week. Repetition is good here.

Every day should land within 100 calories of ${base.calories} and reach at least ${base.protein}g protein.
${ifMode ? "They do intermittent fasting: plan 2 meals plus 1 snack a day inside an eating window — no breakfast." : "Plan breakfast, lunch, dinner and one snack each day."}
${prefs.trim() ? `Their preferences: ${prefs.trim()}.` : ""}
${likes.length ? `Foods they already eat: ${likes.join(", ")}.` : ""}
Use 4 to 7 distinct dishes. Ingredient amounts are for the WHOLE batch, as you'd buy them. Keep steps to at most 4 short lines. Count cooking oil in the macros.

Respond with ONLY JSON:
{"dishes":[{"id":"d1","name":"...","servingsMade":number,"perServing":{"calories":number,"protein":number,"carbs":number,"fat":number},"ingredients":["amount + item"],"steps":["short step"]}],
"days":[{"meals":[{"slot":"Breakfast"|"Lunch"|"Dinner"|"Snack","dish":"d1"}]}],
"prepDay":"one line on what to cook when",
"note":"one line"}
Exactly 7 entries in days.` }], 7000);
      if (!p.dishes?.length || !p.days?.length) throw new Error("The plan came back incomplete. Try again.");
      setData((d) => ({ ...d, week: { start: dayKey(), dishes: p.dishes, days: p.days.slice(0, 7), prepDay: p.prepDay, note: p.note, u: Date.now() } }));
      setDayIdx(0); setOpen(null); setSaved({}); setLogged({});
    } catch (e) { setErr(String(e.message || e).slice(0, 200)); }
    setBusy(false);
  };

  const dish = (id) => week?.dishes.find((x) => x.id === id);
  // Recompute every day's totals here rather than trusting the model's arithmetic.
  const dayTotal = (i) => (week?.days[i]?.meals || []).reduce((a, m) => {
    const ps = dish(m.dish)?.perServing || {};
    return { c: a.c + (+ps.calories || 0), p: a.p + (+ps.protein || 0) };
  }, { c: 0, p: 0 });

  const toList = () => {
    setData((d) => {
      const names = new Set(week.dishes.map((x) => x.name));
      const old = (d.list || []).filter((x) => names.has(x.name));
      const deleted = old.reduce((acc, x) => ({ ...acc, ["list:" + x.id]: Date.now() }), d.deleted || {});
      return { ...d, deleted, list: [...(d.list || []).filter((x) => !names.has(x.name)),
        ...week.dishes.map((x) => ({ id: crypto.randomUUID(), name: x.name, servings: x.servingsMade, u: Date.now(),
          items: (x.ingredients || []).map((t) => ({ text: t, done: false })) }))] };
    });
    onOpenList();
  };

  const saveRecipe = (x) => {
    const n = +x.servingsMade || 1, ps = x.perServing || {};
    setData((d) => ({ ...d, recipes: [...(d.recipes || []), { id: crypto.randomUUID(), name: x.name, servings: n, cookedG: 0, u: Date.now(),
      items: [{ id: crypto.randomUUID(), name: "Whole batch (plan estimate — rebuild by weighing for accuracy)",
        calories: Math.round((+ps.calories || 0) * n), protein: (+ps.protein || 0) * n, carbs: (+ps.carbs || 0) * n, fat: (+ps.fat || 0) * n }] }] }));
    setSaved((s) => ({ ...s, [x.id]: true }));
  };

  const dateFor = (i) => shiftDay(week.start, i);

  return (
    <>
      <div className="glass pad stack">
        <div className="row"><h2>Meal prep week</h2><span className="dim tiny">{base.calories.toLocaleString()} cal · {base.protein}g / day</span></div>
        <input placeholder="Anything to include or avoid? e.g. chicken and rice, no fish, under $80" value={prefs} onChange={(e) => setPrefs(e.target.value)} />
        <button className={ifMode ? "listbtn on" : "listbtn"} onClick={() => setIfMode(!ifMode)}>{ifMode ? "✓ " : ""}I fast — 2 meals + a snack, no breakfast</button>
        <button className="btn accent wide" onClick={build} disabled={busy}>{busy ? "Planning the week — about 20 seconds…" : week ? "Plan a new week" : "Plan my week"}</button>
        {err && <p className="alert">{err}</p>}
      </div>

      {week && (
        <>
          {since > 7 && <p className="cue" style={{ marginBottom: 12 }}>This plan is from {prettyDay(week.start)}. Plan a new week when you're ready.</p>}
          {week.prepDay && <div className="glass pad"><p className="small"><strong>Prep:</strong> {week.prepDay}</p>{week.note && <p className="dim tiny" style={{ marginTop: 6 }}>{week.note}</p>}</div>}

          <div className="chips">{week.days.map((_, i) => {
            const t = dayTotal(i);
            return <button key={i} className={dayIdx === i ? "chip on" : "chip"} onClick={() => setDayIdx(i)}>
              {new Date(dateFor(i) + "T12:00").toLocaleDateString(undefined, { weekday: "short" })} <span className="dim">{Math.round(t.c)}</span></button>;
          })}</div>

          <div className="glass">
            {(() => { const t = dayTotal(dayIdx); const off = Math.round(t.c - base.calories);
              return <div className="mealhead">{prettyDay(dateFor(dayIdx))}<span className="right mono" style={{ color: Math.abs(off) > 150 ? C.warn : undefined }}>
                {Math.round(t.c)} cal · {Math.round(t.p)}g{Math.abs(off) > 150 ? ` (${off > 0 ? "+" : ""}${off})` : ""}</span></div>; })()}
            {(week.days[dayIdx]?.meals || []).map((m, j) => {
              const x = dish(m.dish); if (!x) return null;
              const ps = x.perServing || {}, key = `${dayIdx}-${j}`;
              return (
                <div key={j} className="dish">
                  <div className="row gap"><div><div className="dim tiny">{m.slot}</div><div className="dishname">{x.name}</div></div>
                    <span className="mono" style={{ color: C.cal }}>{Math.round(ps.calories)}</span></div>
                  <span className="dim tiny">{Math.round(ps.protein)}p · {Math.round(ps.carbs)}c · {Math.round(ps.fat)}f per serving</span>
                  {dateFor(dayIdx) === dayKey() && (
                    <button className="btn solid wide" disabled={logged[key]} onClick={() => {
                      onLog({ meal: m.slot, name: `${x.name}, 1 serving`, baseName: x.name, unit: "serving", qty: 1,
                        per: [+ps.calories || 0, +ps.protein || 0, +ps.carbs || 0, +ps.fat || 0],
                        calories: Math.round(ps.calories), protein: Math.round(ps.protein), carbs: Math.round(ps.carbs), fat: Math.round(ps.fat) });
                      setLogged((z) => ({ ...z, [key]: true }));
                    }}>{logged[key] ? "Logged ✓" : "Eat this"}</button>
                  )}
                </div>
              );
            })}
          </div>

          <button className="btn accent wide big" onClick={toList}>Build my grocery list</button>

          <div className="glass">
            <div className="mealhead">The dishes · {week.dishes.length} to cook</div>
            {week.dishes.map((x) => (
              <div key={x.id} className="dish">
                <div className="row gap"><div className="dishname">{x.name}</div><span className="dim tiny">makes {x.servingsMade}</span></div>
                <div className="rowbtns">
                  <button className="btn ghost wide" onClick={() => setOpen(open === x.id ? null : x.id)}>{open === x.id ? "Hide recipe" : "Recipe"}</button>
                  <button className="btn ghost wide" disabled={saved[x.id]} onClick={() => saveRecipe(x)}>{saved[x.id] ? "Saved ✓" : "Save to my recipes"}</button>
                </div>
                {open === x.id && (
                  <div className="recipe fadein">
                    <ul>{(x.ingredients || []).map((t, n) => <li key={n}>{t}</li>)}</ul>
                    <ol>{(x.steps || []).map((t, n) => <li key={n}>{t}</li>)}</ol>
                  </div>
                )}
              </div>
            ))}
            <p className="dim tiny pad">Macros here are the planner's estimates. When you cook a dish, rebuild it in Add food → Recipe by weighing — that's what makes it exact.</p>
          </div>
        </>
      )}
    </>
  );
}

function Labs({ data, setData }) {
  const labs = data.labs || [];
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [unit, setUnit] = useState("");
  const [date, setDate] = useState(dayKey());

  const add = () => {
    if (!name.trim() || value === "") return;
    setData((d) => ({ ...d, labs: [{ id: crypto.randomUUID(), name: name.trim(), value, unit: unit.trim(), date, u: Date.now() }, ...(d.labs || [])].slice(0, 60) }));
    setName(""); setValue(""); setUnit("");
  };

  return (
    <div className="glass pad stack fadein" style={{ marginTop: 12 }}>
      <h2>Lab work</h2>
      <p className="dim tiny">Never shared, even with sharing on. This isn't medical advice and it doesn't replace your doctor — it just lets the menu lean on general dietary patterns instead of guessing.</p>
      <div className="chips">{LAB_PRESETS.map((l) => (
        <button key={l} className={name === l ? "chip on" : "chip"} onClick={() => setName(l)}>{l}</button>))}</div>
      <div className="row gap">
        <input placeholder="Marker" value={name} onChange={(e) => setName(e.target.value)} />
        <input className="mini" placeholder="Value" value={value} onChange={(e) => setValue(e.target.value)} />
      </div>
      <div className="row gap">
        <input placeholder="Unit (mg/dL, %, ng/mL)" value={unit} onChange={(e) => setUnit(e.target.value)} />
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </div>
      <button className="btn solid wide" onClick={add} disabled={!name.trim() || value === ""}>Add marker</button>
      {labs.map((l) => (
        <div key={l.id} className="row tiny">
          <span>{l.name}</span>
          <span className="dim">{l.value}{l.unit ? ` ${l.unit}` : ""} · {l.date}</span>
          <button className="icon" onClick={() => setData((d) => ({ ...d, deleted: tombstone(d, "lab:" + l.id), labs: d.labs.filter((x) => x.id !== l.id) }))}><X size={14} /></button>
        </div>
      ))}
    </div>
  );
}


/* ---------- access gate ---------- */
function Gate({ onOk }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const submit = async () => {
    if (!code.trim()) return;
    setBusy(true); setErr("");
    localStorage.setItem("cutlog:code", code.trim());
    try { await group("POST", { op: "list", prefix: SHARE_PREFIX }); onOk(); }
    catch {
      localStorage.removeItem("cutlog:code");
      setErr("That code didn't work. Check it with whoever sent you here.");
    }
    setBusy(false);
  };

  return (
    <div className="glass pad stack" style={{ marginTop: "22vh" }}>
      <h2>Cut Log</h2>
      <p className="dim small">This one's invite-only. Enter the code you were given.</p>
      <input autoFocus placeholder="Access code" value={code}
        onChange={(e) => setCode(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} />
      <button className="btn accent wide" onClick={submit} disabled={busy || !code.trim()}>
        {busy ? "Checking…" : "Let me in"}</button>
      {err && <p className="alert">{err}</p>}
      <p className="dim tiny">Entered once per device, then remembered.</p>
    </div>
  );
}

/* ---------- shopping list ---------- */
function Shopping({ data, setData }) {
  const list = data.list || [];
  const [busy, setBusy] = useState(false);
  const [merged, setMerged] = useState(null);

  const toggle = (mealId, idx) => setData((d) => ({ ...d, list: d.list.map((m) => m.id !== mealId ? m
    : { ...m, u: Date.now(), items: m.items.map((it, i) => i === idx ? { ...it, done: !it.done } : it) }) }));

  const tidy = async () => {
    setBusy(true);
    try {
      const all = list.flatMap((m) => m.items.map((i) => i.text));
      const p = await askClaude([{ type: "text", text: `Combine this shopping list. Add up duplicate ingredients into a single line with a total amount, round to what a shop actually sells (you buy a dozen eggs, not 7), and group by supermarket section.

${all.join("\n")}

Respond with ONLY JSON:
{"sections":[{"name":"Produce"|"Meat & fish"|"Dairy"|"Pantry"|"Frozen"|"Other","items":["total amount + item"]}]}` }]);
      setMerged(p.sections || []);
    } catch { setMerged(null); }
    setBusy(false);
  };

  if (!list.length) return (
    <div className="glass pad fadein" style={{ marginTop: 12 }}>
      <p className="dim small">Nothing on the list yet. Hit "+ List" on any menu option that has a recipe and its ingredients land here.</p>
    </div>
  );

  return (
    <div className="glass fadein" style={{ marginTop: 12 }}>
      {list.map((m) => (
        <div key={m.id}>
          <div className="mealhead">
            {m.name}
            <span className="right"><button className="icon" onClick={() => setData((d) => ({ ...d, deleted: tombstone(d, "list:" + m.id), list: d.list.filter((x) => x.id !== m.id) }))}><X size={14} /></button></span>
          </div>
          {m.items.map((it, i) => (
            <button key={i} className="listitem" onClick={() => toggle(m.id, i)}>
              <span className={it.done ? "tick on" : "tick"}>{it.done ? "✓" : ""}</span>
              <span style={{ opacity: it.done ? 0.4 : 1, textDecoration: it.done ? "line-through" : "none" }}>{it.text}</span>
            </button>
          ))}
        </div>
      ))}
      <div className="pad stack">
        <button className="btn accent wide" onClick={tidy} disabled={busy}>
          {busy ? "Adding it up…" : "Combine into one shopping list"}</button>
        {merged && merged.map((sec) => (
          <div key={sec.name}>
            <div className="dim tiny" style={{ marginTop: 8, textTransform: "uppercase", letterSpacing: ".06em" }}>{sec.name}</div>
            {sec.items.map((i, n) => <div key={n} style={{ fontSize: 14, padding: "3px 0" }}>{i}</div>)}
          </div>
        ))}
        <button className="btn ghost wide" onClick={() => { setData((d) => ({ ...d, list: [], deleted: (d.list || []).reduce((acc, x) => ({ ...acc, ["list:" + x.id]: Date.now() }), d.deleted || {}) })); setMerged(null); }}>Clear the list</button>
      </div>
    </div>
  );
}

/* ---------- weight ---------- */
function WaistCard({ days }) {
  const pts = Object.entries(days).filter(([, d]) => +d.waist > 0).map(([k, d]) => ({ day: k, waist: +d.waist })).sort((a, b) => a.day.localeCompare(b.day));
  if (!pts.length) return null;
  const first = pts[0].waist, last = pts[pts.length - 1].waist, change = +(last - first).toFixed(2);
  return (
    <div className="glass pad">
      <div className="row"><h2>Waist</h2>
        <span className="mono" style={{ color: change < 0 ? C.protein : undefined }}>{last}" {pts.length > 1 ? `· ${change > 0 ? "+" : ""}${change}"` : ""}</span></div>
      {pts.length > 1 && (
        <ResponsiveContainer width="100%" height={140}>
          <LineChart data={pts} margin={{ top: 8, right: 8, left: -22, bottom: 0 }}>
            <CartesianGrid stroke={C.grid} vertical={false} />
            <XAxis dataKey="day" tick={{ fontSize: 10, fill: C.axis }} tickFormatter={(k) => k.slice(5)} axisLine={false} tickLine={false} />
            <YAxis domain={["dataMin - 1", "dataMax + 1"]} tick={{ fontSize: 10, fill: C.axis }} axisLine={false} tickLine={false} />
            <Line type="monotone" dataKey="waist" stroke={C.carbs} strokeWidth={2.5} dot={{ r: 3 }} />
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

function Thumb({ id, onClick }) {
  const [src, setSrc] = useState(null);
  useEffect(() => { let live = true; loadPhoto(id).then((s) => live && setSrc(s)); return () => { live = false; }; }, [id]);
  return <button className="thumb" onClick={onClick}>{src ? <img src={src} alt="" /> : <span className="dim tiny">…</span>}</button>;
}

function Progress({ data, setData }) {
  const photos = (data.photos || []).slice().sort((a, b) => b.date.localeCompare(a.date) || b.u - a.u);
  const [view, setView] = useState(null);           // null | id | "compare"
  const [big, setBig] = useState({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const code = localStorage.getItem("cutlog:sync");

  // Photos taken before sync was switched on: upload them now.
  useEffect(() => {
    if (!code) return;
    (async () => {
      for (const p of photos.filter((x) => !x.up)) {
        const img = await photoDb.get(p.id).catch(() => null);
        if (!img) continue;
        try {
          await api("/api/photos", { op: "put", code, id: p.id, image: img });
          setData((d) => ({ ...d, photos: (d.photos || []).map((x) => x.id === p.id ? { ...x, up: true, u: Date.now() } : x) }));
        } catch { /* try again next time */ }
      }
    })();
  }, [code, photos.length]);

  useEffect(() => {
    const ids = view === "compare" ? [photos[photos.length - 1]?.id, photos[0]?.id] : view ? [view] : [];
    ids.filter(Boolean).forEach((id) => loadPhoto(id).then((src) => setBig((b) => ({ ...b, [id]: src }))));
  }, [view]);

  const add = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    setBusy(true); setErr("");
    try {
      const img = await shrinkPhoto(f);
      const id = crypto.randomUUID();
      await photoDb.put(id, img);
      let up = false;
      if (code) { try { await api("/api/photos", { op: "put", code, id, image: img }); up = true; } catch { /* backfilled later */ } }
      const w = data.days[dayKey()]?.weight;
      setData((d) => ({ ...d, photos: [...(d.photos || []), { id, date: dayKey(), weight: w ? +w : null, up, u: Date.now() }] }));
    } catch { setErr("Couldn't save that photo."); }
    setBusy(false);
  };

  const remove = async (id) => {
    await photoDb.del(id).catch(() => {});
    if (code) api("/api/photos", { op: "delete", code, id }).catch(() => {});
    setData((d) => ({ ...d, deleted: tombstone(d, "photo:" + id), photos: (d.photos || []).filter((x) => x.id !== id) }));
    setView(null);
  };

  const label = (p) => `${prettyDay(p.date)}${p.weight ? ` · ${p.weight} lb` : ""}`;
  const firstP = photos[photos.length - 1], lastP = photos[0];

  return (
    <div className="glass pad stack">
      <div className="row"><h2>Progress photos</h2>
        {photos.length > 1 && <button className="chip" onClick={() => setView("compare")}>Compare first → latest</button>}</div>
      <p className="dim tiny">Same spot, same light, same time of day — every week or two. {code ? "Synced to your devices under your sync code." : "Stored only on this device. Turn on sync to keep them if you switch phones."}</p>
      {photos.length > 0 && <div className="thumbs">{photos.map((p) => <Thumb key={p.id} id={p.id} onClick={() => setView(p.id)} />)}</div>}
      <label className="dropzone">{busy ? "Saving…" : "Take a progress photo"}
        <input type="file" accept="image/*" capture="user" onChange={add} style={{ display: "none" }} disabled={busy} /></label>
      {err && <p className="alert">{err}</p>}

      {view && (
        <div className="viewer" onClick={() => setView(null)}>
          <div className="viewerInner" onClick={(e) => e.stopPropagation()}>
            {view === "compare" ? (
              <div className="compare">
                {[firstP, lastP].map((p) => (
                  <div key={p.id}><img src={big[p.id] || ""} alt="" /><p className="dim tiny center">{label(p)}</p></div>))}
              </div>
            ) : (
              <>
                <img src={big[view] || ""} alt="" className="full" />
                <p className="dim tiny center">{label(photos.find((p) => p.id === view) || { date: dayKey() })}</p>
                <button className="btn ghost wide" onClick={() => remove(view)}>Delete this photo</button>
              </>
            )}
            <button className="btn solid wide" onClick={() => setView(null)}>Close</button>
          </div>
        </div>
      )}
    </div>
  );
}

function Weight({ data, setData, targets, updateDay }) {
  const today = dayKey();
  const cur = data.days[today]?.weight ?? "";
  const entries = Object.entries(data.days).filter(([, d]) => d.weight !== "" && d.weight != null)
    .map(([k, d]) => ({ k, w: +d.weight })).sort((a, b) => a.k.localeCompare(b.k));
  const series = entries.map((e, i) => {
    const win = entries.slice(Math.max(0, i - 6), i + 1);
    return { day: e.k, weight: e.w, avg: +(win.reduce((a, x) => a + x.w, 0) / win.length).toFixed(1) };
  });
  const { weight: start, goalWeight: goal } = data.profile;
  const latest = entries.length ? entries[entries.length - 1].w : start;
  const lost = start - latest;
  const shown = useCountUp(latest);
  const wks = targets.actualPace > 0 ? Math.ceil((latest - goal) / targets.actualPace) : null;
  const eta = wks ? new Date(Date.now() + wks * 7 * 864e5).toLocaleDateString(undefined, { month: "long", year: "numeric" }) : null;

  return (
    <>
      <div className="glass hero">
        <Ring pct={start > goal ? lost / (start - goal) : 0} color={C.protein} size={220}>
          <div className="huge">{shown.toFixed(1)}<span className="unit">lb</span></div>
          <div className="dim tiny">{lost > 0 ? `${lost.toFixed(1)} down` : "no change yet"}</div>
          <div className="dim tiny">{(latest - goal).toFixed(1)} to go</div>
        </Ring>
        <div className="row wideinput">
          <label>Weigh in</label>
          <input className="mini" type="number" step="0.1" inputMode="decimal" placeholder="—" value={cur}
            onChange={(e) => updateDay(today, (d) => ({ ...d, weight: e.target.value }))} />
        </div>
        <div className="row wideinput">
          <label>Waist (in)</label>
          <input className="mini" type="number" step="0.25" inputMode="decimal" placeholder="—" value={data.days[today]?.waist ?? ""}
            onChange={(e) => updateDay(today, (d) => ({ ...d, waist: e.target.value }))} />
        </div>
        <p className="dim tiny">Weigh the same time each morning, before you eat. Measure your waist at the navel, relaxed, once a week — it keeps dropping on weeks the scale stalls.</p>
      </div>
      <WaistCard days={data.days} />
      <Progress data={data} setData={setData} />

      {series.length > 1 ? (
        <div className="glass pad">
          <ResponsiveContainer width="100%" height={210}>
            <LineChart data={series} margin={{ top: 8, right: 8, left: -22, bottom: 0 }}>
              <CartesianGrid stroke={C.grid} vertical={false} />
              <XAxis dataKey="day" tick={{ fontSize: 10, fill: C.axis }} tickFormatter={(k) => k.slice(5)} axisLine={false} tickLine={false} />
              <YAxis domain={["dataMin - 2", "dataMax + 2"]} tick={{ fontSize: 10, fill: C.axis }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={C.tip} />
              <ReferenceLine y={goal} stroke={C.protein} strokeDasharray="4 4" />
              <Line type="monotone" dataKey="weight" stroke={C.faint} strokeWidth={1.5} dot={{ r: 2 }} />
              <Line type="monotone" dataKey="avg" stroke={C.cal} strokeWidth={2.5} dot={false} name="7-day avg" />
            </LineChart>
          </ResponsiveContainer>
          <p className="dim tiny">The bright line is your 7-day average. That's the one that tells the truth.</p>
        </div>
      ) : <div className="glass pad center"><p className="dim">Log a few days and the trend appears here.</p></div>}

      {eta && <div className="glass pad"><p className="small">At {targets.actualPace.toFixed(1)} lb a week you reach {goal} around <strong>{eta}</strong>. After three weeks of real data, check that against what the scale actually did — the formula runs about 10% off either way.</p></div>}
    </>
  );
}

/* ---------- us ---------- */
function Us({ data, setData }) {
  const [people, setPeople] = useState(null);
  const [err, setErr] = useState("");
  const [open, setOpen] = useState(null);

  const load = useCallback(async () => {
    setErr("");
    try {
      const list = await store.list(SHARE_PREFIX, true);
      const out = [];
      for (const k of list.keys) { try { out.push(JSON.parse((await store.get(k, true)).value)); } catch { /* skip */ } }
      setPeople(out.sort((a, b) => a.name.localeCompare(b.name)));
    } catch { setErr("Couldn't reach the shared log."); setPeople([]); }
  }, []);
  useEffect(() => { load(); }, [load]);

  if (!data.share) return (
    <div className="glass pad stack">
      <h2>Share your log</h2>
      <p className="dim small">Your name, food, calories and weight go into a log your partner can see — and you'll see theirs.</p>
      <p className="alert">Anyone who opens this app can see shared logs.</p>
      <button className="btn solid wide" disabled={!data.profile.name?.trim()} onClick={() => setData((d) => ({ ...d, share: true }))}>Start sharing</button>
      {!data.profile.name?.trim() && <p className="dim tiny">Add your name in Setup first.</p>}
    </div>
  );

  const today = dayKey();
  return (
    <>
      <div className="row"><span className="dim tiny">Sharing as {data.profile.name}</span>
        <button className="btn ghost" onClick={load}>Refresh</button></div>
      {err && <p className="alert">{err}</p>}
      {people === null && <div className="glass pad center"><p className="dim">Loading…</p></div>}
      {people?.length === 0 && <div className="glass pad center"><p className="dim">Nobody's sharing yet. Send your partner this app.</p></div>}
      {people?.map((p) => {
        const d = { ...blankDay(), ...(p.days?.[today] || {}) };
        const cal = d.foods.reduce((a, f) => a + f.calories, 0);
        const prot = d.foods.reduce((a, f) => a + f.protein, 0);
        const ws = Object.entries(p.days || {}).filter(([, x]) => x.weight).sort();
        const latest = ws.length ? +ws[ws.length - 1][1].weight : p.start;
        return (
          <div key={p.name} className="glass">
            <div className="pad">
              <div className="row"><strong>{p.name}</strong>
                <span className="mono" style={{ color: cal > p.target ? C.bad : cal ? C.protein : C.dimText }}>
                  {cal ? `${cal.toLocaleString()} / ${p.target.toLocaleString()}` : "—"}</span></div>
              <div className="track"><div style={{ width: `${Math.min(100, (cal / p.target) * 100)}%`, background: cal > p.target ? C.bad : C.cal, boxShadow: `0 0 10px ${cal > p.target ? C.bad : C.cal}88` }} /></div>
              <div className="row tiny dim"><span>{Math.round(prot)} / {p.proteinTarget}g protein</span><span>{latest} lb · {(p.start - latest).toFixed(1)} down</span></div>
            </div>
            {d.foods.length > 0 && (
              <>
                <button className="linkbtn full" onClick={() => setOpen(open === p.name ? null : p.name)}>{open === p.name ? "Hide" : "See what they ate"}</button>
                {open === p.name && d.foods.map((f) => (
                  <div key={f.id} className="fooditem"><div><div>{f.name}</div><div className="dim tiny">{f.meal}</div></div><span className="mono">{f.calories}</span></div>))}
              </>
            )}
          </div>
        );
      })}
      <button className="btn ghost wide" onClick={() => setData((d) => ({ ...d, share: false }))}>Stop sharing</button>
    </>
  );
}

/* ---------- log tab: your history, plus the group view ---------- */
function LogTab({ data, setData, onPick }) {
  const [view, setView] = useState("mine");
  return (
    <>
      <div className="chips">
        <button className={view === "mine" ? "chip on" : "chip"} onClick={() => setView("mine")}>My history</button>
        <button className={view === "group" ? "chip on" : "chip"} onClick={() => setView("group")}>Group</button>
      </div>
      {view === "mine" ? <History data={data} onPick={onPick} /> : <Us data={data} setData={setData} />}
    </>
  );
}

/* ---------- coach: a chat that already knows your log ---------- */
function coachContext(data, targets, adaptive) {
  const today = dayKey();
  const d = { ...blankDay(), ...(data.days[today] || {}) };
  const sum = (foods) => foods.reduce((a, f) => ({ c: a.c + (+f.calories || 0), p: a.p + (+f.protein || 0) }), { c: 0, p: 0 });
  const t = sum(d.foods);
  const week = [...Array(7)].map((_, i) => shiftDay(today, -(i + 1))).map((k) => {
    const x = data.days[k] || {}; const s = sum(x.foods || []);
    return `${k}: ${s.c ? `${Math.round(s.c)} cal, ${Math.round(s.p)}g protein` : "nothing logged"}${x.weight ? `, weighed ${x.weight}` : ""}`;
  });
  const fastH = data.fast ? ((Date.now() - data.fast.start) / 36e5).toFixed(1) : null;
  const p = data.profile;
  return [
    `Person: ${p.sex}, ${p.age}, ${Math.floor(p.heightIn / 12)}'${p.heightIn % 12}", started ${p.weight} lb, goal ${p.goalWeight} lb, losing ~${p.pace} lb/week.`,
    `Today's budget: ${targets.calories} cal, ${targets.protein}g protein (${targets.carbs}g carbs, ${targets.fat}g fat).${targets.earned ? ` Includes ${targets.earned} earned from activity.` : ""}`,
    adaptive?.ready ? `Measured maintenance from their own data: ${adaptive.tdee} cal (formula said ${adaptive.formula}); trending ${adaptive.lbPerWeek} lb/week.` : `Maintenance is still a formula estimate.`,
    `Eaten today: ${Math.round(t.c)} cal, ${Math.round(t.p)}g protein — ${Math.round(targets.calories - t.c)} cal and ${Math.max(0, Math.round(targets.protein - t.p))}g protein left.`,
    d.foods.length ? `Today's food: ${d.foods.map((f) => `${f.name} (${f.calories} cal, ${Math.round(f.protein)}p${f.at ? ", " + prettyTime(f.at) : ""})`).join("; ")}.` : "Nothing logged yet today.",
    fastH ? `Currently fasting: ${fastH} hours in.` : "Not fasting right now.",
    `Water today: ${+d.water || 0} of ${p.waterOz || 100} oz. ${d.tags?.length ? `Activity today: ${d.tags.map((x) => TAGS[x]?.label).join(", ")}.` : ""}`,
    `Previous 7 days:\n${week.join("\n")}`,
    (data.recipes || []).length ? `Their saved recipes: ${data.recipes.map((r) => r.name).join(", ")}.` : "",
    (data.favorites || []).length ? `Foods they eat often: ${data.favorites.slice(0, 12).map((f) => f.name).join(", ")}.` : "",
    `Current time: ${new Date().toLocaleString([], { weekday: "long", hour: "numeric", minute: "2-digit" })}.`,
  ].filter(Boolean).join("\n");
}

const COACH_RULES = `You are the diet coach inside this person's food-logging app. You can see their numbers below — use them. Answer like a sharp, practical coach texting back: short, specific, grounded in their actual remaining calories and protein. Name real foods and portions. No lectures, no generic advice they could get anywhere.

Hard lines:
- You are not a doctor. Don't diagnose, interpret symptoms, or advise on medications or medical conditions — tell them to ask their doctor.
- Never suggest eating below their budget floor, skipping meals to "make up" for a big day, or anything extreme. If they overshot, the answer is to get back on plan at the next meal.
- If they describe feeling faint, dizzy, or unwell while fasting, tell them to break the fast and eat. If anything suggests an unhealthy relationship with food, encourage them kindly to talk to a professional.
- If you don't know something about their data, say so rather than inventing it.`;

function Coach({ data, setData, targets, adaptive }) {
  const msgs = data.coach || [];
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const endRef = useRef(null);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [msgs.length, busy]);

  const send = async (raw) => {
    const q = String(raw ?? text).trim();
    if (!q || busy) return;
    setText(""); setErr(""); setBusy(true);
    const mine = { role: "user", text: q, at: Date.now() };
    setData((d) => ({ ...d, coach: [...(d.coach || []), mine].slice(-40) }));
    try {
      let history = [...msgs, mine].slice(-12);
      while (history.length && history[0].role !== "user") history = history.slice(1);
      const turns = history.slice(0, -1).map((m) => ({ role: m.role, content: m.text }));
      turns.push({ role: "user", content: `${COACH_RULES}\n\n--- Their data right now ---\n${coachContext(data, targets, adaptive)}\n---\n\nThey say: ${q}` });
      const res = await api("/api/claude", { json: false, max_tokens: 1200, messages: turns });
      const reply = res.content?.[0]?.text?.trim() || "I didn't get an answer back. Try again.";
      setData((d) => ({ ...d, coach: [...(d.coach || []), { role: "assistant", text: reply, at: Date.now() }].slice(-40) }));
    } catch (e) {
      setErr(/too long|cut off/i.test(String(e.message)) ? "That answer ran long and got cut off — try a narrower question." : "Couldn't reach the coach. Check your connection and try again.");
    }
    setBusy(false);
  };

  const quick = ["What should I eat next?", "I'm at a gas station — what do I grab?", "How's my week going?", "I'm starving and have 400 cal left", "I blew my budget today. Now what?"];

  return (
    <>
      <div className="glass pad stack">
        <div className="row"><h2>Coach</h2>{msgs.length > 0 && <button className="chip" onClick={() => setData((d) => ({ ...d, coach: [] }))}>Clear</button>}</div>
        <p className="dim tiny">Sees today's log, your fast, water, the last 7 days and your recipes — not your lab values. Runs on Gemini.</p>
      </div>
      {msgs.length === 0 && (
        <div className="chips">{quick.map((q) => <button key={q} className="chip" onClick={() => send(q)}>{q}</button>)}</div>
      )}
      <div className="chat">
        {msgs.map((m, i) => <div key={i} className={m.role === "user" ? "bubble me" : "bubble"}>{m.text}</div>)}
        {busy && <div className="bubble dim">Thinking…</div>}
        <div ref={endRef} />
      </div>
      {err && <p className="alert">{err}</p>}
      <div className="glass pad row gap composer">
        <textarea rows={2} placeholder="Ask anything about your food today…" value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} />
        <button className="btn accent" onClick={() => send()} disabled={busy || !text.trim()}>Send</button>
      </div>
    </>
  );
}

/* ---------- history ---------- */
function History({ data, onPick }) {
  const rows = Object.entries(data.days).map(([k, raw]) => ({ k, ...(() => { const d = { ...blankDay(), ...raw }; return {
    cal: d.foods.reduce((a, f) => a + f.calories, 0), p: d.foods.reduce((a, f) => a + f.protein, 0),
    weight: d.weight, tags: d.tags, sleep: d.sleep, steps: d.steps }; })() }))
    .filter((r) => r.cal > 0 || r.weight || r.sleep || r.steps).sort((a, b) => b.k.localeCompare(a.k));
  const fasts = (data.fasts || []).slice(0, 7);
  if (!rows.length && !fasts.length) return <div className="glass pad center"><p className="dim">Nothing logged yet.</p></div>;
  const logged = rows.filter((r) => r.cal > 0);
  const avgCal = logged.length ? Math.round(logged.reduce((a, r) => a + r.cal, 0) / logged.length) : 0;
  const avgP = logged.length ? Math.round(logged.reduce((a, r) => a + r.p, 0) / logged.length) : 0;
  const avgF = fasts.length ? (fasts.reduce((a, f) => a + f.hours, 0) / fasts.length).toFixed(1) : null;

  return (
    <>
      <div className="glass pad quad">
        <div><div className="midnum" style={{ color: C.cal }}>{avgCal.toLocaleString()}</div><div className="dim tiny">avg cal</div></div>
        <div><div className="midnum" style={{ color: C.protein }}>{avgP}g</div><div className="dim tiny">avg protein</div></div>
        {avgF && <div><div className="midnum" style={{ color: C.fat }}>{avgF}h</div><div className="dim tiny">avg fast</div></div>}
      </div>
      <div className="glass">
        {rows.map((r) => (
          <button key={r.k} className="histrow" onClick={() => onPick(r.k)}>
            <span>{prettyDay(r.k)}</span>
            <span className="dim tiny">{[r.weight && `${r.weight} lb`, r.sleep && `${r.sleep}h`,
              r.steps && `${(+r.steps).toLocaleString()} steps`, r.tags.length && r.tags.map((t) => TAGS[t]?.label).join(", ")].filter(Boolean).join(" · ")}</span>
            <span className="mono">{r.cal ? r.cal.toLocaleString() : "—"}</span>
          </button>
        ))}
      </div>
    </>
  );
}

/* ---------- import + settings ---------- */
function splitLine(line, delim) {
  const out = []; let cur = "", q = false;
  for (const ch of line) {
    if (ch === '"') q = !q;
    else if (ch === delim && !q) { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur); return out;
}
function toDayKey(v, fmt) {
  const s = String(v).trim();
  if (fmt === "epoch_ms" || /^\d{12,}$/.test(s)) { const n = +s; return n ? dayKey(new Date(n)) : null; }
  const iso = s.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const us = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (us) return `${us[3]}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}`;
  const d = new Date(s); return isNaN(d.getTime()) ? null : dayKey(d);
}
const toMs = (v) => {
  const s = String(v).trim();
  if (/^\d{12,}$/.test(s)) return +s;
  const d = new Date(s); return isNaN(d.getTime()) ? null : d.getTime();
};
const KINDS = { steps: "Steps", sleep: "Sleep", workouts: "Workouts" };

function Importer({ setData }) {
  const [kind, setKind] = useState("steps");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [parsed, setParsed] = useState(null);
  const [err, setErr] = useState("");

  const read = async () => {
    setBusy(true); setErr(""); setParsed(null);
    try {
      const lines = text.split(/\r?\n/).filter((l) => l.trim());
      if (lines.length < 2) throw new Error();
      const map = await askClaude([{ type: "text", text: `Below is the start of an exported health data file. The user wants the ${kind} data.

${lines.slice(0, 40).join("\n")}

Respond with ONLY JSON:
{"headerLine": 0-based index of the header row, "delimiter": "," or ";" or "tab", "dateCol": index of the date or start-time column, "dateFormat": "iso" or "us" or "epoch_ms", "valueCol": index of the ${kind === "steps" ? "step count" : kind === "sleep" ? "sleep duration, or end time if only start and end exist" : "exercise duration"} column, "valueUnit": "steps" or "ms" or "seconds" or "minutes" or "hours" or "endtime", "nameCol": index of an exercise name column, or null}` }]);
      const delim = map.delimiter === "tab" ? "\t" : map.delimiter;
      const out = {};
      for (const line of lines.slice(map.headerLine + 1)) {
        const c = splitLine(line, delim);
        const dk = toDayKey(c[map.dateCol], map.dateFormat);
        if (!dk) continue;
        const raw = c[map.valueCol];
        if (raw == null || raw === "") continue;
        if (kind === "steps") {
          const n = Math.round(+String(raw).replace(/[^\d.]/g, ""));
          if (!n) continue;
          out[dk] = { steps: String(Math.max(+(out[dk]?.steps || 0), n)) };
        } else {
          let mins;
          if (map.valueUnit === "endtime") {
            const a = toMs(c[map.dateCol]), b = toMs(raw);
            mins = a && b && b > a ? (b - a) / 60000 : null;
          } else {
            const n = +String(raw).replace(/[^\d.]/g, "");
            mins = map.valueUnit === "ms" ? n / 60000 : map.valueUnit === "seconds" ? n / 60 : map.valueUnit === "hours" ? n * 60 : n;
          }
          if (!mins || mins <= 0 || mins > 1440) continue;
          if (kind === "sleep") out[dk] = { sleep: (Math.round((+(out[dk]?.sleep || 0) + mins / 60) * 10) / 10).toFixed(1) };
          else out[dk] = { workouts: [...(out[dk]?.workouts || []), { name: map.nameCol != null && c[map.nameCol] ? String(c[map.nameCol]).trim() : "Workout", minutes: Math.round(mins) }] };
        }
      }
      if (!Object.keys(out).length) throw new Error();
      setParsed(out);
    } catch { setErr("Couldn't make sense of that. Paste the header row plus a few data rows, or enter it by hand."); }
    setBusy(false);
  };

  const preview = parsed ? Object.entries(parsed).sort((a, b) => b[0].localeCompare(a[0])) : [];
  return (
    <div className="glass pad stack">
      <h2>Import from your watch</h2>
      <p className="dim tiny">Samsung Health → Settings → Download personal data. Paste a file below, header row included.</p>
      <div className="chips">{Object.entries(KINDS).map(([k, l]) => (
        <button key={k} className={kind === k ? "chip on" : "chip"} onClick={() => { setKind(k); setParsed(null); setErr(""); }}>{l}</button>))}</div>
      <textarea rows={4} value={text} onChange={(e) => { setText(e.target.value); setParsed(null); }} placeholder="Paste file contents" />
      <button className="btn accent wide" onClick={read} disabled={busy || !text.trim()}>{busy ? "Reading…" : `Read the ${KINDS[kind].toLowerCase()}`}</button>
      {err && <p className="alert">{err}</p>}
      {parsed && (
        <div className="fadein stack">
          <p className="dim tiny">Found {preview.length} day{preview.length === 1 ? "" : "s"}:</p>
          {preview.slice(0, 6).map(([k, v]) => (
            <div key={k} className="row tiny"><span>{prettyDay(k)}</span>
              <span className="dim">{v.steps ? `${(+v.steps).toLocaleString()} steps` : v.sleep ? `${v.sleep}h` : v.workouts.map((w) => `${w.name} ${w.minutes}m`).join(", ")}</span></div>))}
          {preview.length > 6 && <p className="dim tiny">…and {preview.length - 6} more.</p>}
          <button className="btn solid wide" onClick={() => {
            setData((d) => {
              const days = { ...d.days };
              for (const [k, v] of Object.entries(parsed)) days[k] = { ...(days[k] || blankDay()), ...v };
              return { ...d, days };
            });
            setParsed(null); setText("");
          }}>Import {preview.length} days</button>
        </div>
      )}
    </div>
  );
}

function AdaptivePanel({ adaptive, on, onToggle }) {
  if (!adaptive) return null;
  const a = adaptive;
  return (
    <div className="glass pad stack">
      <div className="row"><h2>Your real maintenance</h2>
        {a.ready && <button className={on ? "chip on" : "chip"} onClick={() => onToggle(!on)}>{on ? "In use" : "Off"}</button>}</div>
      {!a.ready ? (
        <>
          <p className="dim small">Your budget comes from a formula that's typically 10% off either way. After about three weeks of weigh-ins and logged days, the app measures what you actually burn and replaces it.</p>
          <p className="cue">{a.need}</p>
          <p className="dim tiny">So far: {a.loggedDays} fully logged days, {a.weighIns} weigh-ins in the last 4 weeks.</p>
        </>
      ) : (
        <>
          <div className="quad">
            <div><div className="midnum" style={{ color: C.cal }}>{a.tdee.toLocaleString()}</div><div className="dim tiny">measured</div></div>
            <div><div className="midnum dim">{a.formula.toLocaleString()}</div><div className="dim tiny">formula said</div></div>
            <div><div className="midnum" style={{ color: C.protein }}>{a.lbPerWeek > 0 ? "+" : ""}{a.lbPerWeek}</div><div className="dim tiny">lb / week</div></div>
          </div>
          <p className="dim small">From {a.loggedDays} logged days averaging {a.avgIntake.toLocaleString()} cal and {a.weighIns} weigh-ins over the last 4 weeks{a.trust < 100 ? ` — ${a.trust}% measured, the rest still formula until there's more data` : ""}.</p>
          <p className="dim tiny">This only works if you log everything. Skip foods and it'll decide your metabolism is slower than it is and lower your budget. Your minimum budget still applies either way — it can't be pushed below a safe floor.</p>
        </>
      )}
    </div>
  );
}

/* ---------- setup panels: sync, install, alerts ---------- */
function SyncPanel({ sync, syncNow, startSync, joinSync, leaveSync }) {
  const code = localStorage.getItem("cutlog:sync");
  const [joinCode, setJoinCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [copied, setCopied] = useState(false);
  const run = async (fn) => { setBusy(true); setErr(""); try { await fn(); } catch (e) { setErr(String(e.message || e)); } setBusy(false); };

  if (!code) return (
    <div className="glass pad stack">
      <h2>Sync across devices</h2>
      <p className="dim small">Right now your log lives only in this browser. Turn on sync and it follows you between phone and laptop — and survives a cleared browser.</p>
      <button className="btn accent wide" disabled={busy} onClick={() => run(startSync)}>{busy ? "Setting up…" : "Turn on sync"}</button>
      <div className="row gap">
        <input placeholder="Or a code from another device" value={joinCode} autoCapitalize="characters" onChange={(e) => setJoinCode(e.target.value)} />
        <button className="btn ghost" disabled={busy || !joinCode.trim()} onClick={() => run(() => joinSync(joinCode))}>Connect</button>
      </div>
      {err && <p className="alert">{err}</p>}
    </div>
  );

  const when = sync.at ? new Date(sync.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "";
  const status = sync.state === "syncing" ? "Syncing…" : sync.state === "ok" ? `Synced at ${when}`
    : sync.state === "error" ? `Last sync failed at ${when}: ${sync.err}` : "Waiting to sync…";
  return (
    <div className="glass pad stack">
      <h2>Sync is on</h2>
      <p className="dim small">Enter this code on your other devices. Keep it private — anyone with it can read and change your log.</p>
      <div className="codebox" onClick={() => { navigator.clipboard?.writeText(code); setCopied(true); }}>{code}</div>
      <p className="dim tiny center">{copied ? "Copied" : "Tap to copy"}</p>
      <p className={sync.state === "error" ? "alert" : "dim tiny"}>{status}</p>
      <div className="rowbtns">
        <button className="btn ghost wide" onClick={syncNow}>Sync now</button>
        <button className="btn ghost wide" onClick={leaveSync}>Stop on this device</button>
      </div>
      {err && <p className="alert">{err}</p>}
    </div>
  );
}

function InstallPanel() {
  const [prompt, setPrompt] = useState(() => window.__installPrompt || null);
  const standalone = window.matchMedia?.("(display-mode: standalone)").matches || window.navigator.standalone;
  useEffect(() => {
    const f = () => setPrompt(window.__installPrompt || null);
    window.addEventListener("cutlog:installable", f);
    return () => window.removeEventListener("cutlog:installable", f);
  }, []);
  if (standalone) return null;
  return (
    <div className="glass pad stack">
      <h2>Put it on your home screen</h2>
      {prompt
        ? <button className="btn solid wide" onClick={async () => { prompt.prompt(); await prompt.userChoice; window.__installPrompt = null; setPrompt(null); }}>Install Cut Log</button>
        : <p className="dim small">In Chrome, tap ⋮ → <strong>Add to Home screen</strong> (or <strong>Install app</strong>). On iPhone, Share → Add to Home Screen.</p>}
      <p className="dim tiny">Installed, it opens full-screen like any other app, and fasting alerts are more reliable.</p>
    </div>
  );
}

function Reminders() {
  const saved = (() => { try { return JSON.parse(localStorage.getItem("cutlog:reminders")) || null; } catch { return null; } })();
  const [on, setOn] = useState(!!saved?.on);
  const [times, setTimes] = useState(saved?.times || ["12:30", "18:30"]);
  const [msg, setMsg] = useState("");
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;

  const save = async (nextOn, nextTimes) => {
    setMsg("");
    try {
      await pushApi({ op: "reminders", deviceId: deviceId(), times: nextOn ? nextTimes : [], tz });
      localStorage.setItem("cutlog:reminders", JSON.stringify({ on: nextOn, times: nextTimes }));
      setOn(nextOn); setTimes(nextTimes);
      setMsg(nextOn ? `Saved. Reminders at ${nextTimes.join(" and ")}, ${tz.replace(/_/g, " ")} time.` : "Reminders off.");
    } catch (e) { setMsg(String(e.message || e)); }
  };

  return (
    <div className="subpanel stack" style={{ marginTop: 4 }}>
      <button className={on ? "listbtn on" : "listbtn"} onClick={() => save(!on, times)}>{on ? "✓ " : ""}Remind me to log</button>
      {on && (
        <>
          {times.map((t, i) => (
            <div key={i} className="row gap">
              <input type="time" value={t} onChange={(e) => setTimes((x) => x.map((y, j) => (j === i ? e.target.value : y)))} />
              {times.length > 1 && <button className="icon" onClick={() => setTimes((x) => x.filter((_, j) => j !== i))}><X size={14} /></button>}
            </div>
          ))}
          <div className="rowbtns">
            {times.length < 4 && <button className="btn ghost wide" onClick={() => setTimes((x) => [...x, "20:00"])}>+ Add a time</button>}
            <button className="btn solid wide" onClick={() => save(true, times)}>Save times</button>
          </div>
          <p className="dim tiny">Skipped if you've logged in the last 4 hours, or while a fast is running.</p>
        </>
      )}
      {msg && <p className={/unknown|first|fail/i.test(msg) ? "alert" : "dim tiny"}>{msg}</p>}
    </div>
  );
}

function AlertsPanel({ data }) {
  const supported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  const [on, setOn] = useState(localStorage.getItem("cutlog:alerts") === "1");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  // serviceWorker.ready never settles if the worker failed to register, so don't wait forever.
  const worker = () => Promise.race([navigator.serviceWorker.ready,
    new Promise((_, rej) => setTimeout(() => rej(new Error("The app's background worker isn't running. Reload the page and try again.")), 8000))]);

  const enable = async () => {
    setBusy(true); setMsg("");
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") throw new Error("Notifications are blocked for this site. Allow them in your browser's site settings, then try again.");
      const reg = await worker();
      const { key } = await pushApi({ op: "key" });
      const sub = (await reg.pushManager.getSubscription()) || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(key) });
      await pushApi({ op: "subscribe", deviceId: deviceId(), sub: sub.toJSON(), start: data.fast?.start || null });
      localStorage.setItem("cutlog:alerts", "1");
      setOn(true);
      setMsg("On. You'll get a notification each time a fast reaches a new stage — checked every 10 minutes.");
    } catch (e) { setMsg(String(e.message || e)); }
    setBusy(false);
  };
  const disable = async () => {
    setBusy(true);
    try {
      const reg = await worker();
      await (await reg.pushManager.getSubscription())?.unsubscribe();
      await pushApi({ op: "unsubscribe", deviceId: deviceId() });
    } catch { /* turning off locally is what matters */ }
    localStorage.removeItem("cutlog:alerts");
    setOn(false); setMsg(""); setBusy(false);
  };
  const test = async () => {
    setMsg("");
    try { await pushApi({ op: "test", deviceId: deviceId() }); setMsg("Sent — it should land in a few seconds."); }
    catch (e) { setMsg(String(e.message || e)); }
  };

  return (
    <div className="glass pad stack">
      <h2>Fasting alerts</h2>
      {!supported ? <p className="dim small">This browser can't receive notifications. On iPhone, add the app to your home screen first, then open it from there.</p>
        : on ? (
          <>
            <p className="dim small">On for this device. You'll hear from it when a fast crosses into Fat burning, Ketosis, and each stage after.</p>
            <div className="rowbtns">
              <button className="btn ghost wide" onClick={test}>Send a test</button>
              <button className="btn ghost wide" disabled={busy} onClick={disable}>Turn off</button>
            </div>
            <Reminders />
          </>
        ) : (
          <>
            <p className="dim small">Get a notification as each fasting stage begins, even with the app closed.</p>
            <button className="btn accent wide" disabled={busy} onClick={enable}>{busy ? "Setting up…" : "Turn on fasting alerts"}</button>
          </>
        )}
      {msg && <p className={/blocked|isn't|fail|error/i.test(msg) ? "alert" : "dim tiny"}>{msg}</p>}
    </div>
  );
}

function Settings({ data, setData, onSave, sync, syncNow, startSync, joinSync, leaveSync, adaptive, useAdaptive }) {
  const [copied, setCopied] = useState(false);
  const [paste, setPaste] = useState("");
  const [msg, setMsg] = useState("");
  const t = computeTargets(data.profile, [], useAdaptive ? adaptive.tdee : null);
  return (
    <>
      <div className="glass pad stack">
        <h2>Look</h2>
        <div className="chips">
          <button className={data.theme === "glass" ? "chip on" : "chip"} onClick={() => setData((d) => ({ ...d, theme: "glass" }))}>Glass</button>
          <button className={data.theme !== "glass" ? "chip on" : "chip"} onClick={() => setData((d) => ({ ...d, theme: "retro" }))}>Desktop '95</button>
        </div>
        <p className="dim tiny">Desktop '95 is the default. Switches the whole app — nothing about your data changes.</p>
      </div>
      <AdaptivePanel adaptive={adaptive} on={data.useAdaptive !== false} onToggle={(v) => setData((d) => ({ ...d, useAdaptive: v }))} />
      <SyncPanel {...{ sync, syncNow, startSync, joinSync, leaveSync }} />
      <InstallPanel />
      <AlertsPanel data={data} />
      <div className="glass pad">
        <div className="row"><span className="dim">Maintenance {useAdaptive ? "(measured)" : "(formula)"}</span><strong className="mono">{t.tdee.toLocaleString()}</strong></div>
        <div className="row"><span className="dim">Rest-day budget</span><strong className="mono">{t.base.toLocaleString()}</strong></div>
        <div className="row"><span className="dim">Rest-day protein</span><strong className="mono">{t.protein}g</strong></div>
        {t.clamped && <p className="alert">Budget is held at the floor. Add movement instead of cutting lower.</p>}
      </div>
      <ProfileForm initial={data.profile} title="Your numbers" cta="Save" onSave={onSave} />
      <div className="glass pad stack">
        <h2>Backup</h2>
        <p className="dim tiny">This lives in one browser. Copy it somewhere safe now and again.</p>
        <button className="btn ghost wide" onClick={() => { navigator.clipboard.writeText(JSON.stringify(data)); setCopied(true); }}>{copied ? "Copied" : "Copy my whole log"}</button>
        <input placeholder="Paste a backup to restore" value={paste} onChange={(e) => setPaste(e.target.value)} />
        <button className="btn ghost wide" disabled={!paste.trim()} onClick={() => {
          try { const d = JSON.parse(paste); if (!d.profile || !d.days) throw new Error();
            setData({ favorites: [], fasts: [], calib: [], list: [], labs: [], menus: {}, share: false, fast: null, ...d });
            setMsg("Restored."); setPaste(""); }
          catch { setMsg("That isn't a valid backup."); }
        }}>Restore</button>
        {msg && <p className="dim tiny">{msg}</p>}
      </div>
      <Importer setData={setData} />
    </>
  );
}

function ProfileForm({ initial, title, cta, intro, onSave }) {
  const [p, setP] = useState(initial);
  const set = (k, v) => setP((x) => ({ ...x, [k]: v }));
  const pv = computeTargets({ ...p, weight: +p.weight, goalWeight: +p.goalWeight, age: +p.age, heightIn: +p.heightIn }, []);
  const ft = Math.floor(p.heightIn / 12), inch = p.heightIn % 12;
  return (
    <div className="glass pad stack">
      <h2>{title}</h2>
      {intro && <p className="dim small">{intro}</p>}
      <div><label>Your name</label><input placeholder="So your partner knows whose log is whose" value={p.name || ""} onChange={(e) => set("name", e.target.value)} /></div>
      <div className="chips">{["male", "female"].map((s) => (
        <button key={s} className={p.sex === s ? "chip on" : "chip"} onClick={() => set("sex", s)}>{s === "male" ? "Male" : "Female"}</button>))}</div>
      <div className="grid2">
        <div><label>Age</label><input type="number" value={p.age} onChange={(e) => set("age", e.target.value)} /></div>
        <div><label>Height</label><div className="row gap">
          <input aria-label="Feet" type="number" value={ft} onChange={(e) => set("heightIn", (+e.target.value) * 12 + inch)} />
          <input aria-label="Inches" type="number" value={inch} onChange={(e) => set("heightIn", ft * 12 + (+e.target.value))} /></div></div>
        <div><label>Current weight</label><input type="number" value={p.weight} onChange={(e) => set("weight", e.target.value)} /></div>
        <div><label>Goal weight</label><input type="number" value={p.goalWeight} onChange={(e) => set("goalWeight", e.target.value)} /></div>
        <div><label>Daily water (oz)</label><input type="number" value={p.waterOz ?? 100} onChange={(e) => set("waterOz", e.target.value)} /></div>
      </div>
      <label>How your days usually go</label>
      <div className="stack">{Object.entries(ACTIVITY).map(([k, v]) => (
        <button key={k} className={p.activity === k ? "listbtn on" : "listbtn"} onClick={() => set("activity", k)}>{v.label}</button>))}</div>
      <label>How fast</label>
      <div className="chips">{[0.5, 1, 1.5, 2].map((v) => (
        <button key={v} className={p.pace === v ? "chip on" : "chip"} onClick={() => set("pace", v)}>{v} lb/wk</button>))}</div>
      <div className="quad">
        <div><div className="midnum" style={{ color: C.cal }}>{pv.base.toLocaleString()}</div><div className="dim tiny">calories a day</div></div>
        <div><div className="midnum" style={{ color: C.protein }}>{pv.protein}g</div><div className="dim tiny">protein a day</div></div>
      </div>
      {pv.clamped && <p className="alert">That pace pushes under a sensible floor, so the budget stops here.</p>}
      <button className="btn solid wide" onClick={() => onSave({ ...p, age: +p.age, heightIn: +p.heightIn, weight: +p.weight, goalWeight: +p.goalWeight, waterOz: +p.waterOz || 100 })}>{cta}</button>
    </div>
  );
}

/* ---------- shell ---------- */
function Shell({ children, theme }) {
  return (
    <div className={theme === "glass" ? "app" : "app retro"}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Sora:wght@300;400;600&family=JetBrains+Mono:wght@400;600&family=VT323&display=swap');
        .app { position:relative; min-height:100vh; font-family:'Sora',ui-sans-serif,system-ui,sans-serif;
          color:#F1F5F9; font-size:15px; line-height:1.5; overflow-x:hidden;
          background:#0A0E1F; padding:16px 14px 96px; max-width:560px; margin:0 auto;
          font-variant-numeric:tabular-nums; }
        .app::before, .app::after, .orb { content:''; position:fixed; border-radius:50%; filter:blur(70px); z-index:0; pointer-events:none; }
        .app::before { width:340px; height:340px; background:radial-gradient(circle,#6D28D9,transparent 70%); top:-90px; left:-90px; opacity:.75; animation:drift1 26s ease-in-out infinite; }
        .app::after { width:300px; height:300px; background:radial-gradient(circle,#0E7490,transparent 70%); bottom:40px; right:-90px; opacity:.7; animation:drift2 32s ease-in-out infinite; }
        @keyframes drift1 { 0%,100%{transform:translate(0,0) scale(1)} 50%{transform:translate(70px,110px) scale(1.18)} }
        @keyframes drift2 { 0%,100%{transform:translate(0,0) scale(1)} 50%{transform:translate(-80px,-90px) scale(1.22)} }
        .app > * { position:relative; z-index:1; }
        h2 { font-size:19px; font-weight:600; margin:0; letter-spacing:-.01em; }
        p { margin:0; }
        .dim { color:rgba(241,245,249,.55); } .tiny { font-size:11.5px; } .small { font-size:13px; }
        .center { text-align:center; } .right { text-align:right; } .mono { font-family:'JetBrains Mono',ui-monospace,monospace; }
        .row { display:flex; justify-content:space-between; align-items:center; gap:10px; }
        .gap { gap:8px; } .stack { display:flex; flex-direction:column; gap:11px; }
        .fadein { animation:rise .5s cubic-bezier(.22,1,.36,1) both; }
        @keyframes rise { from{opacity:0; transform:translateY(14px)} to{opacity:1; transform:none} }
        .glass { background:rgba(255,255,255,.055); border:1px solid rgba(255,255,255,.12); border-radius:22px;
          backdrop-filter:blur(22px); -webkit-backdrop-filter:blur(22px); margin-bottom:12px; overflow:hidden;
          box-shadow:0 8px 32px rgba(0,0,0,.32), inset 0 1px 0 rgba(255,255,255,.14); animation:rise .55s cubic-bezier(.22,1,.36,1) both; }
        .pad { padding:16px; } .glass.hero { padding:22px 16px 18px; display:flex; flex-direction:column; align-items:center; gap:14px; }
        .ringwrap { position:relative; display:grid; place-items:center; }
        .ring { position:absolute; inset:0; }
        .ringinner { text-align:center; z-index:1; display:flex; flex-direction:column; gap:3px; }
        .huge { font-size:33px; font-weight:300; letter-spacing:-.02em; line-height:1.1; }
        .unit { font-size:16px; opacity:.5; margin-left:3px; }
        .stagename { font-size:13px; font-weight:600; letter-spacing:.02em; }
        .stagebody { text-align:center; max-width:340px; font-size:14px; line-height:1.55; color:rgba(241,245,249,.85); }
        .bignum { font-size:40px; font-weight:300; letter-spacing:-.03em; line-height:1; }
        .midnum { font-size:23px; font-weight:400; }
        .hr { font-size:12px; min-width:32px; opacity:.6; }
        .fuelhead { display:flex; justify-content:space-between; align-items:flex-end; }
        .fuel { display:flex; height:11px; background:rgba(255,255,255,.09); border-radius:99px; overflow:hidden; margin:14px 0 4px; position:relative; }
        .fuel > div { transition:width .7s cubic-bezier(.22,1,.36,1); }
        .overtick { position:absolute; top:0; bottom:0; width:2px; background:#fff; opacity:.8; }
        .bars { display:flex; flex-direction:column; gap:9px; margin-top:12px; }
        .track { height:5px; background:rgba(255,255,255,.09); border-radius:99px; overflow:hidden; margin-top:5px; }
        .track > div { height:100%; border-radius:99px; transition:width .7s cubic-bezier(.22,1,.36,1); }
        .cue { font-size:12.5px; color:#7DD3FC; border-left:2px solid #7DD3FC55; padding-left:9px; margin-top:9px; }
        .alert { color:#FB7185; font-size:12.5px; }
        .chips { display:flex; flex-wrap:wrap; gap:6px; margin-bottom:8px; }
        .chips.center { justify-content:center; }
        .chip { background:rgba(255,255,255,.07); border:1px solid rgba(255,255,255,.14); color:#F1F5F9;
          padding:7px 13px; border-radius:99px; font:inherit; font-size:12.5px; cursor:pointer; transition:transform .15s, background .2s; }
        .chip:active { transform:scale(.94); }
        .chip.on { background:#F1F5F9; color:#0A0E1F; border-color:#F1F5F9; font-weight:600; }
        .btn { border-radius:99px; font:inherit; font-size:14px; cursor:pointer; padding:12px 18px; border:1px solid transparent;
          display:inline-flex; align-items:center; justify-content:center; gap:7px; transition:transform .15s, opacity .2s; }
        .btn:active { transform:scale(.97); } .btn:disabled { opacity:.35; }
        .btn.solid { background:#F1F5F9; color:#0A0E1F; font-weight:600; }
        .btn.accent { background:linear-gradient(120deg,#6EE7F9,#A78BFA); color:#0A0E1F; font-weight:600; }
        .btn.ghost { background:rgba(255,255,255,.06); border-color:rgba(255,255,255,.16); color:#F1F5F9; }
        .btn.wide { width:100%; } .btn.big { padding:15px; font-size:15px; margin-bottom:12px; }
        .rowbtns { display:flex; gap:8px; width:100%; }
        .icon { background:none; border:none; color:rgba(241,245,249,.6); cursor:pointer; padding:5px; display:inline-flex; }
        .icon:disabled { opacity:.25; }
        .linkbtn { background:none; border:none; color:rgba(241,245,249,.6); font:inherit; font-size:12.5px; cursor:pointer; padding:10px 16px; text-align:left; }
        .linkbtn.full { width:100%; border-top:1px solid rgba(255,255,255,.09); text-align:center; }
        .listbtn { display:block; width:100%; box-sizing:border-box; text-align:left; background:rgba(255,255,255,.05);
          border:1px solid rgba(255,255,255,.12); color:#F1F5F9; border-radius:14px; padding:11px 13px; font:inherit; font-size:13.5px; cursor:pointer; }
        .listbtn.on { background:#F1F5F9; color:#0A0E1F; font-weight:600; }
        .daynav { display:flex; justify-content:center; align-items:center; gap:14px; font-size:13px; color:rgba(241,245,249,.6); margin:4px 0 10px; }
        .mealhead { display:flex; align-items:center; gap:8px; padding:11px 16px; font-size:12.5px; background:rgba(255,255,255,.04); }
        .mealhead .right { margin-left:auto; }
        .dot { width:7px; height:7px; border-radius:50%; }
        .fooditem { display:flex; justify-content:space-between; align-items:center; gap:10px; padding:12px 16px; border-top:1px solid rgba(255,255,255,.06); font-size:14px; }
        .fright { display:flex; align-items:center; gap:6px; }
        .histrow { display:grid; grid-template-columns:1fr auto auto; gap:10px; align-items:center; width:100%; text-align:left;
          background:none; border:none; border-top:1px solid rgba(255,255,255,.07); padding:13px 16px; font:inherit; font-size:13.5px; color:#F1F5F9; cursor:pointer; }
        .histrow:first-child { border-top:none; }
        .quad { display:flex; gap:16px; flex-wrap:wrap; } .quad.small { display:grid; grid-template-columns:repeat(4,1fr); gap:7px; }
        .grid2 { display:grid; grid-template-columns:1fr 1fr; gap:10px; }
        label { display:block; font-size:11.5px; color:rgba(241,245,249,.55); margin-bottom:4px; }
        input, textarea { width:100%; box-sizing:border-box; background:rgba(255,255,255,.07); border:1px solid rgba(255,255,255,.14);
          color:#F1F5F9; border-radius:13px; padding:11px 13px; font:inherit; font-size:15px; outline:none; transition:border-color .2s, background .2s; }
        input:focus, textarea:focus { border-color:#6EE7F9; background:rgba(110,231,249,.08); }
        input::placeholder, textarea::placeholder { color:rgba(241,245,249,.32); }
        input.mini { max-width:110px; text-align:right; } .wideinput { width:100%; }
        textarea { font-size:12px; resize:vertical; font-family:'JetBrains Mono',monospace; }
        .dropzone { display:block; text-align:center; padding:26px; border:1px dashed rgba(255,255,255,.24); border-radius:18px;
          color:#F1F5F9; font-size:14px; cursor:pointer; background:rgba(255,255,255,.03); margin:0; }
        .shot { width:100%; max-height:230px; object-fit:cover; border-radius:16px; display:block; }
        .qbox { border:1px solid rgba(110,231,249,.3); background:rgba(110,231,249,.07); border-radius:16px; padding:14px; display:flex; flex-direction:column; gap:10px; }
        .itemcard { border:1px solid rgba(255,255,255,.1); border-radius:16px; padding:12px; display:flex; flex-direction:column; gap:8px; background:rgba(255,255,255,.03); }
        .badge { font-size:10px; padding:3px 8px; border-radius:99px; text-transform:uppercase; letter-spacing:.05em; white-space:nowrap;
          background:rgba(255,255,255,.1); color:rgba(241,245,249,.7); }
        .badge.good { background:rgba(163,230,53,.18); color:#A3E635; }
        .badge.low { background:rgba(251,113,133,.18); color:#FB7185; }
        .stagerow { display:flex; gap:12px; padding:12px 16px; border-top:1px solid rgba(255,255,255,.06); align-items:flex-start; }
        .stagerow.on { background:rgba(255,255,255,.06); }
        .sname { font-size:13.5px; }
        .dock { position:fixed; bottom:14px; left:50%; transform:translateX(-50%); display:flex; gap:2px; z-index:50;
          background:rgba(18,22,42,.72); border:1px solid rgba(255,255,255,.14); border-radius:99px; padding:6px;
          backdrop-filter:blur(24px); -webkit-backdrop-filter:blur(24px); box-shadow:0 10px 36px rgba(0,0,0,.5); }
        .timerow { display:flex; align-items:center; gap:8px; margin-top:2px; }
        .timeinput { width:auto; padding:2px 6px; font-size:11px; border-radius:7px; background:rgba(255,255,255,.06);
          border:1px solid rgba(255,255,255,.1); color:rgba(241,245,249,.75); font-family:'JetBrains Mono',monospace; }
        .tapable { cursor:pointer; flex:1; min-width:0; }
        .menuthumb { width:84px; height:84px; object-fit:cover; border-radius:12px; }
        .tweaks { margin:0; padding-left:18px; font-size:12.5px; color:rgba(241,245,249,.7); display:flex; flex-direction:column; gap:3px; }
        .chat { display:flex; flex-direction:column; gap:8px; margin-bottom:12px; }
        .bubble { max-width:86%; padding:11px 14px; border-radius:18px 18px 18px 6px; background:rgba(255,255,255,.07);
          border:1px solid rgba(255,255,255,.1); font-size:14px; line-height:1.5; white-space:pre-wrap; align-self:flex-start; }
        .bubble.me { align-self:flex-end; border-radius:18px 18px 6px 18px; background:rgba(110,231,249,.14); border-color:rgba(110,231,249,.3); }
        .composer textarea { font-family:inherit; font-size:14px; }
        .thumbs { display:grid; grid-template-columns:repeat(3,1fr); gap:6px; }
        .thumb { aspect-ratio:3/4; border-radius:12px; overflow:hidden; border:1px solid rgba(255,255,255,.12); background:rgba(255,255,255,.04);
          padding:0; cursor:pointer; display:grid; place-items:center; }
        .thumb img, .compare img { width:100%; height:100%; object-fit:cover; display:block; }
        .viewer { position:fixed; inset:0; z-index:100; background:rgba(5,7,16,.92); display:grid; place-items:center; padding:16px; }
        .viewerInner { width:100%; max-width:520px; display:flex; flex-direction:column; gap:10px; max-height:100%; overflow:auto; }
        .viewer .full { width:100%; max-height:70vh; object-fit:contain; border-radius:16px; }
        .compare { display:grid; grid-template-columns:1fr 1fr; gap:8px; }
        .compare > div > img { aspect-ratio:3/4; border-radius:14px; }
        .editbox { margin:0 12px 12px; padding:14px; border-radius:16px; background:rgba(255,255,255,.05);
          border:1px solid rgba(110,231,249,.25); display:flex; flex-direction:column; gap:10px; }
        .subpanel { padding:12px; border-radius:16px; background:rgba(255,255,255,.035); border:1px solid rgba(255,255,255,.08); }
        .ingredients { border:1px solid rgba(255,255,255,.08); border-radius:14px; padding:6px 12px 10px; }
        .ingrow { padding:7px 0; border-bottom:1px solid rgba(255,255,255,.06); }
        .recipeRow { display:flex; align-items:center; gap:4px; }
        .codebox { font-family:'JetBrains Mono',monospace; font-size:19px; letter-spacing:.08em; text-align:center; padding:14px;
          border-radius:14px; background:rgba(110,231,249,.08); border:1px dashed rgba(110,231,249,.4); user-select:all; }
        .listitem { display:flex; align-items:center; gap:10px; width:100%; text-align:left; background:none; border:none;
          border-top:1px solid rgba(255,255,255,.06); padding:11px 16px; font:inherit; font-size:14px; color:#F1F5F9; cursor:pointer; }
        .tick { width:19px; height:19px; border-radius:6px; border:1px solid rgba(255,255,255,.25); display:grid; place-items:center;
          font-size:12px; flex-shrink:0; color:#0A0E1F; }
        .tick.on { background:#A3E635; border-color:#A3E635; }
        .dish { padding:14px 16px; border-top:1px solid rgba(255,255,255,.06); display:flex; flex-direction:column; gap:9px; }
        .dishname { font-size:15px; }
        .dishmacros { display:flex; align-items:baseline; gap:10px; }
        .recipe { border-top:1px solid rgba(255,255,255,.08); padding-top:10px; font-size:13px; }
        .recipe ul, .recipe ol { margin:8px 0 0; padding-left:18px; display:flex; flex-direction:column; gap:5px; }
        .recipe ul { color:rgba(241,245,249,.7); }

        /* what this one meal should come to */
        .mealtarget { border:1px solid rgba(255,255,255,.1); border-radius:14px; padding:12px 14px;
          background:rgba(255,255,255,.04); display:flex; flex-direction:column; gap:8px; }
        .mealtarget p { margin:0; }

        /* the weighed breakdown: item, grams on the scale, calories that adds */
        .weightbl { width:100%; border-collapse:collapse; margin-top:8px; font-size:13px; }
        .weightbl th { text-align:left; font-weight:400; font-size:11px; letter-spacing:.04em; text-transform:uppercase;
          color:rgba(241,245,249,.45); padding:0 0 5px; border-bottom:1px solid rgba(255,255,255,.1); }
        .weightbl td { padding:5px 0; border-bottom:1px solid rgba(255,255,255,.05); vertical-align:top; }
        .weightbl td:not(:first-child), .weightbl th:not(:first-child) { padding-left:10px; width:58px; }
        .weightbl tfoot td { border-bottom:none; border-top:1px solid rgba(255,255,255,.18); font-weight:600; }
        .weightbl .mono { font-size:13px; }
        .dockbtn { background:none; border:none; color:rgba(241,245,249,.5); font:inherit; font-size:9.5px; cursor:pointer;
          display:flex; flex-direction:column; align-items:center; gap:3px; padding:8px 9px; border-radius:99px; transition:all .25s; }
        .dockbtn.on { color:#0A0E1F; background:#F1F5F9; font-weight:600; }
        .app *:focus-visible { outline:2px solid #6EE7F9; outline-offset:2px; }

        /* ================= Desktop '95 theme ================= */
        .tray { display:none; }
        .app.retro { background:#008080; color:#000; font-family:Tahoma, Verdana, 'Segoe UI', Arial, sans-serif; font-size:14px; }
        .app.retro::before, .app.retro::after { display:none; }
        .app.retro *:focus-visible { outline:1px dotted #000; outline-offset:-4px; }
        .app.retro h2 { font-family:Tahoma, Verdana, 'Segoe UI', Arial, sans-serif; font-size:15px; font-weight:bold; letter-spacing:0; }
        .app.retro .dim { color:#404040; }
        .app.retro .alert { color:#C00000; }

        /* windows */
        .app.retro .glass { background:#C0C0C0; border:none; border-radius:0; box-shadow:inset -1px -1px #0a0a0a, inset 1px 1px #dfdfdf, inset -2px -2px #808080, inset 2px 2px #fff;
          backdrop-filter:none; -webkit-backdrop-filter:none; padding:3px; }
        .app.retro .glass::before { content:""; display:block; height:20px; margin:0 0 3px; align-self:stretch;
          background:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='52' height='14' shape-rendering='crispEdges'%3E%3Cg fill='%23C0C0C0'%3E%3Crect width='16' height='14'/%3E%3Crect x='16' width='16' height='14'/%3E%3Crect x='36' width='16' height='14'/%3E%3C/g%3E%3Cpath d='M.5 13V.5H15M16.5 13V.5H31M36.5 13V.5H51' stroke='%23fff' fill='none'/%3E%3Cpath d='M0 13.5H16M15.5 0V14M16 13.5H32M31.5 0V14M36 13.5H52M51.5 0V14' stroke='%23000' fill='none'/%3E%3Crect x='4' y='9' width='6' height='2'/%3E%3Cpath d='M19.5 3.5h9v7h-9z' fill='none' stroke='%23000'/%3E%3Crect x='19' y='3' width='10' height='2'/%3E%3Cpath d='M40 3.5l7 7M47 3.5l-7 7' stroke='%23000' stroke-width='1.6' shape-rendering='geometricPrecision'/%3E%3C/svg%3E") no-repeat right 3px center, linear-gradient(90deg, #000080, #1084D0); }
        .app.retro .glass.pad { padding:3px 14px 14px; }
        .app.retro .glass.pad::before { margin:0 -11px 10px; }
        .app.retro .glass.hero { padding:3px 14px 16px; }
        .app.retro .glass.hero::before { margin:0 -11px 4px; }
        .app.retro .composer::before { display:none; }
        .app.retro .composer { padding:8px; }

        /* the big numbers stay big — in a terminal face that still reads at a glance */
        .app.retro .huge, .app.retro .bignum, .app.retro .midnum, .app.retro .codebox { font-family:'VT323', 'Courier New', monospace; font-weight:400; letter-spacing:0; }
        .app.retro .huge { font-size:46px; line-height:.95; }
        .app.retro .bignum { font-size:60px; line-height:.9; }
        .app.retro .midnum { font-size:32px; }
        .app.retro .mono { font-family:'VT323', 'Courier New', monospace; font-size:19px; }
        .app.retro .unit { opacity:.7; }
        .app.retro .stagename { font-family:Tahoma, Verdana, 'Segoe UI', Arial, sans-serif; font-weight:bold; }
        .app.retro .stagebody { color:#000; }

        /* buttons */
        .app.retro .btn, .app.retro .chip { background:#C0C0C0; color:#000; border:none; border-radius:0; box-shadow:inset -1px -1px #0a0a0a, inset 1px 1px #dfdfdf, inset -2px -2px #808080, inset 2px 2px #fff;
          font-family:Tahoma, Verdana, 'Segoe UI', Arial, sans-serif; font-weight:normal; transition:none; }
        .app.retro .btn:active, .app.retro .chip:active { box-shadow:inset -1px -1px #fff, inset 1px 1px #0a0a0a, inset -2px -2px #dfdfdf, inset 2px 2px #808080; transform:none; }
        .app.retro .btn.solid, .app.retro .btn.accent { font-weight:bold; box-shadow:0 0 0 1px #000, inset -1px -1px #0a0a0a, inset 1px 1px #dfdfdf, inset -2px -2px #808080, inset 2px 2px #fff; background:#C0C0C0; color:#000; }
        .app.retro .btn.solid:active, .app.retro .btn.accent:active { box-shadow:0 0 0 1px #000, inset -1px -1px #fff, inset 1px 1px #0a0a0a, inset -2px -2px #dfdfdf, inset 2px 2px #808080; }
        .app.retro .btn:disabled, .app.retro .chip:disabled { opacity:1; color:#808080; text-shadow:1px 1px #fff; }
        .app.retro .chip { padding:6px 11px; font-size:12.5px; }
        .app.retro .chip.on { background:#000080; color:#fff; box-shadow:inset -1px -1px #fff, inset 1px 1px #0a0a0a, inset -2px -2px #dfdfdf, inset 2px 2px #808080; font-weight:bold; }
        .app.retro .icon, .app.retro .linkbtn { color:#000; }

        /* list boxes and fields */
        .app.retro .listbtn { background:#fff; color:#000; border:1px solid #808080; border-radius:0; }
        .app.retro .listbtn.on { background:#000080; color:#fff; border-color:#000080; font-weight:bold; }
        .app.retro input, .app.retro textarea { background:#fff; color:#000; border:none; border-radius:0; box-shadow:inset -1px -1px #fff, inset 1px 1px #808080, inset -2px -2px #dfdfdf, inset 2px 2px #0a0a0a; font-family:Tahoma, Verdana, 'Segoe UI', Arial, sans-serif; }
        .app.retro input:focus, .app.retro textarea:focus { background:#fff; border:none; }
        .app.retro input::placeholder, .app.retro textarea::placeholder { color:#808080; }
        .app.retro label { color:#000; }
        .app.retro .timeinput { background:#fff; color:#000; border-radius:0; box-shadow:inset -1px -1px #fff, inset 1px 1px #808080, inset -2px -2px #dfdfdf, inset 2px 2px #0a0a0a; border:none; font-family:'VT323', monospace; font-size:15px; }

        /* progress bars: the chunky block style, each bar keeping its own color */
        .app.retro .track, .app.retro .fuel { background:#fff; border-radius:0; box-shadow:inset -1px -1px #fff, inset 1px 1px #808080, inset -2px -2px #dfdfdf, inset 2px 2px #0a0a0a; height:16px; padding:3px; box-sizing:border-box; }
        .app.retro .track.tall { height:20px; }
        .app.retro .track > div, .app.retro .fuel > div { border-radius:0; box-shadow:none !important;
          background-image:repeating-linear-gradient(90deg, transparent 0 8px, #fff 8px 10px) !important; }
        .app.retro .overtick { background:#C00000; opacity:1; }
        .app.retro .dot { border-radius:0; box-shadow:none !important; }

        /* list views */
        .app.retro .mealhead { background:#C0C0C0; box-shadow:inset -1px -1px #0a0a0a, inset 1px 1px #dfdfdf, inset -2px -2px #808080, inset 2px 2px #fff; font-weight:bold; color:#000; }
        .app.retro .fooditem, .app.retro .dish, .app.retro .listitem, .app.retro .histrow { background:#fff; color:#000; border-top:1px solid #C0C0C0; }
        .app.retro .histrow:hover, .app.retro .histrow:focus-visible { background:#000080; color:#fff; }
        .app.retro .histrow:hover .dim { color:#dfdfdf; }
        .app.retro .stagerow { background:#fff; border-top:1px solid #C0C0C0; }
        .app.retro .stagerow.on { background:#000080; color:#fff; }
        .app.retro .stagerow.on .dim, .app.retro .stagerow.on .hr { color:#dfdfdf; opacity:1; }
        .app.retro .tick { border-radius:0; border-color:#000; background:#fff; }
        .app.retro .tick.on { background:#fff; color:#000; border-color:#000; }

        /* group boxes */
        .app.retro .editbox, .app.retro .subpanel, .app.retro .ingredients, .app.retro .qbox, .app.retro .itemcard, .app.retro .recipe {
          background:transparent; border:2px groove #f4f4f4; border-radius:0; }
        .app.retro .ingrow { border-bottom-color:#a0a0a0; }
        .app.retro .cue { color:#000; background:#FFFFE1; border:1px solid #000; padding:6px 9px; }
        .app.retro .mealtarget { background:#FFFFE1; border:1px solid #000; border-radius:0; }
        .app.retro .weightbl { background:#fff; }
        .app.retro .weightbl th { background:#C0C0C0; color:#000; text-transform:none; letter-spacing:0; font-size:11.5px; font-weight:bold;
          padding:3px 5px; border-bottom:1px solid #808080; box-shadow:inset -1px -1px #808080, inset 1px 1px #fff; }
        .app.retro .weightbl td { padding:4px 5px; border-bottom:1px solid #C0C0C0; color:#000; }
        .app.retro .weightbl tfoot td { border-top:1px solid #000; background:#C0C0C0; font-weight:bold; }
        .app.retro .weightbl .mono { font-size:15px; }
        .app.retro .badge { background:#C0C0C0; color:#000; border:1px solid #808080; border-radius:0; }
        .app.retro .badge.good { color:#006B00; }
        .app.retro .badge.low { color:#C00000; }
        .app.retro .codebox { background:#fff; color:#000080; border:none; border-radius:0; box-shadow:inset -1px -1px #fff, inset 1px 1px #808080, inset -2px -2px #dfdfdf, inset 2px 2px #0a0a0a; font-size:26px; }
        .app.retro .dropzone { background:#fff; color:#000; border:1px dashed #000; border-radius:0; }
        .app.retro .shot, .app.retro .thumb, .app.retro .menuthumb, .app.retro .compare > div > img, .app.retro .viewer .full { border-radius:0; border:1px solid #000; }
        .app.retro .viewer { background:rgba(0,128,128,.94); }
        .app.retro .viewerInner { background:#C0C0C0; box-shadow:inset -1px -1px #0a0a0a, inset 1px 1px #dfdfdf, inset -2px -2px #808080, inset 2px 2px #fff; padding:10px; }

        /* coach */
        .app.retro .bubble { background:#fff; color:#000; border:1px solid #000; border-radius:0; }
        .app.retro .bubble.me { background:#FFFFE1; border-color:#000; }

        /* bottom dock becomes a taskbar */
        .app.retro .dock { left:0; right:0; bottom:0; transform:none; border-radius:0; border:none; background:#C0C0C0;
          box-shadow:inset 0 1px #dfdfdf, inset 0 2px #fff; padding:4px 4px calc(4px + env(safe-area-inset-bottom)); gap:3px;
          backdrop-filter:none; -webkit-backdrop-filter:none; }
        .app.retro .dockbtn { flex:1; flex-direction:row; justify-content:center; gap:4px; border-radius:0; padding:6px 2px;
          background:#C0C0C0; color:#000; font-family:Tahoma, Verdana, 'Segoe UI', Arial, sans-serif; font-size:11px; box-shadow:inset -1px -1px #0a0a0a, inset 1px 1px #dfdfdf, inset -2px -2px #808080, inset 2px 2px #fff; transition:none; min-width:0; }
        .app.retro .dockbtn.on { background:repeating-conic-gradient(#C0C0C0 0 25%, #fff 0 50%) 0 0 / 2px 2px; color:#000; box-shadow:inset -1px -1px #fff, inset 1px 1px #0a0a0a, inset -2px -2px #dfdfdf, inset 2px 2px #808080; font-weight:bold; }
        .app.retro .tray { display:flex; align-items:center; padding:0 8px; font-size:11px; box-shadow:inset -1px -1px #fff, inset 1px 1px #808080, inset -2px -2px #dfdfdf, inset 2px 2px #0a0a0a; white-space:nowrap; }
        @media (max-width:430px) { .app.retro .tray { display:none; } .app.retro .dockbtn span { font-size:10px; } }
        @media (max-width:360px) { .app.retro .dockbtn span { display:none; } }
        .app.retro { padding-bottom:84px; }
        /* the Start button lives only on the taskbar */
        .startbtn { display:none; }

        /* desktop wallpaper: flat teal with the faint scanline dither a 90s CRT gave you free */
        .app.retro { background-color:#008080; background-image:
            repeating-linear-gradient(0deg, rgba(0,0,0,.045) 0 1px, transparent 1px 3px),
            repeating-linear-gradient(90deg, rgba(255,255,255,.035) 0 1px, transparent 1px 3px);
          background-attachment:fixed; }

        /* Start button + menu */
        .app.retro .startbtn { display:flex; align-items:center; gap:5px; flex:0 0 auto; padding:5px 9px; border:none;
          background:#C0C0C0; color:#000; font-family:Tahoma, Verdana, 'Segoe UI', Arial, sans-serif; font-size:12px; font-weight:bold;
          box-shadow:inset -1px -1px #0a0a0a, inset 1px 1px #dfdfdf, inset -2px -2px #808080, inset 2px 2px #fff; cursor:pointer; }
        .app.retro .startbtn[aria-expanded="true"] { box-shadow:inset -1px -1px #fff, inset 1px 1px #0a0a0a, inset -2px -2px #dfdfdf, inset 2px 2px #808080; }
        .app.retro .startmenu { position:fixed; left:4px; bottom:calc(46px + env(safe-area-inset-bottom)); width:206px; z-index:70;
          display:flex; background:#C0C0C0; box-shadow:inset -1px -1px #0a0a0a, inset 1px 1px #dfdfdf, inset -2px -2px #808080, inset 2px 2px #fff; padding:3px; }
        .app.retro .startstripe { width:22px; flex:0 0 22px; margin-right:3px; background:linear-gradient(#000080, #1084D0); }
        .app.retro .startstripe span { display:block; transform:rotate(180deg); writing-mode:vertical-rl; color:#fff; font-weight:bold;
          font-size:12px; padding:8px 0; letter-spacing:.04em; }
        .app.retro .startitems { flex:1; display:flex; flex-direction:column; }
        .app.retro .startitem { display:flex; align-items:center; gap:9px; width:100%; padding:8px 10px; border:none; background:transparent;
          color:#000; font-family:Tahoma, Verdana, 'Segoe UI', Arial, sans-serif; font-size:13px; text-align:left; cursor:pointer; }
        .app.retro .startitem:hover, .app.retro .startitem:focus-visible { background:#000080; color:#fff; outline:none; }

        /* boot splash */
        .boot { position:fixed; inset:0; z-index:100; display:flex; align-items:center; justify-content:center;
          background:#008080; padding:24px; }
        .bootbox { width:100%; max-width:300px; text-align:center; }
        .bootlogo { font-family:Tahoma, Verdana, 'Segoe UI', Arial, sans-serif; font-weight:bold; font-size:34px; color:#fff;
          text-shadow:2px 2px 0 #004040; line-height:1.1; }
        .bootlogo span { display:inline-block; font-family:'VT323', monospace; font-size:24px; color:#FFCC00; vertical-align:super; margin-left:5px; }
        .bootbar { margin:20px 0 10px; height:18px; padding:3px; box-sizing:border-box; background:#C0C0C0;
          box-shadow:inset -1px -1px #fff, inset 1px 1px #808080, inset -2px -2px #dfdfdf, inset 2px 2px #0a0a0a; }
        .bootbar > div { height:100%; background-image:repeating-linear-gradient(90deg, #000080 0 8px, transparent 8px 10px);
          background-size:10px 100%; animation:bootfill 1.6s linear forwards; }
        @keyframes bootfill { from { width:0; } to { width:100%; } }
        .boottip { margin:0; color:#fff; font-family:Tahoma, Verdana, 'Segoe UI', Arial, sans-serif; font-size:12.5px; }

        @media (prefers-reduced-motion:reduce) { *, .app::before, .app::after { animation:none !important; transition:none !important; } }
      `}</style>
      {children}
    </div>
  );
}
