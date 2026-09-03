import { getStore } from "@netlify/blobs";

// Guardrails. Tune these before you hand the link out widely.
const PER_IP_PER_HOUR = 40;      // requests one visitor can make in an hour
const GLOBAL_PER_DAY = 600;      // total requests across everyone, per day
const MAX_TOKENS = 1200;         // hard ceiling regardless of what the client asks for
const ALLOWED_MODELS = ["claude-sonnet-4-6"];

const hourKey = () => `h:${new Date().toISOString().slice(0, 13)}`;
const dayKey = () => `d:${new Date().toISOString().slice(0, 10)}`;

async function bump(store, key, limit) {
  const cur = Number((await store.get(key)) || 0);
  if (cur >= limit) return false;
  await store.set(key, String(cur + 1));
  return true;
}

export default async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const code = Netlify.env.get("ACCESS_CODE");
  if (code && req.headers.get("x-access-code") !== code) {
    return new Response("Bad access code", { status: 401 });
  }

  const key = Netlify.env.get("ANTHROPIC_API_KEY");
  if (!key) return new Response("Server is missing ANTHROPIC_API_KEY", { status: 500 });

  const limits = getStore("cutlog-limits");
  const ip = req.headers.get("x-nf-client-connection-ip") || "unknown";

  if (!(await bump(limits, dayKey(), GLOBAL_PER_DAY))) {
    return new Response("Daily limit for this site reached. Try again tomorrow.", { status: 429 });
  }
  if (!(await bump(limits, `${hourKey()}:${ip}`, PER_IP_PER_HOUR))) {
    return new Response("You've made a lot of requests this hour. Give it a bit.", { status: 429 });
  }

  let body;
  try { body = await req.json(); } catch { return new Response("Bad JSON", { status: 400 }); }

  const model = ALLOWED_MODELS.includes(body.model) ? body.model : ALLOWED_MODELS[0];
  const payload = {
    model,
    max_tokens: Math.min(body.max_tokens || 1000, MAX_TOKENS),
    messages: body.messages,
  };

  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(payload),
  });

  return new Response(await r.text(), {
    status: r.status,
    headers: { "Content-Type": "application/json" },
  });
};

export const config = { path: "/api/claude" };
