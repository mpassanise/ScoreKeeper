import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from '../node_modules/typescript/lib/typescript.js';
let fontScale=1,width=402,rowWidth,chosen,changed;
const jsx=(type,props)=>({type,props}),mod={exports:{}};
const native={useWindowDimensions:()=>({width,fontScale}),ScrollView:'ScrollView',Text:'Text',TextInput:'TextInput',View:'View',Pressable:'Pressable',StyleSheet:{create:s=>s}};
let index=0,slots=[];
const react={useRef:value=>({current:value}),useState:value=>{const i=index++;if(!(i in slots))slots[i]=value;return [slots[i],next=>{slots[i]=next;rowWidth=next}]}};
new Function('require','module','exports',ts.transpileModule(readFileSync('mobile/GameSetup.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText)(name=>name==='react'?react:name==='react/jsx-runtime'?{jsx,jsxs:jsx}:name==='react-native'?native:name==='./Theme'?{useThemeStyles:s=>s}:name==='./useFrequentPlayers'?{useFrequentPlayers:()=>({names:['Mike','Stephanie'],ready:true})}:name==='../shared/frequent-players'?{playerKey:value=>value.toLowerCase()}:name==='../shared/game-setup'?{setupHint:()=>'',changeWinner:(s,value)=>({...s,winner:value}),changeEnding:(s,value)=>({...s,endCondition:value}),changePlayStyle:(s,value)=>({...s,playStyle:value}),changeTargetEnd:(s,value)=>({...s,targetEnd:value})}:{},mod,mod.exports);
const nodes=tree=>Array.isArray(tree)?tree.flatMap(nodes):tree&&typeof tree==='object'?[tree,...nodes(tree.props?.children)]:[];
const settings={winner:'high',scoreMode:'add',playStyle:'turns',endCondition:'manual',targetEnd:'immediate'};
for(width of [320,402,768])for(fontScale of [1,1.5,2]){
 slots=[];const render=(patch={})=>{index=0;return mod.exports.default({presetId:'custom',name:'Game',players:['One','Two'],settings:{...settings,...patch},onPresetChange:value=>chosen=value,onSettingsChange:value=>changed=value})};
 let tree=render(),rows=nodes(tree).filter(n=>n.type==='ScrollView');assert.equal(rows.length,5,'presets and four rules each have one horizontal row');
 const presets=rows[0];presets.props.onLayout({nativeEvent:{layout:{width:width-82}}});assert.equal(rowWidth,width-82);tree=render();rows=nodes(tree).filter(n=>n.type==='ScrollView');
 for(const row of rows){assert.equal(row.props.horizontal,true);assert.equal(row.props.directionalLockEnabled,true);assert.notEqual(row.props.contentContainerStyle.flexWrap,'wrap');assert.equal(row.props.style.flexGrow,0);const cards=nodes(row).filter(n=>n.type==='Pressable');assert.ok(cards.length>=2);const heights=new Set(cards.map(n=>n.props.style.at(-1).height));assert.equal(heights.size,1,'selection and text do not change height');for(const card of cards){assert.ok(card.props.style.at(-1).height>=48);const labels=nodes(card).filter(n=>n.type==='Text');assert.ok(labels.every(n=>n.props.numberOfLines===1));assert.ok(card.props.accessibilityLabel);assert.ok(card.props.style.at(-1).width>0||card.props.style.at(-1).minWidth>0)}}
 const presetCards=nodes(rows[0]).filter(n=>n.type==='Pressable');assert.equal(new Set(presetCards.map(n=>n.props.style.at(-1).width)).size,1);presetCards[2].props.onPress();assert.equal(chosen,'phase10','third preset remains selectable');
 const winner=rows.find(n=>n.props.accessibilityLabel==='Winner options');const winners=nodes(winner).filter(n=>n.type==='Pressable');winners[2].props.onPress();assert.equal(changed.winner,'zero');assert.ok(winners[0].props.accessibilityState.selected);assert.ok(winners.every(n=>n.props.style.at(-1).width===undefined),'long labels can widen without truncation');
 tree=render({winner:'zero'});rows=nodes(tree).filter(n=>n.type==='ScrollView');assert.ok(rows.some(n=>n.props.accessibilityLabel==='Exact zero required options'));assert.ok(rows.some(n=>n.props.accessibilityLabel==='When zero is reached options'));
 // Frequent players stay a separate wrapping list rather than being folded into rule rails.
 assert.equal(nodes(tree).filter(n=>n.type==='Pressable'&&n.props.accessibilityLabel==='Add Mike').length,1);
}
console.log('Setup rows: one horizontal rail per preset/rule group, equal compact heights, no label wrapping, consistent preset widths, font scaling, viewport changes and selection callbacks passed.');
