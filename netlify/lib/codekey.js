// A sync code becomes a storage key by hashing it, so the stored data never
// contains the code itself. Shared by sync.js and photos.js.
export async function keyFor(code) {
  const norm = String(code || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (norm.length !== 16) return null;
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("cutlog-sync:" + norm));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
