// School-style grades (A+ to F) for any food or meal, worked out on the phone from its numbers and name.
// Built around health first, because good health is what keeps the weight off. 100 points:
//   30 how whole the food is   25 protein (keeps you full and keeps muscle)   20 portion size for your goal
//   15 added sugar and refined carbs   10 fat quality (natural fat is fine, fried and packaged fat is not)
const LETTERS = [[97, "A+"], [93, "A"], [90, "A-"], [87, "B+"], [83, "B"], [80, "B-"], [77, "C+"], [73, "C"], [70, "C-"], [67, "D+"], [63, "D"], [60, "D-"]];
export const letterFor = (score) => (LETTERS.find(([min]) => score >= min) || [0, "F"])[1];
export const gradeTone = (letter) => (letter[0] === "A" ? "#22C55E" : letter[0] === "B" ? "#84CC16" : letter[0] === "C" ? "#EAB308" : letter[0] === "D" ? "#F97316" : "#EF4444");

// The tier names the app already uses, so a grade and a tier always agree.
export const tierFor = (letter) => (letter[0] === "A" ? { n: 1, name: "Tier 1 · whole, healthy food" } : letter[0] === "B" ? { n: 2, name: "Tier 2 · mostly good" }
  : letter[0] === "C" || letter[0] === "D" ? { n: 3, name: "Tier 3 · processed or heavy" } : { n: 4, name: "Off plan · save it for rare days" });

// Foods that are mostly sugar in a cup or a spoon.
const SUGARY = /\b(soda|pop|juice|candy|cookie|cake|donut|doughnut|brownie|pastry|ice cream|milkshake|shake|syrup|sugar|honey|jam|frosting|sweet|energy drink|sports drink|lemonade|sweet tea|cereal|granola|pop-?tart|chocolate)\b/i;

// Refined grains: digested fast, so they count less than whole grains.
const REFINED = /\b(white rice|white bread|bread|bagel|pasta|noodles?|tortilla|english muffin|muffin|rice cakes?|crackers?|pretzels?)\b/i;
const WHOLEGRAIN = /whole|brown|corn tortilla|sprouted|oat|quinoa|barley/i;

