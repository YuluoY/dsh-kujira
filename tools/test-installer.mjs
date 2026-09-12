import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,copyFile,rm,realpath} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {parseOptions,pluginCommand,windowsCommand} from '../scripts/dsh-plugin.mjs';
test('installer validates options and keeps directory names as one argument',()=>{
 assert.deepEqual(parseOptions([]),{action:'install',profile:'web',dryRun:false});
 assert.throws(()=>parseOptions(['install','--profile','../private']));assert.throws(()=>parseOptions(['install','--unknown']));
 assert.deepEqual(pluginCommand({action:'install',profile:'web'},'/tmp/with spaces'),['plugin','--profile','web','add','link:/tmp/with spaces']);
 assert.deepEqual(pluginCommand({action:'uninstall',profile:'custom'},'/tmp'),['plugin','--profile','custom','remove','dsh-kujira']);
 assert(windowsCommand('dsh',['link:C:\\with spaces\\x']).includes('"link:C:\\with spaces\\x"'));assert.throws(()=>windowsCommand('dsh',['%TOKEN%']));
});
test('installer works outside its package directory, propagates failures and never restarts DSH',async t=>{
 if(process.platform==='win32')return t.skip('POSIX executable fixture');
 const root=await mkdtemp(join(tmpdir(),'kujira install '));t.after(()=>rm(root,{recursive:true,force:true}));
 for(const path of ['scripts','lib','bin'])await mkdir(join(root,path));
 await copyFile(new URL('../scripts/dsh-plugin.mjs',import.meta.url),join(root,'scripts','dsh-plugin.mjs'));
 await writeFile(join(root,'package.json'),JSON.stringify({name:'dsh-kujira',version:'test',dsh:{bundle:{patch:'cordis.patch.yml'}}}));await writeFile(join(root,'cordis.patch.yml'),'');await writeFile(join(root,'lib/index.js'),'');
 const log=join(root,'calls');
 for(const name of ['dsh','pnpm'])await writeFile(join(root,'bin',name),'#!/bin/sh\nif [ "$1" = "--version" ]; then echo 1.0.0; exit 0; fi\nprintf "%s\\n" "$@" >> "$INSTALL_TEST_LOG"\nexit "${INSTALL_TEST_EXIT:-0}"\n',{mode:0o755});
 const run=extra=>spawnSync(process.execPath,[join(root,'scripts/dsh-plugin.mjs'),'install'],{cwd:tmpdir(),env:{...process.env,PATH:join(root,'bin')+':'+process.env.PATH,INSTALL_TEST_LOG:log,...extra},encoding:'utf8'});
 assert.equal(run({}).status,0);assert.deepEqual((await readFile(log,'utf8')).trim().split('\n'),['plugin','--profile','web','add','link:'+await realpath(root)]);assert.equal(run({INSTALL_TEST_EXIT:'7'}).status,1);
});
