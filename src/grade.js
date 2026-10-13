// School-style grades (A+ to F) for any food or meal, worked out on the phone from its numbers.
// 100 points: protein per calorie 35, how whole the food is 25, portion fit 20, fat balance 20.
const LETTERS = [[97, "A+"], [93, "A"], [90, "A-"], [87, "B+"], [83, "B"], [80, "B-"], [77, "C+"], [73, "C"], [70, "C-"], [67, "D+"], [63, "D"], [60, "D-"]];
export const letterFor = (score) => (LETTERS.find(([min]) => score >= min) || [0, "F"])[1];
export const gradeTone = (letter) => (letter[0] === "A" ? "#22C55E" : letter[0] === "B" ? "#84CC16" : letter[0] === "C" ? "#EAB308" : letter[0] === "D" ? "#F97316" : "#EF4444");

// m: {calories, protein, carbs, fat}; cls: 1 whole, 2 mixed, 3 processed (default 2)
// ctx: {goal: lose|maintain|gain, targetCal, share} — share = how much of the day this item is (0.35 meal, 0.15 snack)
export function gradeFood(m, cls = 2, ctx = {}) {
  const cal = Math.max(1, +m.calories || 0), pr = +m.protein || 0, fat = +m.fat || 0;
  const goal = ctx.goal || "lose", targetCal = +ctx.targetCal > 0 ? +ctx.targetCal : 2000;
  const share = ctx.share || (cal < 220 ? 0.15 : 0.35);
  const dens = (pr / cal) * 100;
  // Whole foods low in protein (fruit, veg, rice) still earn most of the credit.
  const proteinPts = Math.max(cls === 1 ? 22 : 0, 35 * Math.min(1, dens / (goal === "gain" ? 6 : 9)));
  const procPts = cls === 1 ? 25 : cls === 3 ? 4 : 15;
  const ideal = targetCal * share * (goal === "gain" ? 1.3 : 1) * 1.15;
  const over = cal / ideal;
  const portionPts = over <= 1 ? 20 : Math.max(0, 20 - (over - 1) * 40);
  const fatPct = (fat * 9) / cal;
  const fatPts = 20 - Math.min(1, Math.max(0, (fatPct - 0.3) / 0.25)) * 20;
  const score = Math.round(proteinPts + procPts + portionPts + fatPts);
  const letter = letterFor(score);
  // The weakest area becomes the one-line reason.
  const gaps = [
    [35 - proteinPts, `Low in protein for its calories (${Math.round(pr)}g in ${Math.round(cal)}).`],
    [25 - procPts, cls === 3 ? "Heavily processed." : "Not mostly whole foods."],
    [20 - portionPts, "Big for one sitting."],
    [20 - fatPts, "A lot of the calories come from fat."],
  ].sort((a, b) => b[0] - a[0]);
  const good = proteinPts >= 30 && procPts >= 25 ? "High protein and mostly whole food." : proteinPts >= 30 ? "Strong on protein." : "";
  const why = gaps[0][0] < 4 ? (good || "Balanced for your goal.") : `${gaps[0][1]}${gaps[1][0] >= 8 ? " " + gaps[1][1] : ""}`;
  return { score, letter, why };
}
