const fs=require("fs");const s=fs.readFileSync("src/App.jsx","utf8");
const a=s.indexOf("function mealHistory"),b=s.indexOf("function LogMeal");
const code=s.slice(a,b);
const {mealHistory,scaleItem,histTitle}=new Function(code+"; return {mealHistory,scaleItem,histTitle};")();
let ok=0,bad=0;const t=(c,m)=>{c?ok++:(bad++,console.log("FAIL",m))};
const f=(id,name,cal,meal,mealId)=>({id,name,calories:cal,protein:10,carbs:20,fat:5,meal,mealId});
const days={"2026-10-10":{foods:[f(1,"Eggs",200,"Breakfast","a"),f(2,"Toast",100,"Breakfast","a"),f(3,"Chicken bowl",600,"Lunch","b")]},
"2026-10-11":{foods:[f(4,"Eggs",200,"Breakfast","c"),f(5,"Toast",100,"Breakfast","c")]},
"2026-10-12":{foods:[f(6,"Chicken bowl",600,"Lunch","d"),f(7,"Apple",95,"Snack")]}};
let h=mealHistory(days,"Breakfast");
t(h.length===3,"three distinct meals: "+h.length);
t(h[0].meal==="Breakfast"&&h[0].count===2&&h[0].items.length===2,"eggs and toast grouped as one meal, counted twice");
t(histTitle(h[0].items)==="Eggs + 1 more","title");
h=mealHistory(days,"Lunch");t(h[0].meal==="Lunch"&&h[0].count===2,"slot match comes first");
t(mealHistory({},"Lunch").length===0,"empty history");
const s15=scaleItem({name:"Rice, 1 cup",calories:200,protein:4,carbs:44,fat:0.4,qty:1},1.5);
t(s15.calories===300&&s15.name==="Rice, 1 cup (1.5x)"&&s15.qty===1.5,"scaling");
t(scaleItem({name:"x",calories:1},1).name==="x","1x unchanged");
console.log(ok+" ok "+bad+" bad");process.exit(bad?1:0);
