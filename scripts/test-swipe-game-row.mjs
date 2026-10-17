import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import Module,{createRequire} from 'node:module';
const output=mkdtempSync(path.join(tmpdir(),'scorekeeper-swipe-')),originalLoad=Module._load;
try{
 execFileSync(process.execPath,['node_modules/typescript/bin/tsc','mobile/SwipeGameRow.tsx','--jsx','react-jsx','--esModuleInterop','--target','ES2022','--module','commonjs','--moduleResolution','node','--skipLibCheck','--outDir',output],{stdio:'inherit'});
 writeFileSync(path.join(output,'package.json'),'{"type":"commonjs"}');
 const hooks=[];let index=0,effects=[],handlers,position;
 const react={createElement:()=>null,useRef:value=>{const i=index++;return hooks[i]??(hooks[i]={current:value})},useState:value=>{const i=index++;if(!(i in hooks))hooks[i]=value;return [hooks[i],next=>{hooks[i]=next}]},useMemo:fn=>{const i=index++;return hooks[i]??(hooks[i]=fn())},useEffect:fn=>{effects.push(fn)}};
 class Value{constructor(v){this.value=v}setValue(v){this.value=v}stopAnimation(){}}
 const native={Animated:{Value,View:'View',spring:(v,options)=>({start:fn=>{v.setValue(options.toValue);fn({finished:true})}})},PanResponder:{create:value=>{handlers=value;return {panHandlers:{}}}},Pressable:'Pressable',Text:'Text',View:'View',StyleSheet:{create:x=>x}};
 Module._load=function(name,...args){if(name==='react')return react;if(name==='react/jsx-runtime')return {jsx:()=>null,jsxs:()=>null};if(name==='react-native')return native;return originalLoad.call(this,name,...args)};
 const Component=createRequire(import.meta.url)(path.join(output,'SwipeGameRow.js')).default;
 function render(disabled=false){index=0;effects=[];Component({name:'Game',disabled,onDelete(){},children:null});position=hooks[0].current;effects.forEach(effect=>effect())}
 const gesture=(dx,dy=0,vx=0)=>({dx,dy,vx});
 render();assert.equal(handlers.onMoveShouldSetPanResponder(null,gesture(0,60)),false,'vertical scroll stays with list');
 assert.equal(handlers.onMoveShouldSetPanResponder(null,gesture(-5)),false,'tap jitter cannot reveal Delete');
 assert.equal(handlers.onMoveShouldSetPanResponder(null,gesture(-55,4)),true);
 handlers.onPanResponderGrant();handlers.onPanResponderMove(null,gesture(-65));
 assert.equal(handlers.onPanResponderTerminationRequest(),false,'ScrollView cannot steal an active horizontal swipe');
 handlers.onPanResponderRelease(null,gesture(-65));assert.equal(position.value,-88,'deliberate left swipe stays open');
 render();assert.equal(position.value,-88,'ordinary rerender preserves reveal');
 handlers.onPanResponderGrant();handlers.onPanResponderMove(null,gesture(-4));handlers.onPanResponderTerminate();assert.equal(position.value,-88,'forced interruption retains substantially revealed action');
 handlers.onPanResponderGrant();handlers.onPanResponderMove(null,gesture(70));handlers.onPanResponderRelease(null,gesture(70));assert.equal(position.value,0,'right swipe closes');
 handlers.onPanResponderGrant();handlers.onPanResponderMove(null,gesture(-20));handlers.onPanResponderRelease(null,gesture(-20,0,-.7));assert.equal(position.value,-88,'short intentional flick opens');
 handlers.onPanResponderGrant();handlers.onPanResponderMove(null,gesture(15));handlers.onPanResponderRelease(null,gesture(15,0,.7));assert.equal(position.value,0,'right flick closes');
 handlers.onPanResponderGrant();handlers.onPanResponderMove(null,gesture(-20));handlers.onPanResponderRelease(null,gesture(-20));assert.equal(position.value,0,'short slow drag returns closed');
 handlers.onPanResponderGrant();handlers.onPanResponderMove(null,gesture(-70));handlers.onPanResponderRelease(null,gesture(-70));assert.equal(position.value,-88);
 render(true);assert.equal(position.value,0);assert.equal(handlers.onMoveShouldSetPanResponder(null,gesture(-70)),false,'Resume loading cannot reveal Delete');
 console.log('Swipe row actual callbacks: vertical/tap rejection, stable reveal, rerender, responder interruption, flicks, right-close and busy reset passed.');
}finally{Module._load=originalLoad;rmSync(output,{recursive:true,force:true})}
