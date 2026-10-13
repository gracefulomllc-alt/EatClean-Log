const fs=require("fs"),vm=require("vm");const sb={};vm.createContext(sb);vm.runInContext(fs.readFileSync(process.argv[2],"utf8")+";this.T={fastingEnabled,fastGate,fastCaution}",sb);const T=sb.T;
let ok=0,bad=0;const eq=(a,b,m)=>{if(JSON.stringify(a)===JSON.stringify(b))ok++;else{bad++;console.log("FAIL",m,a,b)}};
eq(T.fastingEnabled({}),false,"new off");eq(T.fastingEnabled({fasts:[{}]}),true,"has history");eq(T.fastingEnabled({fastingOn:false,fasts:[{}]}),false,"explicit off wins");eq(T.fastingEnabled({fast:{start:1}}),true,"mid-fast");
eq(T.fastGate({age:17,weight:150,heightIn:68}).ok,false,"minor");eq(T.fastGate({age:18,weight:150,heightIn:68}).ok,true,"18");
eq(T.fastGate({age:30,weight:110,heightIn:70}).ok,false,"BMI<18.5");eq(T.fastGate({age:30,weight:224,heightIn:72}).ok,true,"user");
eq(T.fastGate({}).ok,true,"empty profile does not crash");
eq(T.fastCaution(10),null,"none");eq(T.fastCaution(21).level,"note","note");eq(T.fastCaution(21,{trained:true}).level,"warn","trained");eq(T.fastCaution(25).level,"warn","24");eq(T.fastCaution(40).level,"stop","36");
console.log(ok,"ok",bad,"bad");
