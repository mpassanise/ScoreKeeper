import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const output=mkdtempSync(path.join(tmpdir(),'scorekeeper-callback-'));
const originals={window:globalThis.window,document:globalThis.document,BroadcastChannel:globalThis.BroadcastChannel};
try{
 execFileSync(process.execPath,['node_modules/typescript/bin/tsc','shared/msal-callback.ts','--target','ES2022','--module','commonjs','--outDir',output],{stdio:'inherit'});
 writeFileSync(path.join(output,'package.json'),'{"type":"commonjs"}');
 const {isSilentCallback}=await import(pathToFileURL(path.join(output,'msal-callback.js')).href);
 assert.equal(isSilentCallback(false,'#code=example&state=example',''),false,'top-level redirect still uses handleRedirectPromise');
 assert.equal(isSilentCallback(true,'',''),false,'ordinary embedded app still mounts normally');
 assert.equal(isSilentCallback(true,'#section','?state=preferences'),false);
 assert.equal(isSilentCallback(true,'#code=example&state=example',''),true);
 assert.equal(isSilentCallback(true,'','?error=login_required&state=example'),true);
 assert.equal(isSilentCallback(true,'#ear_jwe=example&state=example',''),true);
 assert.equal(isSilentCallback(true,'#code=example',''),false);
 // Exercise the installed SDK's bridge, not an application reimplementation.
 const {broadcastResponseToMainFrame}=await import('@azure/msal-browser/redirect-bridge');
 const sent=[];let replaced='',closed=0;
 globalThis.BroadcastChannel=class{constructor(name){this.name=name}postMessage(message){sent.push({channel:this.name,message})}close(){}};
 globalThis.document={title:'Scorekeeper'};
 const state=Buffer.from(JSON.stringify({id:'fixture-channel',meta:{interactionType:'silent'}})).toString('base64');
 for(const query of [false,true]){
  const payload='code=fixture-code&state='+encodeURIComponent(state);
  globalThis.window={location:{origin:'https://example.test',pathname:'/',hash:query?'':'#'+payload,search:query?'?'+payload:''},history:{replaceState(_state,_title,url){replaced=url}},close(){closed++}};
  assert.equal(isSilentCallback(true,window.location.hash,window.location.search),true);
  await broadcastResponseToMainFrame();
  assert.equal(sent.at(-1).channel,'fixture-channel');
  assert.equal(sent.at(-1).message.payload,payload);
  assert.equal(sent.at(-1).message.v,1);
  assert.equal(replaced,'https://example.test/','SDK removes auth response from callback URL');
 }
 assert.equal(closed,2);assert.equal(document.title,'Microsoft Authentication');
 globalThis.window={location:{origin:'https://example.test',pathname:'/',hash:'#code=bad&state=invalid',search:''},history:{replaceState(_state,_title,url){replaced=url}},close(){}};
 const count=sent.length;await assert.rejects(broadcastResponseToMainFrame());assert.equal(sent.length,count,'invalid state is not broadcast');
 console.log('MSAL callback: root-frame selection, untouched top-level redirects, hash/query SDK broadcasts, URL cleanup and invalid-state rejection passed.');
}finally{
 for(const [key,value]of Object.entries(originals)){if(value===undefined)delete globalThis[key];else globalThis[key]=value}
 rmSync(output,{recursive:true,force:true});
}

