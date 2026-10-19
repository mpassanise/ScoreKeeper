import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const fixture=JSON.parse(readFileSync('tests/fixtures/game-operation-v1.json','utf8'));
const root=mkdtempSync(path.join(tmpdir(),'scorekeeper-operation-contract-'));
try{
 const source=`import type {GameActionOperation,GameLifecycleOperation} from ${JSON.stringify(path.resolve('shared/game-operation-contract'))};
 const operation=${JSON.stringify(fixture.operation)} satisfies GameActionOperation;
 const deletion={protocolVersion:1,kind:'delete',operationId:'op',gameId:'game',expectedVersion:2} satisfies GameLifecycleOperation;
 // @ts-expect-error Creation requires a complete game.
 const incomplete:GameLifecycleOperation={protocolVersion:1,kind:'create',operationId:'op',gameId:'game',expectedVersion:0};
 // @ts-expect-error Imports cannot overwrite an existing server version.
 const overwrite:GameLifecycleOperation={protocolVersion:1,kind:'import',operationId:'op',gameId:'game',expectedVersion:2,game:{} as never};
 // @ts-expect-error A queued score requires a stable entry ID.
 const invalid:GameActionOperation={...operation,command:{action:'score',expectedVersion:1,points:0,playerId:'p'}};
 // @ts-expect-error Undo targets a specific score entry.
 const untargeted:GameActionOperation={...operation,command:{action:'undo',expectedVersion:1}};
 `;
 writeFileSync(path.join(root,'contract.ts'),source);
 execFileSync(process.execPath,['node_modules/typescript/bin/tsc',path.join(root,'contract.ts'),'--noEmit','--strict','--target','ES2022','--moduleResolution','node','--skipLibCheck'],{stdio:'inherit'});
 // Match the server's typed record property order and absent optional defaults.
 const op=fixture.operation,c=op.command;
 const canonical={protocolVersion:op.protocolVersion,kind:op.kind,operationId:op.operationId,gameId:op.gameId,command:{expectedVersion:c.expectedVersion,action:c.action,points:c.points??null,playerId:c.playerId??null,entryId:c.entryId??null,rules:c.rules??null}};
 assert.equal(createHash('sha256').update(JSON.stringify(canonical)).digest('hex').toUpperCase(),fixture.fingerprint);
 console.log('Web/iPhone operation types require explicit score/undo targets; shared wire/fingerprint fixture passed. No client queue is enabled.');
}finally{rmSync(root,{recursive:true,force:true})}
