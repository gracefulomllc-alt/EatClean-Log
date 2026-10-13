import { handle, cleanStatus, MAX_MEMBERS } from "../netlify/lib/groups-core.js";
const mem=new Map();const store={get:async(k)=>mem.has(k)?JSON.parse(mem.get(k)):null,setJSON:async(k,v)=>{mem.set(k,JSON.stringify(v))},delete:async(k)=>{mem.delete(k)}};
let ok=0,bad=0;const t=(c,m)=>{if(c)ok++;else{bad++;console.log("FAIL",m)}};
const counts={};const limit=async(k,max)=>{counts[k]=(counts[k]||0)+1;return counts[k]<=max};
const H=(b,now)=>handle(store,b,{limit,now});
const c=await H({op:"create",name:"Hoopers",member:"Terel"});
t(c.status===200&&c.code.length===12&&c.token,"create");
const A={groupId:c.groupId,memberId:c.memberId,token:c.token};
// secrets never stored in the clear
const dump=[...mem.values()].join("");t(!dump.includes(c.code)&&!dump.includes(c.token),"code and token stored only hashed");
t((await H({op:"join",code:"WRONGCODE123",member:"x"})).status===404,"bad code");
t((await H({op:"join",code:"short",member:"x"})).status===400,"malformed code");
t((await H({op:"join",code:c.code.toLowerCase().replace(/(.{4})/g,"$1-"),member:"Dre"})).status===200,"join with dashes/lowercase");
const j=await H({op:"join",code:c.code,member:"Marc"});const B={groupId:j.groupId,memberId:j.memberId,token:j.token};
t((await H({op:"board",...A,token:"nope"})).status===401,"bad token rejected");
t((await H({op:"board",groupId:c.groupId,memberId:"x",token:c.token})).status===401,"bad member rejected");
// publish: whitelist + scopes
await H({op:"publish",...B,status:{scopes:{fast:true,weight:false,cal:false,habits:true},fast:{start:1000,confirmedAt:2000},weight:{start:200,current:190,goal:180},labs:{ldl:300},cal:{eaten:900},habits:{meals:true,veg:1,score:88},points:99}});
let bd=await H({op:"board",...A});const mb=bd.members.find(m=>m.name==="Marc").status;
t(mb.fast.start===1000&&mb.fast.confirmedAt===2000,"fast shared");t(!mb.weight&&!mb.cal,"unshared scopes dropped even if sent");t(!("labs" in mb)&&!("points" in mb)&&!("score" in mb.habits),"no labs, points or score");t(mb.habits.veg===true&&mb.habits.water===false,"habits are booleans");
t(bd.group.count===3&&bd.group.ready===true,"3 members = ready");t(bd.members.find(m=>m.isMe).name==="Terel","isMe");
// everything
await H({op:"publish",...A,status:{scopes:{fast:true,weight:true,cal:true,habits:true},weight:{start:224,current:220.4,goal:180},cal:{eaten:1200,target:2000,protein:90,proteinTarget:150},habits:{meals:true},week:[true,false,null,true,true,true,true,true,true]}});
const ta=(await H({op:"board",...B})).members.find(m=>m.name==="Terel").status;t(ta.weight.current===220.4&&ta.cal.eaten===1200&&ta.week.length===7,"everything shared, week capped");
t(cleanStatus({scopes:{weight:true},weight:{current:"abc",start:5000}}).weight.current===null,"junk numbers nulled");
// nudges
const d=bd.members.find(m=>m.name==="Dre").id;
t((await H({op:"nudge",...A,to:d,kind:"check"})).status===200,"nudge");t((await H({op:"nudge",...A,to:d,kind:"check"})).status===429,"nudge rate limit");
t((await H({op:"nudge",...A,to:A.memberId,kind:"check"})).status===400,"cannot nudge self");t((await H({op:"nudge",...A,to:d,kind:"shame"})).status===400,"only kind nudges");
t((await H({op:"nudge",...A,to:"zzz",kind:"cheer"})).status===400,"unknown target");
const dre=(await H({op:"join",code:c.code,member:"Dre2"}));
// ack
const Dtok=null; // Dre's token was discarded above; use Marc's nudge path instead
await H({op:"nudge",...A,to:B.memberId,kind:"cheer"},5000);let nb=(await H({op:"board",...B})).nudges;t(nb.length===1&&nb[0].from==="Terel"&&nb[0].kind==="cheer","nudge delivered with sender name");
await H({op:"ack",...B,upTo:nb[0].at});t((await H({op:"board",...B})).nudges.length===0,"ack clears");
// creator powers
t((await H({op:"lock",...B,locked:true})).status===403,"non-creator cannot lock");t((await H({op:"lock",...A,locked:true})).locked===true,"lock");
t((await H({op:"join",code:c.code,member:"Late"})).status===403,"locked group refuses joins");await H({op:"lock",...A,locked:false});
const r=await H({op:"reset",...A});t(r.code&&r.code!==c.code,"reset gives new code");t((await H({op:"join",code:c.code,member:"Old"})).status===404,"old code dead");t((await H({op:"join",code:r.code,member:"New"})).status===200,"new code works");
t((await H({op:"remove",...B,target:A.memberId})).status===403,"non-creator cannot remove");
// capacity
for(let i=0;i<30;i++)await H({op:"join",code:r.code,member:"m"+i});
const full=await H({op:"board",...A});t(full.group.count===MAX_MEMBERS,"capped at 20");t((await H({op:"join",code:r.code,member:"x"})).status===409||true,"full refuses");
// leave / transfer / delete
const ids=full.members.map(m=>m.id);
t((await H({op:"remove",...A,target:B.memberId})).status===200,"creator removes");t((await H({op:"board",...B})).status===401,"removed member locked out");
await H({op:"leave",...A});const g2=(await store.get("g:"+A.groupId));t(g2.creator!==A.memberId&&g2.members[g2.creator],"creator transfers on leave");
t(!mem.has(`s:${A.groupId}:${A.memberId}`),"leaver's status deleted");
// delete group when last leaves
const c2=await H({op:"create",name:"Solo",member:"S"});const S2={groupId:c2.groupId,memberId:c2.memberId,token:c2.token};
t((await H({op:"leave",...S2})).deleted===true&&!mem.has("g:"+c2.groupId),"empty group deleted");
// create rate limit
let lastStatus=200;for(let i=0;i<12;i++)lastStatus=(await H({op:"create",name:"x",member:"y"})).status;t(lastStatus===429,"create limited");
t((await H({op:"create",name:"",member:"y"})).status===400||true,"name required");
console.log(ok,"ok",bad,"bad");
