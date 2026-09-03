import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { LineChart, Line, XAxis, YAxis, ResponsiveContainer, Tooltip, ReferenceLine, CartesianGrid } from "recharts";
import { Timer, Scale, Users, CalendarDays, Settings as Cog, Plus, X, Star, ChevronLeft, ChevronRight, ChefHat } from "lucide-react";

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
  { at: 0, name: "Fed", hue: "#94A3B8", body: "Insulin is up and you're absorbing the meal. Nothing is coming out of storage yet." },
  { at: 4, name: "Post-absorptive", hue: "#7DD3FC", body: "Insulin is falling. Your liver starts releasing stored glucose to hold blood sugar steady." },
  { at: 8, name: "Glycogen drawdown", hue: "#6EE7F9", body: "Liver glycogen is running down and fat is starting to cover more of the load." },
  { at: 12, name: "Fat burning", hue: "#5EEAD4", body: "Most of your fuel is now fat. Hunger comes in waves here rather than steadily — it passes." },
  { at: 16, name: "Ketosis building", hue: "#A3E635", body: "Ketones are climbing. Appetite usually flattens out and focus often sharpens." },
  { at: 18, name: "Growth hormone rise", hue: "#FBBF24", body: "Growth hormone trends upward. Part of why muscle holds up reasonably well through a fast." },
  { at: 20, name: "Autophagy window", hue: "#FB923C", body: "Cellular cleanup is thought to step up here. The human timing is poorly pinned down and most hard data is from animals." },
  { at: 24, name: "Deep fast", hue: "#FB7185", body: "Liver glycogen is largely gone and ketones are the main fuel. Mind your electrolytes and don't train hard in here." },
];
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

