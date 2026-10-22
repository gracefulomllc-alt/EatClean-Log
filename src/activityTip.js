import { sessionExtra, describeSession } from "./training.js";

// A plain-language read on today's activity. Information only: it never changes the budget.
// Workouts already add to your budget (half of what they burn, plus protein for hard days). Steps are only a suggestion.
// Steps your activity level already assumes in the daily budget. Only steps above this count as extra.
export const USUAL_STEPS = { sedentary: 4500, light: 6500, moderate: 8500, high: 11000 };
const KCAL_PER_STEP_PER_LB = 0.00015;   // about 0.3 kcal per lb per mile, 2,000 steps to a mile (net of sitting)
const MAX_STEP_SUGGEST = 200;
const WALK_STEPS_PER_MIN = 100;

export function activityTip({ steps, sessions, weightLb, activity, recovering = false }) {
  const n = Math.max(0, Math.round(+steps || 0));
  const list = (sessions || []).filter(Boolean);
  const ex = sessionExtra(list, weightLb, recovering);
  const workouts = list.map((s) => describeSession(s));
  const walkSteps = list.filter((s) => s.kind === "walk").reduce((a, s) => a + (+s.min || 0) * WALK_STEPS_PER_MIN, 0);
  const usual = USUAL_STEPS[activity] || USUAL_STEPS.moderate;
  const extraSteps = Math.max(0, n - usual - walkSteps);
  const showSteps = extraSteps >= 1000;
  const stepCal = recovering || !showSteps ? 0 : Math.min(MAX_STEP_SUGGEST, Math.round((extraSteps * (+weightLb || 180) * KCAL_PER_STEP_PER_LB * 0.5) / 5) * 5);
  return {
    has: n > 0 || list.length > 0,
    recovering,
    workouts,
    inBudgetCal: ex?.earned || 0,
    inBudgetProtein: ex?.protein || 0,
    burn: ex?.burn || 0,
    steps: n, usual, extraSteps: showSteps ? extraSteps : 0, stepCal,
  };
}
