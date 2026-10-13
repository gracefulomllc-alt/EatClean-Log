// Tiny RSS reader for the Texans' news feed. Pulls out headline, link and date, and when a
// headline looks like a result ("South Plains 78, Odessa 70") returns it as a score line.
const dec = (s) => String(s || "").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/<[^>]+>/g, "").trim();
const tag = (block, name) => dec((block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i")) || [])[1]);

export function parseRss(xml, limit = 8) {
  const items = [];
  for (const m of String(xml || "").matchAll(/<item[\s>][\s\S]*?<\/item>/gi)) {
    const b = m[0], title = tag(b, "title"), link = tag(b, "link"), date = Date.parse(tag(b, "pubDate")) || null;
    if (!title) continue;
    const link2 = /^https?:\/\//.test(link) ? link : "";
    const score = (title.match(/\b(\d{2,3})\s*[-–,]\s*(?:[A-Za-z.'&() ]{2,40}?\s)?(\d{2,3})\b/) || [])[0] || "";
    items.push({ title: title.slice(0, 140), link: link2, date, score });
    if (items.length >= limit) break;
  }
  return items;
}
