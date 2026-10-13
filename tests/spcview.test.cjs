const fs=require("fs"),vm=require("vm");const sb={};vm.createContext(sb);vm.runInContext(fs.readFileSync(process.argv[2],"utf8")+";this.f=spcView",sb);const f=sb.f;
let ok=0,bad=0;const eq=(a,b,m)=>{if(JSON.stringify(a)===JSON.stringify(b))ok++;else{bad++;console.log("FAIL",m,a,b)}};
const now=new Date("2026-11-05T12:00:00-06:00").getTime();
const g=(s,o)=>({start:s,opp:o});
const r=f([g("2026-11-20T19:00:00-06:00","D"),g("2026-11-05T19:00:00-06:00","A"),g("2026-11-01T19:00:00-05:00","past"),g("2026-11-08T19:00:00-06:00","B"),g("2026-11-12T19:00:00-06:00","C"),g("bad","X"),null],now);
eq(r.today.map(x=>x.opp),["A"],"today");eq(r.upcoming.map(x=>x.opp),["B","C","D"],"next three in order");eq(r.total,5,"invalid dropped");eq(f([],now),{today:[],upcoming:[],total:0},"empty");eq(f(undefined,now).total,0,"undefined");
console.log(ok,"ok",bad,"bad");
