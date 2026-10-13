import { suggestMeals, avoidNote, ALLERGENS, DIETS } from "./mealLibrary.js";
import { roadPicks, ROAD_CHAINS } from "./fastFood.js";
import { scaleIngredient, tagsFor, TAG_FILTERS, swapsFor, applySwaps } from "./mealTools.js";
import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { SPC_GAMES, SPC_URL } from "./spcSchedule.js";
import { LineChart, Line, XAxis, YAxis, ResponsiveContainer, Tooltip, ReferenceLine, CartesianGrid } from "recharts";
import { Timer, Scale, Users, CalendarDays, Settings as Cog, Plus, X, Star, ChevronLeft, ChevronRight, ChefHat, MessageCircle, Dribbble, Utensils } from "lucide-react";

/* ---------- storage: this device's log ---------- */
const ACCESS = () => localStorage.getItem("cutlog:code") || "";
const store = {
  async get(key) {
    const v = localStorage.getItem(key);
    if (v === null) throw new Error("missing");
    return { key, value: v };
  },
  async set(key, value) {
    localStorage.setItem(key, value);
    return { key, value };
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
    const grades = { ...(da?.grades || {}) };
    for (const [gk, gv] of Object.entries(db?.grades || {})) {
      if (!grades[gk] || (gv.at || 0) >= (grades[gk].at || 0)) grades[gk] = gv;
    }
    days[k] = { ...base, foods: byKey(da?.foods, db?.foods, (f) => f.id, "food:"), grades };
    if ((da?.lifts || []).length || (db?.lifts || []).length) days[k].lifts = byKey(da?.lifts, db?.lifts, (l) => l.id, "lift:");
  }
  const top = newer(a, b);
  return {
    ...top, days,
    fasts: byKey(a.fasts, b.fasts, (f) => String(f.id ?? f.end), "fast:").sort((x, y) => y.end - x.end).slice(0, 30),
    favorites: byKey(a.favorites, b.favorites, (f) => f.name, "fav:"),
    labs: byKey(a.labs, b.labs, (l) => l.id, "lab:"),
    list: byKey(a.list, b.list, (l) => l.id, "list:"),
    recipes: byKey(a.recipes, b.recipes, (r) => r.id, "recipe:"),
    photos: byKey(a.photos, b.photos, (p) => p.id, "photo:"),
    groups: byKey(a.groups, b.groups, (g) => g.id, "group:"),
    orders: byKey(a.orders, b.orders, (o) => o.id, "order:"),
    history: byKey(a.history, b.history, (h) => h.id, "chal:"),
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
const groupsApi = (p) => api("/api/groups", p);
// A backup is something people paste into chats and notes. Group logins (member token, invite
// code) never go in it; restoring keeps whatever groups this phone is already in.
const backupJson = (d) => JSON.stringify({ ...d, groups: [] });

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
const TAGS = {
  lift: { label: "Lifted", cal: 180, hard: true }, ball: { label: "Played ball", cal: 400, hard: true }, site: { label: "Job site", cal: 300, hard: true },
  walk: { label: "Walked", cal: 60 }, stretch: { label: "Stretched", cal: 0 },
};

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

// recovering: injury or recovery mode. No activity calories get "earned" and protein stays high to support healing.
function computeTargets(p, tags = [], tdeeOverride = null, recovering = false) {
  const bmr = 10 * (p.weight * 0.4536) + 6.25 * (p.heightIn * 2.54) - 5 * p.age + (p.sex === "male" ? 5 : -161);
  const tdee = tdeeOverride || bmr * ACTIVITY[p.activity].mult;
  // Under 18 there is no calorie cut. Growing bodies and sports need the fuel, so the budget is
  // what the body burns, and weight goals are a talk for a parent, doctor or coach.
  const minor = Number.isFinite(+p.age) && +p.age > 0 && +p.age < 18;
  const floor = p.sex === "male" ? 1500 : 1200;
  const raw = tdee - (minor ? 0 : p.pace) * 500;
  // The recommendation is the starting point. People can nudge it up or down (calAdjust), within reason.
  const adj = minor ? 0 : Math.max(-600, Math.min(600, Math.round(+p.calAdjust || 0)));
  const base = minor ? Math.round(raw / 10) * 10 : Math.max(adj ? 1000 : floor, Math.round((raw + adj) / 10) * 10);
  const earned = recovering ? 0 : Math.min(500, tags.reduce((a, t) => a + (TAGS[t]?.cal || 0), 0));
  const calories = base + earned;
  const protein = Math.max(30, (minor ? 0 : Math.max(-60, Math.min(80, Math.round(+p.proteinAdjust || 0)))) + Math.round((minor ? Math.min(p.weight, p.goalWeight || p.weight) * 0.75 : p.goalWeight) * (minor ? 1 : (recovering || tags.some((t) => TAGS[t]?.hard) ? 1.0 : 0.8))));
  const fat = Math.round((calories * 0.27) / 9);
  const carbs = Math.max(0, Math.round((calories - protein * 4 - fat * 9) / 4));
  return { bmr: Math.round(bmr), tdee: Math.round(tdee), base, earned, calories, protein, fat, carbs,
    clamped: !minor && !adj && raw < floor, floor, actualPace: minor ? 0 : (tdee - base) / 500, minor };
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
/* ---------- NBA team colors, for the Arena theme's scoreboard accent ---------- */
const NBA_TEAMS = [
  ["Hawks", "#E03A3E", "#FDB927"], ["Celtics", "#007A33", "#BA9653"], ["Nets", "#000000", "#FFFFFF"],
  ["Hornets", "#1D1160", "#00788C"], ["Bulls", "#CE1141", "#000000"], ["Cavaliers", "#860038", "#FDBB30"],
  ["Mavericks", "#00538C", "#B8C4CA"], ["Nuggets", "#0E2240", "#FEC524"], ["Pistons", "#C8102E", "#1D42BA"],
  ["Warriors", "#1D428A", "#FFC72C"], ["Rockets", "#CE1141", "#000000"], ["Pacers", "#002D62", "#FDBB30"],
  ["Clippers", "#C8102E", "#1D428A"], ["Lakers", "#552583", "#FDB927"], ["Grizzlies", "#5D76A9", "#12173F"],
  ["Heat", "#98002E", "#F9A01B"], ["Bucks", "#00471B", "#EEE1C6"], ["Timberwolves", "#0C2340", "#78BE20"],
  ["Pelicans", "#0C2340", "#C8102E"], ["Knicks", "#006BB6", "#F58426"], ["Thunder", "#007AC1", "#EF3B24"],
  ["Magic", "#0077C0", "#C4CED4"], ["76ers", "#006BB6", "#ED174C"], ["Suns", "#1D1160", "#E56020"],
  ["Trail Blazers", "#E03A3E", "#000000"], ["Kings", "#5A2D81", "#63727A"], ["Spurs", "#000000", "#C4CED4"],
  ["Raptors", "#CE1141", "#000000"], ["Jazz", "#002B5C", "#00471B"], ["Wizards", "#002B5C", "#E31837"],
];

function hexLum(hex) {
  const [r, g, b] = [hex.slice(1, 3), hex.slice(3, 5), hex.slice(5, 7)].map((h) => parseInt(h, 16) / 255);
  const f = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function hexContrast(a, b) {
  const l1 = hexLum(a), l2 = hexLum(b), hi = Math.max(l1, l2), lo = Math.min(l1, l2);
  return (hi + 0.05) / (lo + 0.05);
}
function mixHex(hex, toward, frac) {
  const a = [hex.slice(1, 3), hex.slice(3, 5), hex.slice(5, 7)].map((h) => parseInt(h, 16));
  const b = [toward.slice(1, 3), toward.slice(3, 5), toward.slice(5, 7)].map((h) => parseInt(h, 16));
  return "#" + a.map((v, i) => Math.round(v + (b[i] - v) * frac).toString(16).padStart(2, "0")).join("");
}
function teamCue(name) {
  const t = NBA_TEAMS.find((x) => x[0] === name) || NBA_TEAMS[13];
  // A near-black primary disappears against this theme's near-black cards, so lead with the
  // secondary color instead for those teams (Nets, Spurs) - the black stays as an accent border.
  const dark = hexLum(t[1]) < 0.02;
  const primary = dark ? t[2] : t[1], secondary = dark ? t[1] : t[2];
  // The button itself needs to (a) stand out from a near-black card and (b) hold readable text.
  // Some team colors (deep purple, dark red) satisfy neither as-is, so nudge toward white in small
  // steps - only for the button fill, never for borders, glows or the raw team identity elsewhere.
  // Same treatment for whichever color a background is painted with: nudge toward white just
  // enough to read against a near-black card and hold readable text, then hand back both.
  const readable = (hex) => {
    let bg = hex, ink = "#FFFFFF";
    for (let f = 0; f <= 1; f += 0.04) {
      bg = mixHex(hex, "#FFFFFF", f);
      ink = hexLum(bg) > 0.32 ? "#0A0C11" : "#FFFFFF";
      if (hexContrast(bg, "#14161C") >= 2.6 && hexContrast(bg, ink) >= 4.5) break;
    }
    return { bg, ink };
  };
  const btn = readable(primary), chip = readable(secondary);
  return { name: t[0], primary, secondary, button: btn.bg, ink: btn.ink, chipBg: chip.bg, chipInk: chip.ink };
}

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
  arena: {
    cal: "#F58426", protein: "#22C55E", carbs: "#38BDF8", fat: "#FACC15", bad: "#EF4444",
    water: "#38BDF8", warn: "#FACC15", idle: "#374151",
    track: "#111318", tickOff: "#374151", dimText: "#8B93A1", faint: "#4B5563",
    grid: "#1F2430", axis: "#8B93A1",
    tip: { fontSize: 12, borderRadius: 4, border: "1px solid #F58426", background: "#0B0D12", color: "#fff" },
    cap: "butt", glow: true, ringFade: 0.4,
    meal: { Breakfast: "#38BDF8", Lunch: "#22C55E", Dinner: "#A78BFA", Snack: "#FACC15" },
    stages: ["#4B5563", "#38BDF8", "#22D3EE", "#22C55E", "#FACC15", "#FB923C", "#F58426", "#EF4444"],
    get primary() { return teamCue(TEAM).primary; }, get secondary() { return teamCue(TEAM).secondary; },
  },
  pro: {
    cal: "#4C8DFF", protein: "#22C55E", carbs: "#8FB8FF", fat: "#FFC72C", bad: "#E5384F",
    water: "#4C8DFF", warn: "#FFC72C", idle: "#3A3D47",
    track: "#23252C", tickOff: "#3A3D47", dimText: "#A3A7B3", faint: "#5A5E6B",
    grid: "#23252C", axis: "#A3A7B3",
    tip: { fontSize: 12, borderRadius: 8, border: "1px solid #2E313A", background: "#15161A", color: "#fff" },
    cap: "butt", glow: false, ringFade: 0.5,
    meal: { Breakfast: "#4C8DFF", Lunch: "#22C55E", Dinner: "#A78BFA", Snack: "#FFC72C" },
    stages: ["#5A5E6B", "#4C8DFF", "#38BDF8", "#22C55E", "#FFC72C", "#FB923C", "#F58426", "#E5384F"],
  },
  modern: {
    cal: "#818CF8", protein: "#34D399", carbs: "#22D3EE", fat: "#FBBF24", bad: "#FB7185",
    water: "#38BDF8", warn: "#FBBF24", idle: "#475569",
    track: "rgba(255,255,255,0.07)", tickOff: "rgba(255,255,255,0.22)", dimText: "#8D93A5", faint: "rgba(255,255,255,0.25)",
    grid: "rgba(255,255,255,0.06)", axis: "#8D93A5",
    tip: { fontSize: 12, borderRadius: 14, border: "1px solid #232739", background: "#11131A", color: "#ECEDF2" },
    cap: "round", glow: false, ringFade: 0.6,
    meal: { Breakfast: "#818CF8", Lunch: "#34D399", Dinner: "#22D3EE", Snack: "#FBBF24" },
    stages: ["#64748B", "#38BDF8", "#22D3EE", "#34D399", "#A3E635", "#FBBF24", "#FB923C", "#FB7185"],
  },
};
let TEAM = "Lakers";
let THEME = "glass";
let PRO = true;
let FOOD_RULES = "";   // allergies and diet, told to the AI on every request
let COURT = true;   // the hardwood basketball look + hoops language (default for everyone)
const H = (court, plain) => plain;   // plain words everywhere; the basketball is in the look, not the wording
const QTR = { Breakfast: "Q1", Lunch: "Q2", Dinner: "Q3", Snack: "OT" };
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
    body: JSON.stringify({ max_tokens: maxTokens, messages: [{ role: "user", content: FOOD_RULES ? [{ type: "text", text: FOOD_RULES + " Follow these rules in every answer." }, ...(Array.isArray(content) ? content : [{ type: "text", text: String(content) }])] : content }] }),
  });
  if (!r.ok) throw new Error(await r.text());
  const j = await r.json();
  const txt = j.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  const clean = txt.replace(/```json|```/g, "").trim();
  try { return JSON.parse(clean); }
  catch {
    // Models sometimes wrap the JSON in a sentence. Take the outermost object.
    const i = clean.indexOf("{"), j = clean.lastIndexOf("}");
    if (i >= 0 && j > i) return JSON.parse(clean.slice(i, j + 1));
    throw new Error("The coach's answer came back garbled. Try again.");
  }
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
      {COURT && !PRO && (
        <svg className="ballseams" width={size * 0.6} height={size * 0.6} viewBox="0 0 100 100" aria-hidden="true">
          <g fill="none" stroke="currentColor" strokeWidth="1.6">
            <circle cx="50" cy="50" r="46" /><line x1="50" y1="4" x2="50" y2="96" /><line x1="4" y1="50" x2="96" y2="50" />
            <path d="M14 17 C34 34 34 66 14 83" /><path d="M86 17 C66 34 66 66 86 83" />
          </g>
        </svg>
      )}
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
  const [welcomed, setWelcomed] = useState(() => { try { return localStorage.getItem("cutlog:welcomed") === "1"; } catch { return true; } });
  const th = data?.theme === "retro" ? "court" : data?.theme;   // the old Desktop '95 look is gone; those logs land on hardwood
  PRO = !th || th === "pro";                      // the default look: ESPN layout in NBA colors
  COURT = th === "court";                          // basketball language (Court, Plays, box score) only on Hardwood
  THEME = PRO ? "pro" : COURT ? "arena" : ["modern", "arena"].includes(th) ? th : "glass";
  TEAM = data?.team || "Lakers";
  FOOD_RULES = avoidNote(data?.profile);
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
    const bg = (!data?.theme || data.theme === "pro") ? "#0B0B0D" : data?.theme === "arena" ? "#05060A" : data?.theme === "modern" ? "#08090D" : (data.theme === "court" || data.theme === "retro") ? "#2A190C" : "#0A0E1F";
    document.body.style.background = bg;
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", bg);
  }, [data?.theme, data?.team]);

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
      try { await groupsApi({ op: "ping" }); setLocked(false); }
      catch (e) { setLocked(/access code/i.test(String(e.message))); }
    })();
  }, []);

  useEffect(() => {
    (async () => {
      const empty = { profile: null, days: {}, favorites: [], fast: null, fasts: [], calib: [], list: [], labs: [], menus: {}, recipes: [], deleted: {} };
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
    })();
  }, [data]);

  const day = { ...blankDay(), ...(data?.days?.[viewDay] || {}) };
  // Once there are ~3 weeks of weigh-ins and logged days, your real results replace the formula.
  const adaptive = useMemo(() => (data?.profile ? estimateTdee(data.days, computeTargets(data.profile, []).tdee) : null), [data?.days, data?.profile]);
  const useAdaptive = data?.useAdaptive !== false && !!adaptive?.ready;
  const targets = useMemo(() => (data?.profile ? computeTargets(data.profile, day.tags, useAdaptive ? adaptive.tdee : null, !!data?.recovery?.on) : null),
    [data?.profile, day.tags, useAdaptive, adaptive, data?.recovery?.on]);
  // Publish what this person chose to share with each group: after a change, and every 5 minutes as a heartbeat.
  const todayKey = dayKey();
  const todayTags = data?.days?.[todayKey]?.tags;
  const todayTargets = useMemo(() => (data?.profile ? computeTargets(data.profile, todayTags || [], useAdaptive ? adaptive.tdee : null, !!data?.recovery?.on) : null),
    [data?.profile, todayTags, useAdaptive, adaptive, data?.recovery?.on]);
  useEffect(() => {
    if (!data?.groups?.length || !todayTargets) return;
    const pub = () => (dataRef.current?.groups || []).forEach((g) => {
      if (g.lost) return;
      groupsApi({ op: "publish", groupId: g.id, memberId: g.memberId, token: g.token, status: buildStatus(dataRef.current, g.scopes, todayTargets) })
        .catch((e) => { if (/not in this group/i.test(String(e.message))) setRawData((d) => ({ ...d, groups: (d.groups || []).map((x) => (x.id === g.id ? { ...x, lost: true } : x)) })); });
    });
    const t = setTimeout(pub, 4000), hb = setInterval(pub, 300000);
    return () => { clearTimeout(t); clearInterval(hb); };
  }, [data?.groups, data?.fast, data?.fastingOn, data?.days?.[todayKey], data?.profile, data?.recovery, todayTargets]);

  const updateDay = useCallback((k, fn) => setData((d) => ({ ...d, days: { ...d.days, [k]: { ...fn(d.days[k] || blankDay()), u: Date.now() } } })), [setData]);

  if (locked) return <Shell theme={THEME}><Gate onOk={() => setLocked(false)} /></Shell>;
  if (!data) return <Shell theme={THEME}><div className="glass pad center"><p className="dim">Waking up…</p></div></Shell>;
  if (!data.profile && !welcomed) return <Shell theme={THEME}>
    <Welcome onDone={() => { try { localStorage.setItem("cutlog:welcomed", "1"); } catch { /* fine */ } setWelcomed(true); }} />
  </Shell>;
  if (!data.profile) return <Shell theme={THEME}>
    <JoinSync onJoin={joinSync} />
    <ProfileForm wizard
      initial={BLANK_PROFILE}
      title="Let's build your plan" cta="Start"
      onSave={(profile) => setData((d) => ({ ...d, profile }))} /></Shell>;

  const TABS = [["now", H("Court", "Today"), COURT ? Dribbble : Timer], ["plan", H("Plays", "Meals"), ChefHat], ["out", "Eating Out", Utensils], ["coach", "Coach", MessageCircle], ["weight", H("Stats", "Progress"), Scale], ["log", H("Scores", "History"), CalendarDays], ["setup", H("Locker", "Settings"), Cog]];

  return (
    <Shell theme={THEME} top={PRO ? <ProTop /> : null}>
      {saveErr && <div className="glass pad alert">That change didn’t save. Back up from Setup before closing.</div>}
      <div className="tabtitle" role="heading" aria-level="1">
        <span>{(TABS.find((t) => t[0] === tab) || [])[1]}</span>
        <small>{{ now: "Your day at a glance", plan: "Ideas for what to eat", out: "Best picks when you're on the road", coach: "Ask anything about your food", weight: "Your weight and progress", log: "Everything you've logged", setup: "Your profile and options" }[tab]}</small>
      </div>
      <div key={tab} className="fadein">
        {tab === "now" && <Now {...{ data, setData, dayId: viewDay, setDayId: setViewDay, day, targets, updateDay, goTab: () => { setTab("setup"); setTimeout(() => document.getElementById("fasting-panel")?.scrollIntoView({ behavior: "smooth", block: "start" }), 250); } }} />}
        {tab === "out" && <RoadTab data={data} setData={setData} targets={targets} day={day} updateDay={updateDay} dayId={viewDay} setDayId={setViewDay} />}
        {tab === "plan" && <Plan data={data} setData={setData} targets={targets} day={day} updateDay={updateDay} dayId={viewDay} setDayId={setViewDay} />}
        {tab === "weight" && <Weight data={data} setData={setData} targets={targets} updateDay={updateDay} />}
        {tab === "coach" && <Coach data={data} setData={setData} targets={targets} adaptive={adaptive} />}
        {tab === "log" && <LogTab data={data} setData={setData} onPick={(k) => { setViewDay(k); setTab("now"); }} />}
        {tab === "setup" && <Settings data={data} setData={setData} onSave={(p) => setData((d) => ({ ...d, profile: p }))} adaptive={adaptive} useAdaptive={useAdaptive}
          sync={sync} syncNow={syncNow} startSync={startSync} joinSync={joinSync} leaveSync={leaveSync} />}
      </div>
      <nav className="dock">
        {TABS.map(([id, label, Icon]) => (
          <button key={id} className={tab === id ? "dockbtn on" : "dockbtn"} onClick={() => setTab(id)}>
            <Icon size={23} strokeWidth={1.7} /><span>{label}</span>
          </button>
        ))}
        <TrayClock />
      </nav>
    </Shell>
  );
}

