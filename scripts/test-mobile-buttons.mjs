import {execFileSync} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
const output=path.resolve('.sites-runtime/button-tests');mkdirSync(output,{recursive:true});
execFileSync(process.execPath,['node_modules/typescript/bin/tsc','mobile/button-colors.ts','mobile/score-keypad.ts','mobile/game-chrome-colors.ts','--target','ES2022','--module','commonjs','--skipLibCheck','--outDir',output],{stdio:'inherit'});
writeFileSync(path.join(output,'package.json'),'{"type":"commonjs"}');
const {buttonColors}=await import(pathToFileURL(path.join(output,'button-colors.js')).href);
function luminance(hex){const rgb=hex.slice(1).match(/../g).map(x=>parseInt(x,16)/255).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4);return .2126*rgb[0]+.7152*rgb[1]+.0722*rgb[2]}
for(const dark of [false,true])for(const secondary of [false,true]){const {text,background}=buttonColors(dark,secondary);const a=luminance(text),b=luminance(background);assert.ok((Math.max(a,b)+.05)/(Math.min(a,b)+.05)>=4.5,`Button contrast fails: dark=${dark}, secondary=${secondary}`)}
console.log('Primary/secondary button label contrast passes 4.5:1 in light and dark modes.');

const {scoreKeyInput}=await import(pathToFileURL(path.join(output,'score-keypad.js')).href);
let draft='';for(const key of ['1','2','3'])draft=scoreKeyInput(draft,key);assert.equal(draft,'123');
draft=scoreKeyInput(draft,'sign');assert.equal(draft,'-123');draft=scoreKeyInput(draft,'backspace');assert.equal(draft,'-12');draft=scoreKeyInput(draft,'sign');assert.equal(draft,'12');
assert.equal(scoreKeyInput('','sign'),'-');assert.equal(scoreKeyInput('-','0'),'-0');assert.equal(scoreKeyInput('000','5'),'5');assert.equal(scoreKeyInput('-00','5'),'-5');assert.equal(scoreKeyInput('','backspace'),'');
assert.equal(scoreKeyInput('10000','0'),'100000');assert.equal(scoreKeyInput('100000','1'),'100000');assert.equal(scoreKeyInput('99999','9'),'99999');assert.equal(scoreKeyInput('-10000','0'),'-100000');assert.equal(scoreKeyInput('12','.'),'12');assert.equal(scoreKeyInput('12','x'),'12');
console.log('Inline score keypad: digits, sign, backspace, leading zeros, numeric-only input and score bounds passed.');

const {gameChromeColors}=await import(pathToFileURL(path.join(output,'game-chrome-colors.js')).href);
assert.equal(gameChromeColors(true).title,'#ffffff','Dark game title stays white rather than inheriting an accent.');
for(const dark of [false,true]){const c=gameChromeColors(dark);for(const [text,background] of [[c.title,c.header],[c.detail,c.header],[c.accent,c.header],[c.accent,c.surface]]){const a=luminance(text),b=luminance(background);assert.ok((Math.max(a,b)+.05)/(Math.min(a,b)+.05)>=4.5,`Game chrome contrast: dark=${dark}, ${text} on ${background}`)}}
console.log('Pinned game header, rules, sync icon and toolbar contrast pass in both themes.');
