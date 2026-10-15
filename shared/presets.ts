import type {Rules} from "./api";
export type Preset={id:string;version:number;name:string;description:string;winner:"high"|"low";rules:Rules};
// Presets supply defaults only. Games store a copy, never a live reference to the catalog.
export const presets:readonly Preset[]=[
 {id:"custom",version:1,name:"Custom",description:"Choose your own play style, score entry, winner and ending rules.",winner:"high",rules:{playStyle:"turns",scoreMode:"add",endCondition:"manual"}},
 {id:"scrabble",version:1,name:"Scrabble",description:"Add each turn's points. Enter endgame tile adjustments yourself, then finish. Tile and word rules are handled at the table.",winner:"high",rules:{playStyle:"turns",scoreMode:"add",endCondition:"manual"}},
 {id:"phase10",version:1,name:"Phase 10",description:"Record each player’s points in turn order. Lowest total wins; finish the game manually.",winner:"low",rules:{playStyle:"turns",scoreMode:"add",endCondition:"manual"}},

];
export function presetRules(p:Preset):Rules{return {...p.rules,presetId:p.id,presetVersion:p.version}}
export function needsAdvancedRules(r:Rules,_winner?:"high"|"low"){return r.playStyle==="free"||r.scoreMode==="total"||(r.endCondition!==undefined&&r.endCondition!=="manual")}
