process.env.TZ = process.env.TZ || "America/Denver";
import { buildStatBook, windowKeys, foodLabel, RANGES } from "../src/statbook.js";
let ok = 0, bad = 0; const t = (c, m) => { c ? ok++ : (bad++, console.log("FAIL", m)); };
const f = (name, calories, protein) => ({ name, calories, protein, carbs: 10, fat: 5 });
const days = {
  "2026-10-10": { foods: [f("Eggs, 2 eggs", 140, 12), f("Chicken", 300, 50)], weight: "200", water: 100, steps: "8000", sleep: "7" },
  "2026-10-12": { foods: [f("Eggs, 1 egg", 70, 6), f("Rice", 200, 4)], weight: "199", waist: "36", water: 50, tags: ["lift"] },
  "2026-10-14": { foods: [f("Chicken", 300, 50)], weight: "198", waist: "35" },
  "2026-08-01": { foods: [f("Old day", 500, 10)], weight: "210" },
};
const targetsFor = () => ({ calories: 2000, protein: 100 });
const scoreFn = (d) => ({ total: (d.foods || []).length * 30, parts: [{ key: "cal", done: false }] });
const gradeMeals = (d) => (d.foods || []).map((x) => (x.name === "Chicken" ? { score: 98, letter: "A+" } : { score: 70, letter: "C-" }));
const sb = (n) => buildStatBook({ days, endKey: "2026-10-14", n, targetsFor, scoreFn, gradeMeals, waterGoal: 100 });

t(windowKeys(days, "2026-10-14", 7).length === 7 && windowKeys(days, "2026-10-14", 7)[6] === "2026-10-14", "7-day window ends today");
t(windowKeys(days, "2026-10-14", 7)[0] === "2026-10-08", "7-day window starts 6 days back");
t(windowKeys(days, "2026-10-14", null)[0] === "2026-08-01", "all time starts at the first logged day");
const a = sb(7);
t(a.logged === 3 && a.span === 7, "7 days: three logged days");
t(Math.round(a.nutrition.cal) === Math.round((440 + 270 + 300) / 3), "average calories over logged days only");
t(a.nutrition.bestProtein === 62 && a.nutrition.proteinDays === 0, "best protein day is 62g and no day reached 90% of 100g");
t(a.score.avg === (60 + 60 + 30) / 3 && a.score.best === 60 && a.score.onTrack === 0, "score average, best, and on-track count");
t(a.grades.count === 5 && a.grades.tier1 === 2 && Math.round(a.grades.avg) === Math.round((98 * 2 + 70 * 3) / 5), "meal grades: count, Tier 1 count, average");
t(a.body.weightStart === 200 && a.body.weightNow === 198 && a.body.weightChange === -2 && a.body.waistChange === -1, "weight and waist change inside the window");
t(a.habits.waterAvg === 75 && a.habits.waterDays === 1 && a.habits.stepsAvg === 8000 && a.habits.sleepAvg === 7 && a.habits.activeDays === 1, "habits");
t(a.top[0].name === "Chicken" && a.top[0].count === 2 && a.top.find((x) => x.name === "Eggs").count === 2, "most-eaten foods merge quantities: " + JSON.stringify(a.top[0]));
const dd = { ...days, "2026-10-13": { foods: [f("Eggs", 70, 6)], sessions: [{ id: "1", kind: "lift", focus: "upper", min: 60 }, { id: "2", kind: "lift", focus: "lower", min: 45 }, { id: "3", kind: "ball", focus: "sport", min: 30 }] } };
const w = buildStatBook({ days: dd, endKey: "2026-10-14", n: 7, targetsFor, scoreFn, gradeMeals });
t(w.habits.workouts === 3 && w.habits.workoutMin === 135 && w.habits.focus.upper === 1 && w.habits.focus.lower === 1 && w.habits.focus.sport === 1, "workouts, minutes and body-part split");
const all = sb(null);
t(all.logged === 4 && all.body.weightStart === 210 && all.body.weightChange === -12, "all time reaches back to the first day");
t(sb(30).logged === 3, "30 days leaves out the August day");
t(foodLabel({ name: "Egg whites, 1 cup" }) === "Egg whites" && foodLabel({ baseName: "Oats", name: "Oats, 1/2 cup" }) === "Oats", "food label strips quantity");
const empty = buildStatBook({ days: {}, endKey: "2026-10-14", n: 7, targetsFor, scoreFn, gradeMeals });
t(empty.logged === 0 && empty.nutrition.cal === null && empty.top.length === 0, "empty window is safe");
const fasted = buildStatBook({ days, endKey: "2026-10-14", n: 7, targetsFor, scoreFn, gradeMeals, fasts: [{ start: new Date(2026, 9, 12, 20).getTime(), end: new Date(2026, 9, 13, 12).getTime() }, { start: new Date(2026, 7, 1, 8).getTime(), end: new Date(2026, 7, 2, 8).getTime() }] });
t(fasted.habits.fasts === 1 && Math.round(fasted.habits.fastLongest) === 16, "fasts counted by end day inside the window");
t(RANGES.map((r) => r.id).join() === "7,15,30,60,all", "ranges are 7, 15, 30, 60, all");
console.log(bad ? `${bad} failed` : `statbook ok (${ok})`); process.exit(bad ? 1 : 0);
