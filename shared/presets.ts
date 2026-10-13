import type {Rules} from "./api";
export type Preset={id:string;version:number;name:string;description:string;winner:"high"|"low";rules:Rules};
// Presets supply defaults only. Games store a copy, never a live reference to the catalog.
export const presets:readonly Preset[]=[
 {id:"custom",version:1,name:"Custom game",description:"Choose your own play style, score entry, winner and ending rules.",winner:"high",rules:{playStyle:"turns",scoreMode:"add",endCondition:"manual"}},
 {id:"scrabble",version:1,name:"Scrabble",description:"Add each turn's points. Enter endgame tile adjustments yourself, then finish. Tile and word rules are handled at the table.",winner:"high",rules:{playStyle:"turns",scoreMode:"add",endCondition:"manual"}},
 {id:"yahtzee",version:1,name:"Yahtzee scorekeeper",description:"13 turns per player. Enter each category's points including any earned bonuses; category validation and bonus calculation are handled on your scorecard.",winner:"high",rules:{playStyle:"turns",scoreMode:"add",endCondition:"rounds",roundLimit:13}},
 {id:"uno",version:1,name:"UNO",description:"Record the hand winner's awarded points after each hand. First to 500 wins. Card rules and point calculation are handled at the table.",winner:"high",rules:{playStyle:"free",scoreMode:"add",endCondition:"target",targetScore:500}},
 {id:"golf",version:1,name:"Golf · 18 holes",description:"Enter strokes for each player, one hole at a time. Lowest total after 18 holes wins. Change to 9 rounds for a shorter game.",winner:"low",rules:{playStyle:"turns",scoreMode:"add",endCondition:"rounds",roundLimit:18}},
 {id:"rummy",version:1,name:"Rummy scorekeeper",description:"Record each player's points after a hand in any order. Finish according to your chosen Rummy variant or customize a score limit.",winner:"high",rules:{playStyle:"free",scoreMode:"add",endCondition:"manual"}},
 {id:"race",version:1,name:"Points race · 100",description:"Anyone can score at any time. First to 100 points wins immediately.",winner:"high",rules:{playStyle:"free",scoreMode:"add",endCondition:"target",targetScore:100}},
 {id:"penalties",version:1,name:"Penalty points",description:"Add penalties in any order; lowest score wins when you finish. Optionally end when anyone reaches a chosen penalty limit.",winner:"low",rules:{playStyle:"free",scoreMode:"add",endCondition:"manual"}},
 {id:"running-total",version:1,name:"Running totals",description:"Enter each player's current total at any time. Each entry replaces that player's displayed total; it is not added to earlier totals.",winner:"high",rules:{playStyle:"free",scoreMode:"total",endCondition:"manual"}}
];
export function presetRules(p:Preset):Rules{return {...p.rules,presetId:p.id,presetVersion:p.version}}
export function needsAdvancedRules(r:Rules,_winner?:"high"|"low"){return r.playStyle==="free"||r.scoreMode==="total"||(r.endCondition!==undefined&&r.endCondition!=="manual")}
