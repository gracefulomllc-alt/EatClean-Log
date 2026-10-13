# Cut Log

Fasting timer, food log, meal planner and recipe builder. React + Vite on Netlify.

## Layout

```
src/App.jsx                    the whole app
src/main.jsx                   boot, service worker, install prompt
public/                        manifest, service worker, icons (installable app)
netlify/functions/claude.js    photo, label and menu estimates via Gemini
netlify/functions/food.js      USDA FoodData Central search + Open Food Facts barcodes
netlify/functions/sync.js      your log, synced across devices by sync code
netlify/functions/photos.js    progress photos, stored under your sync code
netlify/functions/push.js      fasting-alert subscriptions
netlify/functions/push-tick.js runs every 10 min: fasting-stage notifications + logging reminders
netlify/functions/group.js     shared group log
netlify/lib/push-shared.js     fasting stages + push keys, shared by the push functions
netlify/lib/codekey.js         turns a sync code into a storage key (the code itself is never stored)
```

## Where the numbers come from

| Method | Source | Accuracy |
|---|---|---|
| Barcode | Open Food Facts (the package's own label data) | exact |
| Label photo | the printed Nutrition Facts panel, transcribed | exact if legible |
| Weigh | USDA FoodData Central, per 100 g | as good as your scale |
| Recipe | sum of weighed ingredients ÷ finished weight | as good as your scale |
| Plate photo / describe | Gemini estimate | ±20–25% |

## Your calorie budget

Starts from a formula (Mifflin-St Jeor), which is typically ~10% off. After ~3 weeks of
weigh-ins and fully logged days, the app fits a line through your weigh-ins and works out
your real maintenance from energy balance: intake − (lb lost × 3500 ÷ days). It only works
if you log everything; the minimum-budget floor applies regardless.

## Environment variables

| Variable | Needed for |
|---|---|
| `GEMINI_API_KEY` | photo, label, describe, menu, watch import |
| `USDA_API_KEY` | food search (falls back to a ~50/day demo key) |
| `ACCESS_CODE` | optional — locks the whole site behind a code |
| `GEMINI_MODEL` | optional — override if Google renames the model |

Push notification keys are generated automatically on first use and kept in Netlify Blobs.

## Data

Your log is saved in the browser. Turn on **Setup → Sync** and it's also stored
server-side under a hash of a 16-character sync code; enter that code on another
device to share the same log. Lab values never go into the shared group log.

## Phase 1 additions
- **Meal tiers**: "Rate this meal" sorts each food by processing level, then plain rules set Tier 1 / 2 / 3 / Off-plan from the whole plate and its portion against what's left today.
- **Accountability score** (100 pts/day): meals 20, calorie range 20 (within 10% only), protein 20, veggies/fiber 15 (tap), activity or recovery 10, water 5, group check-in 10 (unlocks with groups). Nothing rewards eating less or fasting longer.
- **Optional fasting**: off for new logs; Settings > Fasting tracker, with a safety notice, blocked under 18 or BMI under 18.5, and warnings past 20/24/36 hours.
- **Recovery mode / rest days**: no earned calories, protein stays high, step goal halved, never penalized.
- **Lifting log**: exercises with sets x reps x weight, "last time" hints, strength trend in the Weight tab.

## Hardwood theme, live NBA scores, South Plains
- Hardwood court look is the default (Settings > Look to switch). Hoops language, box score with a W/L strip, basketball on the fasting clock.
- `/api/scores` (Netlify function) reads ESPN's free scoreboard: preseason, regular season, play-in and playoffs, with live scores (refreshes every 15s during live games).
- South Plains Texans games live in `src/spcSchedule.js`. Add one line per game.

## Groups and fast watch
- Open shared log removed. `/api/groups` runs invite-only groups (3 to 20 people, 12-character invite code stored only as a hash).
- Each person picks what friends see (fasting clock, weight, calories and protein, daily habits). Anything switched off is never sent, and the server re-filters to a fixed whitelist. Lab values and points are never shared.
- Fast watch: friends see who is fasting and for how long. Every 12 hours from hour 24 the faster gets an in-app "Still fasting?" check-in; no answer within 2 hours shows friends "not confirmed". Friends can send "Check on them" or "Cheer". No automatic alerts go to friends.
- The old Desktop '95 theme is gone (existing logs land on Hardwood). New: Modern.
