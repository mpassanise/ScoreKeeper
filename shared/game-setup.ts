import type {Rules} from "./api";
import {presets,presetRules} from "./presets";
export type PresetId="custom"|"scrabble"|"phase10";
export type SetupSettings={playStyle:"turns"|"free";scoreMode:"add"|"total";winner:"high"|"low";endCondition:"manual"|"rounds"|"target";limit:string;targetEnd:"immediate"|"round"};
export const defaultSettings:SetupSettings={playStyle:"turns",scoreMode:"add",winner:"high",endCondition:"manual",limit:"10",targetEnd:"immediate"};
export const scrabbleSummary="Players take turns in the order listed. Add each turn’s points to the player’s total. Finish the game manually; the highest total wins. Enter any endgame tile adjustments yourself.";
export const phase10Summary="Score players in any order. Add each player’s points from cards left in hand after each hand. Finish the game manually; the lowest total wins under this preset.";
export function setupRules(presetId:PresetId,settings:SetupSettings):{winner:"high"|"low";rules:Rules}{
 if(presetId!=="custom"){const preset=presets.find(p=>p.id===presetId)!;return {winner:preset.winner,rules:presetRules(preset)}}
 return {winner:settings.winner,rules:{presetId:"custom",presetVersion:1,playStyle:settings.playStyle,scoreMode:settings.scoreMode,endCondition:settings.endCondition,...(settings.endCondition==="rounds"?{roundLimit:Number(settings.limit)}:settings.endCondition==="target"?{targetScore:Number(settings.limit),targetEnd:settings.targetEnd}:{})}};
}
export function changeEnding(settings:SetupSettings,endCondition:SetupSettings["endCondition"]):SetupSettings{return {...settings,endCondition,playStyle:endCondition==="rounds"||(endCondition==="target"&&settings.targetEnd==="round")?"turns":settings.playStyle,limit:endCondition===settings.endCondition?settings.limit:endCondition==="target"?"100":"10"}}
export function changePlayStyle(settings:SetupSettings,playStyle:SetupSettings["playStyle"]):SetupSettings{return {...settings,playStyle,targetEnd:playStyle==="free"?"immediate":settings.targetEnd,endCondition:playStyle==="free"&&settings.endCondition==="rounds"?"manual":settings.endCondition}}
export function setupHint(name:string,players:string[],settings:SetupSettings,presetId:PresetId){const cleaned=players.map(p=>p.trim()).filter(Boolean);if(!name.trim())return "Add a game name to get started.";if(cleaned.length<2)return "Add at least two players to start.";if(new Set(cleaned.map(p=>p.toLowerCase())).size!==cleaned.length)return "Give each player a different name.";if(presetId==="custom"&&settings.endCondition!=="manual"&&(!/^\d+$/.test(settings.limit)||Number(settings.limit)<1))return "Enter a positive whole number for the game limit.";if(presetId==="custom"&&settings.endCondition==="target"&&Number(settings.limit)>100000)return "Target score cannot exceed 100,000.";return ""}
export type GameSetupProps={presetId:PresetId;onPresetChange:(id:PresetId)=>void;name:string;onNameChange:(name:string)=>void;players:string[];onPlayersChange:(players:string[])=>void;settings:SetupSettings;onSettingsChange:(settings:SetupSettings)=>void;onSubmit:()=>void;busy:boolean};

export function changeTargetEnd(settings:SetupSettings,targetEnd:SetupSettings["targetEnd"]):SetupSettings{return {...settings,targetEnd,playStyle:targetEnd==="round"?"turns":settings.playStyle}}
