import {parseRss} from "../netlify/lib/rss.js";
let ok=0,bad=0;const t=(c,m)=>{if(c)ok++;else{bad++;console.log("FAIL",m)}};
const x=`<rss><channel><item><title><![CDATA[Texans fall to Odessa, 78-70]]></title><link>https://www.spctexans.com/a</link><pubDate>Sat, 04 Jan 2027 03:00:00 GMT</pubDate></item><item><title>Roster &amp; schedule</title><link>/rel</link></item><item><title></title></item></channel></rss>`;
const r=parseRss(x);
t(r.length===2,"skips empty");t(r[0].title==="Texans fall to Odessa, 78-70","cdata");t(r[0].score==="78-70","score");t(r[0].link==="https://www.spctexans.com/a","link");t(r[0].date===Date.parse("2027-01-04T03:00:00Z"),"date");
t(r[1].title==="Roster & schedule"&&r[1].link===""&&r[1].score===""&&r[1].date===null,"entities, relative link dropped");
t(parseRss("garbage").length===0&&parseRss(null).length===0,"garbage ok");
console.log(ok,"ok",bad,"bad");
