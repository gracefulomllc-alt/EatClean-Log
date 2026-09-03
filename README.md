# Cut Log

A fasting timer, food log, and meal planner. React + Vite, deployed on Netlify with two serverless functions.

## What's here

```
src/App.jsx              the whole app
netlify/functions/claude.js   proxies Anthropic so your API key stays server-side
netlify/functions/group.js    the shared group log, backed by Netlify Blobs
```

Personal data (your food log, weight, labs, backups) lives in the browser's
localStorage. It never leaves the device. Lab values are excluded from the
shared log by design, regardless of your sharing setting.

## Deploy

1. **Push to GitHub.**
   ```bash
   git init && git add -A && git commit -m "Cut Log"
   gh repo create cutlog --private --source=. --push
   ```

2. **Connect it to Netlify.** New site → import from GitHub → pick the repo.
   Build settings come from `netlify.toml`, so leave them alone.

3. **Set environment variables** in Netlify under Site configuration →
   Environment variables:

   | Variable | Required | What it does |
   |---|---|---|
   | `ANTHROPIC_API_KEY` | yes | Your key from console.anthropic.com. Server-side only. |
   | `ACCESS_CODE` | strongly recommended | If set, nobody can use the AI features or the group log without it. |

4. **Deploy.** Netlify Blobs needs no setup — the functions create their stores
   on first write.

## About the access code

If you set `ACCESS_CODE`, each person enters it once and the browser remembers it:

```js
localStorage.setItem("cutlog:code", "whatever-you-set")
```

Add a proper entry screen later if you want; for a handful of friends, telling
them to paste that line into the console once is enough.

**Leaving `ACCESS_CODE` unset makes the site fully open.** That means anyone who
finds the URL can spend your Anthropic credit and read everyone's food log. The
rate limits in `claude.js` cap the damage but don't prevent it.

## Cost control

`netlify/functions/claude.js` has three limits at the top:

```js
const PER_IP_PER_HOUR = 40;
const GLOBAL_PER_DAY   = 600;
const MAX_TOKENS       = 1200;
```

`GLOBAL_PER_DAY` is your real safety net — it's the most requests the whole site
can make in a day no matter how many people show up. Lower it until you know what
normal use costs you. Photo estimates are the expensive calls because they send
an image; text-only ones are cheap.

Watch actual spend at console.anthropic.com and set a billing limit there too.
The function limits protect you from a bad day; a billing cap protects you from
a bad week.

## Local development

```bash
npm install
npm i -g netlify-cli
netlify dev
```

`netlify dev` runs the functions alongside Vite so `/api/claude` and `/api/group`
work locally. Plain `npm run dev` serves the UI but the AI features will 404.
