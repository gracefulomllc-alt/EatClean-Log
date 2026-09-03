import { getStore } from "@netlify/blobs";

// Guardrails. Tune before handing the link out widely.
const PER_IP_PER_HOUR = 40;
const GLOBAL_PER_DAY = 800;
const MAX_TOKENS = 1500;

// Gemini model names change often. Override with a GEMINI_MODEL env var
// if this one 404s - check aistudio.google.com for the current name.
const DEFAULT_MODEL = "gemini-2.5-flash";

const hourKey = () => `h:${new Date().toISOString().slice(0, 13)}`;
const dayKey = () => `d:${new Date().toISOString().slice(0, 10)}`;

async function bump(store, key, limit) {
  const cur = Number((await store.get(key)) || 0);
  if (cur >= limit) return false;
  await store.set(key, String(cur + 1));
  return true;
}

// The app speaks Anthropic's message format. Translate it to Gemini's.
function toGemini(messages) {
  return messages.map((m) => {
    const content = typeof m.content === "string" ? [{ type: "text", text: m.content }] : m.content;
    return {
      role: m.role === "assistant" ? "model" : "user",
      parts: content.map((b) => {
        if (b.type === "image") {
          return { inline_data: { mime_type: b.source.media_type, data: b.source.data } };
        }
        return { text: b.text };
      }),
    };
  });
}

export default async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const code = Netlify.env.get("ACCESS_CODE");
  if (code && req.headers.get("x-access-code") !== code) {
    return new Response("Bad access code", { status: 401 });
  }

  const key = Netlify.env.get("GEMINI_API_KEY");
  if (!key) return new Response("Server is missing GEMINI_API_KEY", { status: 500 });

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

  const model = Netlify.env.get("GEMINI_MODEL") || DEFAULT_MODEL;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;

  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: toGemini(body.messages),
      generationConfig: {
        maxOutputTokens: Math.min(body.max_tokens || 1000, MAX_TOKENS),
        // Every prompt in this app asks for JSON, so ask Gemini for it directly
        // instead of fishing it out of markdown fences.
        responseMimeType: "application/json",
      },
    }),
  });

  if (!r.ok) {
    const detail = await r.text();
    return new Response(`Gemini error ${r.status}: ${detail.slice(0, 400)}`, { status: r.status });
  }

  const data = await r.json();
  const text = (data?.candidates?.[0]?.content?.parts || [])
    .map((p) => p.text || "")
    .join("");

  if (!text) {
    const reason = data?.candidates?.[0]?.finishReason || "empty response";
    return new Response(`Gemini returned nothing (${reason})`, { status: 502 });
  }

  // Hand it back in the shape the app already parses.
  return new Response(JSON.stringify({ content: [{ type: "text", text }] }), {
    headers: { "Content-Type": "application/json" },
  });
};

export const config = { path: "/api/claude" };