function TrayClock() {
  const [t, setT] = useState(() => new Date());
  useEffect(() => { const i = setInterval(() => setT(new Date()), 20000); return () => clearInterval(i); }, []);
  return <span className="tray">{t.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>;
}

/* ---------- first screen: what you're signing up for, before any form ---------- */
function Welcome({ onDone }) {
  const steps = [
    ["1", "Answer a few questions", "About 2 minutes. Your goal, allergies and how you eat."],
    ["2", "Get your daily numbers", "Calories, protein and water, built for you. You can change them."],
    ["3", "Eat and track your day", "Meals that fit your numbers, picks for the drive-thru, and one tap to log."],
  ];
  const extras = [
    ["Meals that fit you", "Skips your allergies. Swap an ingredient or cook for more people."],
    ["Eating Out", "The best order at McDonald's, Chipotle, gas stations and more."],
    ["Fasting timer", "Optional. Off until you turn it on."],
    ["Friends", "Join with a code. You choose what they can see."],
  ];
  return (
    <div className="glass pad stack">
      <h1 className="welcomehead">Know exactly what to eat today.</h1>
      <p className="small">Cut Log is a food and fasting tracker. It builds your daily calorie and protein goal, finds meals that fit it, and tracks your day.</p>
      <button className="btn solid wide big" onClick={onDone}>Build my plan</button>
      {steps.map(([n, t, b]) => <div key={n} className="row gap" style={{ alignItems: "flex-start" }}><span className="stepnum">{n}</span><div><strong>{t}</strong><p className="dim small" style={{ margin: "2px 0 0" }}>{b}</p></div></div>)}
      <h3 style={{ margin: "8px 0 0" }}>Also inside</h3>
      {extras.map(([t, b]) => <div key={t}><strong>{t}</strong><p className="dim small" style={{ margin: "2px 0 0" }}>{b}</p></div>)}
      <p className="dim tiny">This app is not a doctor. If you're under 18, pregnant, or have a health condition, check with a parent or doctor before changing how you eat.</p>
      <button className="btn solid wide" onClick={onDone}>Build my plan</button>
    </div>
  );
}

/* ---------- fast edits: forgot to start or stop? Fix the times. ---------- */
const MAX_FAST_H = 7 * 24;
// <input type="datetime-local"> speaks local time as "YYYY-MM-DDTHH:mm".
const toLocalInput = (ms) => { const d = new Date(ms), z = (n) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}T${z(d.getHours())}:${z(d.getMinutes())}`; };
const fromLocalInput = (str) => { const t = new Date(str).getTime(); return Number.isFinite(t) ? t : null; };
// An active fast's start can be moved earlier (forgot to tap Start) or a bit later, never into the future.
function checkFastStart(start, now = Date.now()) {
  if (!Number.isFinite(start)) return "Pick a date and time.";
  if (start > now + 60000) return "The start can't be in the future.";
  if (now - start > MAX_FAST_H * 36e5) return "That's more than 7 days ago. Pick a closer time.";
  return "";
}
// A finished fast: validates the times and builds the record. `prev` keeps the same id when editing.
function fastRecord(start, end, prev = null, now = Date.now()) {
  if (!Number.isFinite(start) || !Number.isFinite(end)) return { error: "Pick both times." };
  if (end > now + 60000) return { error: "The end can't be in the future." };
  if (end <= start) return { error: "The end has to be after the start." };
  if (end - start > MAX_FAST_H * 36e5) return { error: "That's longer than 7 days. Check the dates." };
  return { rec: { id: String(prev?.id ?? prev?.end ?? end), start, end, hours: +((end - start) / 36e5).toFixed(1), u: now } };
}
const saveFastIn = (fasts, rec, oldKey) => [rec, ...(fasts || []).filter((f) => String(f.id ?? f.end) !== String(oldKey ?? rec.id))].sort((x, y) => y.end - x.end).slice(0, 30);
/* ---------- fast edits end ---------- */

/* ---------- starting a fast: say what it is before the clock starts ---------- */
function FastStart({ data, onStart, onCancel, early }) {
  const crew = (data.groups || []).filter((g) => !g.lost && (g.scopes?.fast ?? DEFAULT_SCOPES.fast));
  const [ago, setAgo] = useState(0);   // hours since the last meal
  const [exact, setExact] = useState(early ? Date.now() - 10 * 36e5 : null);   // or an exact time
  return (
    <div className="glass pad stack">
      <h2>{early ? "Start a fast you forgot to start" : "You're about to start a fast"}</h2>
      <p className="small">{early ? <>Set the time you <strong>stopped eating</strong>. The clock will count from then and keep running, so you're current right away.</> : <>A fast means <strong>no food</strong> until you end it. Water is fine. The clock starts when you tap Start.</>}</p>
      <div>
        <label>When did you last eat?</label>
        <div className="chips">{[[0, "Just now"], [2, "2h ago"], [4, "4h ago"], [8, "8h ago"]].map(([v, l]) => (
          <button key={v} className={!exact && ago === v ? "chip on" : "chip"} onClick={() => { setExact(null); setAgo(v); }}>{l}</button>))}
          <button className={exact ? "chip on" : "chip"} onClick={() => setExact(exact ? null : Date.now() - 36e5)}>Pick a time</button></div>
        {exact && <TimeField label="I stopped eating at" ms={exact} onChange={setExact} max={Date.now()} />}
        {exact && checkFastStart(exact) && <p className="alert">{checkFastStart(exact)}</p>}
      </div>
      <p className="small">{crew.length
        ? <>Your crew ({crew.map((g) => g.name).join(", ")}) will see that you're fasting and for how long. At 24 hours, and every 12 hours after, you'll be asked to confirm you're still going, and friends can check on you. Change this under Crew → sharing.</>
        : "Nobody else sees your fast. Sharing only happens if you join a crew and leave fasting switched on."}</p>
      <p className="dim tiny">Skip it if you're pregnant or nursing, have a history of disordered eating, take diabetes or blood-pressure medication, or just don't feel right. If you feel dizzy, faint or unwell, end it and eat. A longer fast never scores higher.</p>
      <div className="rowbtns">
        <button className="btn ghost wide" onClick={onCancel}>Not now</button>
        <button className="btn solid wide" disabled={!!exact && !!checkFastStart(exact)} onClick={() => onStart(exact || Date.now() - ago * 36e5)}>Start fast</button>
      </div>
    </div>
  );
}

function TimeField({ label, ms, onChange, min, max }) {
  return (
    <div><label>{label}</label>
      <input type="datetime-local" value={Number.isFinite(ms) ? toLocalInput(ms) : ""} min={min ? toLocalInput(min) : undefined} max={max ? toLocalInput(max) : undefined}
        onChange={(e) => onChange(fromLocalInput(e.target.value))} /></div>
  );
}
const fmtWhen = (ms) => new Date(ms).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

// Changing when the running fast began.
function FastStartEdit({ start, onSave, onCancel }) {
  const [v, setV] = useState(start);
  const err = checkFastStart(v);
  const nudge = (min) => setV((x) => (Number.isFinite(x) ? x + min * 6e4 : x));
  return (
    <div className="glass pad stack fadein">
      <h2>Change the start time</h2>
      <p className="dim small">Forgot to tap Start? Set the time you actually stopped eating.</p>
      <TimeField label="I started fasting at" ms={v} onChange={setV} max={Date.now()} />
      <div className="chips">{[[-60, "1h earlier"], [-30, "30m earlier"], [30, "30m later"]].map(([m, l]) => <button key={m} className="chip" onClick={() => nudge(m)}>{l}</button>)}</div>
      {!err && <p className="small">That makes it <strong>{((Date.now() - v) / 36e5).toFixed(1)} hours</strong> so far.</p>}
      {err && <p className="alert">{err}</p>}
      <div className="rowbtns">
        <button className="btn ghost wide" onClick={onCancel}>Cancel</button>
        <button className="btn solid wide" disabled={!!err} onClick={() => onSave(v)}>Save</button>
      </div>
    </div>
  );
}

// Ending the running fast: now, or the time you really stopped.
function FastEndEdit({ start, onSave, onCancel }) {
  const [end, setEnd] = useState(Date.now());
  const r = fastRecord(start, end);
  return (
    <div className="glass pad stack fadein">
      <h2>End your fast</h2>
      <p className="dim small">Forgot to stop it? Pick the time you really ate.</p>
      <div className="chips">{[[0, "Just now"], [30, "30 min ago"], [60, "1 hour ago"], [120, "2 hours ago"]].map(([m, l]) => <button key={m} className="chip" onClick={() => setEnd(Date.now() - m * 6e4)}>{l}</button>)}</div>
      <TimeField label="I ended my fast at" ms={end} onChange={setEnd} min={start} max={Date.now()} />
      {r.rec && <p className="small">Total fast: <strong>{r.rec.hours} hours</strong> ({fmtWhen(start)} to {fmtWhen(end)})</p>}
      {r.error && <p className="alert">{r.error}</p>}
      <div className="rowbtns">
        <button className="btn ghost wide" onClick={onCancel}>Keep fasting</button>
        <button className="btn solid wide" disabled={!r.rec} onClick={() => onSave(r.rec)}>Save fast</button>
      </div>
    </div>
  );
}

// The list of finished fasts, with edit, delete, and "add one I forgot".
function PastFasts({ data, setData }) {
  const fasts = data.fasts || [];
  const [editing, setEditing] = useState(null);   // fast key, or "new"
  const [s, setS] = useState(0), [e, setE] = useState(0);
  const [still, setStill] = useState(false);
  const open = (f) => {
    setStill(false);
    if (f) { setEditing(String(f.id ?? f.end)); setE(f.end); setS(f.start ?? f.end - (f.hours || 16) * 36e5); }
    else { setEditing("new"); setE(Date.now()); setS(Date.now() - 16 * 36e5); }
  };
  const prev = editing && editing !== "new" ? fasts.find((f) => String(f.id ?? f.end) === editing) : null;
  const r = fastRecord(s, e, prev);
  const save = () => {
    if (editing === "new" && still && !data.fast) {
      if (checkFastStart(s)) return;
      setData((d) => ({ ...d, fast: { start: s } })); setEditing(null); return;
    }
    if (!r.rec) return;
    setData((d) => ({ ...d, fasts: saveFastIn(d.fasts, editing === "new" ? { ...r.rec, id: crypto.randomUUID() } : r.rec, editing === "new" ? null : editing) }));
    setEditing(null);
  };
  const del = (f) => { if (!confirm("Delete this fast?")) return;
    const key = String(f.id ?? f.end);
    setData((d) => ({ ...d, deleted: tombstone(d, "fast:" + key), fasts: (d.fasts || []).filter((x) => String(x.id ?? x.end) !== key) })); setEditing(null); };
  return (
    <div className="glass">
      <div className="mealhead">Past fasts</div>
      {fasts.length === 0 && editing !== "new" && <p className="dim small pad">No finished fasts yet.</p>}
      {fasts.slice(0, 10).map((f) => {
        const key = String(f.id ?? f.end);
        return (
          <div key={key} className="dish">
            <div className="row gap"><div><div className="dishname">{f.hours} hours</div>
              <div className="dim tiny">{f.start ? `${fmtWhen(f.start)} to ${fmtWhen(f.end)}` : `Ended ${fmtWhen(f.end)}`}</div></div>
              <button className="chip" onClick={() => (editing === key ? setEditing(null) : open(f))}>{editing === key ? "Close" : "Edit"}</button></div>
            {editing === key && (
              <div className="stack fadein" style={{ marginTop: 8 }}>
                <TimeField label="Started" ms={s} onChange={setS} max={Date.now()} />
                <TimeField label="Ended" ms={e} onChange={setE} min={s} max={Date.now()} />
                {r.rec && <p className="small">Total: <strong>{r.rec.hours} hours</strong></p>}
                {r.error && <p className="alert">{r.error}</p>}
                <div className="rowbtns">
                  <button className="btn ghost" onClick={() => del(f)}>Delete</button>
                  <button className="btn solid wide" disabled={!r.rec} onClick={save}>Save</button>
                </div>
              </div>)}
          </div>);
      })}
      {editing === "new"
        ? (
          <div className="dish stack fadein">
            <div className="dishname">Add a fast I forgot to log</div>
            <TimeField label="Started" ms={s} onChange={setS} max={Date.now()} />
            {!data.fast && <label className="row small" style={{ gap: 8, justifyContent: "flex-start" }}><input type="checkbox" checked={still} onChange={(ev) => setStill(ev.target.checked)} /> I'm still fasting (keep the clock running)</label>}
            {!(still && !data.fast) && <TimeField label="Ended" ms={e} onChange={setE} min={s} max={Date.now()} />}
            {still && !data.fast
              ? (checkFastStart(s) ? <p className="alert">{checkFastStart(s)}</p> : <p className="small">The clock will show <strong>{((Date.now() - s) / 36e5).toFixed(1)} hours</strong> and keep going.</p>)
              : <>{r.rec && <p className="small">Total: <strong>{r.rec.hours} hours</strong></p>}{r.error && <p className="alert">{r.error}</p>}</>}
            <div className="rowbtns"><button className="btn ghost wide" onClick={() => setEditing(null)}>Cancel</button><button className="btn solid wide" disabled={still && !data.fast ? !!checkFastStart(s) : !r.rec} onClick={save}>{still && !data.fast ? "Start the clock" : "Save"}</button></div>
          </div>)
        : <div className="pad"><button className="btn ghost wide" onClick={() => open(null)}>+ Add a fast I forgot to log</button></div>}
    </div>
  );
}

// Pick which day you're looking at and logging to. Used on Today, Meals and Eating Out.
function DayBar({ dayId, setDayId }) {
  const isToday = dayId === dayKey();
  return (
    <div className="glass pad stack daybar">
      <div className="row gap" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <button className="btn ghost" aria-label="Previous day" onClick={() => setDayId(shiftDay(dayId, -1))}><ChevronLeft size={16} /> Back</button>
        <div className="center"><div className="daybig">{prettyDay(dayId)}</div><div className="dim tiny">{isToday ? "Today" : "a past day"}</div></div>
        <button className="btn ghost" aria-label="Next day" disabled={isToday} onClick={() => setDayId(shiftDay(dayId, 1))}>Next <ChevronRight size={16} /></button>
      </div>
      <div className="row gap" style={{ justifyContent: "center", alignItems: "center" }}>
        <span className="dim small">Jump to a date</span>
        <input aria-label="Jump to a date" type="date" max={dayKey()} value={dayId} style={{ width: 160 }}
          onChange={(e) => { const v = e.target.value; if (/^\d{4}-\d{2}-\d{2}$/.test(v) && v <= dayKey()) setDayId(v); }} />
      </div>
      {!isToday && (
        <div className="cue">
          You're viewing <strong>{prettyDay(dayId)}</strong>. Anything you add or change goes on that day.
          <div style={{ marginTop: 6 }}><button className="chip" onClick={() => setDayId(dayKey())}>Back to today</button></div>
        </div>)}
    </div>
  );
}

/* ---------- now ---------- */
function Now({ data, setData, dayId, setDayId, day, targets, updateDay, goTab }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const removeFood = (id) => setData((d) => ({ ...d, deleted: tombstone(d, "food:" + id),
    days: { ...d.days, [dayId]: { ...(d.days[dayId] || blankDay()), foods: (d.days[dayId]?.foods || []).filter((x) => x.id !== id), u: Date.now() } } }));
  const [showStages, setShowStages] = useState(false);
  const [confirmFast, setConfirmFast] = useState(false);
  const [editStart, setEditStart] = useState(false);
  const [endOpen, setEndOpen] = useState(false);
  const [showPast, setShowPast] = useState(false);
  const [now, setNow] = useState(Date.now());
  const fast = data.fast;
  const fastEnabled = fastingEnabled(data);
  const fastOn = fastEnabled && dayId === dayKey();   // the fasting clock belongs to today
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
      <DayBar dayId={dayId} setDayId={setDayId} />
      {isToday && !PRO && <GamesPanel />}
      {isToday && (data.groups || []).length > 0 && <CrewFastStrip data={data} />}
      {fastOn && fast && (() => {
        const cs = fastConfirmState(fast.start, fast.confirmedAt, now);
        if (cs.state !== "due" && cs.state !== "unconfirmed") return null;
        const inGroup = (data.groups || []).some((g) => !g.lost);
        return (
          <div className="glass pad stack">
            <h2>Check-in</h2>
            <p className="small">{Math.floor(hours)} hours in. Still fasting, and feeling okay? {cs.state === "unconfirmed" && inGroup ? "Your group can see you haven't confirmed." : ""}</p>
            <div className="rowbtns">
              <button className="btn solid" onClick={() => setData((d) => ({ ...d, fast: { ...d.fast, confirmedAt: Date.now() } }))}>Still fasting</button>
              <button className="btn ghost" onClick={() => setEndOpen(true)}>End fast</button>
            </div>
            <p className="dim tiny">If you feel dizzy, faint or unwell, break it and eat.</p>
          </div>
        );
      })()}
      {!fastEnabled && !fast && isToday && fastGate(data.profile).ok && (
        <div className="glass pad stack">
          <strong>Planning to fast?</strong>
          <p className="dim small">Fasting is off. Press here to turn on the fasting tracker. You'll see what it is first, then you can start the clock any time.</p>
          <button className="btn ghost wide" onClick={goTab}>Set up fasting</button>
        </div>
      )}
      {!fastOn ? null : fast && endOpen ? (
        <FastEndEdit start={fast.start} onCancel={() => setEndOpen(false)}
          onSave={(rec) => { setData((d) => ({ ...d, fast: null, fasts: saveFastIn(d.fasts, rec, null) })); setEndOpen(false); }} />
      ) : fast && editStart ? (
        <FastStartEdit start={fast.start} onCancel={() => setEditStart(false)}
          onSave={(v) => { setData((d) => ({ ...d, fast: { ...d.fast, start: v } })); setEditStart(false); }} />
      ) : fast ? (
        <div className="glass hero">
          <Ring pct={Math.min(1, hours / 24)} color={st.hue}
            ticks={STAGES.map((sg) => ({ at: sg.at / 24, hit: hours >= sg.at, color: sg.hue }))}>
            <div className="mono huge">{clock(now - fast.start)}</div>
            <div className="stagename" style={{ color: st.hue }}>{st.name}</div>
            <div className="dim tiny">{nx ? `${nx.name} in ${(nx.at - hours).toFixed(1)}h` : "deep fast"}</div>
          </Ring>
          <p className="dim tiny center">Started {fmtWhen(fast.start)}</p>
          <p className="stagebody">{st.body}</p>
          {(() => { const c = fastCaution(hours, { trained: day.tags.some((x) => x === "lift" || x === "ball"), recovering: !!day.rest || !!data.recovery?.on }); return c ? <p className={c.level === "note" ? "cue" : "alert"}>{c.text}</p> : null; })()}
          <div className="rowbtns">
            <button className="btn ghost" onClick={() => setShowStages(!showStages)}>{showStages ? "Hide" : "All stages"}</button>
            <button className="btn ghost" onClick={() => setEditStart(true)}>Edit start</button>
            <button className="btn solid" onClick={() => setEndOpen(true)}>End fast</button>
          </div>
        </div>
      ) : confirmFast ? (
        <FastStart data={data} early={confirmFast === "early"} onCancel={() => setConfirmFast(false)}
          onStart={(start) => { setData((d) => ({ ...d, fast: { start } })); setConfirmFast(false); }} />
      ) : (
        <div className="glass hero">
          <Ring pct={0} color={C.idle} glow={false}>
            <div className="mono huge dim">0:00:00</div>
            <div className="dim tiny">{H("shot clock off", "not fasting")}</div>
          </Ring>
          <button className="btn solid wide big" onClick={() => setConfirmFast(true)}>{H("Start the clock", "Start fasting")}</button>
          <p className="dim tiny center">Starting a fast means no food until you end it. You'll see what it involves first.</p>
          {(data.fasts || [])[0] && <p className="dim tiny center">{H("Last game", "Last fast")}: {data.fasts[0].hours}h</p>}
          <button className="btn ghost wide" onClick={() => setConfirmFast("early")}>I forgot to press start. Start it from earlier</button>
          <button className="chip" onClick={() => setShowPast(!showPast)}>{showPast ? "Hide past fasts" : "Edit or add a finished fast"}</button>
        </div>
      )}
      {fastOn && !fast && showPast && <PastFasts data={data} setData={setData} />}

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

      <div className="glass pad">
        <div className="fuelhead">
          <div>
            <div className="bignum" style={{ color: left < 0 ? C.bad : "#fff" }}>{Math.round(shownLeft).toLocaleString()}</div>
            <div className="dim tiny">{left < 0 ? H("over the limit, foul trouble", "over budget") : H("calories left in the game", "calories left")}</div>
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
        <div className="chips">
          <button className={day.rest === "rest" ? "chip on" : "chip"} onClick={() => updateDay(dayId, (d) => ({ ...d, rest: d.rest === "rest" ? "" : "rest" }))}>{H("Timeout", "Rest day")}</button>
          <button className={data.recovery?.on ? "chip on" : "chip"} onClick={() => setData((d) => ({ ...d, recovery: d.recovery?.on ? { on: false, u: Date.now() } : { on: true, since: dayId, u: Date.now() } }))}>{H("Injury report", "Hurt / recovering")}</button>
        </div>
        {data.recovery?.on && <p className="cue">{H("Injury report: you're on the bench, not out of the season.", "")} Recovery mode is on. No activity calories get earned, protein stays high to help healing, and your step goal is halved. A rest day, stretching, or an easy walk still counts toward your score. Nothing is penalized. See a professional if it doesn't improve.</p>}
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
        {day.foods.length === 0 ? <p className="dim center pad">{H("Empty box score. Get on the board.", "Nothing logged yet. Press Add a meal below to start.")}</p> :
          MEALS.filter((m) => day.foods.some((f) => f.meal === m)).map((m) => (
            <div key={m}>
              <div className="mealhead"><span className="dot" style={{ background: MEAL_COLOR[m], boxShadow: `0 0 8px ${MEAL_COLOR[m]}` }} />{m}
                <span className="right dim">{day.foods.filter((f) => f.meal === m).reduce((a, f) => a + f.calories, 0)}</span></div>
              {(() => { const rows = day.foods.slice().sort((a, b) => (a.at || 0) - (b.at || 0)).filter((f) => f.meal === m);
                return rows.map((f, i) => {
                  const grade = f.mealId && day.grades?.[f.mealId] && rows[i + 1]?.mealId !== f.mealId ? day.grades[f.mealId] : null;
                  return (
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
                <TierBox grade={grade} />
                </React.Fragment>
                  );
                }); })()}
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

      {open ? <AddFood budget={targets.calories} budgetLeft={left} onCancel={() => setOpen(false)} calib={data.calib || []} recipes={data.recipes || []} setData={setData}
        onCalib={(n) => setData((d) => ({ ...d, calib: [n, ...(d.calib || [])].slice(0, 12) }))}
        onAdd={(items, grade) => {
          // A shared mealId groups these items so a grade (if any) can attach to the right ones,
          // even for a one-item "meal" — grading a single food should still show its verdict.
          const mealId = crypto.randomUUID();
          updateDay(dayId, (d) => ({ ...d, foods: [...d.foods, ...items.map((i) => ({ at: stampFor(dayId), ...i, mealId, u: Date.now() }))],
            grades: grade ? { ...(d.grades || {}), [mealId]: { ...grade, at: Date.now() } } : d.grades }));
          setOpen(false);
        }} />
        : <button className="btn solid wide big" onClick={() => setOpen(true)}><Plus size={18} /> {H("Log a play", "Add a meal")}</button>}
      {!open && <p className="dim small center" style={{ marginTop: -4, marginBottom: 10 }}>Press the button after you eat. Type the food, snap a photo, or scan a barcode.</p>}

      {(() => {
        const goal = data.profile.waterOz || 100, have = +day.water || 0;
        return (
          <div className="glass pad">
            <div className="row"><label style={{ margin: 0 }}>Water</label>
              <span className="mono" style={{ color: have >= goal ? C.water : undefined }}>{have} / {goal} oz</span></div>
            <p className="dim tiny">Press a button each time you drink.</p>
            <div className="track"><div style={{ width: `${Math.min(100, (have / goal) * 100)}%`, background: C.water, boxShadow: `0 0 10px ${C.water}88` }} /></div>
            <div className="chips" style={{ marginTop: 10, marginBottom: 0 }}>
              {[8, 16, 24].map((n) => (
                <button key={n} className="chip" onClick={() => updateDay(dayId, (d) => ({ ...d, water: (+d.water || 0) + n }))}>+{n} oz</button>))}
              <button className="chip" disabled={!have} onClick={() => updateDay(dayId, (d) => ({ ...d, water: Math.max(0, (+d.water || 0) - 8) }))}>−8</button>
            </div>
          </div>
        );
      })()}

      <LiftLog {...{ data, setData, dayId, day, updateDay }} />

      <ScoreCard {...{ data, dayId, day, targets, updateDay }} />

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


function ScoreCard({ data, dayId, day, targets, updateDay }) {
  const prof = { ...data.profile, recovering: !!data.recovery?.on };
  const sc = dayScore(day, targets, prof);
  const hasGroup = !!(data.groups && data.groups.length);
  const week = weekOnTrack(data.days, dayId, () => targets, prof);
  const pct = sc.total;
  return (
    <div className="glass pad stack">
      <div className="row">
        <label style={{ margin: 0 }}>{H("Box score", "Today's score")}</label>
        <span className="mono"><strong style={{ fontSize: 20 }}>{pct}</strong><span className="dim">{H(" PTS", " / 100")}</span></span>
      </div>
      <div className="track"><div style={{ width: `${pct}%`, background: pct >= ON_TRACK ? C.water : C.accent || C.water }} /></div>
      {COURT ? (
        <div className="wlstrip">
          {weekRecord(data.days, dayId, () => targets, prof).map((w, i) => <span key={i} className={w === true ? "wl w" : w === false ? "wl l" : "wl n"}>{w === true ? "W" : w === false ? "L" : "–"}</span>)}
          <span className="dim tiny" style={{ marginLeft: 8 }}>Last 7: {week}-{weekRecord(data.days, dayId, () => targets, prof).filter((x) => x === false).length}. A win is 70+ points. Points reward habits, never eating less.</span>
        </div>
      ) : <p className="dim tiny">{week} of the last 7 days on track (70+). Points reward habits, never eating less.</p>}
      {sc.parts.map((p) => (
        <div key={p.key} className="row small scorerow" style={{ opacity: p.done ? 1 : 0.85 }}>
          <span style={{ flex: 1 }}>{p.done ? "✓ " : ""}{p.label}</span>
          {p.key === "veg" && !p.done
            ? <button className="chip" onClick={() => updateDay(dayId, (d) => ({ ...d, veg: true }))}>I had them +15</button>
            : p.key === "checkin" && !p.done
              ? (hasGroup
                ? <button className="chip" onClick={() => updateDay(dayId, (d) => ({ ...d, checkin: Date.now() }))}>Check in +10</button>
                : <span className="dim tiny">join a group to unlock</span>)
              : <span className="mono dim">{p.pts}/{p.max}</span>}
          {p.key === "veg" && p.done && <button className="icon" title="Undo" onClick={() => updateDay(dayId, (d) => ({ ...d, veg: false }))}><X size={13} /></button>}
        </div>
      ))}
    </div>
  );
}

function LiftRow({ lift, last, onSets, onRemove }) {
  const [reps, setReps] = useState("");
  const [wt, setWt] = useState("");
  const sets = lift.sets || [];
  const add = () => {
    if (!(+reps > 0)) return;
    onSets([...sets, { reps: +reps, wt: +wt || 0 }]);
    setReps("");
  };
  return (
    <div className="liftrow stack">
      <div className="row"><strong>{lift.name}</strong>
        <button className="icon" title="Remove exercise" onClick={onRemove}><X size={14} /></button></div>
      {last && <p className="dim tiny">Last time: {last.sets.map((s) => `${s.reps}×${s.wt}`).join(", ")}</p>}
      {sets.map((s, i) => (
        <div key={i} className="row small">
          <span className="mono">Set {i + 1}</span>
          <span className="mono">{s.reps} × {s.wt} lb</span>
          <button className="icon" onClick={() => onSets(sets.filter((_, n) => n !== i))}><X size={12} /></button>
        </div>
      ))}
      <div className="row gap">
        <input className="mini" type="number" inputMode="numeric" placeholder="reps" value={reps} onChange={(e) => setReps(e.target.value)} />
        <span className="dim">×</span>
        <input className="mini" type="number" inputMode="decimal" placeholder="lb" value={wt} onChange={(e) => setWt(e.target.value)} />
        <button className="chip" onClick={add}>Add set</button>
      </div>
    </div>
  );
}

function LiftLog({ data, setData, dayId, day, updateDay }) {
  const [name, setName] = useState("");
  const [open, setOpen] = useState(false);
  const lifts = day.lifts || [];
  const names = useMemo(() => exerciseNames(data.days), [data.days]);
  const addEx = () => {
    const n = name.trim(); if (!n) return;
    updateDay(dayId, (d) => ({ ...d, lifts: [...(d.lifts || []), { id: crypto.randomUUID(), name: n, sets: [], u: Date.now() }] }));
    setName("");
  };
  const patch = (id, fn) => updateDay(dayId, (d) => ({ ...d, lifts: (d.lifts || []).map((l) => (l.id === id ? { ...fn(l), u: Date.now() } : l)) }));
  if (!open && !lifts.length) return <button className="btn ghost wide" onClick={() => setOpen(true)}>+ Log lifting</button>;
  return (
    <div className="glass pad stack">
      <label style={{ margin: 0 }}>Lifting</label>
      {lifts.map((l) => (
        <LiftRow key={l.id} lift={l} last={lastSets(data.days, l.name, dayId)}
          onSets={(sets) => patch(l.id, (x) => ({ ...x, sets }))}
          onRemove={() => { setData((d) => ({ ...d, deleted: tombstone(d, "lift:" + l.id) })); updateDay(dayId, (d) => ({ ...d, lifts: (d.lifts || []).filter((x) => x.id !== l.id) })); }} />
      ))}
      <div className="row gap">
        <input list="exnames" placeholder="Exercise (bench press, squat…)" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addEx()} />
        <datalist id="exnames">{names.map((n) => <option key={n} value={n} />)}</datalist>
        <button className="chip" onClick={addEx} disabled={!name.trim()}>Add</button>
      </div>
    </div>
  );
}

function ChallengePanel({ data, setData }) {
  const prof = { ...data.profile, recovering: !!data.recovery?.on };
  const today = dayKey();
  const ch = data.challenge || null;
  const st = ch ? challengeStatus(ch, data.days, (day) => computeTargets(data.profile, day?.tags || [], null, false), prof, today) : null;
  const start = (id) => setData((d) => ({ ...d, challenge: { id, start: dayKey(), u: Date.now() }, u: Date.now() }));
  const archive = () => setData((d) => ({ ...d, history: st?.finished ? [...(d.history || []), { id: crypto.randomUUID(), challenge: st.def.name, start: ch.start, hits: st.hits, badge: st.badge, u: Date.now() }] : d.history || [], challenge: null, u: Date.now() }));
  return (
    <div className="glass pad stack">
      <h2>{H("30-day challenge", "30-day challenge")}</h2>
      {!st ? (
        <>
          <p className="dim small">Pick one habit and run it for thirty days. You get a weekly check and a final report.</p>
          {CHALLENGES.map((c) => <button key={c.id} className="listbtn" onClick={() => start(c.id)}>{c.name}<span className="dim tiny" style={{ display: "block" }}>{c.blurb}</span></button>)}
          {(data.history || []).length > 0 && <p className="dim tiny">Finished: {(data.history || []).map((h) => `${h.challenge}${h.badge ? ` (${h.badge})` : ""}`).join(", ")}</p>}
        </>
      ) : (
        <>
          <div className="row"><strong>{st.def.name}</strong><span className="dim tiny">{st.finished ? "Complete" : `Day ${st.dayNo} of 30`}</span></div>
          <div className="chalgrid" role="img" aria-label={`${st.hits} of 30 days hit`}>
            {st.cells.map((c) => <span key={c.key} className={`chalcell ${c.st}`} title={c.key} />)}
          </div>
          <div className="row small"><span>{st.hits} days hit</span><span className="dim">{st.streak} streak · best {st.best}</span></div>
          {st.weeks.length > 0 && <div className="dim tiny">{st.weeks.map((w) => `Week ${w.n}: ${w.hits}/${w.of}`).join("  ·  ")}</div>}
          {st.finished ? (
            <>
              <p className="small">{st.badge ? <><strong>{st.badge} badge.</strong> </> : ""}{st.hits} of 30 days ({st.pct}%), best run {st.best}. {st.badge ? "That is a real month of work." : "A month in the books. Start another and beat it."}</p>
              <button className="btn solid wide" onClick={archive}>Finish and pick another</button>
            </>
          ) : <button className="btn ghost wide" onClick={() => { if (confirm("Stop this challenge?")) setData((d) => ({ ...d, challenge: null, u: Date.now() })); }}>Stop challenge</button>}
        </>
      )}
    </div>
  );
}

function StrengthPanel({ data }) {
  const rows = useMemo(() => strengthSummary(data.days), [data.days]);
  if (!rows.length) return null;
  return (
    <div className="glass pad stack">
      <h2>Strength</h2>
      <p className="dim tiny">Estimated one-rep max from your best set each session. Holding or growing strength while the scale drops means the loss is fat.</p>
      {rows.map((r) => (
        <div key={r.name} className="row small">
          <span style={{ flex: 1 }}>{r.name}<span className="dim tiny"> · {r.sessions} session{r.sessions > 1 ? "s" : ""}</span></span>
          <span className="mono">{r.last} lb{r.change != null && <span style={{ color: r.change >= 0 ? C.water : C.bad }}> {r.change >= 0 ? "+" : ""}{r.change}%</span>}</span>
        </div>
      ))}
    </div>
  );
}

function GamesPanel() {
  const [nba, setNba] = useState(null);
  const [err, setErr] = useState(false);
  const load = useCallback(async () => {
    try {
      const d = new Date();
      const ds = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
      const r = await fetch(`/api/scores?dates=${ds}`, { headers: { "x-access-code": ACCESS() } });
      if (!r.ok) throw new Error("bad");
      const j = await r.json();
      if (j.error) throw new Error(j.error);
      setNba(j.games || []); setErr(false);
    } catch { setErr(true); }
  }, []);
  useEffect(() => {
    load();
    // 15s while a game is live, otherwise once a minute.
    const t = setInterval(() => { if (!document.hidden) load(); }, (nba || []).some((g) => g.state === "in") ? 15000 : 60000);
    return () => clearInterval(t);
  }, [load, (nba || []).some((g) => g.state === "in")]);
  // Recent headlines/results from the school's own feed. Quietly absent if the feed isn't there.
  const [news, setNews] = useState([]);
  useEffect(() => {
    let dead = false;
    const go = () => fetch("/api/spc", { headers: { "x-access-code": ACCESS() } }).then((r) => (r.ok ? r.json() : null)).then((j) => { if (!dead && j?.items) setNews(j.items.slice(0, 3)); }).catch(() => {});
    go(); const t = setInterval(() => { if (!document.hidden) go(); }, 300000);
    return () => { dead = true; clearInterval(t); };
  }, []);
  const spc = spcView(SPC_GAMES);
  const live = (nba || []).some((g) => g.state === "in");
  const gt = (iso) => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", timeZoneName: "short" });
  const gd = (iso) => new Date(iso).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
  return (
    <div className="gamespanel">
      <div className="row gamehead">
        <strong>{live ? <><span className="live">● LIVE</span> Games</> : "Games"}</strong>
        <span className="dim tiny">swipe →</span>
      </div>
      <div className="gamestrip" tabIndex={0} aria-label="Today's games, swipe sideways">
        {nba === null && !err && <div className="gcard"><span className="dim tiny">Checking games…</span></div>}
        {err && nba === null && <div className="gcard"><span className="dim tiny">NBA scores didn't load.</span></div>}
        {nba && nba.length === 0 && <div className="gcard"><span className="gl">NBA today</span><span className="dim tiny">No games today.</span></div>}
        {(nba || []).map((g) => (
          <div key={g.id} className={g.state === "in" ? "gcard livecard" : "gcard"}>
            <span className="gl">{g.phase || "NBA"}{g.state === "in" ? <span className="live"> ● {g.status}</span> : ""}</span>
            <div className="grow"><span>{g.away.logo && <img className="glogo" width="18" height="18" src={g.away.logo} alt="" loading="lazy" onError={(e) => { e.currentTarget.style.display = "none"; }} />}{g.away.abbr || g.away.name}</span><b className="gscore">{g.state !== "pre" ? g.away.score : ""}</b></div>
            <div className="grow"><span>{g.home.logo && <img className="glogo" width="18" height="18" src={g.home.logo} alt="" loading="lazy" onError={(e) => { e.currentTarget.style.display = "none"; }} />}{g.home.abbr || g.home.name}</span><b className="gscore">{g.state !== "pre" ? g.home.score : ""}</b></div>
            {g.start && <span className="gf">{g.state === "pre" ? "Starts" : "Started"} {gd(g.start)} · {gt(g.start)}</span>}
            {(g.state !== "pre" || g.tv) && <span className="gf">{g.state === "post" ? "Final" : g.state === "in" ? "Live" : ""}{g.state !== "pre" && g.tv ? " · " : ""}{g.tv}</span>}
          </div>
        ))}
        {[...spc.today, ...spc.upcoming].map((g) => (
          <div key={g.start} className="gcard spccard">
            <span className="gl">Texans{g.event ? ` · ${g.event}` : g.conf ? " · Conf" : ""}</span>
            <div className="grow"><span>South Plains</span></div>
            <div className="grow"><span>{g.home === false ? "at " : "vs "}{g.opp}</span></div>
            <span className="gf">{gd(g.start)} · {g.tba ? "Time TBA" : gt(g.start)}</span>
          </div>
        ))}
      </div>
      <div className="gamefoot dim tiny">
        {news[0] ? <span>Texans: {news[0].link ? <a href={news[0].link} target="_blank" rel="noreferrer">{news[0].title}</a> : news[0].title} · </span> : null}
        <a href={SPC_URL} target="_blank" rel="noreferrer">Texans schedule and live stats</a>
      </div>
    </div>
  );
}

/* ---------- groups: what a phone publishes, and how a friend's fast reads ---------- */
// Fasts get a check-in every 12 hours from the 24th. No answer within 2 hours of a mark shows friends "not confirmed".
const CONFIRM_FIRST_H = 24, CONFIRM_EVERY_H = 12, CONFIRM_GRACE_H = 2;
function fastConfirmState(start, confirmedAt, now = Date.now()) {
  const h = (now - start) / 36e5;
  if (!(h >= CONFIRM_FIRST_H)) return { state: "ok", mark: null };
  const k = Math.floor((h - CONFIRM_FIRST_H) / CONFIRM_EVERY_H);
  const mark = start + (CONFIRM_FIRST_H + CONFIRM_EVERY_H * k) * 36e5;
  if ((confirmedAt || 0) >= mark) return { state: "confirmed", mark };
  return { state: now - mark < CONFIRM_GRACE_H * 36e5 ? "due" : "unconfirmed", mark };
}
const fmtHM = (ms) => { const m = Math.max(0, Math.floor(ms / 60000)); return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`; };
const DEFAULT_SCOPES = { fast: true, weight: true, cal: true, habits: true };
const HABIT_LABELS = { meals: "Logged meals", cal: "Calorie range", protein: "Protein", veg: "Veggies", move: "Moved or rested", water: "Water", checkin: "Check-in" };
// Privacy is enforced here, at the source: anything a person switched off is never put in the payload.
function buildStatus(data, scopes, targets, today = dayKey()) {
  const p = data?.profile || {};
  const day = { ...blankDay(), ...(data?.days?.[today] || {}) };
  const sc = { ...DEFAULT_SCOPES, ...(scopes || {}) };
  const out = { scopes: sc };
  if (sc.fast && fastingEnabled(data) && data?.fast?.start) {
    out.fast = { start: data.fast.start };
    if (data.fast.confirmedAt) out.fast.confirmedAt = data.fast.confirmedAt;
  }
  if (sc.weight) {
    const ws = Object.entries(data?.days || {}).filter(([, d]) => +d?.weight > 0).sort();
    out.weight = { start: +p.weight || null, current: ws.length ? +ws[ws.length - 1][1].weight : +p.weight || null, goal: +p.goalWeight || null };
  }
  if (sc.cal) {
    out.cal = { eaten: Math.round(day.foods.reduce((a, f) => a + (+f.calories || 0), 0)), target: targets?.calories || 0,
      protein: Math.round(day.foods.reduce((a, f) => a + (+f.protein || 0), 0)), proteinTarget: targets?.protein || 0 };
  }
  if (sc.habits) {
    const prof = { ...p, recovering: !!data?.recovery?.on };
    out.habits = Object.fromEntries(dayScore(day, targets, prof).parts.map((x) => [x.key, x.done]));
    out.week = weekRecord(data?.days, today, () => targets, prof);
  }
  return out;
}
const groupErr = (e) => { try { return JSON.parse(e.message).error || e.message; } catch { return e.message || "Something went wrong."; } };

