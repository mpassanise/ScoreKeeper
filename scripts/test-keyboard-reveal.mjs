import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from '../node_modules/typescript/lib/typescript.js';
let frames=new Map(),next=0,keyboard,scheduled;
const mod={exports:{}};
new Function('require','module','exports','requestAnimationFrame','cancelAnimationFrame',ts.transpileModule(readFileSync('mobile/useKeyboardReveal.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(name=>name==='react'?{}:{Keyboard:{metrics:()=>keyboard}},mod,mod.exports,fn=>{frames.set(++next,fn);return next},id=>frames.delete(id));
const flush=()=>{const pending=[...frames.values()];frames.clear();pending.forEach(fn=>fn())};
let focused=true,y=680,height=50,late=false,offset={current:200},calls=[];
const input={isFocused:()=>focused,measureInWindow:fn=>late?scheduled=()=>fn(10,y,200,height):fn(10,y,200,height)};
const container={getNativeScrollRef:()=>({measureInWindow:fn=>fn(0,120,400,700)}),scrollTo:opts=>calls.push(opts)},scroll={current:container};
const controller=mod.exports.createKeyboardReveal(scroll,offset);
controller.focus(input);flush();assert.equal(calls.length,0,'focus before keyboard does not scroll prematurely');
keyboard={screenY:500,height:350};controller.reveal();flush();assert.deepEqual(calls.pop(),{y:442,animated:true},'entire input stays 12 points above keyboard, accounting for header and existing offset');
y=200;controller.reveal();flush();assert.equal(calls.length,0,'visible inputs do not jump');
y=100;controller.focus(input);flush();assert.deepEqual(calls.pop(),{y:168,animated:true},'changing focus to a field above viewport scrolls upward');
y=600;controller.focus(input);controller.reveal();assert.equal(frames.size,1,'keyboard events coalesce');flush();assert.deepEqual(calls.pop(),{y:362,animated:true});
// Measurements may return after a different field gains focus or the form closes.
late=true;controller.focus(input);flush();const old=scheduled;const other={isFocused:()=>true,measureInWindow:fn=>fn(0,200,100,50)};controller.focus(other);old();flush();assert.equal(calls.length,0,'late measurement cannot scroll the next input');
controller.focus(input);flush();controller.close();scheduled();flush();assert.equal(calls.length,0,'leaving setup cancels pending work');assert.equal(frames.size,0);
const unmounted=mod.exports.createKeyboardReveal(scroll,offset);late=false;focused=false;unmounted.focus(input);flush();assert.equal(calls.length,0,'blurred or removed fields are ignored');unmounted.close();
// All real setup inputs, including dynamically added players, register their native ref.
const jsx=(type,props)=>({type,props}),native={exports:{}};
const refs=[];const react={useRef:value=>{const ref={current:value};refs.push(ref);return ref},useState:value=>[value,()=>{}]};
new Function('require','module','exports',ts.transpileModule(readFileSync('mobile/GameSetup.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText)(name=>name==='react'?react:name==='react/jsx-runtime'?{jsx,jsxs:jsx}:name==='react-native'?{TextInput:'TextInput',View:'View',Text:'Text',Pressable:'Pressable',StyleSheet:{create:s=>s}}:name==='./Theme'?{useThemeStyles:s=>s}:name==='./useFrequentPlayers'?{useFrequentPlayers:()=>({names:[],ready:true})}:name==='../shared/game-setup'?{setupHint:()=>'',phase10Summary:'',scrabbleSummary:''}: {},native,native.exports);
const nodes=tree=>Array.isArray(tree)?tree.flatMap(nodes):tree&&typeof tree==='object'?[tree,...nodes(tree.props?.children)]:[];
for(const winner of ['high','zero']){let target;const tree=native.exports.default({presetId:'custom',name:'Game',players:['One','Two','Three'],settings:{winner,endCondition:'target',playStyle:'turns'},onInputFocus:input=>target=input});const fields=nodes(tree).filter(n=>n.type==='TextInput');assert.equal(fields.length,5);for(const field of fields){const ref=field.props.ref;if(typeof ref==='function')ref(input);else ref.current=input;field.props.onFocus();assert.equal(target,input,field.props.accessibilityLabel)}}
const app=readFileSync('mobile/App.tsx','utf8');assert.ok(app.includes("automaticallyAdjustKeyboardInsets={Platform.OS==='ios'}"));assert.ok(app.includes("enabled={Platform.OS!=='ios'}"),'avoid double keyboard compensation');assert.ok(app.includes('onInputFocus={revealSetupInput}'));
console.log('iPhone keyboard reveal: initial show, focus changes, header/viewport geometry, spacing, no unnecessary scroll, coalescing, stale/blur/unmount safety, dynamic setup fields and single inset owner passed.');
