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
  // Calorie-free things (water, black coffee) aren't marked down for having no protein.
  const addon = !!ctx.addon;   // oils, butter, sauces, sweeteners: used in small amounts, so protein and fat share don't count against them
  const proteinPts = addon ? 25 : cal < 30 ? 35 : Math.max(cls === 1 ? (fat * 9 <= 0.3 * cal ? 30 : 22) : 0, 35 * Math.min(1, dens / (goal === "gain" ? 6 : 9)));
  const procPts = cls === 1 ? 25 : cls === 3 ? 4 : 15;
  const ideal = targetCal * share * (goal === "gain" ? 1.3 : 1) * 1.15;
  const over = cal / ideal;
  const portionPts = over <= 1 ? 20 : Math.max(0, 20 - (over - 1) * 40);
  // Fat is judged by what kind of food it is: the natural fat in eggs, salmon, avocado or nuts is fine,
  // while the same share of fat in fried or packaged food is not.
  const fatPct = (fat * 9) / cal;
  const [fatLim, fatSpan] = cls === 1 ? [0.75, 0.3] : cls === 3 ? [0.3, 0.25] : [0.5, 0.35];
  const fatPts = addon || cal < 30 ? 20 : 20 - Math.min(1, Math.max(0, (fatPct - fatLim) / fatSpan)) * 20;
  const score = Math.round(proteinPts + procPts + portionPts + fatPts);
  const letter = letterFor(score);
  const g = Math.round(dens * 10) / 10, pctDay = Math.round((cal / targetCal) * 100), fp = Math.round(fatPct * 100);
  const parts = [
    { key: "protein", label: "Protein for its calories", pts: Math.round(proteinPts), max: 35,
      note: addon ? "A cooking fat, sauce or sweetener. Protein is not expected here, so it is graded mostly on how much you use." : cls === 1 && proteinPts <= 30.01 && dens < (goal === "gain" ? 6 : 9) ? `${g}g per 100 cal. Low, but whole foods like this still get most of the credit.` : `${Math.round(pr)}g protein in ${Math.round(cal)} cal is ${g}g per 100 cal. ${dens >= (goal === "gain" ? 6 : 9) ? "That hits the target." : `Aim for ${goal === "gain" ? 6 : 9} or more.`}`,
      tip: "Add a protein: chicken, eggs, egg whites, Greek yogurt or a scoop of whey." },
    { key: "whole", label: "How whole the food is", pts: Math.round(procPts), max: 25,
      note: cls === 1 ? "Mostly whole, minimally processed food." : cls === 3 ? "Heavily processed (fried, packaged or fast food)." : "A mix of whole and processed ingredients.",
      tip: "Swap something processed for a whole version: grilled instead of breaded, fruit instead of candy." },
    { key: "portion", label: "Portion size", pts: Math.round(portionPts), max: 20,
      note: `${Math.round(cal)} cal is ${pctDay}% of your ${Math.round(targetCal).toLocaleString()} cal day. ${over <= 1 ? "A sensible size for one sitting." : "Bigger than a typical sitting for your goal."}`,
      tip: "Cut the portion, or split it across two sittings." },
    { key: "fat", label: "Fat balance", pts: Math.round(fatPts), max: 20,
      note: addon ? "Cooking fats and sauces are mostly fat by nature, so this is not held against it. Measure it, since the calories add up fast." : `${fp}% of the calories come from fat. ${fatPct <= fatLim ? (cls === 1 && fatPct > 0.4 ? "That's natural fat from a whole food, which is fine." : "Nicely balanced.") : cls === 1 ? "High, even for a whole food. Watch the oil or butter added." : `Under ${Math.round(fatLim * 100)}% is ideal for this kind of food.`}`,
      tip: "Use less oil, butter or cheese, or pick a leaner cut." },
  ];
  // The weakest area becomes the one-line reason and the tip.
  const ranked = parts.slice().sort((a, b) => (b.max - b.pts) / b.max - (a.max - a.pts) / a.max);
  const weak = ranked[0], gap = (weak.max - weak.pts) / weak.max;
  const good = proteinPts >= 30 && procPts >= 25 ? "High protein and mostly whole food." : proteinPts >= 30 ? "Strong on protein." : "";
  const why = gap < 0.12 ? (good || "Balanced for your goal.") : `${weak.note}${(ranked[1].max - ranked[1].pts) / ranked[1].max >= 0.4 ? " " + ranked[1].note : ""}`;
  return { score, letter, why, parts, tip: gap < 0.12 ? "" : weak.tip };
}
