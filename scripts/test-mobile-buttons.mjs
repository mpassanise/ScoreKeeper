import {execFileSync} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
const output=path.resolve('.sites-runtime/button-tests');mkdirSync(output,{recursive:true});
execFileSync(process.execPath,['node_modules/typescript/bin/tsc','mobile/button-colors.ts','--target','ES2022','--module','commonjs','--skipLibCheck','--outDir',output],{stdio:'inherit'});
writeFileSync(path.join(output,'package.json'),'{"type":"commonjs"}');
const {buttonColors}=await import(pathToFileURL(path.join(output,'button-colors.js')).href);
function luminance(hex){const rgb=hex.slice(1).match(/../g).map(x=>parseInt(x,16)/255).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4);return .2126*rgb[0]+.7152*rgb[1]+.0722*rgb[2]}
for(const dark of [false,true])for(const secondary of [false,true]){const {text,background}=buttonColors(dark,secondary);const a=luminance(text),b=luminance(background);assert.ok((Math.max(a,b)+.05)/(Math.min(a,b)+.05)>=4.5,`Button contrast fails: dark=${dark}, secondary=${secondary}`)}
console.log('Primary/secondary button label contrast passes 4.5:1 in light and dark modes.');
