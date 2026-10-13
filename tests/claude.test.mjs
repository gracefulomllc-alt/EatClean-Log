// The AI proxy: falls through to another model when one is retired or out of quota.
globalThis.__stores = {};   // used only by the local Blobs stub
globalThis.Netlify = { env: { get: (k) => (k === "GEMINI_API_KEY" ? "test-key" : undefined) } };
let calls = [];
globalThis.fetch = async (url, init) => {
  const m = String(url).match(/models\/([^:]+):/)[1]; calls.push(m);
  const plan = globalThis.__plan[m] || 200;
  if (plan === 200) return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "{\"ok\":true}" }] }, finishReason: "STOP" }] }), { status: 200 });
  return new Response(`model ${m} says ${plan}`, { status: plan });
};
// Blobs stub so counters work without Netlify.
let ok = 0, bad = 0; const t = (c, m) => { if (c) ok++; else { bad++; console.log("FAIL", m); } };
const { default: h } = await import("../netlify/functions/claude.js").catch((e) => ({ default: null, e }));
if (!h) { console.log("skipped: needs @netlify/blobs installed (CI has it)"); process.exit(0); }
const ask = async () => { calls = []; const r = await h(new Request("http://x/api/claude", { method: "POST", body: JSON.stringify({ messages: [{ role: "user", content: "hi" }] }) })); return { r, body: await r.text() }; };
globalThis.__plan = {};
let x;
try { x = await ask(); } catch (e) { console.log("skipped: Netlify Blobs isn't available here (" + String(e.message).slice(0, 60) + ")"); process.exit(0); } t(x.r.status === 200 && calls.length === 1, "first model works, one call");
globalThis.__plan = { "gemini-2.5-flash": 404 }; x = await ask(); t(x.r.status === 200 && calls.includes("gemini-flash-latest"), "retired model falls through");
globalThis.__plan = { "gemini-2.5-flash": 429, "gemini-flash-latest": 429 }; x = await ask(); t(x.r.status === 200 && calls.length >= 3, "quota on two models falls through to a third");
globalThis.__plan = { "gemini-2.5-flash": 403 }; x = await ask(); t(x.r.status === 403 && /403/.test(x.body) && calls.length === 1, "bad key stops and says why");
const all = Object.fromEntries(["gemini-2.5-flash", "gemini-flash-latest", "gemini-2.0-flash", "gemini-flash-lite-latest"].map((m) => [m, 404]));
globalThis.__plan = all; x = await ask(); t(x.r.status === 404 && /model/.test(x.body), "all gone: clear message");
console.log(ok, "ok", bad, "bad");
