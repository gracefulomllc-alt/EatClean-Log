[README.md](https://github.com/user-attachments/files/32488029/README.md)
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
