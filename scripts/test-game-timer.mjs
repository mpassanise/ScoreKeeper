import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from '../node_modules/typescript/lib/typescript.js';
let now=1000,index=0,slots=[],effects=[],intervals=new Map(),nextId=0;
const react={useRef:value=>{const i=index++;return slots[i]??(slots[i]={current:value})},useState:value=>{const i=index++;if(!(i in slots))slots[i]=value;return [slots[i],value=>{slots[i]=typeof value==='function'?value(slots[i]):value}]},useCallback:(fn,deps)=>{const i=index++;return slots[i]??(slots[i]=fn)},useEffect:(fn,deps)=>{const i=index++,old=slots[i];if(!old||deps.some((d,j)=>d!==old.deps[j])){old?.cleanup?.();const slot={deps};slots[i]=slot;effects.push(()=>slot.cleanup=fn())}}};
const module={exports:{}};new Function('require','module','exports','Date','setInterval','clearInterval',ts.transpileModule(readFileSync('shared/use-game-timer.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(()=>react,module,module.exports,{now:()=>now},fn=>{const id=++nextId;intervals.set(id,fn);return id},id=>intervals.delete(id));
function render(){index=0;effects=[];const result=module.exports.useGameTimer();effects.forEach(fn=>fn());return result}
let t=render();assert.equal(t.seconds,30);assert.equal(intervals.size,0);t.toggle();t=render();assert.equal(t.running,true);
now+=1250;intervals.values().next().value();t=render();assert.equal(t.seconds,29);t.toggle();t=render();assert.equal(t.running,false);assert.equal(intervals.size,0);
now+=60000;t.refresh();t=render();assert.equal(t.seconds,29,'pause retains exact remaining time');t.toggle();t=render();now+=28750;t.refresh();t=render();assert.equal(t.seconds,0);assert.equal(t.finished,true);assert.equal(intervals.size,0);
t.toggle();t=render();assert.equal(t.seconds,30);assert.equal(t.finished,false);t.choose(60);t=render();assert.equal(t.seconds,60);assert.equal(t.running,false);assert.equal(intervals.size,0);
t.toggle();t=render();now+=120000;t.refresh();t=render();assert.equal(t.seconds,0,'suspension does not extend deadline');assert.equal(t.finished,true);t.reset();t=render();assert.equal(t.seconds,60);assert.equal(t.finished,false);
assert.equal(module.exports.timerDisplay(60),'1:00');assert.equal(module.exports.timerDisplay(30),'0:30');assert.equal(module.exports.timerDisplay(0),'0:00');
console.log('Game timer: 30/60 selection, pause/resume precision, reset/restart, suspension deadline, completion, formatting and interval cleanup passed.');
