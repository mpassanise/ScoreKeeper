import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from '../node_modules/typescript/lib/typescript.js';
// Execute the actual shell event handlers, including callbacks retained by a native alert.
const source=readFileSync('mobile/App.tsx','utf8');
const handlers=source.slice(source.indexOf(' function selectScorer('),source.indexOf(' async function create()'));
assert.ok(handlers.includes('function finishGame()'));
const code=ts.transpileModule(handlers,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
function fixture({draft='',...flags}={}){
 const game={id:'game-A',version:3,next:'one',finished:false,entries:[{id:'entry-1',playerId:'one',points:25}],players:[{id:'one'},{id:'two'}]};
 const state={foregroundContext:{current:{view:{game},points:draft}},identityRevision:{current:1},locked:{current:false},correctionState:{current:{blocked:false}},busy:false,accountScoreReadOnly:false,accountCompletionReadOnly:false,pendingScoreSave:false,reordering:false,...flags};
 const actions=[],alerts=[],errors=[];let homes=0;
 Object.assign(state,{Alert:{alert:(...args)=>alerts.push(args)},setPoints:p=>{state.foregroundContext.current.points=p},setError:e=>errors.push(e),action:async a=>actions.push(a),goHome:()=>homes++,remainingTargetPlayers:g=>g.eligible});
 const api=new Function('s',`with(s){${code};return {selectScorer,leaveGame,finishGame,undoLastScore}}`)(state);
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

// Undo must name the exact latest entry, confirm once, preserve drafts on cancel,
// and reject stale authority/history even when an alert outlives its screen.
f=fixture({draft:'27'});f.api.undoLastScore();assert.equal(f.actions.length,0);assert.ok(f.alerts[0][1].includes('25 points (turn 1)'));assert.ok(f.alerts[0][1].includes('Unadded points'));assert.equal(f.state.foregroundContext.current.points,'27');f.confirm();assert.deepEqual(f.actions,[{action:'undo'}]);assert.equal(f.state.foregroundContext.current.points,'');
for(const change of [f=>f.state.identityRevision.current++,f=>f.state.foregroundContext.current.view={game:{...f.game,version:4}},f=>f.state.foregroundContext.current.view=null,f=>f.state.foregroundContext.current.view={game:{...f.game,id:'other'}},f=>f.state.foregroundContext.current.points='99',f=>f.state.locked.current=true,f=>f.state.correctionState.current.blocked=true,f=>f.state.foregroundContext.current.view={game:{...f.game,entries:[{id:'newer',points:40}]}}]){f=fixture({draft:'27'});f.api.undoLastScore();change(f);f.confirm();assert.equal(f.actions.length,0);assert.notEqual(f.state.foregroundContext.current.points,'')}
f=fixture();f.game.entries=[];f.api.undoLastScore();assert.equal(f.alerts.length,0);
f=fixture();f.state.correctionState.current.blocked=true;f.api.undoLastScore();assert.equal(f.alerts.length,0);
f=fixture();f.game.scoreMode='total';f.game.finished=true;f.api.undoLastScore();assert.ok(f.alerts[0][1].includes('25 recorded total'));assert.ok(f.alerts[0][1].includes('game status'));f.confirm();assert.deepEqual(f.actions,[{action:'undo'}]);
console.log('Undo confirmation: exact-entry summary, total/completed games, draft safety, empty/blocked state, and stale authority/version/history rejection passed.');

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
 hooks=[];tree=render(Toolbar,{busy:false,finished:false,disabled:false,undoDisabled:false,onHome(){},onFinish(){},onResume(){},onUndo(){},onHistory(){}});assert.deepEqual(tree.props.edges,['bottom']);assert.equal(nodes(tree,n=>n.props?.accessibilityLabel==='Finish game').length,1);assert.equal(nodes(tree,n=>n.type==='Pressable').length,4);assert.equal(tree.props.children.props.style.flexDirection,'row');assert.equal(nodes(tree,n=>n.props?.accessibilityLabel==='Score history')[0].props.disabled,false);
 hooks=[];tree=render(Toolbar,{busy:false,finished:true,disabled:true});assert.equal(nodes(tree,n=>n.props?.accessibilityLabel==='Resume game')[0].props.disabled,true,'Resume retains completion permission checks');
}
// Both native menus route Timer only after iOS dismisses the menu modal.
for(const game of [undefined,{name:'Timer game',winner:'high'}]){hooks=[];let opened=0;const header=render(Header,{game,signedIn:false,onTimer:()=>opened++});const action=nodes(header,n=>n.type==='Pressable'&&nodes(n,c=>c.type==='Text'&&c.props.children==='Timer').length===1)[0];assert.ok(action);action.props.onPress();assert.equal(opened,0);nodes(header,n=>n.type==='Modal')[0].props.onDismiss();assert.equal(opened,1)}
hooks=[];const players=Array.from({length:20},(_,i)=>({id:String(i),name:`Player ${i+1}`})),selected=[];
let props={view:{game:{players,winner:'high'},totals:Object.fromEntries(players.map((p,i)=>[p.id,100-i]))},selectedId:'0',onSelect:id=>selected.push(id)};
let tree=render(Standings,props),strip=nodes(tree,n=>n.type==='ScrollView')[0],scrolls=[];strip.props.ref.current={scrollTo:p=>scrolls.push(p)};
let pills=nodes(strip,n=>n.type==='Pressable');assert.equal(pills.length,20);pills.forEach((p,i)=>p.props.onLayout({nativeEvent:{layout:{x:i*140}}}));
pills[19].props.onPress();assert.deepEqual(selected,['19']);
assert.equal(nodes(tree,n=>n.type==='SideDrawer').length,0);assert.equal(nodes(tree,n=>n.props?.accessibilityRole==='header').length,1);
props={...props,selectedId:'19'};tree=render(Standings,props);assert.equal(scrolls.at(-1).x,2644,'Selected offscreen player is revealed');
props={...props,disabled:true};tree=render(Standings,props);assert.ok(nodes(nodes(tree,n=>n.type==='ScrollView')[0],n=>n.type==='Pressable').every(n=>n.props.disabled));
props={...props,disabled:false,isPlayerDisabled:id=>id==='1'};tree=render(Standings,props);assert.equal(nodes(nodes(tree,n=>n.type==='ScrollView')[0],n=>n.type==='Pressable')[1].props.disabled,true);
console.log('Native component trees: safe-area edges, theme-specific title, completion toolbar, 20-player pill selection, static player heading, selected-pill scrolling and eligibility passed.');

// Structural regression: history/editing share one native sheet and the tray
// is outside vertical scrolling, so both actions remain reachable while scoring.
const ast=ts.createSourceFile('App.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
let toolbarFound=false,historyFound=false;
function visit(n,ancestors=[]){
 if(ts.isJsxSelfClosingElement(n)&&n.tagName.getText(ast)==='GameToolbar'){toolbarFound=true;assert.ok(!ancestors.includes('ScrollView'),'Tray cannot move into scrolling body')}
 if(ts.isJsxElement(n)){const tag=n.openingElement.tagName.getText(ast);if(tag==='SideDrawer'&&n.openingElement.attributes.getText(ast).includes('historyOpen')){historyFound=true;assert.ok(n.getText(ast).includes('setEdit(e.id)'));assert.ok(n.getText(ast).includes('Corrected points'));assert.ok(!n.getText(ast).includes('<Modal'))}ancestors=[...ancestors,tag]}
 ts.forEachChild(n,c=>visit(c,ancestors));
}
visit(ast);assert.ok(toolbarFound&&historyFound);

for(dark of [false,true]){hooks=[];const calls=[];const tree=render(Toolbar,{busy:false,finished:false,disabled:false,undoDisabled:true,onHome:()=>calls.push('home'),onFinish:()=>calls.push('finish'),onResume:()=>{},onUndo:()=>calls.push('undo'),onHistory:()=>calls.push('history')});const buttons=nodes(tree,n=>n.type==='Pressable');assert.equal(buttons[1].props.disabled,true);assert.equal(buttons[2].props.disabled,false,'History remains readable when undo is unavailable');for(const b of buttons)assert.ok(b.props.style[0].minHeight>=44);buttons[0].props.onPress();buttons[2].props.onPress();buttons[3].props.onPress();assert.deepEqual(calls,['home','history','finish'])}
console.log('Pinned tray: four buttons, independent history/undo availability, action routing and minimum touch targets pass in both themes.');

for(dark of [false,true])for(const blocked of [false,true]){hooks=[];let resumed=0;const tree=render(Toolbar,{busy:false,finished:true,disabled:blocked,undoDisabled:true,onResume:()=>resumed++});const resume=nodes(tree,n=>n.props?.accessibilityLabel==='Resume game')[0];assert.equal(resume.props.disabled,blocked);assert.equal(nodes(tree,n=>n.props?.accessibilityLabel==='+ New game').length,0);if(!blocked){resume.props.onPress();assert.equal(resumed,1)}}
assert.ok(source.includes('{game.finished&&<Button title="+ New Game" onPress={newGame}/>}'),'New game is the primary completed-screen action independent of account scoring permission');
console.log('Completed iPhone actions: primary New Game above results; Resume in pinned tray with permission gates, routing and theme support passed.');

for(dark of [false,true]){
 hooks=[];const header=render(Header,{screenTitle:'New game',signedIn:true});const title=nodes(header,n=>n.props?.accessibilityRole==='header')[0];assert.equal(title.props.children,'New game');assert.equal(title.props.style.at(-1).color,dark?'#ffffff':'#17252a');assert.equal(nodes(header,n=>n.type==='SafeAreaView')[0].props.style.at(-1).backgroundColor,dark?'#12343e':'#e8f0f1');assert.equal(nodes(header,n=>n.props?.accessibilityLabel==='Scorekeeper home').length,0,'Setup title replaces brand');assert.equal(nodes(header,n=>n.type==='Text'&&n.props.children==='Game details').length,0,'Setup does not pretend to be a saved game');
 for(const busy of [false,true]){hooks=[];let homes=0;const tray=render(Toolbar,{setup:true,busy,onHome:()=>homes++});const buttons=nodes(tray,n=>n.type==='Pressable');assert.equal(buttons.length,1);assert.equal(buttons[0].props.accessibilityLabel,'Home');assert.equal(buttons[0].props.disabled,busy);assert.equal(buttons[0].props.style[1].width,'25%');assert.equal(buttons[0].props.children[1].props.style[1].color,dark?'#9bd7dc':'#226b73');assert.deepEqual(tray.props.edges,['bottom']);if(!busy){buttons[0].props.onPress();assert.equal(homes,1)}}
}
assert.ok(source.includes("screenTitle={creating&&!game?'New game':undefined}"));assert.ok(source.includes("edges={game||creating?['left','right']"),'Tray owns bottom safe area during setup');assert.ok(source.includes('{creating&&!game&&<GameToolbar setup'));assert.ok(!source.includes('title="‹ Home"'),'Setup no longer duplicates Home in scrolling content');
console.log('New Game chrome: themed contextual header, no fake game actions, Home-only fixed tray, busy gate and shared safe-area ownership passed.');