/* ---------- groups UI ---------- */
function SharingToggles({ scopes, onChange }) {
  const rows = [["fast", "Fasting clock"], ["weight", "Weight"], ["cal", "Calories and protein"], ["habits", "Daily habits (yes or no)"]];
  return (
    <div className="stack">
      <label style={{ margin: 0 }}>What friends can see</label>
      {rows.map(([k, l]) => (
        <div key={k} className="row small">
          <span>{l}</span>
          <input type="checkbox" checked={!!scopes[k]} onChange={(e) => onChange({ ...scopes, [k]: e.target.checked })} />
        </div>
      ))}
      <p className="dim tiny">Starts as everything. Lab results and points are never shared and there's no leaderboard. You can change this any time, and anything you switch off stops being sent.</p>
    </div>
  );
}

function useBoard(g, everyMs = 30000) {
  const [board, setBoard] = useState(null);
  const [err, setErr] = useState("");
  const load = useCallback(async () => {
    if (!g || g.lost) return;
    try { setBoard(await groupsApi({ op: "board", groupId: g.id, memberId: g.memberId, token: g.token })); setErr(""); }
    catch (e) { setErr(groupErr(e)); }
  }, [g?.id, g?.memberId, g?.token, g?.lost]);
  useEffect(() => {
    load();
    const t = setInterval(() => { if (!document.hidden) load(); }, everyMs);
    return () => clearInterval(t);
  }, [load, everyMs]);
  return { board, err, load };
}

// Who in your group is fasting right now. Hidden when nobody is.
function CrewFastStrip({ data }) {
  const g = (data.groups || []).find((x) => !x.lost);
  const { board } = useBoard(g, 60000);
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(t); }, []);
  const fasting = (board?.members || []).filter((m) => !m.isMe && m.status?.fast);
  if (!g || !fasting.length) return null;
  return (
    <div className="glass pad stack">
      <h2>{H("Crew on the clock", "Friends fasting now")}</h2>
      {fasting.map((m) => {
        const f = m.status.fast, cs = fastConfirmState(f.start, f.confirmedAt, now);
        return (
          <div key={m.id} className="row small">
            <span>{m.name}</span>
            <span className="mono">{fmtHM(now - f.start)}{cs.state === "unconfirmed" ? " · not confirmed" : cs.state === "due" ? " · check-in due" : ""}</span>
          </div>
        );
      })}
    </div>
  );
}