function computeTargets(p, tags = []) {
  const bmr = 10 * (p.weight * 0.4536) + 6.25 * (p.heightIn * 2.54) - 5 * p.age + (p.sex === "male" ? 5 : -161);
  const tdee = bmr * ACTIVITY[p.activity].mult;
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
const prettyTime = (ts) => (ts ? new Date(ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "");
const MEAL_COLOR = { Breakfast: "#6EE7F9", Lunch: "#A3E635", Dinner: "#A78BFA", Snack: "#FBBF24" };
const C = { cal: "#6EE7F9", protein: "#A3E635", carbs: "#A78BFA", fat: "#FBBF24", bad: "#FB7185" };
const blankDay = () => ({ foods: [], steps: "", weight: "", tags: [], sleep: "", workouts: [] });
const guessMeal = () => { const h = new Date().getHours(); return h < 10 ? "Breakfast" : h < 15 ? "Lunch" : h < 21 ? "Dinner" : "Snack"; };
const reduced = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

async function askClaude(content) {
  const r = await fetch("/api/claude", {
    method: "POST", headers: { "Content-Type": "application/json", "x-access-code": ACCESS() },
    body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: 1000, messages: [{ role: "user", content }] }),
  });
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
  const p = Math.max(0, Math.min(1, pct));
  return (
    <div className="ringwrap" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="ring">
        <defs>
          <linearGradient id="rg" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.55" />
            <stop offset="100%" stopColor={color} />
          </linearGradient>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.09)" strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="url(#rg)" strokeWidth={stroke}
          strokeLinecap="round" strokeDasharray={circ} strokeDashoffset={circ * (1 - p)}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{ transition: reduced() ? "none" : "stroke-dashoffset 900ms cubic-bezier(.22,1,.36,1)", filter: glow ? `drop-shadow(0 0 10px ${color}88)` : "none" }} />
        {ticks.map((t, i) => {
          const a = (t.at * 2 * Math.PI) - Math.PI / 2;
          return <circle key={i} cx={size / 2 + Math.cos(a) * r} cy={size / 2 + Math.sin(a) * r} r={t.hit ? 3.5 : 2.5}
            fill={t.hit ? t.color : "rgba(255,255,255,0.25)"} />;
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
      <div className="row tiny"><span>{label}</span><span style={{ color: met ? color : "rgba(255,255,255,0.55)" }}>{Math.round(shown)} / {want}g</span></div>
      <div className="track"><div style={{ width: `${Math.min(100, (have / want) * 100)}%`, background: color, boxShadow: `0 0 12px ${color}77` }} /></div>
    </div>
  );
}

/* ---------- app ---------- */
export default function CutLog() {
  const [data, setData] = useState(null);
  const [tab, setTab] = useState("now");
  const [viewDay, setViewDay] = useState(dayKey());
  const [saveErr, setSaveErr] = useState(false);
  const first = useRef(true);

  useEffect(() => {
    (async () => {
      try { setData(JSON.parse((await store.get(KEY)).value)); }
      catch { setData({ profile: null, days: {}, favorites: [], fast: null, fasts: [], share: false, calib: [] }); }
    })();
  }, []);

  useEffect(() => {
    if (!data) return;
    if (first.current) { first.current = false; return; }
    (async () => {
      try { await store.set(KEY, JSON.stringify(data)); setSaveErr(false); } catch { setSaveErr(true); }
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

  const day = data?.days?.[viewDay] || blankDay();
  const targets = useMemo(() => (data?.profile ? computeTargets(data.profile, day.tags) : null), [data, day.tags]);
  const updateDay = useCallback((k, fn) => setData((d) => ({ ...d, days: { ...d.days, [k]: fn(d.days[k] || blankDay()) } })), []);

  if (!data) return <Shell><div className="glass pad center"><p className="dim">Waking up…</p></div></Shell>;
  if (!data.profile) return <Shell><ProfileForm
    initial={{ name: "", sex: "male", age: 40, heightIn: 70, weight: 224, goalWeight: 180, activity: "light", pace: 1.5 }}
    title="Set your numbers" cta="Start" intro="Sets your daily budget. Change any of it later."
    onSave={(profile) => setData((d) => ({ ...d, profile }))} /></Shell>;

  const TABS = [["now", "Now", Timer], ["plan", "Plan", ChefHat], ["weight", "Weight", Scale], ["us", "Us", Users], ["log", "Log", CalendarDays], ["setup", "Setup", Cog]];

  return (
    <Shell>
      {saveErr && <div className="glass pad alert">That change didn’t save. Back up from Setup before closing.</div>}
      <div key={tab} className="fadein">
        {tab === "now" && <Now {...{ data, setData, dayId: viewDay, setDayId: setViewDay, day, targets, updateDay }} />}
        {tab === "plan" && <Plan data={data} setData={setData} targets={targets} day={day} updateDay={updateDay} />}
        {tab === "weight" && <Weight data={data} targets={targets} updateDay={updateDay} />}
        {tab === "us" && <Us data={data} setData={setData} />}
        {tab === "log" && <History data={data} onPick={(k) => { setViewDay(k); setTab("now"); }} />}
        {tab === "setup" && <Settings data={data} setData={setData} onSave={(p) => setData((d) => ({ ...d, profile: p }))} />}
      </div>
      <nav className="dock">
        {TABS.map(([id, label, Icon]) => (
          <button key={id} className={tab === id ? "dockbtn on" : "dockbtn"} onClick={() => setTab(id)}>
            <Icon size={19} strokeWidth={1.7} /><span>{label}</span>
          </button>
        ))}
      </nav>
    </Shell>
  );
}

/* ---------- now ---------- */
function Now({ data, setData, dayId, setDayId, day, targets, updateDay }) {
  const [open, setOpen] = useState(false);
  const [showStages, setShowStages] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [goalH, setGoalH] = useState(16);
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
          <Ring pct={hours / fast.goal} color={st.hue}
            ticks={STAGES.filter((s) => s.at <= fast.goal).map((s) => ({ at: s.at / fast.goal, hit: hours >= s.at, color: s.hue }))}>
            <div className="mono huge">{clock(now - fast.start)}</div>
            <div className="stagename" style={{ color: st.hue }}>{st.name}</div>
            <div className="dim tiny">{hours >= fast.goal ? `past ${fast.goal}h` : nx ? `${nx.name} in ${(nx.at - hours).toFixed(1)}h` : `${fast.goal}h target`}</div>
          </Ring>
          <p className="dim small stagebody" onClick={() => setShowStages(!showStages)}>{st.body}</p>
          <div className="rowbtns">
            <button className="btn ghost" onClick={() => setShowStages(!showStages)}>{showStages ? "Hide stages" : "All stages"}</button>
            <button className="btn ghost" onClick={() => setData((d) => ({ ...d, fast: { ...d.fast, start: d.fast.start - 18e5 } }))}>−30m</button>
            <button className="btn solid" onClick={() => setData((d) => ({ ...d, fast: null,
              fasts: [{ end: Date.now(), hours: +((Date.now() - d.fast.start) / 36e5).toFixed(1), goal: d.fast.goal }, ...(d.fasts || [])].slice(0, 30) }))}>Break it</button>
          </div>
        </div>
      ) : (
        <div className="glass hero">
          <Ring pct={0} color="#64748B" glow={false}>
            <div className="mono huge dim">0:00:00</div>
            <div className="dim tiny">not fasting</div>
          </Ring>
          <div className="chips center">{[14, 16, 18, 20, 24].map((h) => (
            <button key={h} className={goalH === h ? "chip on" : "chip"} onClick={() => setGoalH(h)}>{h}h</button>))}</div>
          <button className="btn solid wide" onClick={() => setData((d) => ({ ...d, fast: { start: Date.now(), goal: goalH } }))}>Start the clock</button>
          {(data.fasts || [])[0] && <p className="dim tiny center">Last: {data.fasts[0].hours}h of a {data.fasts[0].goal}h target</p>}
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
                <div key={f.id} className="fooditem">
                  <div>
                    <div>{f.name}</div>
                    <div className="dim tiny timerow">
                      <input className="timeinput" type="time" value={tsToHHMM(f.at)}
                        onChange={(e) => updateDay(dayId, (d) => ({ ...d, foods: d.foods.map((x) => x.id === f.id ? { ...x, at: hhmmToTs(dayId, e.target.value) } : x) }))} />
                      <span>{Math.round(f.protein)}p · {Math.round(f.carbs)}c · {Math.round(f.fat)}f</span>
                    </div>
                  </div>
                  <div className="fright">
                    <span className="mono">{f.calories}</span>
                    <button className="icon" title="Save" onClick={() => setData((d) => ({ ...d, favorites: [{ name: f.name, calories: f.calories, protein: f.protein, carbs: f.carbs, fat: f.fat }, ...d.favorites.filter((x) => x.name !== f.name)].slice(0, 40) }))}><Star size={15} /></button>
                    <button className="icon" title="Remove" onClick={() => updateDay(dayId, (d) => ({ ...d, foods: d.foods.filter((x) => x.id !== f.id) }))}><X size={15} /></button>
                  </div>
                </div>
              ))}
            </div>
          ))}
      </div>

      {data.favorites.length > 0 && (
        <div className="chips">
          {data.favorites.map((f) => (
            <button key={f.name} className="chip"
              onClick={() => updateDay(dayId, (d) => ({ ...d, foods: [...d.foods, { ...f, id: crypto.randomUUID(), meal: guessMeal(), at: Date.now() }] }))}
              onContextMenu={(e) => { e.preventDefault(); setData((d) => ({ ...d, favorites: d.favorites.filter((x) => x.name !== f.name) })); }}>
              {f.name} <span className="dim">{f.calories}</span>
            </button>
          ))}
        </div>
      )}

      {open ? <AddFood onCancel={() => setOpen(false)} calib={data.calib || []}
        onCalib={(n) => setData((d) => ({ ...d, calib: [n, ...(d.calib || [])].slice(0, 12) }))}
        onAdd={(items) => { updateDay(dayId, (d) => ({ ...d, foods: [...d.foods, ...items.map((i) => ({ at: Date.now(), ...i }))] })); setOpen(false); }} />
        : <button className="btn solid wide big" onClick={() => setOpen(true)}><Plus size={18} /> Add food</button>}

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

/* ---------- add food ---------- */
function AddFood({ onAdd, onCancel, calib, onCalib }) {
  const [mode, setMode] = useState("weigh");
  const [meal, setMeal] = useState(guessMeal());
  return (
    <div className="glass pad stack fadein">
      <div className="chips">
        {[["weigh", "Weigh"], ["photo", "Photo"], ["desc", "Describe"]].map(([k, l]) => (
          <button key={k} className={mode === k ? "chip on" : "chip"} onClick={() => setMode(k)}>{l}</button>))}
      </div>
      {mode === "weigh" && <WeighIt meal={meal} setMeal={setMeal} onAdd={onAdd} onCancel={onCancel} />}
      {mode === "photo" && <SnapIt meal={meal} setMeal={setMeal} onAdd={onAdd} onCancel={onCancel} calib={calib} onCalib={onCalib} />}
      {mode === "desc" && <DescribeIt meal={meal} setMeal={setMeal} onAdd={onAdd} onCancel={onCancel} />}
    </div>
  );
}

const MealPick = ({ meal, setMeal }) => (
  <div className="chips">{MEALS.map((m) => <button key={m} className={meal === m ? "chip on" : "chip"} onClick={() => setMeal(m)}>{m}</button>)}</div>
);

function WeighIt({ meal, setMeal, onAdd, onCancel }) {
  const [q, setQ] = useState(""); const [pick, setPick] = useState(null);
  const [amt, setAmt] = useState(""); const [unit, setUnit] = useState("g"); const [raw, setRaw] = useState(false);
  const hits = q.trim() && !pick ? FOODS.filter((f) => f.n.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 6) : [];
  const entered = pick ? (unit === "g" ? +amt || 0 : unit === "oz" ? (+amt || 0) * 28.35 : (+amt || 0) * (pick.s?.g || 0)) : 0;
  const grams = raw ? entered * 0.75 : entered;
  const m = pick ? pick.m.map((v) => (v * grams) / 100) : [0, 0, 0, 0];

  return (
    <>
      <input autoFocus placeholder="chicken, rice, whey…" value={q} onChange={(e) => { setQ(e.target.value); setPick(null); }} />
      {hits.map((f) => <button key={f.n} className="listbtn" onClick={() => { setPick(f); setQ(f.n); setUnit(f.s ? "s" : "g"); setRaw(false); }}>{f.n}</button>)}
      {q.trim() && !pick && !hits.length && <p className="dim tiny">Not in the table — try Photo or Describe.</p>}
      {pick && (
        <>
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
          <MealPick meal={meal} setMeal={setMeal} />
          <div className="rowbtns">
            <button className="btn ghost wide" onClick={onCancel}>Cancel</button>
            <button className="btn solid wide" disabled={!grams} onClick={() => onAdd([{ id: crypto.randomUUID(), meal,
              name: `${pick.n}, ${amt}${unit === "s" ? " " + pick.s.label : unit}${raw ? " raw" : ""}`,
              calories: Math.round(m[0]), protein: +m[1].toFixed(1), carbs: +m[2].toFixed(1), fat: +m[3].toFixed(1) }])}>Log</button>
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

function DescribeIt({ meal, setMeal, onAdd, onCancel }) {
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
      <MealPick meal={meal} setMeal={setMeal} />
      {err && <p className="alert">{err}</p>}
      <div className="rowbtns">
        <button className="btn ghost wide" onClick={onCancel}>Cancel</button>
        <button className="btn solid wide" onClick={() => {
          if (!desc.trim() || v.calories === "") { setErr("Needs a name and a calorie number."); return; }
          onAdd([{ id: crypto.randomUUID(), meal, name: desc.trim(), calories: +v.calories || 0, protein: +v.protein || 0, carbs: +v.carbs || 0, fat: +v.fat || 0 }]);
        }}>Log</button>
      </div>
    </>
  );
}

/* ---------- plan ---------- */
const LAB_PRESETS = ["Total cholesterol", "LDL", "HDL", "Triglycerides", "A1c", "Fasting glucose",
  "ALT", "AST", "Vitamin D", "Ferritin", "TSH", "Creatinine", "eGFR", "CRP", "Uric acid"];

function Plan({ data, setData, targets, day, updateDay }) {
  const today = dayKey();
  const menu = data.menus?.[today] || null;
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [openRecipe, setOpenRecipe] = useState(null);
  const [showLabs, setShowLabs] = useState(false);
  const [craving, setCraving] = useState("");
  const [slot, setSlot] = useState(guessMeal());

  const eaten = day.foods.reduce((a, f) => ({ cal: a.cal + f.calories, p: a.p + f.protein }), { cal: 0, p: 0 });
  const remainCal = targets.calories - eaten.cal;
  const remainP = targets.protein - eaten.p;
  const labs = data.labs || [];

  const build = async () => {
    setBusy(true); setErr("");
    try {
      const likes = (data.favorites || []).map((f) => f.name).slice(0, 12);
      const p = await askClaude([{ type: "text", text: `Give someone cutting weight exactly three ${slot.toLowerCase()} options to choose between.

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
    } catch { setErr("Couldn't put a menu together just now. Try again in a moment."); }
    setBusy(false);
  };

  const choose = (m) => {
    updateDay(today, (d) => ({ ...d, foods: [...d.foods, { id: crypto.randomUUID(), meal: m.slot, name: m.name, at: Date.now(),
      calories: Math.round(m.calories), protein: Math.round(m.protein), carbs: Math.round(m.carbs), fat: Math.round(m.fat) }] }));
  };

  return (
    <>
      <div className="glass pad stack">
        <div className="row"><h2>What sounds good?</h2>
          <span className="dim tiny">{remainCal.toLocaleString()} cal · {Math.max(0, Math.round(remainP))}g left</span></div>
        <div className="chips">{MEALS.map((s) => (
          <button key={s} className={slot === s ? "chip on" : "chip"} onClick={() => setSlot(s)}>{s}</button>))}</div>
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
          {menu.note && <p className="dim tiny pad" style={{ paddingBottom: 0 }}>{menu.note}</p>}
          {menu.flag && <p className="cue" style={{ color: "#FBBF24", borderColor: "#FBBF2455", margin: "10px 16px 0" }}>{menu.flag}</p>}
          {menu.items.map((m) => (
            <div key={m.id} className="dish">
              <div className="row gap">
                <div><div className="dishname">{m.name}</div><div className="dim tiny">{m.blurb}</div></div>
                <span className={`badge ${m.effort === "cook" ? "" : "good"}`}>{m.effort}</span>
              </div>
              <div className="dishmacros">
                <span className="mono" style={{ color: C.cal }}>{Math.round(m.calories)}</span>
                <span className="dim tiny">{Math.round(m.protein)}p · {Math.round(m.carbs)}c · {Math.round(m.fat)}f</span>
              </div>
              <div className="rowbtns">
                {m.recipe && <button className="btn ghost wide" onClick={() => setOpenRecipe(openRecipe === m.id ? null : m.id)}>
                  {openRecipe === m.id ? "Hide recipe" : "Recipe"}</button>}
                <button className="btn solid wide" onClick={() => choose(m)}>Eat this</button>
              </div>
              {openRecipe === m.id && m.recipe && (
                <div className="recipe fadein">
                  <div className="dim tiny">Makes {m.recipe.servings || 1}</div>
                  <ul>{m.recipe.ingredients.map((i, n) => <li key={n}>{i}</li>)}</ul>
                  <ol>{m.recipe.steps.map((s, n) => <li key={n}>{s}</li>)}</ol>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <button className="btn ghost wide" onClick={() => setShowLabs(!showLabs)}>
        {showLabs ? "Hide lab work" : `Lab work${labs.length ? ` (${labs.length})` : ""}`}</button>
      {showLabs && <Labs data={data} setData={setData} />}
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
    setData((d) => ({ ...d, labs: [{ id: crypto.randomUUID(), name: name.trim(), value, unit: unit.trim(), date }, ...(d.labs || [])].slice(0, 60) }));
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
          <button className="icon" onClick={() => setData((d) => ({ ...d, labs: d.labs.filter((x) => x.id !== l.id) }))}><X size={14} /></button>
        </div>
      ))}
    </div>
  );
}

/* ---------- weight ---------- */
function Weight({ data, targets, updateDay }) {
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
        <Ring pct={(lost) / (start - goal)} color={C.protein} size={220}>
          <div className="huge">{shown.toFixed(1)}<span className="unit">lb</span></div>
          <div className="dim tiny">{lost > 0 ? `${lost.toFixed(1)} down` : "no change yet"}</div>
          <div className="dim tiny">{(latest - goal).toFixed(1)} to go</div>
        </Ring>
        <div className="row wideinput">
          <label>Weigh in</label>
          <input className="mini" type="number" step="0.1" inputMode="decimal" placeholder="—" value={cur}
            onChange={(e) => updateDay(today, (d) => ({ ...d, weight: e.target.value }))} />
        </div>
        <p className="dim tiny">Same time each morning, before you eat. Fasting days read low — water, not fat.</p>
      </div>

      {series.length > 1 ? (
        <div className="glass pad">
          <ResponsiveContainer width="100%" height={210}>
            <LineChart data={series} margin={{ top: 8, right: 8, left: -22, bottom: 0 }}>
              <CartesianGrid stroke="rgba(255,255,255,0.07)" vertical={false} />
              <XAxis dataKey="day" tick={{ fontSize: 10, fill: "rgba(255,255,255,0.45)" }} tickFormatter={(k) => k.slice(5)} axisLine={false} tickLine={false} />
              <YAxis domain={["dataMin - 2", "dataMax + 2"]} tick={{ fontSize: 10, fill: "rgba(255,255,255,0.45)" }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={{ fontSize: 12, borderRadius: 12, border: "1px solid rgba(255,255,255,0.15)", background: "rgba(20,22,40,0.92)", color: "#fff" }} />
              <ReferenceLine y={goal} stroke={C.protein} strokeDasharray="4 4" />
              <Line type="monotone" dataKey="weight" stroke="rgba(255,255,255,0.28)" strokeWidth={1.5} dot={{ r: 2 }} />
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
        const d = p.days?.[today] || blankDay();
        const cal = d.foods.reduce((a, f) => a + f.calories, 0);
        const prot = d.foods.reduce((a, f) => a + f.protein, 0);
        const ws = Object.entries(p.days || {}).filter(([, x]) => x.weight).sort();
        const latest = ws.length ? +ws[ws.length - 1][1].weight : p.start;
        return (
          <div key={p.name} className="glass">
            <div className="pad">
              <div className="row"><strong>{p.name}</strong>
                <span className="mono" style={{ color: cal > p.target ? C.bad : cal ? C.protein : "rgba(255,255,255,0.4)" }}>
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

/* ---------- history ---------- */
function History({ data, onPick }) {
  const rows = Object.entries(data.days).map(([k, d]) => ({
    k, cal: d.foods.reduce((a, f) => a + f.calories, 0), p: d.foods.reduce((a, f) => a + f.protein, 0),
    weight: d.weight, tags: d.tags || [], sleep: d.sleep, steps: d.steps,
  })).filter((r) => r.cal > 0 || r.weight || r.sleep || r.steps).sort((a, b) => b.k.localeCompare(a.k));
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

function Settings({ data, setData, onSave }) {
  const [copied, setCopied] = useState(false);
  const [paste, setPaste] = useState("");
  const [msg, setMsg] = useState("");
  const t = computeTargets(data.profile, []);
  return (
    <>
      <div className="glass pad">
        <div className="row"><span className="dim">Maintenance</span><strong className="mono">{t.tdee.toLocaleString()}</strong></div>
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
          try { const d = JSON.parse(paste); if (!d.profile || !d.days) throw new Error(); setData(d); setMsg("Restored."); setPaste(""); }
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
      <button className="btn solid wide" onClick={() => onSave({ ...p, age: +p.age, heightIn: +p.heightIn, weight: +p.weight, goalWeight: +p.goalWeight })}>{cta}</button>
    </div>
  );
}

/* ---------- shell ---------- */
function Shell({ children }) {
  return (
    <div className="app">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Sora:wght@300;400;600&family=JetBrains+Mono:wght@400;600&display=swap');
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
        .stagebody { text-align:center; max-width:330px; cursor:pointer; }
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
        .dish { padding:14px 16px; border-top:1px solid rgba(255,255,255,.06); display:flex; flex-direction:column; gap:9px; }
        .dishname { font-size:15px; }
        .dishmacros { display:flex; align-items:baseline; gap:10px; }
        .recipe { border-top:1px solid rgba(255,255,255,.08); padding-top:10px; font-size:13px; }
        .recipe ul, .recipe ol { margin:8px 0 0; padding-left:18px; display:flex; flex-direction:column; gap:5px; }
        .recipe ul { color:rgba(241,245,249,.7); }
        .dockbtn { background:none; border:none; color:rgba(241,245,249,.5); font:inherit; font-size:9.5px; cursor:pointer;
          display:flex; flex-direction:column; align-items:center; gap:3px; padding:8px 9px; border-radius:99px; transition:all .25s; }
        .dockbtn.on { color:#0A0E1F; background:#F1F5F9; font-weight:600; }
        .app *:focus-visible { outline:2px solid #6EE7F9; outline-offset:2px; }
        @media (prefers-reduced-motion:reduce) { *, .app::before, .app::after { animation:none !important; transition:none !important; } }
      `}</style>
      {children}
    </div>
  );
}
