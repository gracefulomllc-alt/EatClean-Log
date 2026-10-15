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
  const g = Math.round(dens * 10) / 10, pctDay = Math.round((cal / targetCal) * 100), fp = Math.round(fatPct * 100);
  const parts = [
    { key: "protein", label: "Protein for its calories", pts: Math.round(proteinPts), max: 35,
      note: cls === 1 && proteinPts <= 22.01 && dens < (goal === "gain" ? 6 : 9) ? `${g}g per 100 cal. Low, but whole foods like this still get most of the credit.` : `${Math.round(pr)}g protein in ${Math.round(cal)} cal is ${g}g per 100 cal. ${dens >= (goal === "gain" ? 6 : 9) ? "That hits the target." : `Aim for ${goal === "gain" ? 6 : 9} or more.`}`,
      tip: "Add a protein: chicken, eggs, egg whites, Greek yogurt or a scoop of whey." },
    { key: "whole", label: "How whole the food is", pts: Math.round(procPts), max: 25,
      note: cls === 1 ? "Mostly whole, minimally processed food." : cls === 3 ? "Heavily processed (fried, packaged or fast food)." : "A mix of whole and processed ingredients.",
      tip: "Swap something processed for a whole version: grilled instead of breaded, fruit instead of candy." },
    { key: "portion", label: "Portion size", pts: Math.round(portionPts), max: 20,
      note: `${Math.round(cal)} cal is ${pctDay}% of your ${Math.round(targetCal).toLocaleString()} cal day. ${over <= 1 ? "A sensible size for one sitting." : "Bigger than a typical sitting for your goal."}`,
      tip: "Cut the portion, or split it across two sittings." },
    { key: "fat", label: "Fat balance", pts: Math.round(fatPts), max: 20,
      note: `${fp}% of the calories come from fat. ${fatPct <= 0.3 ? "Nicely balanced." : "Under 30% is ideal."}`,
      tip: "Use less oil, butter or cheese, or pick a leaner cut." },
  ];
  // The weakest area becomes the one-line reason and the tip.
  const ranked = parts.slice().sort((a, b) => (b.max - b.pts) / b.max - (a.max - a.pts) / a.max);
  const weak = ranked[0], gap = (weak.max - weak.pts) / weak.max;
  const good = proteinPts >= 30 && procPts >= 25 ? "High protein and mostly whole food." : proteinPts >= 30 ? "Strong on protein." : "";
  const why = gap < 0.12 ? (good || "Balanced for your goal.") : `${weak.note}${(ranked[1].max - ranked[1].pts) / ranked[1].max >= 0.4 ? " " + ranked[1].note : ""}`;
  return { score, letter, why, parts, tip: gap < 0.12 ? "" : weak.tip };
}
