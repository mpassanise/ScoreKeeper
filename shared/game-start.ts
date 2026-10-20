import type {GameSummary,GameView,Rules,ScorekeeperApi} from './api';
import {validateGameCreation,type LocalGames} from './local-games';
import {needsAdvancedRules} from './presets';
async function bounded<T>(work:()=>Promise<T>,ms:number):Promise<T>{let timer:ReturnType<typeof setTimeout>;try{return await Promise.race([work(),new Promise<T>((_,reject)=>{timer=setTimeout(()=>reject(new Error('Account saving timed out.')),ms)})])}finally{clearTimeout(timer!)}}
export async function startGame({local,cloud,signedIn,deviceOnly=false,name,players,winner,rules,uuid,timeoutMs=5000}:{local:LocalGames;cloud:Pick<ScorekeeperApi,'account'|'create'>;signedIn:boolean;deviceOnly?:boolean;name:string;players:string[];winner:'high'|'low';rules:Rules;uuid:()=>string;timeoutMs?:number}):Promise<{view:GameView;deviceOnly:boolean;message:string}>{
 const clean=validateGameCreation(name,players,winner,rules);
 if(signedIn&&!deviceOnly){try{
  const status=await bounded(()=>cloud.account(),Math.min(timeoutMs,2000));
  if(status.deletionStatus)throw new Error('Account saving unavailable.');
  if(needsAdvancedRules(rules,winner)&&(status.scoringRulesVersion||0)<2)throw new Error('Account rules unavailable.');
  if(rules.targetEnd==='round'&&(status.scoringRulesVersion||0)<3)throw new Error('Account round endings unavailable.');
  const view=await bounded(()=>cloud.create(uuid(),name,clean,winner,rules),timeoutMs);
  return {view,deviceOnly:false,message:''};
 }catch{
  // Use a separate ID: a timed-out account request may still have created an empty game.
  const view=await local.create(uuid(),name,clean,winner,rules,{deviceOnly:true});
  return {view,deviceOnly:true,message:'Game started on this device. Account saving is unavailable right now. You can keep scoring and add this game to your account later.'};
 }}
 return {view:await local.create(uuid(),name,clean,winner,rules,{deviceOnly}),deviceOnly,message:deviceOnly?'Game started on this device. Your scores are saved here.':''};
}
export function mergeDeviceGames(saved:GameSummary[],locals:GameSummary[],accountAuthority:readonly string[]=[]){const adopted=new Set(accountAuthority);const device=locals.filter(g=>g.deviceOnly&&!adopted.has(g.id));const ids=new Set(device.map(g=>g.id));return [...device,...saved.filter(g=>!ids.has(g.id))].sort((a,b)=>Date.parse(b.updated)-Date.parse(a.updated))}
