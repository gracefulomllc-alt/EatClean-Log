// Optional cycle notes: where she probably is in her cycle, and a few general food and training tips.
// Everything is an estimate from the first day of her last period and her usual cycle length. It never changes her calorie targets.
export const PHASES = {
  period: { name: "Period", short: "Days 1 to 5", tips: [
    "Energy can run lower. An easier training day is fine.",
    "Iron-rich foods help: lean beef, beans, lentils, spinach with a source of vitamin C.",
    "Water and warm meals can ease cramps for some people." ] },
  follicular: { name: "Building phase", short: "After your period", tips: [
    "Energy and mood often rise. A good time for harder training and new lifts.",
    "Keep protein steady, it helps recovery as the training gets harder." ] },
  ovulation: { name: "Peak window", short: "Around mid-cycle", tips: [
    "Strength and energy are often at their best around now.",
    "Warm up well and take your joints seriously, they can feel looser this time of the month." ] },
  luteal: { name: "Pre-period phase", short: "The week or two before your period", tips: [
    "Appetite and cravings often go up. A little extra food is normal, and protein and fiber keep you full.",
    "The scale can read 1 to 3 pounds higher from water. That is not fat, so judge the weekly trend, not today.",
    "Sleep and steady water make this stretch easier." ] },
};

const dayMs = 864e5;
const utc = (k) => { const [y, m, d] = String(k).split("-").map(Number); return Date.UTC(y, (m || 1) - 1, d || 1); };

// day: 1-based day of the cycle for dayKey, given the first day of the last period and the usual length.
export function cycleDay(startKey, dayKey, len = 28) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(startKey || "")) || !/^\d{4}-\d{2}-\d{2}$/.test(String(dayKey || ""))) return null;
  const L = Math.max(21, Math.min(40, Math.round(+len) || 28));
  const diff = Math.floor((utc(dayKey) - utc(startKey)) / dayMs);
  if (diff < 0) return null;
  return { day: (diff % L) + 1, len: L, cycles: Math.floor(diff / L) };
}

export function cyclePhase(startKey, dayKey, len = 28) {
  const c = cycleDay(startKey, dayKey, len);
  if (!c) return null;
  const ov = c.len - 14;                     // ovulation sits about 14 days before the next period
  let key = "luteal";
  if (c.day <= 5) key = "period";
  else if (c.day < ov - 1) key = "follicular";
  else if (c.day <= ov + 1) key = "ovulation";
  return { key, ...PHASES[key], day: c.day, len: c.len, daysToNext: c.len - c.day + 1, late: c.cycles >= 3 };
}
