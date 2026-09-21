import { getStore } from "@netlify/blobs";

// Guardrails. Tune before handing the link out widely.
const PER_IP_PER_HOUR = 40;
const GLOBAL_PER_DAY = 800;
const MAX_TOKENS = 8192;   // a week of meal prep is a long answer

// Netlify AI Gateway injects ANTHROPIC_API_KEY and ANTHROPIC_BASE_URL at runtime, so there is
// no key to manage here. Override the model with ANTHROPIC_MODEL if you want a cheaper or
// newer one - it must be a model AI Gateway supports.
const DEFAULT_MODEL = "claude-sonnet-4-5";

const env = (k) => (typeof Netlify !== "undefined" ? Netlify.env.get(k) : undefined) ?? process.env[k];

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

  const code = env("ACCESS_CODE");
  if (code && req.headers.get("x-access-code") !== code) {
    return new Response("Bad access code", { status: 401 });
  }

  // AI Gateway sets both of these. If they're missing, the site hasn't had a production
  // deploy yet or AI features are switched off for the team.
  const key = env("ANTHROPIC_API_KEY");
  const base = env("ANTHROPIC_BASE_URL");
  if (!key || !base) {
    return new Response("AI isn't wired up for this site yet. Enable AI features in Netlify and deploy once.", { status: 503 });
  }

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
  if (!Array.isArray(body.messages)) return new Response("No messages", { status: 400 });

  // The app already speaks Anthropic's message format - text and base64 image blocks both
  // pass straight through, so there's nothing to translate.
  const wantsJson = body.json !== false;
  const messages = [...body.messages];
  // Structured answers (menus, labels, estimates) must parse. Prefilling the reply with "{"
  // means the model can only continue a JSON object - no preamble, no fences. The coach
  // chats in plain text, so it skips this.
  if (wantsJson) messages.push({ role: "assistant", content: "{" });

  const payload = {
    model: env("ANTHROPIC_MODEL") || DEFAULT_MODEL,
    max_tokens: Math.min(body.max_tokens || 1500, MAX_TOKENS),
    messages,
  };
  if (wantsJson) payload.system = "Reply with one valid JSON object and nothing else. No markdown fences, no commentary before or after.";

  const r = await fetch(`${base.replace(/\/$/, "")}/v1/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
    body: JSON.stringify(payload),
  });

  if (!r.ok) {
    const detail = await r.text();
    return new Response(`AI error ${r.status}: ${detail.slice(0, 400)}`, { status: r.status });
  }

  const data = await r.json();
  let text = (data?.content || []).filter((b) => b.type === "text").map((b) => b.text || "").join("");
  // Put back the "{" that was handed to the model as a prefill - it isn't echoed in the reply.
  if (wantsJson && text) text = `{${text}`;

  if (!text) return new Response(`AI returned nothing (${data?.stop_reason || "empty response"})`, { status: 502 });
  // A cut-off JSON answer won't parse. Say so plainly instead of letting the app choke on it.
  if (data?.stop_reason === "max_tokens" && wantsJson) {
    return new Response("That answer ran too long and got cut off. Try asking for less at once.", { status: 502 });
  }

  // Hand it back in the shape the app already parses.
  return new Response(JSON.stringify({ content: [{ type: "text", text }] }), {
    headers: { "Content-Type": "application/json" },
  });
};

export const config = { path: "/api/claude" };
