import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

export const publicBuildConfigKeys=[
 'NEXT_PUBLIC_SCOREKEEPER_API_URL',
 'NEXT_PUBLIC_SCOREKEEPER_AUTHORITY',
 'NEXT_PUBLIC_SCOREKEEPER_WEB_CLIENT_ID',
 'NEXT_PUBLIC_SCOREKEEPER_SCOPE',
];

const examplePath=fileURLToPath(new URL('../.env.example',import.meta.url));

export function publicBuildConfig(environment=process.env,exampleText=readFileSync(examplePath,'utf8')){
 const example=Object.fromEntries(exampleText.split(/\r?\n/).flatMap(line=>{
  const trimmed=line.trim();
  if(!trimmed||trimmed.startsWith('#'))return [];
  const separator=trimmed.indexOf('=');
  if(separator<1)return [];
  return [[trimmed.slice(0,separator).trim(),trimmed.slice(separator+1).trim()]];
 }));
 return Object.fromEntries(publicBuildConfigKeys.map(key=>[
  key,
  environment[key]||example[key]||'',
 ]));
}