// m: {calories, protein, carbs, fat}; cls: 1 whole, 2 mixed, 3 processed (default 2)
// ctx: {goal, targetCal, share, addon, names} — share = how much of the day this item is (0.35 meal, 0.15 snack)
export function gradeFood(m, cls = 2, ctx = {}) {
  const cal = Math.max(1, +m.calories || 0), pr = +m.protein || 0, carbs = +m.carbs || 0, fat = +m.fat || 0;
  const goal = ctx.goal || "lose", targetCal = +ctx.targetCal > 0 ? +ctx.targetCal : 2000;
  const share = ctx.share || (cal < 220 ? 0.15 : 0.35);
  const addon = !!ctx.addon, tiny = cal < 30;
  const sugary = SUGARY.test(String(ctx.names || "").replace(/rice cakes?/gi, ""));
  const dens = (pr / cal) * 100, goalDens = goal === "gain" ? 6 : 9;
  const fatPct = (fat * 9) / cal, carbPct = (carbs * 4) / cal;

  // 1. How whole the food is
  const wholePts = cls === 1 ? 30 : cls === 3 ? 5 : 18;
  // 2. Protein. Whole plant foods low in protein (fruit, vegetables, rice) still earn most of the credit.
  const proteinPts = tiny ? 25 : addon ? 17 : Math.max(cls === 1 && fatPct <= 0.3 ? 21 : cls === 1 ? 16 : 0, 25 * Math.min(1, dens / goalDens));
  // 3. Portion size against your day
  const ideal = targetCal * share * (goal === "gain" ? 1.3 : 1) * 1.15, over = cal / ideal;
  const portionPts = over <= 1 ? 20 : Math.max(0, 20 - (over - 1) * 40);
  // 4. Added sugar and refined carbs
  const names = String(ctx.names || "");
  const refined = REFINED.test(names) && !WHOLEGRAIN.test(names);
  const sugarPts = tiny ? 15 : sugary ? (cls === 1 ? 9 : 2) : cls === 3 ? (carbPct > 0.5 ? 6 : 10) : refined ? 8 : 15;
  // 5. Fat quality: the natural fat in eggs, salmon, avocado or nuts is fine; the same share in fried or packaged food is not.
  const [fatLim, fatSpan] = cls === 1 ? [0.75, 0.3] : cls === 3 ? [0.3, 0.25] : [0.5, 0.35];
  const fatPts = addon || tiny ? 10 : 10 - Math.min(1, Math.max(0, (fatPct - fatLim) / fatSpan)) * 10;

  const score = Math.round(wholePts + proteinPts + portionPts + sugarPts + fatPts);
  const letter = letterFor(score);
  const g = Math.round(dens * 10) / 10, pctDay = Math.round((cal / targetCal) * 100), fp = Math.round(fatPct * 100);
  const parts = [
    { key: "whole", label: "How whole the food is", pts: Math.round(wholePts), max: 30,
      note: cls === 1 ? "Mostly whole, minimally processed food. That's the biggest health win." : cls === 3 ? "Heavily processed (fried, packaged or fast food)." : "A mix of whole and processed ingredients.",
      tip: "Swap something processed for a whole version: grilled instead of breaded, fruit instead of candy." },
    { key: "protein", label: "Protein", pts: Math.round(proteinPts), max: 25,
      note: addon ? "A cooking fat, sauce or sweetener. Protein is not expected here, so it is graded on how much you use." : tiny ? "Almost no calories, so nothing to mark down." : cls === 1 && proteinPts <= 21.01 && dens < goalDens ? `${g}g per 100 cal. Low, but whole plant foods like this still get most of the credit.` : `${Math.round(pr)}g protein in ${Math.round(cal)} cal is ${g}g per 100 cal. ${dens >= goalDens ? "That keeps you full and protects muscle." : `Aim for ${goalDens} or more.`}`,
      tip: "Add a protein: chicken, eggs, egg whites, Greek yogurt or a scoop of whey." },
    { key: "portion", label: "Portion size", pts: Math.round(portionPts), max: 20,
      note: `${Math.round(cal)} cal is ${pctDay}% of your ${Math.round(targetCal).toLocaleString()} cal day. ${over <= 1 ? "A sensible size for one sitting." : "Bigger than a typical sitting for your goal."}`,
      tip: "Cut the portion, or split it across two sittings." },
    { key: "sugar", label: "Added sugar and refined carbs", pts: Math.round(sugarPts), max: 15,
      note: tiny ? "Nothing to mark down." : sugary ? (cls === 1 ? "Natural sugar, but concentrated. Fine in small amounts." : "Mostly sugar. It spikes hunger and works against keeping the weight off.") : refined && cls !== 3 ? "A refined grain. It digests fast and leaves you hungry sooner than whole grains." : cls === 3 ? "Processed carbs. They are digested fast and leave you hungry again." : "No sign of added sugar.",
      tip: "Cut the sweet part: water or unsweetened drinks, fruit instead of dessert." },
    { key: "fat", label: "Fat quality", pts: Math.round(fatPts), max: 10,
      note: addon ? "Cooking fats and sauces are mostly fat by nature, so this is not held against it. Measure it, since the calories add up fast." : `${fp}% of the calories come from fat. ${fatPct <= fatLim ? (cls === 1 && fatPct > 0.4 ? "That's natural fat from a whole food, which is fine." : "Nicely balanced.") : cls === 1 ? "High, even for a whole food. Watch the oil or butter added." : `Under ${Math.round(fatLim * 100)}% is ideal for this kind of food.`}`,
      tip: "Use less oil, butter or cheese, or pick a leaner cut." },
  ];
  // The weakest area becomes the one-line reason and the tip.
  const lost = (p) => (p.max - p.pts) / p.max;
  const ranked = parts.slice().sort((a, b) => lost(b) - lost(a));
  const weak = ranked[0];
  const good = wholePts >= 30 && proteinPts >= 22 ? "Whole, healthy food with solid protein." : wholePts >= 30 ? "Whole, healthy food." : "";
  const why = lost(weak) < 0.12 ? (good || "Healthy and balanced for your goal.") : `${weak.note}${lost(ranked[1]) >= 0.4 ? " " + ranked[1].note : ""}`;
  return { score, letter, why, parts, tip: lost(weak) < 0.12 ? "" : weak.tip, tier: tierFor(letter) };
}