function GroupBoard({ g, data, setData }) {
  const { board, err, load } = useBoard(g);
  const [now, setNow] = useState(Date.now());
  const [sent, setSent] = useState({});
  const [msg, setMsg] = useState("");
  const [showCode, setShowCode] = useState(false);
  const [pics, setPics] = useState({});          // memberId -> loaded image
  const [caption, setCaption] = useState("");
  const [posting, setPosting] = useState(false);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 20000); return () => clearInterval(t); }, []);
  const call = (p) => groupsApi({ groupId: g.id, memberId: g.memberId, token: g.token, ...p });
  const patchGroup = (fn) => setData((d) => ({ ...d, groups: (d.groups || []).map((x) => (x.id === g.id ? { ...fn(x), u: Date.now() } : x)) }));
  const dropLocal = () => setData((d) => ({ ...d, deleted: tombstone(d, "group:" + g.id), groups: (d.groups || []).filter((x) => x.id !== g.id) }));

  if (g.lost) return (
    <div className="glass pad stack">
      <h2>{g.name}</h2>
      <p className="alert">You're not in this group anymore.</p>
      <button className="btn ghost wide" onClick={dropLocal}>Remove it from this app</button>
    </div>
  );
  const nudge = async (to, kind) => {
    setMsg("");
    try { await call({ op: "nudge", to, kind }); setSent((s) => ({ ...s, [to + kind]: true })); }
    catch (e) { setMsg(groupErr(e)); }
  };
  const ack = async () => { try { await call({ op: "ack", upTo: Math.max(...board.nudges.map((n) => n.at)) }); load(); } catch { /* try again next refresh */ } };
  const run = async (p, after) => { setMsg(""); try { const r = await call(p); after && after(r); load(); } catch (e) { setMsg(groupErr(e)); } };
  const grp = board?.group;
  const viewPic = async (id) => {
    if (pics[id]) { setPics((p) => { const n = { ...p }; delete n[id]; return n; }); return; }
    setMsg("");
    try { const r = await call({ op: "photoget", target: id }); setPics((p) => ({ ...p, [id]: r.image })); }
    catch (e) { setMsg(groupErr(e)); load(); }
  };
  const postPic = async (e) => {
    const f = e.target.files?.[0]; e.target.value = "";
    if (!f) return;
    setPosting(true); setMsg("");
    try {
      // Shrink until it fits what the server accepts; a meal photo doesn't need to be sharp.
      let img = null;
      for (const [max, q] of [[900, 0.6], [700, 0.5], [500, 0.45]]) { img = await shrinkPhoto(f, max, q); if (img.length <= 220000) break; }
      if (!img || img.length > 220000) throw new Error("That photo is too big to share.");
      await call({ op: "photo", image: img, caption });
      setCaption(""); load();
    } catch (er) { setMsg(groupErr(er)); }
    setPosting(false);
  };

  return (
    <>
      <div className="glass pad stack">
        <div className="row"><h2>{g.name}</h2><button className="chip" onClick={load}>Refresh</button></div>
        {grp && <p className="dim tiny">{grp.count} {grp.count === 1 ? "person" : "people"}{grp.ready ? "" : ` · works best with 3 or more, send them the invite code`}{grp.locked ? " · closed to new members" : ""}</p>}
        {err && <p className="alert">{err}</p>}
        {msg && <p className="alert">{msg}</p>}
      </div>

      {(board?.nudges || []).length > 0 && (
        <div className="glass pad stack">
          {board.nudges.slice().reverse().map((n, i) => (
            <p key={i} className="small">{n.kind === "check" ? `${n.from} is checking in on you. How are you feeling?` : `${n.from} is cheering you on.`}</p>))}
          <button className="chip" onClick={ack}>Got it</button>
        </div>
      )}

      {!board && !err && <div className="glass pad center"><p className="dim">Loading…</p></div>}
      {(board?.members || []).map((m) => {
        const s = m.status, f = s?.fast, cs = f ? fastConfirmState(f.start, f.confirmedAt, now) : null;
        const hrs = f ? (now - f.start) / 36e5 : 0;
        const stale = s && now - s.at > 3 * 36e5;
        return (
          <div key={m.id} className="glass pad stack">
            <div className="row"><strong>{m.name}{m.isMe ? " (you)" : ""}{m.creator ? " · host" : ""}</strong>
              {s && <span className="dim tiny">{stale ? `last seen ${fmtHM(now - s.at)} ago` : "up to date"}</span>}</div>
            {!s && <p className="dim tiny">Hasn't opened the app since joining.</p>}
            {s && s.scopes?.fast === false && <p className="dim tiny">Keeping fasting private.</p>}
            {s && s.scopes?.fast && !f && <p className="dim tiny">Not fasting.</p>}
            {f && (
              <div>
                <div className="row"><span className="mono">Fasting {fmtHM(now - f.start)}</span><span className="dim tiny">{stageAt(hrs).name}</span></div>
                <p className={cs.state === "unconfirmed" ? "alert tiny" : "dim tiny"}>
                  {cs.state === "confirmed" ? "Checked in and still fasting." : cs.state === "due" ? "Check-in due." : cs.state === "unconfirmed" ? "Hasn't confirmed since the last check-in." : "Under 24 hours, no check-in needed yet."}
                  {stale ? " Their phone hasn't reported in for a while." : ""}
                </p>
                {hrs >= 36 && !m.isMe && <p className="cue">That's a long one. A message from you goes a long way.</p>}
              </div>
            )}
            {s?.weight?.current != null && s.weight.start != null && <div className="row small"><span className="dim">Weight</span><span className="mono">{s.weight.current} lb · {(s.weight.start - s.weight.current).toFixed(1)} down</span></div>}
            {s?.cal && s.cal.target > 0 && (
              <div>
                <div className="row small"><span className="dim">Today</span><span className="mono">{s.cal.eaten.toLocaleString()} / {s.cal.target.toLocaleString()} cal · {s.cal.protein}/{s.cal.proteinTarget}g protein</span></div>
                <div className="track"><div style={{ width: `${Math.min(100, (s.cal.eaten / s.cal.target) * 100)}%`, background: C.cal }} /></div>
              </div>
            )}
            {s?.habits && (
              <div className="chips" style={{ marginBottom: 0 }}>
                {Object.entries(HABIT_LABELS).map(([k, l]) => <span key={k} className={s.habits[k] ? "chip on" : "chip"} style={{ cursor: "default", opacity: s.habits[k] ? 1 : 0.55 }}>{s.habits[k] ? "✓ " : ""}{l}</span>)}
              </div>
            )}
            {s?.week && <div className="wlstrip">{s.week.map((w, i) => <span key={i} className={w === true ? "wl w" : w === false ? "wl l" : "wl n"}>{w === true ? "W" : w === false ? "L" : "–"}</span>)}</div>}
            {m.photo && (
              <div className="stack" style={{ gap: 6 }}>
                <button className="chip" onClick={() => viewPic(m.id)}>{pics[m.id] ? "Hide photo" : `Meal photo${m.photo.caption ? `: ${m.photo.caption}` : ""} · ${fmtHM(now - m.photo.at)} ago`}</button>
                {pics[m.id] && <img src={pics[m.id]} alt={m.photo.caption || "Shared meal"} style={{ width: "100%", borderRadius: 10 }} />}
              </div>
            )}
            {m.isMe && (
              <div className="stack" style={{ gap: 6 }}>
                <input placeholder="Caption (optional)" value={caption} maxLength={60} onChange={(e) => setCaption(e.target.value)} aria-label="Photo caption" />
                <div className="rowbtns">
                  <label className="chip" style={{ cursor: "pointer" }}>{posting ? "Posting…" : "Share a meal photo"}
                    <input type="file" accept="image/*" capture="environment" onChange={postPic} style={{ display: "none" }} disabled={posting} /></label>
                  {m.photo && <button className="chip" onClick={() => run({ op: "photodel" })}>Remove mine</button>}
                </div>
                <p className="dim tiny">Meal photos only. The crew sees it for 24 hours. Progress photos can't be shared.</p>
              </div>
            )}
            {!m.isMe && (
              <div className="rowbtns">
                <button className="chip" disabled={sent[m.id + "check"]} onClick={() => nudge(m.id, "check")}>{sent[m.id + "check"] ? "Sent" : "Check on them"}</button>
                <button className="chip" disabled={sent[m.id + "cheer"]} onClick={() => nudge(m.id, "cheer")}>{sent[m.id + "cheer"] ? "Sent" : "Cheer"}</button>
                {grp?.isCreator && <button className="chip" onClick={() => { if (window.confirm(`Remove ${m.name} from the group?`)) run({ op: "remove", target: m.id }); }}>Remove</button>}
              </div>
            )}
          </div>
        );
      })}

      <div className="glass pad stack">
        <SharingToggles scopes={{ ...DEFAULT_SCOPES, ...(g.scopes || {}) }} onChange={(sc) => patchGroup((x) => ({ ...x, scopes: sc }))} />
      </div>

      <div className="glass pad stack">
        <h2>Group</h2>
        {grp?.isCreator && (
          <>
            {g.code ? (
              <>
                <button className="chip" onClick={() => setShowCode(!showCode)}>{showCode ? "Hide invite code" : "Show invite code"}</button>
                {showCode && <div className="codebox mono">{g.code.match(/.{4}/g).join("-")}</div>}
              </>
            ) : <p className="dim tiny">Reset the code to get a new invite code to share.</p>}
            <div className="rowbtns">
              <button className="chip" onClick={() => run({ op: "lock", locked: !grp.locked })}>{grp.locked ? "Open to new members" : "Close to new members"}</button>
              <button className="chip" onClick={() => { if (window.confirm("Reset the invite code? The old one stops working. People already in stay in.")) run({ op: "reset" }, (r) => { patchGroup((x) => ({ ...x, code: r.code })); setShowCode(true); }); }}>Reset code</button>
            </div>
          </>
        )}
        <button className="btn ghost wide" onClick={() => { if (window.confirm("Leave this group?")) call({ op: "leave" }).catch(() => {}).finally(dropLocal); }}>Leave group</button>
      </div>
    </>
  );
}

function GroupsView({ data, setData }) {
  const groups = data.groups || [];
  const [modeRaw, setMode] = useState(null);
  const mode = modeRaw ?? (groups.length ? null : "choose");   // no groups (first visit, or just left one) -> start screen
  const [gname, setGname] = useState("");
  const [me, setMe] = useState(data.profile?.name || "");
  const [code, setCode] = useState("");
  const [scopes, setScopes] = useState(DEFAULT_SCOPES);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const add = (r, extra) => {
    setData((d) => ({ ...d, groups: [...(d.groups || []), { id: r.groupId, name: r.groupName, memberId: r.memberId, token: r.token, scopes, u: Date.now(), ...extra }] }));
    setMode(null);
  };
  const create = async () => {
    setBusy(true); setErr("");
    try { const r = await groupsApi({ op: "create", name: gname, member: me }); add(r, { code: r.code }); }
    catch (e) { setErr(groupErr(e)); }
    setBusy(false);
  };
  const join = async () => {
    setBusy(true); setErr("");
    try { const r = await groupsApi({ op: "join", code, member: me }); add(r); }
    catch (e) { setErr(groupErr(e)); }
    setBusy(false);
  };

  if (!mode) return (
    <>
      {groups.map((g) => <GroupBoard key={g.id} g={g} data={data} setData={setData} />)}
      <button className="btn ghost wide" onClick={() => setMode("choose")}>Create or join another group</button>
    </>
  );
  if (mode === "choose") return (
    <div className="glass pad stack">
      <h2>{H("Your crew", "Friends")}</h2>
      <p className="dim small">Invite-only groups of up to 20. Friends only see what you allow, and nothing is public.</p>
      <p className="small">Starting it yourself? Press <strong>Start a group</strong>, then send the code to your friends. Got a code from a friend? Press <strong>I have an invite code</strong>.</p>
      <button className="btn solid wide" onClick={() => setMode("create")}>Start a group</button>
      <button className="btn ghost wide" onClick={() => setMode("join")}>I have an invite code</button>
      {groups.length > 0 && <button className="btn ghost wide" onClick={() => setMode(null)}>Back</button>}
    </div>
  );
  return (
    <div className="glass pad stack">
      <h2>{mode === "create" ? "Start a group" : "Join a group"}</h2>
      {mode === "create" && <input placeholder="Group name" maxLength={32} value={gname} onChange={(e) => setGname(e.target.value)} />}
      {mode === "join" && <input placeholder="Invite code" autoCapitalize="characters" value={code} onChange={(e) => setCode(e.target.value)} />}
      <input placeholder="Your name in the group" maxLength={24} value={me} onChange={(e) => setMe(e.target.value)} />
      <SharingToggles scopes={scopes} onChange={setScopes} />
      {err && <p className="alert">{err}</p>}
      <button className="btn solid wide" disabled={busy || !me.trim() || (mode === "create" ? !gname.trim() : !code.trim())} onClick={mode === "create" ? create : join}>{busy ? "One sec…" : mode === "create" ? "Create group" : "Join group"}</button>
      <button className="btn ghost wide" onClick={() => setMode(groups.length ? null : "choose")}>Back</button>
    </div>
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
function AddFood({ onAdd, onCancel, calib, onCalib, recipes, setData, budget, budgetLeft }) {
  const [mode, setMode] = useState("meal");
  const [meal, setMeal] = useState(guessMeal());
  return (
    <div className="glass pad stack fadein">
      <div className="chips">
        {[["meal", "Meal"], ["weigh", "Weigh"], ["label", "Label"], ["recipe", "Recipe"], ["photo", "Photo"], ["desc", "Describe"]].map(([k, l]) => (
          <button key={k} className={mode === k ? "chip on" : "chip"} onClick={() => setMode(k)}>{l}</button>))}
      </div>
      {mode === "meal" && <MealBuilder meal={meal} setMeal={setMeal} onAdd={onAdd} onCancel={onCancel} calib={calib} onCalib={onCalib} budget={budget} budgetLeft={budgetLeft} />}
      {mode === "recipe" && <Recipes recipes={recipes} setData={setData} meal={meal} setMeal={setMeal} onAdd={onAdd} onCancel={onCancel} />}
      {mode === "weigh" && <WeighIt meal={meal} setMeal={setMeal} onAdd={onAdd} onCancel={onCancel} />}
      {mode === "label" && <LabelIt meal={meal} setMeal={setMeal} onAdd={onAdd} onCancel={onCancel} />}
      {mode === "photo" && <SnapIt meal={meal} setMeal={setMeal} onAdd={onAdd} onCancel={onCancel} calib={calib} onCalib={onCalib} />}
      {mode === "desc" && <DescribeIt meal={meal} setMeal={setMeal} onAdd={onAdd} onCancel={onCancel} />}
    </div>
  );
}

/* ---------- optional fasting: off by default for new logs, gated, never rewarded ---------- */
const fastingEnabled = (data) => data?.fastingOn ?? (((data?.fasts || []).length > 0) || !!data?.fast);
function fastGate(p) {
  const age = +p?.age, w = +p?.weight, h = +p?.heightIn;
  if (Number.isFinite(age) && age > 0 && age < 18) return { ok: false, reason: "Fasting isn't offered under 18. Growing bodies need regular meals." };
  if (w > 0 && h > 0) {
    const bmi = (w * 703) / (h * h);
    if (bmi < 18.5) return { ok: false, reason: "Fasting isn't offered when BMI is under 18.5. Regular meals come first." };
  }
  return { ok: true, reason: "" };
}
function fastCaution(hours, { trained = false, recovering = false } = {}) {
  if (hours >= 36) return { level: "stop", text: "That's 36+ hours. Break this fast now. If you feel dizzy, faint, or unwell, eat and get medical help." };
  if (hours >= 24) return { level: "warn", text: "Past 24 hours there is no extra credit for going longer, and the risks climb. Breaking it on plan is the win." };
  if (hours >= 20 && (trained || recovering)) return { level: "warn", text: recovering ? "You're in recovery mode. Eat, don't push the fast." : "You trained today. Don't push a long fast on top of it. Eat protein soon." };
  if (hours >= 20) return { level: "note", text: "Longer isn't better here. Same points whether you stop at 14 hours or 20." };
  return null;
}

/* ---------- lifting log: exercises -> sets of reps x weight ---------- */
const liftKey = (n) => String(n || "").trim().toLowerCase().replace(/\s+/g, " ");
const e1rm = (wt, reps) => (+wt > 0 && +reps > 0 ? +wt * (1 + Math.min(+reps, 30) / 30) : 0);   // Epley
const cleanSets = (sets) => (sets || []).filter((s) => +s.reps > 0 && +s.wt >= 0);
function exerciseNames(days) {
  const seen = new Map();
  for (const d of Object.values(days || {})) for (const l of d?.lifts || []) if (liftKey(l.name)) seen.set(liftKey(l.name), l.name.trim());
  return [...seen.values()].sort();
}
function lastSets(days, name, beforeKey) {
  const k = liftKey(name);
  const keys = Object.keys(days || {}).filter((d) => d < beforeKey).sort().reverse();
  for (const dk of keys) {
    const hit = (days[dk]?.lifts || []).find((l) => liftKey(l.name) === k && cleanSets(l.sets).length);
    if (hit) return { day: dk, sets: cleanSets(hit.sets) };
  }
  return null;
}
// Per exercise across days: best estimated 1RM per session, so the trend isn't thrown by one easy day.
function strengthSummary(days, sinceKey = "0000-00-00") {
  const by = new Map();
  for (const dk of Object.keys(days || {}).filter((d) => d >= sinceKey).sort()) {
    for (const l of days[dk]?.lifts || []) {
      const sets = cleanSets(l.sets); if (!sets.length) continue;
      const k = liftKey(l.name);
      const e = by.get(k) || { name: l.name.trim(), sessions: [] };
      e.sessions.push({ day: dk, best: Math.max(...sets.map((s) => e1rm(s.wt, s.reps))), volume: sets.reduce((a, s) => a + s.reps * s.wt, 0), top: Math.max(...sets.map((s) => +s.wt)) });
      by.set(k, e);
    }
  }
  return [...by.values()].map((e) => {
    const f = e.sessions[0], l = e.sessions[e.sessions.length - 1];
    return { name: e.name, sessions: e.sessions.length, first: Math.round(f.best), last: Math.round(l.best), best: Math.round(Math.max(...e.sessions.map((s) => s.best))),
      change: f.best > 0 && e.sessions.length > 1 ? Math.round(((l.best - f.best) / f.best) * 100) : null, volume: Math.round(e.sessions.reduce((a, s) => a + s.volume, 0)) };
  }).sort((a, b) => b.sessions - a.sessions);
}

// South Plains games for the panel: what's on today, then the next few. Past games drop off.
function spcView(games, nowMs = Date.now(), nUpcoming = 3) {
  const sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();
  const all = (games || []).filter((g) => g && g.start && !Number.isNaN(new Date(g.start).getTime())).sort((a, b) => new Date(a.start) - new Date(b.start));
  const today = all.filter((g) => sameDay(g.start, nowMs));
  const upcoming = all.filter((g) => new Date(g.start).getTime() > nowMs && !sameDay(g.start, nowMs)).slice(0, nUpcoming);
  return { today, upcoming, total: all.length };
}

/* ---------- accountability score: 100 points a day, built from habits ---------- */
// No points for eating less or fasting longer. Calorie points only land inside +/-10% of your budget.
const SCORE_MAX = { meals: 20, cal: 20, protein: 20, veg: 15, move: 10, water: 5, checkin: 10 };
const ON_TRACK = 70;
function dayScore(day, targets, profile = {}) {
  const d = day || {};
  const foods = d.foods || [];
  const cal = foods.reduce((a, f) => a + (+f.calories || 0), 0);
  const prot = foods.reduce((a, f) => a + (+f.protein || 0), 0);
  const meals = new Set(foods.map((f) => f.meal || "x")).size;
  const tCal = +targets?.calories || 0, tProt = +targets?.protein || 0;
  const stepGoal = (+profile.stepGoal || 6000) / (profile.recovering ? 2 : 1);
  const water = +d.water || 0, waterGoal = +profile.waterOz || 100;
  const moved = !!d.rest || (d.tags || []).length > 0 || (d.workouts || []).length > 0 || (d.lifts || []).length > 0 || (+d.steps || 0) >= stepGoal;
  const parts = [
    { key: "meals", label: "Logged your meals", pts: meals >= 2 ? 20 : meals === 1 ? 10 : 0, hint: "Log at least two meals" },
    { key: "cal", label: "Inside your calorie range", pts: meals >= 2 && tCal > 0 && cal >= tCal * 0.9 && cal <= tCal * 1.1 ? 20 : 0, hint: "Land within 10% of your budget" },
    { key: "protein", label: "Hit your protein", pts: tProt > 0 ? Math.round(20 * Math.min(1, prot / (tProt * 0.9))) : 0, hint: "Reach 90% of your protein target" },
    { key: "veg", label: "Fiber and veggies", pts: d.veg ? 15 : 0, hint: "Tap when you've had your veggies, fruit or fiber" },
    { key: "move", label: d.rest ? "Recovery day" : "Right-sized activity", pts: moved ? 10 : 0, hint: "Train, walk, or log a rest day" },
    { key: "water", label: "Hydration", pts: water >= waterGoal ? 5 : 0, hint: "Reach your water goal" },
    { key: "checkin", label: "Group check-in", pts: d.checkin ? 10 : 0, hint: "Check in with your group" },
  ].map((p) => ({ ...p, max: SCORE_MAX[p.key], done: p.pts >= SCORE_MAX[p.key] }));
  return { total: parts.reduce((a, p) => a + p.pts, 0), parts, cal, prot };
}
// The 7 days ending at endKey, oldest first: true = on track (70+), false = logged but short, null = nothing logged.
function weekRecord(days, endKey, targetsFor, profile) {
  const [y, m, dd] = endKey.split("-").map(Number);
  const out = [];
  for (let i = 6; i >= 0; i--) {
    const dt = new Date(y, m - 1, dd - i);
    const k = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
    out.push(days?.[k] ? dayScore(days[k], targetsFor(days[k]), profile).total >= ON_TRACK : null);
  }
  return out;
}
const weekOnTrack = (days, endKey, targetsFor, profile) => weekRecord(days, endKey, targetsFor, profile).filter((x) => x === true).length;


/* ---------- 30-day challenges: one habit, thirty days, a final report ---------- */
// A day counts when it clears the habit. No points, and nothing about eating less or fasting longer.
const CHALLENGES = [
  { id: "board", name: "30 on the board", blurb: "Score 70+ every day.", pass: (sc) => sc.total >= ON_TRACK },
  { id: "protein", name: "Protein 30", blurb: "Hit your protein target daily.", pass: (sc) => sc.parts.find((x) => x.key === "protein")?.done },
  { id: "log", name: "Log every play", blurb: "Log at least two meals a day.", pass: (sc) => sc.parts.find((x) => x.key === "meals")?.done },
  { id: "move", name: "Move daily", blurb: "A workout, a walk, or a logged rest day.", pass: (sc) => sc.parts.find((x) => x.key === "move")?.done },
  { id: "water", name: "Water 30", blurb: "Reach your water goal daily.", pass: (sc) => sc.parts.find((x) => x.key === "water")?.done },
];
const ymdAdd = (key, n) => { const [y, m, d] = key.split("-").map(Number); const t = new Date(y, m - 1, d + n); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`; };
const ymdDiff = (a, b) => { const f = (k) => { const [y, m, d] = k.split("-").map(Number); return Date.UTC(y, m - 1, d); }; return Math.round((f(b) - f(a)) / 864e5); };
// Bronze 18 days, silver 24, gold 27 (60 / 80 / 90%).
const badgeFor = (hits) => (hits >= 27 ? "Gold" : hits >= 24 ? "Silver" : hits >= 18 ? "Bronze" : null);
function challengeStatus(ch, days, targetsFor, profile, todayKey) {
  const def = CHALLENGES.find((c) => c.id === ch?.id);
  if (!def) return null;
  const cells = [];
  for (let i = 0; i < 30; i++) {
    const k = ymdAdd(ch.start, i);
    let st = "future";
    if (k <= todayKey) {
      const day = days?.[k];
      const hit = !!day && !!def.pass(dayScore(day, targetsFor(day), profile));
      st = hit ? "hit" : k === todayKey ? "open" : "miss";
    }
    cells.push({ key: k, st });
  }
  const dayNo = Math.min(31, ymdDiff(ch.start, todayKey) + 1);
  const hits = cells.filter((c) => c.st === "hit").length;
  let best = 0, run = 0;
  for (const c of cells) { run = c.st === "hit" ? run + 1 : 0; best = Math.max(best, run); }
  let streak = 0;
  for (let i = cells.length - 1; i >= 0; i--) { if (cells[i].st === "future" || cells[i].st === "open") continue; if (cells[i].st === "hit") streak++; else break; }
  const weeks = [];
  for (let w = 0; w < 4; w++) { const seg = cells.slice(w * 7, w * 7 + 7); if (seg.every((c) => c.st !== "future" && c.st !== "open")) weeks.push({ n: w + 1, hits: seg.filter((c) => c.st === "hit").length, of: 7 }); }
  const finished = dayNo > 30;
  return { def, cells, dayNo: Math.max(1, Math.min(30, dayNo)), hits, best, streak, weeks, finished, badge: finished ? badgeFor(hits) : null, pct: Math.round((hits / 30) * 100) };
}

/* ---------- meal tiers: rated on the whole plate, never on a single food ---------- */
// cls per item: 1 = whole / minimally processed, 2 = mixed or lightly processed, 3 = heavily processed.
// The AI only sorts each item into a class; the tier itself is plain rules, so it's consistent and explainable.
const TIER_INFO = {
  1: { label: "Tier 1", name: "Whole foods", hue: "#22C55E" },
  2: { label: "Tier 2", name: "Mixed", hue: "#EAB308" },
  3: { label: "Tier 3", name: "Processed", hue: "#F97316" },
  off: { label: "Off-plan", name: "Outside budget", hue: "#EF4444" },
};
const WHOLE_RE = /\b(chicken breast|chicken|turkey|salmon|fish|shrimp|steak|sirloin|egg|eggs|broccoli|spinach|greens|salad|lettuce|vegetable|veggies|carrot|pepper|onion|tomato|cucumber|rice|oats|oatmeal|potato|sweet potato|beans|lentil|apple|banana|berries|orange|fruit|avocado|almonds|nuts|yogurt|cottage cheese|water)\b/i;
const PROC_RE = /\b(fries|chips|soda|candy|cookie|cake|donut|doughnut|pizza|nugget|hot dog|bacon|sausage|cereal|pop-?tart|ice cream|milkshake|fast food|burger|bun|frosted|fried|breaded|syrup|energy drink)\b/i;
function guessClass(name) {
  const n = String(name || "");
  if (PROC_RE.test(n)) return 3;
  if (WHOLE_RE.test(n)) return 1;
  return 2;
}
function tierMeal(items, cls, ctx = {}) {
  const its = (items || []).map((i) => ({ cal: Math.max(0, +i.calories || 0), p: Math.max(0, +i.protein || 0) }));
  const total = its.reduce((a, i) => a + i.cal, 0);
  const prot = its.reduce((a, i) => a + i.p, 0);
  const share = (k) => (total > 0 ? its.reduce((a, i, n) => a + ((cls?.[n] ?? 2) === k ? i.cal : 0), 0) / total : 0);
  const whole = share(1), proc = share(3);
  const proteinShare = total > 0 ? (prot * 4) / total : 0;
  const { budget, budgetLeft } = ctx;
  const haveBudget = Number.isFinite(budget) && budget > 0 && Number.isFinite(budgetLeft);
  const reasons = [];
  let tier;
  if (haveBudget && total > Math.max(0, budgetLeft) * 1.1 && total > 0.2 * budget) {
    tier = "off";
    reasons.push(`About ${Math.round(total - Math.max(0, budgetLeft))} cal more than you have left today.`);
  } else if (haveBudget && proc >= 0.6 && total > 0.35 * budget) {
    tier = "off";
    reasons.push("A large portion that's mostly processed food.");
  } else if (proc >= 0.5) {
    tier = 3; reasons.push(`${Math.round(proc * 100)}% of the calories are heavily processed.`);
  } else if (whole >= 0.7 && proc <= 0.1 && proteinShare >= 0.15) {
    tier = 1; reasons.push("Mostly whole foods with solid protein.");
  } else {
    tier = 2;
    reasons.push(whole >= 0.7 ? "Mostly whole foods, but protein is on the light side." : "A mix of whole and processed foods.");
  }
  // Portion note: the same food reads differently at different sizes.
  if (tier !== "off" && haveBudget && total > 0 && total > Math.max(0, budgetLeft)) reasons.push("Slightly over what's left today. A smaller portion would keep it on plan.");
  return { tier, reasons, whole: Math.round(whole * 100), processed: Math.round(proc * 100), cal: Math.round(total) };
}

/* ---------- build a whole meal from several items, then optionally rate its tier ---------- */
function TierBox({ grade }) {
  if (!grade) return null;
  const ti = TIER_INFO[grade.tier];
  if (!ti) return <div className="gradebox"><strong>{grade.verdict}</strong><p className="dim tiny">{grade.why}</p></div>;
  return (
    <div className="gradebox tierbox fadein" style={{ "--tier": ti.hue }}>
      <strong><span className="tierpill">{ti.label}</span> {ti.name}</strong>
      <p className="dim tiny">{grade.why}</p>
      {grade.tip && <p className="tiny"><b>To move up:</b> {grade.tip}</p>}
    </div>
  );
}
function MealBuilder({ meal, setMeal, onAdd, onCancel, calib, onCalib, budget, budgetLeft }) {
  const [items, setItems] = useState([]);
  const [adding, setAdding] = useState(null);   // null | "weigh" | "label" | "photo" | "desc"
  const [grading, setGrading] = useState(false);
  const [grade, setGrade] = useState(null);
  const [err, setErr] = useState("");
  const noop = () => {};

  const addItems = (its) => { setItems((x) => [...x, ...its]); setAdding(null); setGrade(null); };
  const removeItem = (i) => { setItems((x) => x.filter((_, n) => n !== i)); setGrade(null); };
  const tot = sumMacros(items);

  const gradeIt = async () => {
    setGrading(true); setErr("");
    let cls = null, tip = "";
    try {
      const p = await askClaude([{ type: "text", text: `Sort each food in this meal by how processed it is. 1 = whole or minimally processed (meat, fish, eggs, vegetables, fruit, plain rice/oats/potatoes, beans, plain dairy, nuts). 2 = mixed or lightly processed (bread, pasta, sauces, cheese, restaurant dishes made from real ingredients). 3 = heavily processed (fried fast food, chips, candy, soda, pastries, packaged snacks, processed meats).
Never call any food "bad". Then give one friendly tip for making this same meal more whole-food (a swap or portion tweak, not eating less overall).

Items:
${items.map((i, n) => `${n}. ${i.name} (${Math.round(i.calories)} cal, ${Math.round(i.protein)}g protein)`).join("\n")}

Respond with ONLY JSON: {"classes":[one number 1-3 per item, in order],"tip":"one short sentence"}` }], 600);
      if (Array.isArray(p.classes) && p.classes.length === items.length) cls = p.classes.map((x) => (x === 1 || x === 3 ? x : 2));
      tip = typeof p.tip === "string" ? p.tip.slice(0, 200) : "";
    } catch { /* fall back to the offline guess below */ }
    if (!cls) { cls = items.map((i) => guessClass(i.name)); setErr("Couldn't reach the AI, so this tier is a quick estimate from the food names."); }
    const r = tierMeal(items, cls, { budget, budgetLeft });
    setGrade({ tier: r.tier, why: r.reasons.join(" "), tip, cls });
    setGrading(false);
  };

  return (
    <>
      {items.length > 0 && (
        <div className="ingredients">
          {items.map((i, n) => (
            <div key={n} className="row small ingrow">
              <span style={{ flex: 1 }}>{i.name}</span>
              <span className="mono dim">{Math.round(i.calories)}</span>
              <button className="icon" onClick={() => removeItem(n)}><X size={13} /></button>
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
            {[["weigh", "Weigh"], ["label", "Label"], ["photo", "Photo"], ["desc", "Describe"]].map(([k, l]) => (
              <button key={k} className={adding === k ? "chip on" : "chip"} onClick={() => setAdding(k)}>{l}</button>))}
          </div>
          {adding === "weigh" && <WeighIt meal={meal} setMeal={noop} hideMeal cta="Add to meal" onAdd={addItems} onCancel={() => setAdding(null)} />}
          {adding === "label" && <LabelIt meal={meal} setMeal={noop} hideMeal cta="Add to meal" onAdd={addItems} onCancel={() => setAdding(null)} />}
          {adding === "photo" && <SnapIt meal={meal} setMeal={noop} hideMeal cta="Add to meal" onAdd={addItems} onCancel={() => setAdding(null)} calib={calib} onCalib={onCalib} />}
          {adding === "desc" && <DescribeIt meal={meal} setMeal={noop} hideMeal cta="Add to meal" onAdd={addItems} onCancel={() => setAdding(null)} />}
        </div>
      ) : (
        <button className="btn ghost wide" onClick={() => setAdding("weigh")}>+ Add item</button>
      )}

      {items.length > 0 && (
        <button className="btn accent wide" onClick={gradeIt} disabled={grading}>{grading ? "Rating…" : grade ? "Re-rate this meal" : "Rate this meal"}</button>
      )}
      <TierBox grade={grade} />
      {err && <p className="alert">{err}</p>}

      <MealPick meal={meal} setMeal={setMeal} />
      <div className="rowbtns">
        <button className="btn ghost wide" onClick={onCancel}>Cancel</button>
        <button className="btn solid wide" disabled={!items.length} onClick={() => onAdd(items, grade)}>
          Log {items.length ? `${items.length} item${items.length > 1 ? "s" : ""}` : "meal"}
        </button>
      </div>
    </>
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

function Plan({ data, setData, targets, day, updateDay, dayId, setDayId }) {
  const today = dayId || dayKey();
  const menu = data.menus?.[today] || null;
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [openRecipe, setOpenRecipe] = useState(null);
  const [cook, setCook] = useState({});            // dish id -> how many people to cook for
  const [swapApplied, setSwapApplied] = useState({});   // dish id -> applied swap ids
  const [swapOpen, setSwapOpen] = useState(null);
  const [tagFilter, setTagFilter] = useState("");
  const [showLabs, setShowLabs] = useState(false);
  const [showList, setShowList] = useState(false);
  const [craving, setCraving] = useState("");
  const [slot, setSlot] = useState(guessMeal());
  const [mode, setMode] = useState("today");

  const eaten = day.foods.reduce((a, f) => ({ cal: a.cal + f.calories, p: a.p + f.protein }), { cal: 0, p: 0 });
  const remainCal = targets.calories - eaten.cal;
  const remainP = targets.protein - eaten.p;
  const labs = data.labs || [];

  const build = async () => {
    setBusy(true); setErr("");
    try {
      const likes = (data.favorites || []).map((f) => f.name).slice(0, 12);
      const p = await askClaude([{ type: "text", text: `Give someone ${data.profile?.age < 18 ? "who is a growing athlete (under 18, so never a calorie cut; fuel for growth and sports)" : "cutting weight"} exactly three ${slot.toLowerCase()} options to choose between.

${craving.trim() ? `What they're in the mood for: "${craving.trim()}". Take this seriously — all three options should satisfy that craving, worked into their numbers rather than replaced with something virtuous.` : "No particular craving — give three genuinely different options."}

Their numbers: ${targets.calories} calorie budget today, ${targets.protein}g protein target. ${remainCal} calories and ${Math.max(0, Math.round(remainP))}g protein left for the rest of the day. Size these options so they fit what's left without using all of it, unless this is their last meal of the day.
${data.fast ? "They are fasting right now, so this will break the fast — lead with protein." : ""}
${likes.length ? `Foods they already eat: ${likes.join(", ")}.` : ""}
${labs.length ? `\nLab values they entered:\n${labs.slice(0, 12).map((l) => `${l.name}: ${l.value}${l.unit ? " " + l.unit : ""} (${l.date})`).join("\n")}\n\nUse these ONLY to lean on well-established dietary patterns. Do NOT diagnose or name conditions. If a value looks meaningfully out of range, put one plain sentence in "flag" telling them to raise it with their doctor.` : ""}

Repetition is fine — do not avoid obvious or familiar meals. Real food, honestly counted, including the oil it's cooked in.

"effort": "grab" is no cooking, "simple" is under 10 minutes, "cook" is a real recipe. Include the recipe object ONLY for "cook".

Respond with ONLY JSON:
{"menu":[{"name":"short dish name","blurb":"one short line","calories":number,"protein":number,"carbs":number,"fat":number,"effort":"grab"|"simple"|"cook","recipe":{"servings":number,"ingredients":["amount + item"],"steps":["step"]}}],
"note":"one line on how this fits today",
"flag":"one sentence about a lab value worth raising with a doctor, or null"}` }]);

      const items = (p.menu || []).slice(0, 3).map((m) => ({ ...m, slot, id: crypto.randomUUID() }));
      setData((d) => ({ ...d, menus: { [today]: { items, note: p.note, flag: p.flag, slot, craving: craving.trim() } } }));
      setOpenRecipe(null);
    } catch (e) {
      const why = String(e?.message || "").slice(0, 160);
      setErr(`The coach couldn't build a custom menu${why ? ` (${why})` : ""}. The ideas below still work.`);
    }
    setBusy(false);
  };

  const addToList = (m, people, ings) => {
    if (!m.recipe) return;
    setData((d) => {
      // Replacing a dish of the same name: mark the old one deleted so another device can't bring it back.
      const old = (d.list || []).filter((x) => x.name === m.name);
      const deleted = old.reduce((acc, x) => ({ ...acc, ["list:" + x.id]: Date.now() }), d.deleted || {});
      return { ...d, deleted, list: [...(d.list || []).filter((x) => x.name !== m.name),
        { id: crypto.randomUUID(), name: m.name, servings: people || m.recipe.servings || 1, u: Date.now(),
          items: (ings || m.recipe.ingredients).map((t) => ({ text: t, done: false })) }] };
    });
    setShowList(true);
  };

  const choose = (m) => {
    updateDay(today, (d) => ({ ...d, foods: [...d.foods, { id: crypto.randomUUID(), meal: m.slot, name: m.name, at: stampFor(today),
      calories: Math.round(m.calories), protein: Math.round(m.protein), carbs: Math.round(m.carbs), fat: Math.round(m.fat) }] }));
  };

  const logToday = (item) => updateDay(today, (d) => ({ ...d, foods: [...d.foods, { id: crypto.randomUUID(), at: stampFor(today), u: Date.now(), ...item }] }));
  const dishCard = (m0) => {
    const ids = swapApplied[m0.id] || [];
    const m = ids.length ? applySwaps(m0, ids) : m0;
    const opts = swapsFor(m);
    const base = m0.recipe?.servings || 1;
    const people = cook[m0.id] || base;
    const f = people / base;
    const ings = m.recipe ? m.recipe.ingredients.map((i) => (/^Swap:/.test(i) ? i : scaleIngredient(i, f))) : [];
    const sizes = [...new Set([1, 2, 3, 4, 6, base])].sort((x, y) => x - y);
    const lost = Math.round(m0.protein - m.protein);
    return (
            <div key={m0.id} className="dish">
              <div className="row gap">
                <div><div className="dishname">{m.name}</div><div className="dim tiny">{m.blurb}</div></div>
                <span className={`badge ${m.effort === "cook" ? "" : "good"}`}>{m.effort}</span>
              </div>
              <div className="dishmacros">
                <span className="mono" style={{ color: C.cal }}>{Math.round(m.calories)}</span>
                <span className="dim tiny">{Math.round(m.protein)}p · {Math.round(m.carbs)}c · {Math.round(m.fat)}f · per serving</span>
              </div>
              <div className="tagrow">{tagsFor(m).slice(0, 5).map((t) => <span key={t} className="tagpill">{t}</span>)}</div>
              <div className="rowbtns">
                {m.recipe && <button className="btn ghost wide" onClick={() => setOpenRecipe(openRecipe === m0.id ? null : m0.id)}>
                  {openRecipe === m0.id ? "Hide recipe" : "Recipe"}</button>}
                {(opts.length > 0 || ids.length > 0) && <button className="btn ghost wide" onClick={() => setSwapOpen(swapOpen === m0.id ? null : m0.id)}>{swapOpen === m0.id ? "Hide swaps" : "Swap"}</button>}
                {m.recipe && <button className="btn ghost wide" onClick={() => addToList(m, people, ings)}>+ List</button>}
                <button className="btn solid wide" onClick={() => choose(m)}>Eat this</button>
              </div>
              {swapOpen === m0.id && (
                <div className="stack fadein" style={{ marginTop: 8 }}>
                  {opts.map((o) => (
                    <button key={o.id} className="listbtn" onClick={() => setSwapApplied((x) => ({ ...x, [m0.id]: [...(x[m0.id] || []), o.id] }))}>
                      {o.label}<span className="dim tiny" style={{ display: "block" }}>{o.d[0]} cal · {o.d[1] >= 0 ? "+" : ""}{o.d[1]}g protein · {o.d[2]}g carbs</span></button>))}
                  {ids.length > 0 && <button className="chip" onClick={() => setSwapApplied((x) => ({ ...x, [m0.id]: [] }))}>Undo my swaps</button>}
                  {lost >= 5 && <p className="cue">That drops protein by {lost}g. Add a Greek yogurt, an egg or a scoop of whey to keep it up.</p>}
                  <p className="dim tiny">Swap numbers are estimates for a typical portion.</p>
                </div>)}
              {openRecipe === m0.id && m.recipe && (
                <div className="recipe fadein">
                  <label>Cooking for</label>
                  <div className="chips">{sizes.map((n) => <button key={n} className={people === n ? "chip on" : "chip"} onClick={() => setCook((x) => ({ ...x, [m0.id]: n }))}>{n} {n === 1 ? "person" : "people"}</button>)}</div>
                  <div className="dim tiny" style={{ marginTop: 6 }}>Amounts below are for {people}. Calories and protein above are per serving.</div>
                  <ul>{ings.map((i, n) => <li key={n}>{i}</li>)}</ul>
                  <ol>{m.recipe.steps.map((st, n) => <li key={n}>{st}</li>)}</ol>
                </div>
              )}
            </div>
    );
  };
  const ideas = suggestMeals(craving, slot, remainCal, remainP, 40, data.profile).filter((m) => !tagFilter || tagsFor(m).includes(tagFilter)).slice(0, 6).map((m) => ({ ...m, slot, id: "lib-" + slot + m.name }));
  const otherIdeas = ideas.length || !craving.trim() ? [] : suggestMeals(craving, null, remainCal, remainP, 4, data.profile).map((m) => ({ ...m, slot: m.slots[0], id: "lib-x" + m.name }));
  return (
    <>
      {setDayId && <DayBar dayId={today} setDayId={setDayId} />}
      <div className="chips">
        {[["today", "Today"], ["week", "Week"]].map(([k, l]) => (
          <button key={k} className={mode === k ? "chip on" : "chip"} onClick={() => setMode(k)}>{l}</button>))}
      </div>
      {mode === "week" && <WeekPlan data={data} setData={setData} onLog={logToday} onOpenList={() => setShowList(true)} />}
      {mode === "today" && (<>
      <div className="glass pad stack">
        <div className="row"><h2>What sounds good?</h2>
          <span className="dim tiny">{remainCal.toLocaleString()} cal · {Math.max(0, Math.round(remainP))}g left</span></div>
        <div className="chips">{MEALS.map((s) => (
          <button key={s} className={slot === s ? "chip on" : "chip"} onClick={() => setSlot(s)}>{s}</button>))}</div>
        <p className="dim small">1. Pick the meal. 2. Type what sounds good, like chicken. 3. Press Eat this on one you like.</p>
        <div className="chips" style={{ flexWrap: "nowrap", overflowX: "auto", paddingBottom: 4 }}>
          <button className={!tagFilter ? "chip on" : "chip"} style={{ flex: "none" }} onClick={() => setTagFilter("")}>All</button>
          {TAG_FILTERS.map((t) => <button key={t} className={tagFilter === t ? "chip on" : "chip"} style={{ flex: "none", whiteSpace: "nowrap" }} onClick={() => setTagFilter(tagFilter === t ? "" : t)}>{t}</button>)}
        </div>
        <input placeholder="burgers, something Mexican, steak — or leave it blank" value={craving}
          onChange={(e) => setCraving(e.target.value)} onKeyDown={(e) => e.key === "Enter" && build()} />
        <button className="btn accent wide" onClick={build} disabled={busy}>
          {busy ? "Thinking…" : `Ask the coach for three custom ${slot.toLowerCase()} options`}</button>
        {err && <p className="alert">{err}</p>}
      </div>

      <div className="glass fadein">
        <div className="mealhead">
          <span className="dot" style={{ background: MEAL_COLOR[slot], boxShadow: `0 0 8px ${MEAL_COLOR[slot]}` }} />
          {craving.trim() ? `${slot} ideas for “${craving.trim()}”` : `${slot} ideas`}
        </div>
        {ideas.length === 0 && (
          <>
            <p className="dim small pad">Nothing for “{craving.trim()}” at {slot.toLowerCase()}. {otherIdeas.length ? "These work at other meals:" : "Try the coach button above, or a simpler word like chicken, beef, fish, eggs or tacos."}</p>
            {otherIdeas.map((m) => dishCard(m))}
          </>
        )}
        {ideas.map((m) => dishCard(m))}
      </div>

      {menu && (
        <div className="glass fadein">
          <div className="mealhead">
            <span className="dot" style={{ background: MEAL_COLOR[menu.slot], boxShadow: `0 0 8px ${MEAL_COLOR[menu.slot]}` }} />
            {menu.slot}{menu.craving ? ` · ${menu.craving}` : ""}
          </div>
          {menu.note && <p className="dim tiny pad" style={{ paddingBottom: 0 }}>{menu.note}</p>}
          {menu.flag && <p className="cue" style={{ color: C.warn, borderColor: `${C.warn}55`, margin: "10px 16px 0" }}>{menu.flag}</p>}
          {menu.items.map((m) => dishCard(m))}
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
/* ---------- Eating Out tab: built-in drive-thru picks, ranked for what's left today ---------- */
function RoadTab({ data, setData, targets, day, updateDay, dayId, setDayId }) {
  const today = dayId || dayKey();
  const eaten = day.foods.reduce((a, f) => ({ cal: a.cal + f.calories, p: a.p + f.protein }), { cal: 0, p: 0 });
  const remainCal = targets.calories - eaten.cal, remainP = targets.protein - eaten.p;
  const [slot, setSlot] = useState(guessMeal());
  const [chain, setChain] = useState("");
  const [more, setMore] = useState(false);
  const [portion, setPortion] = useState({});
  const [logged, setLogged] = useState({});
  const [saved, setSaved] = useState({});
  const [ai, setAi] = useState(false);
  const orders = data.orders || [];
  const logToday = (item) => updateDay(today, (d) => ({ ...d, foods: [...d.foods, { id: crypto.randomUUID(), at: stampFor(today), u: Date.now(), ...item }] }));
  const picks = roadPicks(slot, remainCal, remainP, data.profile, chain, more ? 40 : 8);
  const hasMore = !more && roadPicks(slot, remainCal, remainP, data.profile, chain, 40).length > 8;
  return (
    <>
      {setDayId && <DayBar dayId={today} setDayId={setDayId} />}
      <div className="glass pad stack">
        <div className="row"><h2>What's left {today === dayKey() ? "today" : "that day"}</h2><span className="dim tiny">{Math.max(0, Math.round(remainCal)).toLocaleString()} cal · {Math.max(0, Math.round(remainP))}g protein left</span></div>
        <p className="dim small">Stopping for food on the road? These are the best orders for what you have left today. Tap Eat this to log it.</p>
        <div className="chips">{MEALS.map((m) => <button key={m} className={slot === m ? "chip on" : "chip"} onClick={() => { setSlot(m); setMore(false); }}>{m}</button>)}</div>
        <label>Only show one place <span className="dim tiny">(swipe for more)</span></label>
        <div className="chips" style={{ flexWrap: "nowrap", overflowX: "auto", paddingBottom: 6, WebkitOverflowScrolling: "touch" }}>
          <button className={!chain ? "chip on" : "chip"} style={{ flex: "none" }} onClick={() => { setChain(""); setMore(false); }}>All</button>
          {ROAD_CHAINS.map((c) => <button key={c} style={{ flex: "none", whiteSpace: "nowrap" }} className={chain === c ? "chip on" : "chip"} onClick={() => { setChain(chain === c ? "" : c); setMore(false); }}>{c}</button>)}
        </div>
      </div>

      {orders.length > 0 && (
        <div className="glass">
          <div className="mealhead">Your saved orders</div>
          {orders.map((o) => (
            <div key={o.id} className="dish">
              <div className="row gap"><div><div className="dishname">{o.name}</div>{o.where && <div className="dim tiny">{o.where}</div>}</div>
                <span className="mono" style={{ color: C.cal }}>{o.calories}</span></div>
              <span className="dim tiny">{o.protein}p · {o.carbs}c · {o.fat}f</span>
              <div className="rowbtns">
                <button className="btn solid wide" onClick={() => logToday({ meal: slot, name: `${o.name}${o.where ? ` (${o.where})` : ""}`, calories: o.calories, protein: o.protein, carbs: o.carbs, fat: o.fat })}>Eat this</button>
                <button className="btn ghost" aria-label="Remove saved order" onClick={() => setData((d) => ({ ...d, orders: (d.orders || []).filter((x) => x.id !== o.id), deleted: tombstone(d, "order:" + o.id) }))}>Remove</button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="glass">
        <div className="mealhead">Best picks for you</div>
        {picks.length === 0 && <p className="dim small pad">Nothing matches your food rules here. Try a different meal or place, or ask the coach below.</p>}
        {picks.map((m0) => {
          const key = m0.chain + m0.name, f = portion[key] || 1, m = scaleOrder(m0, f);
          return (
            <div key={key} className="dish">
              <div><div className="dishname">{m0.name}</div><div className="dim tiny">{m0.chain}</div></div>
              <div className="dishmacros">
                <span className="mono" style={{ color: C.cal }}>{m.calories}</span>
                <span className="dim tiny">{m.protein}p · {m.carbs}c · {m.fat}f · estimate</span>
              </div>
              <div className="tagrow">{tagsFor({ ...m0, tags: m0.chain }).slice(0, 4).map((t) => <span key={t} className="tagpill">{t}</span>)}</div>
              {m0.tweak && <ul className="tweaks"><li>{m0.tweak}</li></ul>}
              <div className="chips" aria-label="Portion">{PORTIONS.map(([v, l]) => <button key={v} className={f === v ? "chip on" : "chip"} onClick={() => setPortion((x) => ({ ...x, [key]: v }))}>{l}</button>)}</div>
              <div className="rowbtns">
                <button className="btn solid wide" disabled={logged[key]} onClick={() => {
                  logToday({ meal: slot, name: `${m0.name}${f !== 1 ? ` (${PORTIONS.find((p) => p[0] === f)[1]} portion)` : ""} (${m0.chain})`, calories: m.calories, protein: m.protein, carbs: m.carbs, fat: m.fat });
                  setLogged((x) => ({ ...x, [key]: true }));
                }}>{logged[key] ? "Logged ✓" : "Eat this"}</button>
                <button className="btn ghost" disabled={saved[key]} onClick={() => {
                  setData((d) => ({ ...d, orders: [...(d.orders || []), { id: crypto.randomUUID(), name: m0.name, where: m0.chain, calories: m0.calories, protein: m0.protein, carbs: m0.carbs, fat: m0.fat, u: Date.now() }] }));
                  setSaved((x) => ({ ...x, [key]: true }));
                }}>{saved[key] ? "Saved ✓" : "Save"}</button>
              </div>
            </div>);
        })}
        {hasMore && <div className="pad"><button className="btn ghost wide" onClick={() => setMore(true)}>Show more</button></div>}
        <p className="dim tiny pad" style={{ paddingTop: 0 }}>Numbers are estimates from each place's published nutrition. Menus change, so check the app or board if it matters. Allergy info here is a helper, not a guarantee. Always ask the restaurant.</p>
      </div>

      {ai
        ? <EatingOut remainCal={remainCal} remainP={remainP} onLog={logToday} data={data} setData={setData} noSaved />
        : <div className="glass pad stack">
            <h2>Not on the list?</h2>
            <p className="dim small">Type any restaurant, or take a photo of the menu, and the coach will pick the best order.</p>
            <button className="btn accent wide" onClick={() => setAi(true)}>Ask the coach for a custom order</button>
          </div>}
    </>
  );
}

/* ---------- eating out: best orders from a menu photo or a restaurant name ---------- */
const CHAINS = ["Chipotle", "Chick-fil-A", "Subway", "McDonald's", "Starbucks", "Taco Bell", "Wendy's", "Panera", "Whataburger", "Raising Cane's", "Panda Express", "Jimmy John's"];
const PORTIONS = [[0.5, "½"], [0.75, "¾"], [1, "Full"], [1.25, "1¼"]];
// Eating half and saving the rest is the most useful trim there is, so macros scale with the portion.
const scaleOrder = (m, f) => ({ ...m, calories: Math.round(m.calories * f), protein: Math.round(m.protein * f), carbs: Math.round(m.carbs * f), fat: Math.round(m.fat * f) });
function EatingOut({ remainCal, remainP, onLog, data, setData, noSaved }) {
  const orders = data?.orders || [];
  const [portion, setPortion] = useState({});
  const [savedPick, setSavedPick] = useState({});
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
      content.push({ type: "text", text: `Someone ${data?.profile?.age < 18 ? "who is a growing athlete under 18 (no calorie cutting)" : "cutting weight"} is eating out${where.trim() ? ` at ${where.trim()}` : ""}. This is ${slot.toLowerCase()}.
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
        <div className="row"><h2>Custom order</h2><span className="dim tiny">{Math.max(0, remainCal).toLocaleString()} cal · {Math.max(0, Math.round(remainP))}g left</span></div>
        <div className="chips">{MEALS.map((m) => <button key={m} className={slot === m ? "chip on" : "chip"} onClick={() => setSlot(m)}>{m}</button>)}</div>
        <div className="chips">{CHAINS.map((c) => <button key={c} className={where === c ? "chip on" : "chip"} onClick={() => setWhere(where === c ? "" : c)}>{c}</button>)}</div>
        <input placeholder="Or type a place: Texas Roadhouse, the diner" value={where} onChange={(e) => setWhere(e.target.value)} />
        {img ? (
          <div className="row gap"><img src={img} alt="Menu" className="menuthumb" /><button className="btn ghost" onClick={() => setImg(null)}>Remove photo</button></div>
        ) : (
          <label className="dropzone">Photograph the menu (optional)
            <input type="file" accept="image/*" capture="environment" onChange={pick} style={{ display: "none" }} /></label>
        )}
        <button className="btn accent wide" onClick={go} disabled={busy || (!where.trim() && !img)}>{busy ? "Reading the menu…" : "What should I order?"}</button>
        {err && <p className="alert">{err}</p>}
      </div>

      {!noSaved && orders.length > 0 && (
        <div className="glass">
          <div className="mealhead">Saved orders</div>
          {orders.map((o) => (
            <div key={o.id} className="dish">
              <div className="row gap"><div><div className="dishname">{o.name}</div>{o.where && <div className="dim tiny">{o.where}</div>}</div>
                <span className="mono" style={{ color: C.cal }}>{o.calories}</span></div>
              <span className="dim tiny">{o.protein}p · {o.carbs}c · {o.fat}f</span>
              <div className="rowbtns">
                <button className="btn solid wide" onClick={() => onLog({ meal: slot, name: `${o.name}${o.where ? ` (${o.where})` : ""}`, calories: o.calories, protein: o.protein, carbs: o.carbs, fat: o.fat })}>Eat this</button>
                <button className="btn ghost" aria-label="Remove saved order" onClick={() => setData((d) => ({ ...d, orders: (d.orders || []).filter((x) => x.id !== o.id), deleted: tombstone(d, "order:" + o.id) }))}>Remove</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {res && (
        <div className="glass fadein">
          {res.known === false && <p className="cue" style={{ margin: "14px 16px 0", color: C.warn, borderColor: `${C.warn}55` }}>It doesn't know this place's menu well — treat these as ballpark. A menu photo gets you real items.</p>}
          {res.note && <p className="dim tiny pad" style={{ paddingBottom: 0 }}>{res.note}</p>}
          {res.picks.map((m0, i) => {
            const f = portion[i] || 1, m = scaleOrder(m0, f);
            return (
            <div key={i} className="dish">
              <div><div className="dishname">{m0.name}</div><div className="dim tiny">{m0.why}</div></div>
              <div className="dishmacros">
                <span className="mono" style={{ color: C.cal }}>{m.calories}</span>
                <span className="dim tiny">{m.protein}p · {m.carbs}c · {m.fat}f · estimate</span>
              </div>
              <div className="chips" aria-label="Portion">{PORTIONS.map(([v, l]) => <button key={v} className={f === v ? "chip on" : "chip"} onClick={() => setPortion((x) => ({ ...x, [i]: v }))}>{l}</button>)}</div>
              {m0.tweaks?.length > 0 && <ul className="tweaks">{m0.tweaks.map((t, j) => <li key={j}>{t}</li>)}</ul>}
              <div className="rowbtns">
                <button className="btn solid wide" disabled={logged[i]} onClick={() => {
                  onLog({ meal: slot, name: `${m0.name}${f !== 1 ? ` (${PORTIONS.find((p) => p[0] === f)[1]} portion)` : ""}${where.trim() ? ` (${where.trim()})` : ""}`, calories: m.calories,
                    protein: m.protein, carbs: m.carbs, fat: m.fat });
                  setLogged((x) => ({ ...x, [i]: true }));
                }}>{logged[i] ? "Logged ✓" : "Eat this"}</button>
                <button className="btn ghost" disabled={savedPick[i]} onClick={() => {
                  setData((d) => ({ ...d, orders: [...(d.orders || []), { id: crypto.randomUUID(), name: m0.name, where: where.trim(), calories: Math.round(m0.calories), protein: Math.round(m0.protein), carbs: Math.round(m0.carbs), fat: Math.round(m0.fat), u: Date.now() }] }));
                  setSavedPick((x) => ({ ...x, [i]: true }));
                }}>{savedPick[i] ? "Saved ✓" : "Save order"}</button>
              </div>
            </div>);
          })}
          {res.avoid && <p className="cue" style={{ margin: "0 16px 14px" }}>Skip: {res.avoid}</p>}
        </div>
      )}
    </>
  );
}

// Totals come from the dishes themselves, not from anything the model summed.
const weekCost = (w) => (w?.dishes || []).reduce((a, d) => ({ cost: a.cost + Math.max(0, Math.round(+d.costUsd || 0)), minutes: a.minutes + Math.max(0, Math.round(+d.cookMinutes || 0)) }), { cost: 0, minutes: 0 });
/* ---------- week: batch-cook meal prep, one grocery list ---------- */
function WeekPlan({ data, setData, onLog, onOpenList }) {
  const week = data.week;
  const base = computeTargets(data.profile, []);
  const fasts = (data.fasts || []).length >= 3;
  const [ifMode, setIfMode] = useState(fasts);
  const [prefs, setPrefs] = useState("");
  const [budget, setBudget] = useState("");            // weekly grocery budget, dollars
  const [maxCook, setMaxCook] = useState(0);           // longest the person will cook in one go, minutes (0 = no limit)
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
      const p = await askClaude([{ type: "text", text: `Plan 7 days of meal prep for someone ${data.profile?.age < 18 ? "who is a growing athlete under 18 (no calorie cutting, plenty of fuel)" : "cutting weight"}, around a small set of batch-cooked dishes that repeat through the week — they cook twice and eat all week. Repetition is good here.

Every day should land within 100 calories of ${base.calories} and reach at least ${base.protein}g protein.
${ifMode ? "They do intermittent fasting: plan 2 meals plus 1 snack a day inside an eating window — no breakfast." : "Plan breakfast, lunch, dinner and one snack each day."}
${prefs.trim() ? `Their preferences: ${prefs.trim()}.` : ""}
${+budget > 0 ? `Grocery budget: about $${Math.round(+budget)} for the whole week. Choose cheap staples and keep the total ingredient cost at or under that.` : ""}
${maxCook > 0 ? `No single dish may take more than ${maxCook} minutes of hands-on cooking.` : ""}
${likes.length ? `Foods they already eat: ${likes.join(", ")}.` : ""}
Use 4 to 7 distinct dishes. Ingredient amounts are for the WHOLE batch, as you'd buy them. Keep steps to at most 4 short lines. Count cooking oil in the macros.

Respond with ONLY JSON:
{"dishes":[{"id":"d1","name":"...","servingsMade":number,"cookMinutes":number,"costUsd":number,"perServing":{"calories":number,"protein":number,"carbs":number,"fat":number},"ingredients":["amount + item"],"steps":["short step"]}],
"days":[{"meals":[{"slot":"Breakfast"|"Lunch"|"Dinner"|"Snack","dish":"d1"}]}],
"prepDay":"one line on what to cook when",
"note":"one line"}
Exactly 7 entries in days.` }], 7000);
      if (!p.dishes?.length || !p.days?.length) throw new Error("The plan came back incomplete. Try again.");
      setData((d) => ({ ...d, week: { start: dayKey(), budget: +budget > 0 ? Math.round(+budget) : null, dishes: p.dishes, days: p.days.slice(0, 7), prepDay: p.prepDay, note: p.note, u: Date.now() } }));
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
        <div className="grid2">
          <div><label>Grocery budget ($/week)</label><input type="number" inputMode="numeric" placeholder="No limit" value={budget} onChange={(e) => setBudget(e.target.value)} /></div>
          <div><label>Longest cook</label><div className="chips">{[[0, "Any"], [30, "30m"], [45, "45m"], [60, "60m"]].map(([v, l]) => <button key={v} className={maxCook === v ? "chip on" : "chip"} onClick={() => setMaxCook(v)}>{l}</button>)}</div></div>
        </div>
        <button className={ifMode ? "listbtn on" : "listbtn"} onClick={() => setIfMode(!ifMode)}>{ifMode ? "✓ " : ""}I fast — 2 meals + a snack, no breakfast</button>
        <button className="btn accent wide" onClick={build} disabled={busy}>{busy ? "Planning the week — about 20 seconds…" : week ? "Plan a new week" : "Plan my week"}</button>
        {err && <p className="alert">{err}</p>}
      </div>

      {week && (
        <>
          {since > 7 && <p className="cue" style={{ marginBottom: 12 }}>This plan is from {prettyDay(week.start)}. Plan a new week when you're ready.</p>}
          {week.prepDay && <div className="glass pad"><p className="small"><strong>Prep:</strong> {week.prepDay}</p>{week.note && <p className="dim tiny" style={{ marginTop: 6 }}>{week.note}</p>}
            {(() => { const t = weekCost(week); return (t.cost > 0 || t.minutes > 0) && (
              <p className="dim tiny" style={{ marginTop: 6 }}>
                {t.cost > 0 && <>Groceries about ${t.cost}{week.budget ? <span style={{ color: t.cost > week.budget * 1.1 ? C.warn : undefined }}> of your ${week.budget}{t.cost > week.budget * 1.1 ? " (over, an estimate)" : ""}</span> : ""}. </>}
                {t.minutes > 0 && <>About {t.minutes} min of cooking in all.</>}
              </p>); })()}
          </div>}

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
                <div className="row gap"><div className="dishname">{x.name}</div><span className="dim tiny">makes {x.servingsMade}{+x.cookMinutes > 0 ? ` · ${Math.round(x.cookMinutes)} min` : ""}{+x.costUsd > 0 ? ` · ~$${Math.round(x.costUsd)}` : ""}</span></div>
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
    try { await groupsApi({ op: "ping" }); onOk(); }
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
  const gaining = goal > start;                       // a bulk: the goal is above the starting weight
  const lost = gaining ? latest - start : start - latest;
  const shown = useCountUp(latest);
  const toGo = gaining ? goal - latest : latest - goal;
  const pace = gaining ? -targets.actualPace : targets.actualPace;
  const wks = pace > 0 && toGo > 0 ? Math.ceil(toGo / pace) : null;
  const eta = wks ? new Date(Date.now() + wks * 7 * 864e5).toLocaleDateString(undefined, { month: "long", year: "numeric" }) : null;

  return (
    <>
      <div className="glass hero">
        <Ring pct={start !== goal ? Math.max(0, lost) / Math.abs(start - goal) : 0} color={C.protein} size={220}>
          <div className="huge">{shown.toFixed(1)}<span className="unit">lb</span></div>
          <div className="dim tiny">{lost > 0 ? `${lost.toFixed(1)} ${gaining ? "up" : "down"}` : "no change yet"}</div>
          <div className="dim tiny">{Math.max(0, toGo).toFixed(1)} to go</div>
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

      <ChallengePanel data={data} setData={setData} />
      <StrengthPanel data={data} />

      {eta && <div className="glass pad"><p className="small">At {Math.abs(targets.actualPace).toFixed(1)} lb a week you reach {goal} around <strong>{eta}</strong>. After three weeks of real data, check that against what the scale actually did — the formula runs about 10% off either way.</p></div>}
    </>
  );
}

/* ---------- us ---------- */
/* ---------- log tab: your history, plus the group view ---------- */
function LogTab({ data, setData, onPick }) {
  const [view, setView] = useState("mine");
  return (
    <>
      <div className="chips">
        <button className={view === "mine" ? "chip on" : "chip"} onClick={() => setView("mine")}>My history</button>
        <button className={view === "group" ? "chip on" : "chip"} onClick={() => setView("group")}>{H("Crew", "Friends")}</button>
      </div>
      {view === "mine" ? <><History data={data} onPick={onPick} />{fastingEnabled(data) && <PastFasts data={data} setData={setData} />}</> : <GroupsView data={data} setData={setData} />}
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
    p.age < 18
      ? `Person: ${p.sex}, ${p.age} (UNDER 18), ${Math.floor(p.heightIn / 12)}'${p.heightIn % 12}", ${p.weight} lb. IMPORTANT: this is a young athlete. Never suggest cutting calories, fasting, skipping meals or losing weight. Talk about fueling growth and sports, sleep, water and real food. For any weight question, tell them to talk with a parent, a doctor and their coach. Use short, simple words.`
      : `Person: ${p.sex}, ${p.age}, ${Math.floor(p.heightIn / 12)}'${p.heightIn % 12}", started ${p.weight} lb, goal ${p.goalWeight} lb, ${goalPhrase(p)}.`,
    lifestyleNote(p),
    avoidNote(p),
    `Today's budget: ${targets.calories} cal, ${targets.protein}g protein (${targets.carbs}g carbs, ${targets.fat}g fat).${targets.earned ? ` Includes ${targets.earned} earned from activity.` : ""}`,
    adaptive?.ready ? `Measured maintenance from their own data: ${adaptive.tdee} cal (formula said ${adaptive.formula}); trending ${adaptive.lbPerWeek} lb/week.` : `Maintenance is still a formula estimate.`,
    `Eaten today: ${Math.round(t.c)} cal, ${Math.round(t.p)}g protein — ${Math.round(targets.calories - t.c)} cal and ${Math.max(0, Math.round(targets.protein - t.p))}g protein left.`,
    d.foods.length ? `Today's food: ${d.foods.map((f) => `${f.name} (${f.calories} cal, ${Math.round(f.protein)}p${f.at ? ", " + prettyTime(f.at) : ""})`).join("; ")}.` : "Nothing logged yet today.",
    fastH ? `Currently fasting: ${fastH} hours in.` : fastingEnabled(data) ? "Not fasting right now." : "They don't use fasting. Don't suggest it.",
    (() => {
      const tiers = Object.values(d.grades || {}).map((g) => TIER_INFO[g.tier]?.label).filter(Boolean);
      const sc = dayScore(d, targets, { ...p, recovering: !!data.recovery?.on });
      const missing = sc.parts.filter((x) => !x.done && x.key !== "checkin").map((x) => x.label.toLowerCase());
      return `Meal tiers rated today: ${tiers.length ? tiers.join(", ") : "none yet"}. Habit score so far ${sc.total}/100${missing.length ? `; still open: ${missing.join(", ")}` : ""}.`;
    })(),
    data.recovery?.on ? "RECOVERY MODE is on (injury or recovery). Keep advice gentle, protein high, no pushing training or fasting." : d.rest ? "Today is logged as a rest day." : "",
    (() => { const st = strengthSummary(data.days, shiftDay(today, -42)).slice(0, 4); return st.length ? `Strength (est. 1RM, last 6 weeks): ${st.map((x) => `${x.name} ${x.last} lb${x.change != null ? ` (${x.change >= 0 ? "+" : ""}${x.change}%)` : ""}`).join("; ")}.` : ""; })(),
    `Water today: ${+d.water || 0} of ${p.waterOz || 100} oz. ${d.tags?.length ? `Activity today: ${d.tags.map((x) => TAGS[x]?.label).join(", ")}.` : ""}`,
    `Previous 7 days:\n${week.join("\n")}`,
    (data.recipes || []).length ? `Their saved recipes: ${data.recipes.map((r) => r.name).join(", ")}.` : "",
    (data.favorites || []).length ? `Foods they eat often: ${data.favorites.slice(0, 12).map((f) => f.name).join(", ")}.` : "",
    `Current time: ${new Date().toLocaleString([], { weekday: "long", hour: "numeric", minute: "2-digit" })}.`,
  ].filter(Boolean).join("\n");
}

const COACH_RULES = `You are the diet coach inside this person's food-logging app. Talk like a good coach and a good nutritionist: warm, plain words, no jargon, no sports slang. Never shame anyone. A bad day is just a bad day, and the next meal is what matters. You can see their numbers below — use them. Answer like a sharp, practical coach texting back: short, specific, grounded in their actual remaining calories and protein. Name real foods and portions. No lectures, no generic advice they could get anywhere.

Hard lines:
- You are not a doctor. Don't diagnose, interpret symptoms, or advise on medications or medical conditions — tell them to ask their doctor.
- Never suggest eating below their budget floor, skipping meals to "make up" for a big day, or anything extreme. If they overshot, the answer is to get back on plan at the next meal.
- If they describe feeling faint, dizzy, or unwell while fasting, tell them to break the fast and eat. If anything suggests an unhealthy relationship with food, encourage them kindly to talk to a professional.
- If you don't know something about their data, say so rather than inventing it.
- Meal tiers: Tier 1 whole foods, Tier 2 mixed, Tier 3 processed, Off-plan outside budget. Tiers describe a whole meal and its portion, never a single food, so never call any food bad or forbidden. When asked how to make a meal Tier 1, suggest swaps and portion tweaks that keep it satisfying, not eating less overall.
- The score rewards habits only (logging, calorie range, protein, veggies, movement or recovery, water). Never suggest eating less or fasting longer to raise it.
- In recovery mode, or on a rest day, support rest and protein. Don't push training.`;

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

  const quick = ["How's my day going?", "What should I eat tonight?", "How do I make this Tier 1?", "What should I eat next?", "I'm at a gas station — what do I grab?", "How's my week going?", "I'm starving and have 400 cal left", "I blew my budget today. Now what?"];

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
      <div className="row"><h2>How many calories you really burn</h2>
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

const ALERT_KEYS = [
  ["team", "Game start and final score for my team", "Uses the team you picked under Look."],
  ["spc", "South Plains Texans game start", "Fires when a posted game time arrives."],
  ["fastCheck", "My fast check-in", "At 24h, then every 12h while you're fasting."],
  ["nudges", "Nudges from friends", "When someone taps Check on them or Cheer."],
  ["water", "Water reminders", "11:00 and 16:00, your time."],
  ["review", "Weekly film session", "Sunday at 6 PM."],
];
const loadAlertPrefs = () => { try { return JSON.parse(localStorage.getItem("cutlog:alertprefs")) || {}; } catch { return {}; } };
// Tells the server which alerts this device wants. Group logins are sent only so the server
// can confirm you're really that member before it will push you that group's nudges.
const syncAlerts = (prefs, data) => pushApi({
  op: "alerts", deviceId: deviceId(), tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
  alerts: { ...prefs, team: prefs.team ? (data.team || "Lakers") : null },
  links: (data.groups || []).filter((g) => !g.lost).map((g) => ({ groupId: g.id, memberId: g.memberId, token: g.token })),
});

function AlertsPanel({ data, setData }) {
  const supported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  const [on, setOn] = useState(localStorage.getItem("cutlog:alerts") === "1");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [prefs, setPrefs] = useState(loadAlertPrefs);
  const groupSig = (data.groups || []).filter((g) => !g.lost).map((g) => g.id).join();
  const pushPrefs = (next) => {
    setPrefs(next);
    try { localStorage.setItem("cutlog:alertprefs", JSON.stringify(next)); } catch { /* fine */ }
    return syncAlerts(next, data).catch((e) => setMsg(String(e.message || e)));
  };
  // Joining a group, or changing the team, has to reach the server too.
  useEffect(() => { if (on) syncAlerts(loadAlertPrefs(), data).catch(() => {}); }, [on, groupSig, data.team]);
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
      syncAlerts(loadAlertPrefs(), data).catch(() => {});
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
            <div className="subpanel stack" style={{ marginTop: 4 }}>
              {ALERT_KEYS.map(([k, label, hint]) => (
                <button key={k} className={prefs[k] ? "listbtn on" : "listbtn"} onClick={() => pushPrefs({ ...prefs, [k]: !prefs[k] })}>
                  {prefs[k] ? "✓ " : ""}{label}<span className="dim tiny" style={{ display: "block" }}>{hint}</span>
                </button>))}
              {prefs.team && (
                <select value={data.team || "Lakers"} onChange={(e) => setData((d) => ({ ...d, team: e.target.value }))} className="teampick" aria-label="My team">
                  {NBA_TEAMS.map(([name]) => <option key={name} value={name}>{name}</option>)}
                </select>)}
              <p className="dim tiny">Friends' fasts never send you alerts. Checked every 10 minutes, so a game-start alert can land a few minutes late.</p>
            </div>
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

function FastingPanel({ data, setData }) {
  const on = fastingEnabled(data);
  const gate = fastGate(data.profile);
  const [ack, setAck] = useState(false);
  const [open, setOpen] = useState(false);
  return (
    <div className="glass pad stack" id="fasting-panel">
      <div className="row">
        <h2 style={{ margin: 0 }}>Fasting tracker</h2>
        <button className={on ? "chip on" : "chip"} onClick={() => {
          if (on) setData((d) => ({ ...d, fastingOn: false, fast: null }));
          else setOpen(!open);
        }}>{on ? "On" : "Off"}</button>
      </div>
      <p className="small">Planning to fast? Press <strong>Off</strong> to turn it on. Then go back to Today and press Start fasting.</p>
      <p className="dim tiny">Optional. It only tracks the clock and what your body is doing. It never earns points, and a longer fast scores the same as a shorter one.</p>
      {!on && open && (gate.ok ? (
        <>
          <p className="tiny">Before you start: skip fasting if you are pregnant or nursing, have a history of disordered eating, take diabetes or blood-pressure medication, or have any condition where skipping meals is risky, unless your doctor says it's fine. Stop if you feel dizzy, faint, or unwell. Eating on a regular schedule is always a valid choice.</p>
          <label className="row small" style={{ gap: 8, justifyContent: "flex-start" }}>
            <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} /> I've read this and fasting is okay for me
          </label>
          <button className="btn solid wide" disabled={!ack} onClick={() => { setData((d) => ({ ...d, fastingOn: true, fastAck: Date.now() })); setOpen(false); setAck(false); }}>Turn on fasting tracker</button>
        </>
      ) : <p className="alert">{gate.reason}</p>)}
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
          {[["pro", "Pro"], ["court", "Hardwood"], ["modern", "Modern"], ["arena", "Scoreboard"], ["glass", "Glass"]].map(([k, l]) => (
            <button key={k} className={(data.theme === "retro" ? "court" : data.theme || "pro") === k ? "chip on" : "chip"} onClick={() => setData((d) => ({ ...d, theme: k }))}>{l}</button>))}
        </div>
        <p className="dim tiny">Switches the whole app. Nothing about your data changes.</p>
        {THEME === "arena" && (
          <>
            <label style={{ marginTop: 4 }}>Team colors</label>
            <select value={data.team || "Lakers"} onChange={(e) => setData((d) => ({ ...d, team: e.target.value }))} className="teampick">
              {NBA_TEAMS.map(([name]) => <option key={name} value={name}>{name}</option>)}
            </select>
          </>
        )}
      </div>
      <AdaptivePanel adaptive={adaptive} on={data.useAdaptive !== false} onToggle={(v) => setData((d) => ({ ...d, useAdaptive: v }))} />
      <SyncPanel {...{ sync, syncNow, startSync, joinSync, leaveSync }} />
      <InstallPanel />
      <FastingPanel data={data} setData={setData} />
      <AlertsPanel data={data} setData={setData} />
      <div className="glass pad">
        <div className="row"><span className="dim">Maintenance {useAdaptive ? "(measured)" : "(formula)"}</span><strong className="mono">{t.tdee.toLocaleString()}</strong></div>
        <div className="row"><span className="dim">Rest-day budget</span><strong className="mono">{t.base.toLocaleString()}</strong></div>
        <div className="row"><span className="dim">Rest-day protein</span><strong className="mono">{t.protein}g</strong></div>
        {t.clamped && <p className="alert">Budget is held at the floor. Add movement instead of cutting lower.</p>}
      </div>
      <ProfileForm initial={data.profile} title="Your profile" cta="Save" onSave={onSave} />
      <div className="glass pad stack">
        <h2>Backup</h2>
        <p className="dim tiny">This lives in one browser. Copy it somewhere safe now and again.</p>
        <button className="btn ghost wide" onClick={() => { navigator.clipboard.writeText(backupJson(data)); setCopied(true); }}>{copied ? "Copied" : "Copy my whole log"}</button>
        <p className="dim tiny">Group logins stay out of backups, so a pasted backup can't be used to act as you in a group.</p>
        <input placeholder="Paste a backup to restore" value={paste} onChange={(e) => setPaste(e.target.value)} />
        <button className="btn ghost wide" disabled={!paste.trim()} onClick={() => {
          try { const d = JSON.parse(paste); if (!d.profile || !d.days) throw new Error();
            setData((cur) => ({ favorites: [], fasts: [], calib: [], list: [], labs: [], menus: {}, fast: null, ...d, groups: cur.groups || [] }));
            setMsg("Restored."); setPaste(""); }
          catch { setMsg("That isn't a valid backup."); }
        }}>Restore</button>
        {msg && <p className="dim tiny">{msg}</p>}
      </div>
      <Importer setData={setData} />
    </>
  );
}

const BLANK_PROFILE = { name: "", sex: "male", age: "", heightIn: 69, weight: "", goalWeight: "", activity: "light", pace: 1, goal: "lose",
  health: [], allergies: [], allergyOther: "", diet: "", dislikes: "", meals: 3, cooking: "", budget: "", workouts: "", sleep: "", waterOz: 100, waterCustom: false, calAdjust: 0, proteinAdjust: 0 };
// A daily water goal that fits the person: about half an ounce per pound of body weight, plus extra
// for an active job, for workouts, and for pregnancy or nursing. General guidance, not medical advice.
function waterPlan(p) {
  const w = +p.weight >= 80 && +p.weight <= 600 ? +p.weight : 170;
  const parts = [{ label: `Your size (${Math.round(w)} lb)`, oz: w * 0.5 }];
  const act = { sedentary: 0, light: 6, moderate: 12, high: 20 }[p.activity] || 0;
  if (act) parts.push({ label: "Active job or days", oz: act });
  const wk = p.workouts === "" || p.workouts == null ? 0 : Math.min(7, Math.max(0, +p.workouts || 0));
  if (wk) parts.push({ label: `Workouts (${wk} a week)`, oz: (wk * 16) / 7 });
  const h = p.health || [];
  if (h.includes("pregnant")) parts.push({ label: "Pregnant or nursing", oz: 16 });
  const raw = parts.reduce((a, x) => a + x.oz, 0);
  const oz = Math.min(160, Math.max(48, Math.round(raw / 4) * 4));
  const note = h.includes("heart") || h.includes("other")
    ? "Your doctor may have given you a limit on fluids. If so, follow your doctor's number instead of this one."
    : h.includes("sugar") ? "Water is a good choice with blood sugar worries. Pick it over sweet drinks." : "";
  return { oz, cups: Math.round((oz / 8) * 10) / 10, parts: parts.map((x) => ({ label: x.label, oz: Math.round(x.oz) })), note };
}
const goalOf = (p) => p.goal || (+p.goalWeight > +p.weight ? "gain" : +p.goalWeight === +p.weight ? "maintain" : "lose");
const goalPhrase = (p) => (goalOf(p) === "gain" ? `gaining ~${Math.abs(p.pace || 0.5)} lb/week` : goalOf(p) === "maintain" ? "keeping their weight steady" : `losing ~${p.pace} lb/week`);
const HEALTH = { pregnant: "Pregnant or nursing", sugar: "Diabetes or blood sugar", heart: "Heart or blood pressure", other: "Something else my doctor watches" };
const COOKING = { none: "I don't cook", basic: "Simple stuff", good: "I cook well" };
const BUDGET = { tight: "Tight", ok: "Normal", free: "Flexible" };
const SLEEP = { under6: "Under 6 hours", s6: "6 to 7 hours", s7: "7 to 8 hours", s8: "8 or more hours" };
const lifestyleNote = (p) => {
  const bits = [];
  if (p.workouts !== "" && p.workouts != null) bits.push(`works out ${p.workouts} day${+p.workouts === 1 ? "" : "s"} a week`);
  if (p.sleep) bits.push(`sleeps ${SLEEP[p.sleep] || p.sleep + " hours"} a night`);
  if (p.meals) bits.push(`prefers ${p.meals} meals a day`);
  if (p.cooking) bits.push(`cooking: ${COOKING[p.cooking]}`);
  if (p.budget) bits.push(`food budget: ${BUDGET[p.budget]}`);
  const h = (p.health || []).length ? " They have told us a doctor watches something (pregnancy, blood sugar, heart or similar). Keep advice gentle and tell them to follow their doctor." : "";
  return bits.length || h ? `About their life: ${bits.join(", ")}.${h}` : "";
};

function ProfileForm({ initial, title, cta, intro, onSave, wizard }) {
  const [p, setP] = useState(() => ({ ...BLANK_PROFILE, ...initial, waterCustom: initial?.waterCustom ?? (!wizard && initial?.waterOz != null) }));
  const [step, setStep] = useState(0);
  const set = (k, v) => setP((x) => ({ ...x, [k]: v }));
  const toggle = (k, v) => setP((x) => ({ ...x, [k]: (x[k] || []).includes(v) ? x[k].filter((y) => y !== v) : [...(x[k] || []), v] }));
  const goal = goalOf(p);
  const wp = waterPlan(p);
  const waterNow = p.waterCustom ? (+p.waterOz || wp.oz) : wp.oz;
  const setGoal = (g) => setP((x) => ({ ...x, goal: g, pace: g === "maintain" ? 0 : g === "gain" ? -0.5 : (x.pace > 0 ? x.pace : 1) }));
  const ageOk = +p.age >= 13 && +p.age <= 100;
  const bodyOk = +p.weight >= 80 && +p.weight <= 600 && +p.heightIn >= 48 && +p.heightIn <= 90;
  const goalOk = goal === "maintain" || (+p.goalWeight >= 80 && +p.goalWeight <= 600);
  const numsOk = ageOk && bodyOk && goalOk;
  const eff = { ...p, goalWeight: goal === "maintain" ? p.weight : p.goalWeight };
  const pv = computeTargets({ ...eff, weight: numsOk ? +eff.weight : 180, goalWeight: numsOk ? +eff.goalWeight : 160, age: numsOk ? +p.age : 30, heightIn: +p.heightIn || 69 }, []);
  const rec = computeTargets({ ...eff, weight: numsOk ? +eff.weight : 180, goalWeight: numsOk ? +eff.goalWeight : 160, age: numsOk ? +p.age : 30, heightIn: +p.heightIn || 69, calAdjust: 0, proteinAdjust: 0 }, []);
  const ft = Math.floor(p.heightIn / 12), inch = p.heightIn % 12;
  const bump = (k, d) => setP((x) => ({ ...x, [k]: (+x[k] || 0) + d }));
  const adjusted = !pv.minor && (+p.calAdjust || +p.proteinAdjust);
  const targetsBox = numsOk ? (
    <div className="stack">
      <div className="quad">
        <div className="center">
          <div className="row gap" style={{ justifyContent: "center" }}>
            {!pv.minor && <button className="btn ghost" aria-label="Fewer calories" onClick={() => bump("calAdjust", -50)}>−</button>}
            <div><div className="midnum" style={{ color: C.cal }}>{pv.base.toLocaleString()}</div><div className="dim tiny">calories a day</div></div>
            {!pv.minor && <button className="btn ghost" aria-label="More calories" onClick={() => bump("calAdjust", 50)}>+</button>}
          </div>
        </div>
        <div className="center">
          <div className="row gap" style={{ justifyContent: "center" }}>
            {!pv.minor && <button className="btn ghost" aria-label="Less protein" onClick={() => bump("proteinAdjust", -5)}>−</button>}
            <div><div className="midnum" style={{ color: C.protein }}>{pv.protein}g</div><div className="dim tiny">protein a day</div></div>
            {!pv.minor && <button className="btn ghost" aria-label="More protein" onClick={() => bump("proteinAdjust", 5)}>+</button>}
          </div>
        </div>
      </div>
      {!pv.minor && (adjusted
        ? <button className="chip" onClick={() => setP((x) => ({ ...x, calAdjust: 0, proteinAdjust: 0 }))}>Use the recommended {rec.base.toLocaleString()} cal and {rec.protein}g</button>
        : <p className="dim tiny center">Our best recommendation. Tap − or + to change it to fit you.</p>)}
      {!pv.minor && pv.base < pv.floor && <p className="alert">That's below the usual minimum of {pv.floor.toLocaleString()} calories. Going this low for long can cost you muscle and energy. Only do it if your doctor says so.</p>}
      {!pv.minor && pv.base > rec.base + 300 && goal === "lose" && <p className="dim tiny center">That's well above the recommendation, so you'll lose weight slower than planned.</p>}
    </div>
  ) : null;
  const save = () => onSave({ ...p, goal, age: +p.age, heightIn: +p.heightIn, weight: +p.weight, goalWeight: goal === "maintain" ? +p.weight : +p.goalWeight,
    waterOz: Math.max(16, Math.min(300, waterNow)), waterCustom: !!p.waterCustom, calAdjust: pv.minor ? 0 : Math.round(+p.calAdjust || 0), proteinAdjust: pv.minor ? 0 : Math.round(+p.proteinAdjust || 0), meals: +p.meals || 3, workouts: p.workouts === "" ? "" : +p.workouts });
  const q = (text, hint) => <div><label>{text}</label>{hint && <p className="dim tiny" style={{ margin: "2px 0 6px" }}>{hint}</p>}</div>;
  const pick = (map, k) => <div className="chips">{Object.entries(map).map(([v, l]) => (
    <button key={v} className={String(p[k]) === v ? "chip on" : "chip"} onClick={() => set(k, String(p[k]) === v ? "" : v)}>{l}</button>))}</div>;

  const S = {
    you: { title: "About you", need: () => ageOk, body: (
      <>
        <div><label>What should we call you?</label><input placeholder="First name is fine" value={p.name || ""} onChange={(e) => set("name", e.target.value)} /></div>
        {q("Are you male or female?", "Your body burns calories a little differently, so this sets your starting number.")}
        <div className="chips">{["male", "female"].map((x) => (
          <button key={x} className={p.sex === x ? "chip on" : "chip"} onClick={() => set("sex", x)}>{x === "male" ? "Male" : "Female"}</button>))}</div>
        <div><label>How old are you?</label><input type="number" inputMode="numeric" value={p.age} onChange={(e) => set("age", e.target.value)} /></div>
        {p.age !== "" && !ageOk && <p className="alert">Enter an age from 13 to 100.</p>}
      </>) },
    body: { title: "Your body", need: () => bodyOk, body: (
      <>
        <div><label>How tall are you?</label><div className="row gap">
          <input aria-label="Feet" type="number" inputMode="numeric" value={ft} onChange={(e) => set("heightIn", (+e.target.value) * 12 + inch)} /><span className="dim">ft</span>
          <input aria-label="Inches" type="number" inputMode="numeric" value={inch} onChange={(e) => set("heightIn", ft * 12 + (+e.target.value))} /><span className="dim">in</span></div></div>
        <div><label>What do you weigh right now? (lb)</label><input type="number" inputMode="decimal" value={p.weight} onChange={(e) => set("weight", e.target.value)} /></div>
        {p.weight !== "" && !bodyOk && <p className="alert">Check your height and weight. Weight should be 80 to 600 lb.</p>}
      </>) },
    goal: { title: "Your goal", need: () => goalOk, body: (
      <>
        {q("What do you want to do?")}
        <div className="stack">{[["lose", "Lose weight"], ["maintain", "Stay where I am"], ["gain", "Gain weight or build muscle"]].map(([k, l]) => (
          <button key={k} className={goal === k ? "listbtn on" : "listbtn"} onClick={() => setGoal(k)}>{l}</button>))}</div>
        {goal !== "maintain" && <div><label>What weight do you want to reach? (lb)</label>
          <input type="number" inputMode="decimal" value={p.goalWeight} onChange={(e) => set("goalWeight", e.target.value)} /></div>}
        {numsOk && pv.minor ? (
          <p className="cue">You're under 18, so we don't set a calorie cut. Your numbers are the fuel your body needs to grow. If you want to change your weight, talk with a parent, a doctor and your coach first.</p>
        ) : goal !== "maintain" && (
          <>
            {q(goal === "gain" ? "How fast?" : "How fast do you want to lose?", "Slower is easier to stick with. Most people do well at 1 lb a week.")}
            <div className="chips">{(goal === "gain" ? [0.5, 1] : [0.5, 1, 1.5, 2]).map((v) => {
              const val = goal === "gain" ? -v : v;
              return <button key={v} className={p.pace === val ? "chip on" : "chip"} onClick={() => set("pace", val)}>{v} lb a week</button>; })}</div>
          </>)}
      </>) },
    health: { title: "Your health", skip: true, body: (
      <>
        {q("Does a doctor watch anything for you?", "Pick any that fit. This only makes the advice gentler and reminds you to follow your doctor. Skip it if none.")}
        <div className="stack">
          <button className={p.healthNone && !(p.health || []).length ? "listbtn on" : "listbtn"} onClick={() => setP((x) => ({ ...x, health: [], healthNone: true }))}>{p.healthNone && !(p.health || []).length ? "✓ " : ""}None of these</button>
          {Object.entries(HEALTH).map(([k, l]) => (
            <button key={k} className={(p.health || []).includes(k) ? "listbtn on" : "listbtn"} onClick={() => setP((x) => ({ ...x, healthNone: false, health: (x.health || []).includes(k) ? x.health.filter((y) => y !== k) : [...(x.health || []), k] }))}>{(p.health || []).includes(k) ? "✓ " : ""}{l}</button>))}</div>
        {(p.health || []).length > 0 && <p className="cue">Please check this plan with your doctor before you start. We give general guidance, not medical advice.</p>}
      </>) },
    allergy: { title: "Allergies", skip: true, body: (
      <>
        {q("Are you allergic to any foods?", "Tap all that apply. Meal ideas and the coach will stay away from them.")}
        <div className="chips">
          <button className={p.allergyNone && !(p.allergies || []).length && !(p.allergyOther || "").trim() ? "chip on" : "chip"} onClick={() => setP((x) => ({ ...x, allergies: [], allergyOther: "", allergyNone: true }))}>None</button>
          {Object.entries(ALLERGENS).map(([k, a]) => (
            <button key={k} className={(p.allergies || []).includes(k) ? "chip on" : "chip"} onClick={() => setP((x) => ({ ...x, allergyNone: false, allergies: (x.allergies || []).includes(k) ? x.allergies.filter((y) => y !== k) : [...(x.allergies || []), k] }))}>{a.label}</button>))}</div>
        <div><label>Anything else?</label><input placeholder="Like mustard, corn, kiwi" value={p.allergyOther || ""} onChange={(e) => setP((x) => ({ ...x, allergyOther: e.target.value, allergyNone: e.target.value.trim() ? false : x.allergyNone }))} /></div>
        <p className="dim tiny">Always read the label. This is a helper, not a safety guarantee.</p>
      </>) },
    eating: { title: "How you eat", skip: true, body: (
      <>
        {q("Do you follow a special way of eating?")}
        <div className="chips">
          <button className={p.diet === "none" ? "chip on" : "chip"} onClick={() => set("diet", p.diet === "none" ? "" : "none")}>None, I eat everything</button>
          {Object.entries(DIETS).map(([k, d]) => (
            <button key={k} className={p.diet === k ? "chip on" : "chip"} onClick={() => set("diet", p.diet === k ? "" : k)}>{d.label}</button>))}</div>
        <div><label>Foods you won't eat</label>
          <div className="chips" style={{ marginBottom: 6 }}><button className={p.dislikesNone && !(p.dislikes || "").trim() ? "chip on" : "chip"} onClick={() => setP((x) => ({ ...x, dislikes: "", dislikesNone: true }))}>None</button></div>
          <input placeholder="Like mushrooms, liver, olives" value={p.dislikes || ""} onChange={(e) => setP((x) => ({ ...x, dislikes: e.target.value, dislikesNone: e.target.value.trim() ? false : x.dislikesNone }))} /></div>
        {q("How many meals do you like to eat a day?")}
        <div className="chips">{[2, 3, 4, 5].map((n) => <button key={n} className={+p.meals === n ? "chip on" : "chip"} onClick={() => set("meals", n)}>{n}</button>)}</div>
        {q("How's your cooking?")}
        {pick(COOKING, "cooking")}
        {q("What's your food budget?")}
        {pick(BUDGET, "budget")}
      </>) },
    days: { title: "Your days", skip: true, body: (
      <>
        {q("How do your days usually go?")}
        <div className="stack">{Object.entries(ACTIVITY).map(([k, v]) => (
          <button key={k} className={p.activity === k ? "listbtn on" : "listbtn"} onClick={() => set("activity", k)}>{v.label}</button>))}</div>
        {q("How many days a week do you work out?")}
        <div className="chips">{[0, 1, 2, 3, 4, 5, 6, 7].map((n) => <button key={n} className={p.workouts !== "" && +p.workouts === n && p.workouts != null ? "chip on" : "chip"} onClick={() => set("workouts", n)}>{n}</button>)}</div>
        {q("How much do you sleep a night?")}
        {pick(SLEEP, "sleep")}
        <div className="stack water-plan">
          <label>Your daily water goal</label>
          <div className="row gap" style={{ justifyContent: "center", alignItems: "center" }}>
            <button className="btn ghost" aria-label="Less water" onClick={() => setP((x) => ({ ...x, waterCustom: true, waterOz: Math.max(32, waterNow - 4) }))}>−</button>
            <div className="center"><div className="midnum" style={{ color: C.water }}>{waterNow} oz</div><div className="dim tiny">about {Math.round((waterNow / 8) * 10) / 10} cups</div></div>
            <button className="btn ghost" aria-label="More water" onClick={() => setP((x) => ({ ...x, waterCustom: true, waterOz: Math.min(200, waterNow + 4) }))}>+</button>
          </div>
          <div className="row gap" style={{ justifyContent: "center", alignItems: "center" }}><span className="dim small">Or type your own</span>
            <input aria-label="Water goal in ounces" type="number" inputMode="numeric" style={{ width: 90 }} value={p.waterCustom ? p.waterOz : ""} placeholder={String(wp.oz)}
              onChange={(e) => setP((x) => ({ ...x, waterCustom: e.target.value !== "", waterOz: e.target.value }))} /><span className="dim small">oz</span></div>
          {p.waterCustom
            ? <button className="chip" onClick={() => set("waterCustom", false)}>Use the recommended {wp.oz} oz</button>
            : <p className="dim tiny center">Recommended for you. Tap − or + to change it.</p>}
          <div className="cue">
            <strong>How we figured it out</strong>
            {wp.parts.map((x, i) => <div key={i} className="row small"><span>{x.label}</span><span className="mono">{i ? "+" : ""}{x.oz} oz</span></div>)}
            <div className="dim tiny" style={{ marginTop: 4 }}>This is general guidance, about half an ounce per pound plus extra for activity. It's not medical advice. It changes as you answer the questions above.</div>
          </div>
          {wp.note && <p className="alert">{wp.note}</p>}
        </div>
      </>) },
    plan: { title: "Your plan", body: (
      numsOk ? (
        <>
          {targetsBox}
          {pv.clamped && <p className="alert">That pace goes under a safe minimum, so your calories stop here.</p>}
          <p className="small">{goal === "maintain" ? "These numbers keep your weight steady." : goal === "gain" ? "These numbers add a small surplus so you gain slowly." : "These numbers put you in a steady, safe deficit."}</p>
          {(() => { const skip = [...(p.allergies || []).map((k) => ALLERGENS[k]?.label), (p.allergyOther || "").trim(), DIETS[p.diet]?.label].filter(Boolean); return skip.length ? <p className="small">Meals will skip: {skip.join(", ")}.</p> : null; })()}
          <p className="small">Water goal: {waterNow} oz a day.</p>
          <p className="dim tiny">You can change any answer later in Settings.</p>
        </>
      ) : <p className="dim small">Go back and fill in your age, height and weight to see your numbers.</p>) },
  };
  const order = ["you", "body", "goal", "health", "allergy", "eating", "days", "plan"];

  if (!wizard) {
    // Settings: every question on one page.
    return (
      <div className="glass pad stack">
        <h2>{title}</h2>
        {intro && <p className="dim small">{intro}</p>}
        {order.filter((k) => k !== "plan").map((k) => (
          <div key={k} className="stack"><h3 style={{ margin: "10px 0 0" }}>{S[k].title}</h3>{S[k].body}</div>))}
        {numsOk ? targetsBox : <p className="dim small">Fill in your age, weight and goal to see your daily numbers.</p>}
        <button className="btn solid wide" disabled={!numsOk} onClick={save}>{cta}</button>
      </div>
    );
  }
  const key = order[step], cur = S[key], last = step === order.length - 1;
  const canNext = cur.need ? cur.need() : true;
  return (
    <div className="glass pad stack">
      <div className="row"><span className="dim tiny">Step {step + 1} of {order.length}</span>{cur.skip && !last && <button className="chip" onClick={() => setStep(step + 1)}>Skip</button>}</div>
      <div className="track"><div style={{ width: `${((step + 1) / order.length) * 100}%`, background: C.water }} /></div>
      <h2>{step === 0 ? title : cur.title}</h2>
      {step === 0 && <p className="dim small">A few quick questions, like a nutritionist would ask, so your plan fits you. Tap an answer or type. Takes about 2 minutes.</p>}
      {cur.body}
      <div className="row gap">
        {step > 0 && <button className="btn ghost" onClick={() => setStep(step - 1)}>Back</button>}
        {last
          ? <button className="btn solid wide" disabled={!numsOk} onClick={save}>{cta}</button>
          : <button className="btn solid wide" disabled={!canNext} onClick={() => setStep(step + 1)}>Next</button>}
      </div>
    </div>
  );
}

/* ---------- shell ---------- */
function Shell({ children, theme, top }) {
  const cls = theme === "pro" ? "app pro" : theme === "modern" ? "app modern" : theme === "arena" ? (COURT ? "app arena court" : "app arena") : "app";
  const cue = theme === "arena" ? teamCue(TEAM) : null;
  const style = cue ? { "--pri": cue.primary, "--sec": cue.secondary, "--pri-btn": cue.button, "--pri-ink": cue.ink,
    "--sec-btn": cue.chipBg, "--sec-ink": cue.chipInk } : undefined;
  return (
    <div className={cls} style={style}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
        .app { position:relative; min-height:100vh; font-family:'Inter',ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;
          color:#F1F5F9; font-size:15px; line-height:1.5; overflow-x:hidden;
          background:#0A0E1F; padding:16px 14px 106px; max-width:560px; margin:0 auto;
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
        .center { text-align:center; } .right { text-align:right; } .mono { font-family:'Inter',ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;font-variant-numeric:tabular-nums; }
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
        textarea { font-size:12px; resize:vertical; font-family:'Inter',ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;font-variant-numeric:tabular-nums; }
        .dropzone { display:block; text-align:center; padding:26px; border:1px dashed rgba(255,255,255,.24); border-radius:18px;
          color:#F1F5F9; font-size:14px; cursor:pointer; background:rgba(255,255,255,.03); margin:0; }
        .shot { width:100%; max-height:230px; object-fit:cover; border-radius:16px; display:block; }
        .qbox { border:1px solid rgba(110,231,249,.3); background:rgba(110,231,249,.07); border-radius:16px; padding:14px; display:flex; flex-direction:column; gap:10px; }
        .gradebox { margin:8px 16px 12px; padding:11px 14px; border-radius:12px; background:rgba(163,230,53,.08); border:1px solid rgba(163,230,53,.3); }
        .gradebox strong { font-size:13.5px; }
        .tierbox { border-color:var(--tier); background:color-mix(in srgb, var(--tier) 10%, transparent); }
        .tierpill { display:inline-block; padding:1px 8px; border-radius:99px; background:var(--tier); color:#000; font-size:11.5px; font-weight:800; margin-right:4px; }
        .itemcard { border:1px solid rgba(255,255,255,.1); border-radius:16px; padding:12px; display:flex; flex-direction:column; gap:8px; background:rgba(255,255,255,.03); }
        .badge { font-size:10px; padding:3px 8px; border-radius:99px; letter-spacing:0; white-space:nowrap;
          background:rgba(255,255,255,.1); color:rgba(241,245,249,.7); }
        .badge.good { background:rgba(163,230,53,.18); color:#A3E635; }
        .badge.low { background:rgba(251,113,133,.18); color:#FB7185; }
        .stagerow { display:flex; gap:12px; padding:12px 16px; border-top:1px solid rgba(255,255,255,.06); align-items:flex-start; }
        .stagerow.on { background:rgba(255,255,255,.06); }
        .sname { font-size:13.5px; }
        .dock { position:fixed; bottom:10px; left:8px; right:8px; display:flex; gap:2px; z-index:50;
          background:rgba(18,22,42,.72); border:1px solid rgba(255,255,255,.14); border-radius:22px; padding:7px 4px;
          backdrop-filter:blur(24px); -webkit-backdrop-filter:blur(24px); box-shadow:0 10px 36px rgba(0,0,0,.5); }
        .timerow { display:flex; align-items:center; gap:8px; margin-top:2px; }
        .timeinput { width:auto; padding:2px 6px; font-size:11px; border-radius:7px; background:rgba(255,255,255,.06);
          border:1px solid rgba(255,255,255,.1); color:rgba(241,245,249,.75); font-family:'Inter',ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;font-variant-numeric:tabular-nums; }
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
        .codebox { font-family:'Inter',ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;font-variant-numeric:tabular-nums; font-size:19px; letter-spacing:0; text-align:center; padding:14px;
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
        .welcomehead { font-size:30px; line-height:1.15; font-weight:800; letter-spacing:-.4px; margin:0; }
        .stepnum { flex:none; width:26px; height:26px; border-radius:50%; background:var(--nbared, var(--pri, #6EE7F9)); color:#fff; font-weight:800; display:inline-flex; align-items:center; justify-content:center; font-size:13px; }
        .tagrow { display:flex; flex-wrap:wrap; gap:5px; margin:6px 0 2px; }
        .tagpill { font-size:10.5px; padding:2px 8px; border-radius:999px; border:1px solid rgba(255,255,255,.18); opacity:.85; }
        .daybig { font-size:22px; font-weight:800; }
        .daybar .btn { padding:10px 12px; display:inline-flex; align-items:center; gap:4px; }
        .tabtitle { text-align:center; margin:6px 0 14px; }
        .tabtitle span { display:inline-block; font-size:34px; font-weight:800; letter-spacing:-.5px; line-height:1.1; padding-bottom:6px; border-bottom:4px solid var(--nbared, var(--pri, #6EE7F9)); }
        .tabtitle small { display:block; margin-top:8px; font-size:13.5px; opacity:.7; }
        .dockbtn { flex:1; min-width:0; background:none; border:none; color:rgba(241,245,249,.55); font:inherit; font-size:11px; cursor:pointer;
          display:flex; flex-direction:column; align-items:center; gap:4px; padding:10px 2px; border-radius:16px; transition:all .2s; }
        .dockbtn.on { color:#0A0E1F; background:#F1F5F9; font-weight:700; }
        .dockbtn span { max-width:100%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        .app *:focus-visible { outline:2px solid #6EE7F9; outline-offset:2px; }

        .tray { display:none; }

        /* ================= Arena Scoreboard theme ================= */
        .app.arena {
          background:
            radial-gradient(1100px 500px at 50% -180px, color-mix(in srgb, var(--pri) 22%, transparent), transparent 70%),
            repeating-linear-gradient(90deg, #0B0D12 0 3px, #0A0C11 3px 6px),
            #05060A;
          color:#E7EAF0; font-family:'Inter',ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,sans-serif; font-size:14.5px; --pri:#552583; --sec:#FDB927;
        }
        .app.arena::before, .app.arena::after { display:none; }
        .app.arena h2 { font-family:'Inter',ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,sans-serif; font-weight:700; letter-spacing:0; font-size:15px; }
        .app.arena .dim { color:#8B93A1; } .app.arena .alert { color:#EF4444; font-weight:600; }
        .app.arena *:focus-visible { outline:2px solid var(--sec); outline-offset:2px; }

        .app.arena .glass { background:linear-gradient(180deg,#14161C,#0D0F14); border:1px solid #22262f; border-radius:6px;
          box-shadow:0 0 0 1px #05060A, 0 10px 26px rgba(0,0,0,.55), inset 0 1px 0 rgba(255,255,255,.04); backdrop-filter:none; -webkit-backdrop-filter:none; }
        .app.arena .glass.hero, .app.arena .glass.pad { border-top:3px solid var(--pri); }
        .app.arena .glass::-webkit-scrollbar { display:none; }

        /* the scoreboard digits */
        .app.arena .huge, .app.arena .bignum, .app.arena .midnum, .app.arena .mono, .app.arena .codebox {
          font-family:'Inter',ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,sans-serif; letter-spacing:.02em; }
        .app.arena .huge, .app.arena .bignum { font-weight:900; text-shadow:0 0 14px currentColor, 0 0 3px currentColor; }
        .app.arena .midnum { font-weight:700; }
        .app.arena .unit { opacity:.65; font-family:'Inter',ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,sans-serif; font-size:13px; }
        .app.arena .stagename { font-family:'Inter',ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,sans-serif; font-weight:700; letter-spacing:0; }

        .app.arena .btn, .app.arena .chip { background:linear-gradient(180deg,#2A303C,#171A21); color:#E7EAF0; border:1px solid #2c313d; border-radius:5px;
          font-family:'Inter',ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,sans-serif; letter-spacing:0; font-weight:600; font-size:12.5px; }
        .app.arena .btn:active, .app.arena .chip:active { transform:scale(.97); }
        .app.arena .btn.solid, .app.arena .btn.accent { background:var(--pri-btn,var(--pri)); border-color:var(--pri-btn,var(--pri)); color:var(--pri-ink,#fff); box-shadow:0 0 16px color-mix(in srgb, var(--pri) 50%, transparent); }
        .app.arena .btn.ghost { background:transparent; }
        .app.arena .chip.on { background:var(--sec-btn,var(--sec)); border-color:var(--sec-btn,var(--sec)); color:var(--sec-ink,#0A0C11); font-weight:700; }
        .app.arena .btn:disabled, .app.arena .chip:disabled { opacity:.4; }
        .app.arena .icon, .app.arena .linkbtn { color:#8B93A1; }

        .app.arena .listbtn { background:#0D0F14; border:1px solid #22262f; border-radius:5px; color:#E7EAF0; }
        .app.arena .listbtn.on { background:var(--pri-btn,var(--pri)); border-color:var(--pri-btn,var(--pri)); color:var(--pri-ink,#fff); font-weight:700; }
        .app.arena input, .app.arena textarea { background:#0B0D12; border:1px solid #262b36; border-radius:5px; color:#E7EAF0; font-family:'Inter',ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,sans-serif; }
        .app.arena input:focus, .app.arena textarea:focus { border-color:var(--sec); background:#0B0D12; box-shadow:0 0 0 2px color-mix(in srgb, var(--sec) 35%, transparent); }
        .app.arena label { color:#8B93A1; font-size:10.5px; letter-spacing:0; }
        .app.arena .teampick { width:100%; box-sizing:border-box; background:#0B0D12; border:1px solid #262b36; border-radius:5px; color:#E7EAF0; padding:11px 13px; font:inherit; font-family:'Inter',ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,sans-serif; }
        .app.arena .timeinput { background:#0B0D12; color:#E7EAF0; border:1px solid #262b36; border-radius:4px; font-family:'Inter',ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;font-variant-numeric:tabular-nums; }

        .app.arena .track, .app.arena .fuel { background:#111318; border-radius:3px; box-shadow:inset 0 0 0 1px #22262f; }
        .app.arena .track > div, .app.arena .fuel > div { border-radius:2px; box-shadow:0 0 8px currentColor; }
        .app.arena .overtick { background:#fff; }
        .app.arena .dot { box-shadow:0 0 6px currentColor; }

        .app.arena .mealhead { background:linear-gradient(90deg, color-mix(in srgb, var(--pri) 30%, #0D0F14), #0D0F14); font-weight:700; font-size:11.5px; letter-spacing:0; }
        .app.arena .fooditem, .app.arena .dish, .app.arena .listitem, .app.arena .histrow { background:transparent; border-top:1px solid #1c2029; }
        .app.arena .stagerow { border-top:1px solid #1c2029; } .app.arena .stagerow.on { background:color-mix(in srgb, var(--pri) 18%, transparent); }
        .app.arena .tick { border-radius:3px; border-color:#2c313d; }
        .app.arena .tick.on { background:var(--sec-btn,var(--sec)); border-color:var(--sec-btn,var(--sec)); color:var(--sec-ink,#0A0C11); }

        .app.arena .editbox, .app.arena .subpanel, .app.arena .ingredients, .app.arena .qbox, .app.arena .itemcard, .app.arena .recipe {
          background:#0B0D12; border:1px solid #1c2029; border-radius:5px; }
        .app.arena .cue { color:var(--sec); border-left-color:var(--sec); }
        .app.arena .gradebox { background:#0B0D12; border:1px solid #22C55E; border-radius:5px; }
        .app.arena .tierbox { border-color:var(--tier); }
        .app.arena .tierbox strong { color:inherit; }
        .app.arena .gradebox strong { color:#22C55E; letter-spacing:0; font-family:'Inter',ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,sans-serif; }
        .app.arena .badge { background:#1c2029; color:#8B93A1; border-radius:3px; }
        .app.arena .badge.good { background:color-mix(in srgb, #22C55E 22%, transparent); color:#22C55E; }
        .app.arena .badge.low { background:color-mix(in srgb, #EF4444 22%, transparent); color:#EF4444; }
        .app.arena .codebox { background:#0B0D12; color:var(--sec); border:1px dashed var(--sec); border-radius:5px; }
        .app.arena .dropzone { background:#0B0D12; border:1px dashed #2c313d; border-radius:5px; }
        .app.arena .shot, .app.arena .thumb, .app.arena .menuthumb, .app.arena .compare > div > img, .app.arena .viewer .full { border-radius:5px; border:1px solid #22262f; }
        .app.arena .viewer { background:rgba(5,6,10,.92); } .app.arena .viewerInner { background:#14161C; border:1px solid #22262f; padding:12px; border-radius:6px; }
        .app.arena .bubble { background:#0D0F14; border:1px solid #22262f; border-radius:6px; } .app.arena .bubble.me { background:color-mix(in srgb, var(--pri) 22%, #0D0F14); border-color:var(--pri); }

        .app.arena .dock { background:#0B0D12; border:1px solid #22262f; border-top:3px solid var(--pri); border-radius:14px; box-shadow:0 -6px 24px rgba(0,0,0,.5); backdrop-filter:none; -webkit-backdrop-filter:none; }
        .app.arena .dockbtn { color:#6B7280; font-family:'Inter',ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,sans-serif; font-size:10.5px; letter-spacing:0; }
        .app.arena .dockbtn.on { color:var(--pri-ink,#fff); background:var(--pri-btn,var(--pri)); font-weight:700; box-shadow:0 0 14px color-mix(in srgb, var(--pri) 55%, transparent); }
        .app.arena .tray { display:flex; align-items:center; padding:0 8px; font-family:'Inter',ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,sans-serif; font-size:11px; color:var(--sec); }
        @media (max-width:430px) { .app.arena .tray { display:none; } }

        /* ================= Modern 2026 theme ================= */
        .app.modern { background:#08090D; color:#ECEDF2; font-size:15px; }
        .app.modern::before { width:560px; height:560px; top:-260px; left:50%; margin-left:-280px; background:radial-gradient(circle, rgba(99,102,241,.30), transparent 66%); filter:blur(30px); opacity:1; animation:none; }
        .app.modern::after { width:420px; height:420px; right:-160px; bottom:-120px; background:radial-gradient(circle, rgba(34,211,238,.14), transparent 68%); filter:blur(40px); opacity:1; animation:none; }
        .app.modern h2 { font-size:17px; font-weight:600; letter-spacing:-.015em; }
        .app.modern .dim { color:#8D93A5; }
        .app.modern .glass { background:#11131A; border:1px solid #1E2230; border-radius:24px; box-shadow:inset 0 1px 0 rgba(255,255,255,.04), 0 10px 34px rgba(0,0,0,.4); backdrop-filter:none; -webkit-backdrop-filter:none; }
        .app.modern .huge, .app.modern .bignum, .app.modern .midnum { font-weight:300; letter-spacing:-.03em; text-shadow:none; }
        .app.modern .btn, .app.modern .chip { background:#191C27; color:#ECEDF2; border:1px solid #232739; border-radius:999px; }
        .app.modern .btn.ghost { background:transparent; }
        .app.modern .btn.solid, .app.modern .btn.accent { background:linear-gradient(135deg,#5B5BF0,#7C5CF5); border-color:transparent; color:#fff; box-shadow:0 8px 24px rgba(91,91,240,.35); }
        .app.modern .chip.on { background:#ECEDF2; color:#0B0C10; border-color:#ECEDF2; font-weight:600; }
        .app.modern .btn:disabled, .app.modern .chip:disabled { opacity:.4; }
        .app.modern input, .app.modern textarea, .app.modern select { background:#0C0E14; border:1px solid #1E2230; border-radius:16px; color:#ECEDF2; }
        .app.modern input:focus, .app.modern textarea:focus { border-color:#6366F1; box-shadow:0 0 0 3px rgba(99,102,241,.25); }
        .app.modern .track, .app.modern .fuel { background:#1A1D29; border-radius:999px; }
        .app.modern .track > div, .app.modern .fuel > div { border-radius:999px; }
        .app.modern .mealhead { background:transparent; border-bottom:1px solid #1E2230; }
        .app.modern .fooditem, .app.modern .histrow, .app.modern .stagerow { border-top:1px solid #1B1E2A; }
        .app.modern .gradebox { background:#0C0E14; border:1px solid #232739; border-radius:16px; }
        .app.modern .tierbox { border-color:var(--tier); }
        .app.modern .bubble { background:#171A24; border-radius:20px; } .app.modern .bubble.me { background:#26285F; }
        .app.modern .dock { background:rgba(17,19,26,.92); border:1px solid #23273A; border-radius:30px; box-shadow:0 14px 40px rgba(0,0,0,.55); backdrop-filter:blur(16px); -webkit-backdrop-filter:blur(16px); }
        .app.modern .dockbtn { color:#7A8095; border-radius:22px; }
        .app.modern .dockbtn.on { background:#ECEDF2; color:#0B0C10; }

        /* ================= Hardwood court theme (builds on Arena) ================= */
        .app.arena.court {
          background:
            radial-gradient(900px 520px at 50% -140px, color-mix(in srgb, var(--pri) 38%, transparent), transparent 72%),
            linear-gradient(180deg, rgba(8,4,0,.62), rgba(8,4,0,.38) 45%, rgba(8,4,0,.7)),
            repeating-linear-gradient(90deg, #7A4E27 0 46px, #5A3818 46px 48px, #74492A 48px 94px, #5A3818 94px 96px),
            #6B4423;
        }
        .app.arena.court::before {
          display:block; content:''; position:fixed; inset:0; width:auto; height:auto; border-radius:0; filter:none; animation:none; opacity:.2; z-index:0; pointer-events:none;
          background:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 400 800'><g fill='none' stroke='white' stroke-width='4'><rect x='6' y='6' width='388' height='788'/><line x1='6' y1='400' x2='394' y2='400'/><circle cx='200' cy='400' r='60'/><rect x='130' y='6' width='140' height='190'/><circle cx='200' cy='196' r='60'/><path d='M40 6 V120 A170 170 0 0 0 360 120 V6'/><rect x='130' y='604' width='140' height='190'/><circle cx='200' cy='604' r='60'/><path d='M40 794 V680 A170 170 0 0 1 360 680 V794'/></g></svg>") center / auto 100% no-repeat;
        }
        .app.arena.court .dim { color:#CDBBA3; }
        .app.arena.court .glass { background:linear-gradient(180deg,rgba(24,17,12,.96),rgba(14,10,7,.97)); border-color:#4a3320; }
        .app.arena.court .huge { font-family:'Inter',ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,sans-serif; letter-spacing:0; }
        .app.court .ringwrap { position:relative; }
        .app.court .ballseams { position:absolute; left:50%; top:50%; transform:translate(-50%,-50%); color:#E8892B; opacity:.2; pointer-events:none; }
        .app.court .ringinner { position:relative; z-index:1; }
        .app.court .wlstrip { display:flex; align-items:center; flex-wrap:wrap; gap:4px; }
        .app.court .wl { width:24px; height:24px; border-radius:50%; display:inline-flex; align-items:center; justify-content:center; font-size:12px; font-weight:700; }
        .app.court .wl.w { background:#22C55E; color:#04210f; } .app.court .wl.l { background:#3a2a22; color:#E8892B; border:1px solid #E8892B; } .app.court .wl.n { background:transparent; color:#8B7A68; border:1px dashed #5a4636; }
        .wlstrip { display:flex; align-items:center; flex-wrap:wrap; gap:4px; }
        .chalgrid { display:grid; grid-template-columns:repeat(10,1fr); gap:5px; }
        .chalcell { aspect-ratio:1; border-radius:50%; background:rgba(255,255,255,.07); border:1px solid rgba(255,255,255,.14); }
        .chalcell.hit { background:#22C55E; border-color:#22C55E; } .chalcell.miss { background:transparent; border:1px solid #E8892B; } .chalcell.open { border:1px dashed #94A3B8; }
        .wl { width:24px; height:24px; border-radius:50%; display:inline-flex; align-items:center; justify-content:center; font-size:12px; font-weight:700; }
        .wl.w { background:#22C55E; color:#04210f; } .wl.l { background:transparent; color:#F59E0B; border:1px solid #F59E0B; } .wl.n { background:transparent; color:#8B93A1; border:1px dashed #5b6270; }
        .gamespanel { margin-bottom:12px; }
        .gamespanel .gamehead { margin-bottom:6px; padding:0 2px; }
        .gamespanel .gamestrip { display:flex; gap:8px; overflow-x:auto; scroll-snap-type:x proximity; -webkit-overflow-scrolling:touch; padding:2px 2px 8px; scrollbar-width:thin; }
        .gamespanel .gcard { flex:0 0 148px; scroll-snap-align:start; box-sizing:border-box; display:flex; flex-direction:column; gap:3px; padding:9px 11px; border-radius:12px;
          background:rgba(20,16,12,.92); border:1px solid rgba(255,255,255,.14); font-size:14px; line-height:1.25; }
        .gamespanel .gcard.livecard { border-color:#EF4444; }
        .gamespanel .gcard.spccard { border-color:#E8892B; }
        .gamespanel .gl { font-size:11.5px; opacity:.8; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
        .gamespanel .grow { display:flex; justify-content:space-between; gap:6px; font-weight:600; font-size:15px; }
        .gamespanel .grow > span { white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
        .gamespanel .gscore { min-width:26px; text-align:right; font-variant-numeric:tabular-nums; }
        .gamespanel .glogo { width:18px; height:18px; max-width:18px; max-height:18px; object-fit:contain; margin-right:6px; vertical-align:-4px; flex:none; }
        .gamespanel .gf { font-size:12px; opacity:.75; margin-top:2px; }
        .gamespanel .gamefoot { padding:0 2px; overflow:hidden; text-overflow:ellipsis; }
        .gamespanel .live { color:#EF4444; font-weight:700; font-size:12px; }
        .gamespanel a { color:var(--sec,#60A5FA); }
        .app.arena.court .dock { border-top-color:#E8892B; }

        /* ================= Readability pass: plain sans-serif, bigger small text, no thin numerals ================= */
        .app, .app * { -webkit-font-smoothing:antialiased; }
        .app { font-size:16px; line-height:1.45; }
        .app .tiny { font-size:13px; } .app .small { font-size:14.5px; }
        .app label { font-size:13px; font-weight:600; letter-spacing:0; }
        .app h2 { font-size:17px; font-weight:700; letter-spacing:0; }
        .app .huge, .app .bignum, .app .midnum { font-weight:600; }
        .app .btn, .app .chip, .app .listbtn { font-size:15px; font-weight:600; letter-spacing:0; }
        .app .dockbtn { font-size:12.5px; font-weight:600; letter-spacing:0; }
        .app input, .app textarea, .app select { font-size:16px; }
        .app .dim { color:rgba(241,245,249,.74); }
        .app.arena .dim, .app.modern .dim { color:#B4BAC8; }
        .app.arena.court .dim { color:#E0D2BD; }
        .app.arena.court, .app.arena.court .glass { color:#F6EFE4; }

        /* ================= Pro: ESPN layout, NBA colors (default) ================= */
        .app.pro { background:#0B0B0D; color:#F4F5F7; --nbablue:#1D63ED; --nbadeep:#17408B; --nbared:#C8102E; padding-bottom:84px; }
        .app.pro::before, .app.pro::after { display:none; }
        .app.pro .glass { background:#15161A; border:1px solid #26282F; border-radius:10px; box-shadow:none; backdrop-filter:none; -webkit-backdrop-filter:none; animation:none; margin-bottom:10px; }
        .app.pro .fadein { animation:none; }
        .app.pro h2 { font-size:18px; font-weight:800; letter-spacing:-.01em; padding-left:10px; border-left:4px solid var(--nbared); line-height:1.1; }
        .app.pro .mealhead { background:#1B1D23; border-bottom:1px solid #26282F; font-weight:700; }
        .app.pro .dim { color:#A3A7B3; }
        .app.pro .huge, .app.pro .bignum, .app.pro .midnum { font-weight:800; letter-spacing:-.02em; text-shadow:none; }
        .app.pro .btn, .app.pro .chip, .app.pro .listbtn { background:#1E2026; color:#F4F5F7; border:1px solid #2E313A; border-radius:8px; }
        .app.pro .chip { border-radius:999px; }
        .app.pro .btn.ghost { background:transparent; }
        .app.pro .btn.solid, .app.pro .btn.accent { background:var(--nbablue); border-color:var(--nbablue); color:#fff; box-shadow:none; }
        .app.pro .chip.on, .app.pro .listbtn.on { background:var(--nbared); border-color:var(--nbared); color:#fff; font-weight:700; }
        .app.pro .btn:disabled, .app.pro .chip:disabled { opacity:.45; }
        .app.pro input, .app.pro textarea, .app.pro select { background:#0F1013; border:1px solid #2E313A; border-radius:8px; color:#F4F5F7; }
        .app.pro input:focus, .app.pro textarea:focus { border-color:var(--nbablue); box-shadow:0 0 0 2px rgba(29,99,237,.35); outline:none; }
        .app.pro .track, .app.pro .fuel { background:#23252C; border-radius:3px; }
        .app.pro .track > div, .app.pro .fuel > div { border-radius:3px; }
        .app.pro .fooditem, .app.pro .histrow, .app.pro .stagerow { border-top:1px solid #23252C; }
        .app.pro .gradebox, .app.pro .subpanel { background:#0F1013; border:1px solid #26282F; border-radius:8px; }
        .app.pro .tierbox { border-color:var(--tier); }
        .app.pro .bubble { background:#1B1D23; border-radius:12px; } .app.pro .bubble.me { background:var(--nbadeep); }
        .app.pro .alert { color:#FF6B7F; }
        .app.pro .wl.w { background:#22C55E; color:#04210f; } .app.pro .wl.l { background:transparent; color:#FF6B7F; border:1px solid #FF6B7F; }
        .app.pro .tray { display:none; }
        .app.pro .btn.ghost { border-color:#3A3D47; }
        .app.pro .daynav, .app.pro .daylabel { font-weight:700; }
        /* top bar and scores strip */
        .app.pro .probar { position:sticky; top:0; z-index:40; display:flex; justify-content:space-between; align-items:center; height:46px; padding:0 14px; background:#0B0B0D; border-bottom:2px solid var(--nbared); }
        .app.pro .prologo { font-weight:900; font-size:19px; letter-spacing:.02em; color:#fff; } .app.pro .prologo b { color:var(--nbablue); font-weight:900; }
        .app.pro .prodate { font-size:13px; color:#A3A7B3; font-weight:600; }
        .app.pro .proscores { padding:10px 10px 2px; background:#0B0B0D; }
        .app.pro .gamespanel { margin:0; }
        .app.pro .gamehead strong { font-size:14px; font-weight:800; }
        .app.pro .gamespanel .gcard { background:#15161A; border:1px solid #26282F; border-radius:8px; flex-basis:158px; }
        .app.pro .gamespanel .gcard.livecard { border-color:var(--nbared); box-shadow:inset 3px 0 0 var(--nbared); }
        .app.pro .gamespanel .gcard.spccard { border-color:#2E313A; box-shadow:inset 3px 0 0 var(--nbablue); }
        .app.pro .glogo { width:18px; height:18px; object-fit:contain; margin-right:6px; vertical-align:-4px; }
        /* bottom tab bar */
        .app.pro .dock { left:0; right:0; bottom:0; gap:0; border-radius:0; background:#0B0B0D; border:0; border-top:1px solid #26282F; box-shadow:none; backdrop-filter:none; -webkit-backdrop-filter:none; padding:4px 4px calc(6px + env(safe-area-inset-bottom)); }
        .app.pro .dockbtn { color:#8A8F9C; border-radius:0; background:none; font-size:10.5px; letter-spacing:-.15px; padding:6px 0; border-top:3px solid transparent; }
        .app.pro .dockbtn.on { color:#fff; background:none; border-top-color:var(--nbared); box-shadow:none; }
        .app.pro .dockbtn.on svg { color:var(--nbablue); }

        @media (prefers-reduced-motion:reduce) { *, .app::before, .app::after { animation:none !important; transition:none !important; } }
      `}</style>
      {top}
      {children}
    </div>
  );
}

// ESPN-style top: a slim wordmark bar, then the scores strip, on every tab.
function ProTop() {
  return (
    <>
      <header className="probar"><span className="prologo">CUT<b>LOG</b></span><span className="prodate">{new Date().toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })}</span></header>
      <div className="proscores"><GamesPanel /></div>
    </>
  );
}
