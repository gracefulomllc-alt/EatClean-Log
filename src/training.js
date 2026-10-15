// Workouts: what kind, which part of the body, how long and how hard, and what that is worth.
// Calories use METs: net burn = (MET - 1) x kg x hours. The "-1" leaves out what you'd burn sitting anyway,
// because your daily budget already counts normal activity. Only half of it is handed back as extra food.
export const KINDS = {
  lift: { label: "Lifting", focus: ["upper", "lower", "full", "core"], defaultFocus: "full", met: [3.5, 5, 6, 8] },
  ball: { label: "Basketball or sport", focus: ["sport"], defaultFocus: "sport", met: [4.5, 6.5, 8, 10] },
  cardio: { label: "Cardio", focus: ["cardio"], defaultFocus: "cardio", met: [4, 6, 8.5, 11] },
  walk: { label: "Walk", focus: [], defaultFocus: "", met: [2.8, 3.5, 4.3, 5] },
  site: { label: "Job site", focus: [], defaultFocus: "", met: [3, 4, 5.5, 7] },
  stretch: { label: "Stretching or mobility", focus: ["full"], defaultFocus: "full", met: [2, 2.3, 2.8, 3.3] },
};
export const FOCUS = { upper: "Upper body", lower: "Lower body", full: "Full body", core: "Core", cardio: "Cardio", sport: "Sport or game" };
export const EFFORT = [
  { n: 1, label: "Easy", hint: "You could talk the whole time" },
  { n: 2, label: "Moderate", hint: "Breathing harder, still talking" },
  { n: 3, label: "Hard", hint: "Only a few words at a time" },
  { n: 4, label: "All-out", hint: "Max effort, can't talk" },
];
export const DURATIONS = [20, 30, 45, 60, 90];
export const MAX_EARNED = 500;
export const MAX_PROTEIN_BUMP = 30;

export const newSession = (kind, extra = {}) => ({
  id: extra.id || (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : String(Date.now()) + Math.random().toString(36).slice(2)),
  kind, focus: KINDS[kind]?.defaultFocus || "", min: 45, effort: 2, dist: "", src: "manual", u: Date.now(), ...extra,
});

// Calories above sitting for one session. Rounded to 5.
export function netCal(s, weightLb) {
  const k = KINDS[s?.kind]; if (!k) return 0;
  const min = Math.max(0, Math.min(600, +s.min || 0));
  const met = k.met[Math.max(1, Math.min(4, Math.round(+s.effort || 2))) - 1];
  const kg = (+weightLb || 180) * 0.4536;
  return Math.max(0, Math.round(((met - 1) * kg * (min / 60)) / 5) * 5);
}

// What the day's sessions hand back: half the burn, capped, nothing while recovering. Protein goes up for hard or long sessions.
export function sessionExtra(sessions, weightLb, recovering = false) {
  const list = (sessions || []).filter((s) => s && KINDS[s.kind]);
  if (!list.length) return null;
  const burn = list.reduce((a, s) => a + netCal(s, weightLb), 0);
  const earned = recovering ? 0 : Math.min(MAX_EARNED, Math.round((burn * 0.5) / 10) * 10);
  const hard = list.filter((s) => s.kind !== "stretch" && s.kind !== "walk" && (+s.effort >= 3 || (s.kind === "lift" && +s.min >= 30))).length;
  const protein = recovering ? 0 : Math.min(MAX_PROTEIN_BUMP, hard * 10);
  return { earned, protein, burn };
}

export const kindsOf = (sessions) => [...new Set((sessions || []).map((s) => s.kind).filter(Boolean))];

export function describeSession(s) {
  const k = KINDS[s.kind];
  const parts = [k?.label || s.kind];
  if (s.focus && FOCUS[s.focus] && FOCUS[s.focus] !== k?.label) parts.push(FOCUS[s.focus]);
  if (+s.min) parts.push(`${Math.round(+s.min)} min`);
  const e = EFFORT.find((x) => x.n === Math.round(+s.effort));
  if (e) parts.push(e.label);
  return parts.join(" · ");
}

// A watch or phone names its workouts its own way. Map the name onto one of our kinds and body focus.
export function mapWorkoutType(name) {
  const n = String(name || "").toLowerCase().replace(/_/g, " ");
  if (/strength|weight|lift|resistance|crossfit|calisthenic|functional/.test(n)) return { kind: "lift", focus: "full" };
  if (/basketball|soccer|football|tennis|volleyball|baseball|softball|hockey|golf|rugby|lacrosse|badminton|squash|handball|sport|boxing|martial|wrestl/.test(n)) return { kind: "ball", focus: "sport" };
  if (/run|jog|cycl|bik|swim|row|elliptic|hiit|high intensity|interval|cardio|stair|spin|aerobic|dance|jump rope/.test(n)) return { kind: "cardio", focus: "cardio" };
  if (/walk|hik/.test(n)) return { kind: "walk", focus: "" };
  if (/yoga|stretch|pilates|flexib|mobility|cooldown|cool down/.test(n)) return { kind: "stretch", focus: "full" };
  return { kind: "cardio", focus: "cardio" };
}
