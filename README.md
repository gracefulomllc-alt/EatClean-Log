[README.md](https://github.com/user-attachments/files/32488029/README.md)
# Cut Log

Fasting timer, food log, meal planner and recipe builder. React + Vite on Netlify.

## Layout

```
src/App.jsx                    the whole app
src/main.jsx                   boot, service worker, install prompt
public/                        manifest, service worker, icons (installable app)
netlify/functions/claude.js    photo, label and menu estimates via Netlify AI Gateway
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
| Plate photo / describe | Claude estimate | ±20–25% |

## Planning a meal

The Plan tab works out what a single meal should come to before it suggests anything. Two
numbers, because they disagree and both are useful: what's left today divided by the meals you
haven't eaten yet, and the share of the day's budget a meal of that kind usually takes. The
first is the number to cook to, the two together are a range to land inside.

The three options it gives you are sized to that number, and each one comes with a weighed
breakdown — every component in grams with the calories that weight contributes, cooking oil on
its own line, raw weights where it matters. The calories shown on a dish are the sum of those
lines rather than a separate guess, so the card, the scale and your log always agree.

## Your calorie budget

Starts from a formula (Mifflin-St Jeor), which is typically ~10% off. After ~3 weeks of
weigh-ins and fully logged days, the app fits a line through your weigh-ins and works out
your real maintenance from energy balance: intake − (lb lost × 3500 ÷ days). It only works
if you log everything; the minimum-budget floor applies regardless.

## Environment variables

Anything that asks a model a question runs through **Netlify AI Gateway**, which injects
`ANTHROPIC_API_KEY` and `ANTHROPIC_BASE_URL` at runtime. There is no AI key to set or rotate —
it needs one production deploy to activate, and usage bills to your Netlify credits.

| Variable | Needed for |
|---|---|
| `USDA_API_KEY` | food search (falls back to a ~50/day demo key) |
| `ACCESS_CODE` | optional — locks the whole site behind a code |
| `ANTHROPIC_MODEL` | optional — override the model AI Gateway is asked for |

A leftover `GEMINI_API_KEY` is no longer read. Worth deleting: while one is set, Netlify
suppresses its own Gemini credentials for the project.

Push notification keys are generated automatically on first use and kept in Netlify Blobs.

## Data

Your log is saved in the browser. Turn on **Setup → Sync** and it's also stored
server-side under a hash of a 16-character sync code; enter that code on another
device to share the same log. Lab values never go into the shared group log.
