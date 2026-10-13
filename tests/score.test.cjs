const fs=require("fs"),vm=require("vm");const sb={};vm.createContext(sb);vm.runInContext(fs.readFileSync(process.argv[2],"utf8")+";this.T={dayScore,weekOnTrack}",sb);const {dayScore,weekOnTrack}=sb.T;
let ok=0,bad=0;const eq=(a,b,m)=>{if(JSON.stringify(a)===JSON.stringify(b))ok++;else{bad++;console.log("FAIL",m,a,b)}};
const t={calories:2000,protein:160};const f=(meal,c,p)=>({meal,calories:c,protein:p});
const full={foods:[f("Breakfast",600,50),f("Lunch",700,60),f("Dinner",700,50)],veg:true,tags:["lift"],water:100,checkin:1};
eq(dayScore(full,t).total,100,"perfect");
eq(dayScore({foods:[f("Breakfast",300,20)]},t).total,10+Math.round(20*20/144),"one meal");
const under={foods:[f("Breakfast",300,160),f("Lunch",300,0)]};
eq(dayScore(under,t).parts.find(p=>p.key==="cal").pts,0,"undereating earns nothing");
eq(dayScore({foods:[f("A",1000,0),f("B",1300,0)]},t).parts.find(p=>p.key==="cal").pts,0,"overeating earns nothing");
eq(dayScore({foods:[f("A",1000,0),f("B",1000,0)]},t).parts.find(p=>p.key==="cal").pts,20,"on budget");
eq(dayScore({rest:"rest"},t).parts.find(p=>p.key==="move").pts,10,"rest day counts");
eq(dayScore({},t).total,0,"empty");eq(dayScore(null,null).total,0,"null safe");
eq(dayScore({steps:"7000"},t).parts.find(p=>p.key==="move").pts,10,"steps");
const days={"2026-10-12":full,"2026-10-11":full,"2026-10-10":{}, "2026-10-09":full};
eq(weekOnTrack(days,"2026-10-12",()=>t,{}),3,"week count");
eq(weekOnTrack(days,"2026-10-02",()=>t,{}),0,"week window");
// month rollover
eq(weekOnTrack({"2026-09-30":full},"2026-10-02",()=>t,{}),1,"rollover");
console.log(ok,"ok",bad,"bad");
