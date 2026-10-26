import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from '../node_modules/typescript/lib/typescript.js';
// Execute the actual shell event handlers, including callbacks retained by a native alert.
const source=readFileSync('mobile/App.tsx','utf8');
const handlers=source.slice(source.indexOf(' function selectScorer('),source.indexOf(' async function create()'));
assert.ok(handlers.includes('function finishGame()'));
const code=ts.transpileModule(handlers,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
function fixture({draft='',...flags}={}){
 const game={id:'game-A',version:3,next:'one',finished:false,players:[{id:'one'},{id:'two'}]};
 const state={foregroundContext:{current:{view:{game},points:draft}},identityRevision:{current:1},locked:{current:false},busy:false,accountScoreReadOnly:false,accountCompletionReadOnly:false,pendingScoreSave:false,reordering:false,...flags};
 const actions=[],alerts=[],errors=[];let homes=0;
 Object.assign(state,{Alert:{alert:(...args)=>alerts.push(args)},setPoints:p=>{state.foregroundContext.current.points=p},setError:e=>errors.push(e),action:async a=>actions.push(a),goHome:()=>homes++,remainingTargetPlayers:g=>g.eligible});
 const api=new Function('s',`with(s){${code};return {selectScorer,leaveGame,finishGame}}`)(state);
 return {state,game,actions,alerts,errors,api,homes:()=>homes,confirm:()=>alerts.at(-1)[2].at(-1).onPress()};
}
let f=fixture();f.api.selectScorer('two');assert.deepEqual(f.actions,[{action:'select',playerId:'two'}]);
f=fixture({draft:'27'});f.api.selectScorer('two');assert.equal(f.actions.length,0);assert.equal(f.state.foregroundContext.current.points,'27','Cancel leaves unsent points intact');f.confirm();assert.deepEqual(f.actions,[{action:'select',playerId:'two'}]);assert.equal(f.state.foregroundContext.current.points,'');
for(const change of [f=>f.state.identityRevision.current++,f=>f.state.foregroundContext.current.view={game:{...f.game,version:f.game.version+1}},f=>f.state.foregroundContext.current.view=null,f=>f.state.foregroundContext.current.view={game:{...f.game,id:'other'}},f=>f.state.foregroundContext.current.points='99',f=>f.state.locked.current=true]){
 for(const event of ['selectScorer','finishGame']){f=fixture({draft:'27'});f.api[event]('two');change(f);f.confirm();assert.equal(f.actions.length,0,`${event} rejects stale confirmation`);assert.notEqual(f.state.foregroundContext.current.points,'','Stale callback cannot discard current input')}
}
for(const flag of ['busy','accountScoreReadOnly','pendingScoreSave','reordering']){f=fixture({[flag]:true});f.api.selectScorer('two');assert.equal(f.actions.length,0);assert.equal(f.alerts.length,0)}
f=fixture();f.game.eligible=[{id:'one'}];f.api.selectScorer('two');f.api.selectScorer('missing');f.api.selectScorer('one');assert.equal(f.actions.length,0,'Final round and unknown player eligibility is preserved');
for(const draft of ['', '27']){f=fixture({draft});f.api.finishGame();assert.equal(f.actions.length,0,'Finish always confirms');f.confirm();assert.deepEqual(f.actions,[{action:'finish'}]);assert.equal(f.state.foregroundContext.current.points,'')}
for(const flag of ['accountCompletionReadOnly','pendingScoreSave','reordering']){f=fixture({[flag]:true});f.api.finishGame();assert.equal(f.alerts.length,0)}
f=fixture({draft:'27'});f.api.leaveGame();assert.equal(f.homes(),0);assert.equal(f.state.foregroundContext.current.points,'27');f.confirm();assert.equal(f.homes(),1);assert.equal(f.state.foregroundContext.current.points,'');
f=fixture({draft:'27'});f.api.leaveGame();f.state.identityRevision.current++;f.confirm();assert.equal(f.homes(),0);assert.equal(f.state.foregroundContext.current.points,'27');
f=fixture();f.api.leaveGame();assert.equal(f.homes(),1);
console.log('Pinned scorer actual handlers: draft confirmation, selection/finish/navigation, final-round eligibility, disabled gates and stale account/game/draft callbacks passed.');

// Render actual native component trees with host primitives, then exercise their
// callbacks. Native safe-area geometry still needs acceptance on a real iPhone.
let dark=false,index=0,hooks=[],effects=[];
const react={useRef:v=>{const i=index++;return hooks[i]??(hooks[i]={current:v})},useState:v=>{const i=index++;if(!(i in hooks))hooks[i]=v;return [hooks[i],v=>hooks[i]=v]},useEffect:(fn,deps)=>{const i=index++,old=hooks[i];if(!old||deps.some((v,j)=>v!==old[j])){hooks[i]=deps;effects.push(fn)}}};
const jsx=(type,props)=>({type,props});
const native={View:'View',Text:'Text',Pressable:'Pressable',ScrollView:'ScrollView',Modal:'Modal',Image:'Image',Keyboard:{dismiss(){}},Platform:{OS:'ios'},StyleSheet:{create:s=>s,absoluteFill:{}}};
const cache=new Map();
function load(file){if(cache.has(file))return cache.get(file);const module={exports:{}};cache.set(file,module.exports);const compiled=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
 const req=name=>{if(name==='react')return react;if(name==='react/jsx-runtime')return {jsx,jsxs:jsx,Fragment:'Fragment'};if(name==='react-native')return native;if(name==='react-native-safe-area-context')return {SafeAreaView:'SafeAreaView'};if(name==='./Theme')return {useTheme:()=>({dark}),useThemeStyles:s=>s};if(name==='./SideDrawer')return {default:'SideDrawer'};if(name==='../shared/local-games')return {rulesLabel:()=> 'Turn-based · Add points'};if(name.endsWith('.png'))return 1;const base=new URL(name,new URL(file,`file://${process.cwd()}/`)).pathname;return load(base+'.ts')};
 new Function('require','module','exports',compiled)(req,module,module.exports);cache.set(file,module.exports);return module.exports;
}
function render(component,props){index=0;effects=[];const tree=component(props);effects.forEach(fn=>fn());return tree}
function nodes(tree,predicate){const result=[];function visit(n){if(!n||typeof n!=='object')return;if(Array.isArray(n)){n.forEach(visit);return}if(predicate(n))result.push(n);visit(n.props?.children)}visit(tree);return result}
const Header=load('mobile/AppHeader.tsx').default,Toolbar=load('mobile/GameToolbar.tsx').default,Standings=load('mobile/Standings.tsx').default;
for(dark of [false,true]){
 hooks=[];let tree=render(Header,{game:{name:'Friday Scrabble',winner:'high'},signedIn:true});
 assert.deepEqual(nodes(tree,n=>n.type==='SafeAreaView')[0].props.edges,['top','left','right']);
 const title=nodes(tree,n=>n.props?.accessibilityRole==='header')[0];assert.equal(title.props.children,'Friday Scrabble');assert.equal(title.props.style.at(-1).color,dark?'#ffffff':'#17252a');
 hooks=[];tree=render(Toolbar,{busy:false,finished:false,disabled:false,onHome(){},onFinish(){},onNewGame(){}});assert.deepEqual(tree.props.edges,['bottom']);assert.equal(nodes(tree,n=>n.props?.accessibilityLabel==='Finish game').length,1);
 hooks=[];tree=render(Toolbar,{busy:false,finished:true,disabled:true});assert.equal(nodes(tree,n=>n.props?.accessibilityLabel==='Start a new game')[0].props.disabled,false,'Completed game can start a new game even if completion writes are unavailable');
}
hooks=[];const players=Array.from({length:20},(_,i)=>({id:String(i),name:`Player ${i+1}`})),selected=[];
let props={view:{game:{players,winner:'high'},totals:Object.fromEntries(players.map((p,i)=>[p.id,100-i]))},selectedId:'0',onSelect:id=>selected.push(id)};
let tree=render(Standings,props),strip=nodes(tree,n=>n.type==='ScrollView')[0],scrolls=[];strip.props.ref.current={scrollTo:p=>scrolls.push(p)};
let pills=nodes(strip,n=>n.type==='Pressable');assert.equal(pills.length,20);pills.forEach((p,i)=>p.props.onLayout({nativeEvent:{layout:{x:i*140}}}));
pills[19].props.onPress();assert.deepEqual(selected,['19']);
nodes(tree,n=>n.props?.accessibilityLabel==='Show all 20 players')[0].props.onPress();tree=render(Standings,props);assert.equal(nodes(tree,n=>n.type==='SideDrawer')[0].props.visible,true);
props={...props,selectedId:'19'};tree=render(Standings,props);tree=render(Standings,props);assert.equal(nodes(tree,n=>n.type==='SideDrawer')[0].props.visible,false);assert.equal(scrolls.at(-1).x,2644,'Selected offscreen player is revealed');
props={...props,disabled:true};tree=render(Standings,props);assert.ok(nodes(nodes(tree,n=>n.type==='ScrollView')[0],n=>n.type==='Pressable').every(n=>n.props.disabled));
props={...props,disabled:false,isPlayerDisabled:id=>id==='1'};tree=render(Standings,props);assert.equal(nodes(nodes(tree,n=>n.type==='ScrollView')[0],n=>n.type==='Pressable')[1].props.disabled,true);
console.log('Native component trees: safe-area edges, theme-specific title, completion toolbar, 20-player selection, chooser lifecycle, selected-pill scrolling and eligibility passed.');
