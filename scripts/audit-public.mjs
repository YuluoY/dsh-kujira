#!/usr/bin/env node
import {execFileSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

// Report filenames and line numbers only; never echo matched credentials.
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const files=execFileSync('git',['ls-files','-z'],{cwd:root,encoding:'utf8'}).split('\0').filter(Boolean);
const checks=[['private key',/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],['access token',/\b(?:sk-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})/],['personal device path',/\/Users\/[A-Za-z0-9_.-]+/],['personal email',/[A-Za-z0-9._%+-]+@(?:gmail|qq|163|126|outlook|hotmail|icloud)\.[A-Za-z]{2,}/]];
let findings=0;
for(const file of files){
 if(/(^|\/)(\.env(?:\..*)?|\.credentials\.yaml|inventory\.json|inventory\.sqlite(?:-wal|-shm)?|realtime\.json|id_rsa)$/.test(file)&&!file.endsWith('.env.example')){console.error(file+': private runtime file');findings++;}
 const bytes=await readFile(resolve(root,file));if(bytes.subarray(0,8192).includes(0))continue;
 bytes.toString('utf8').split('\n').forEach((line,i)=>{for(const [kind,pattern]of checks)if(pattern.test(line)){findings++;console.error(file+':'+(i+1)+': '+kind);}});
}
console.log('Checked '+files.length+' tracked files; '+findings+' findings. Review screenshots and Git history separately.');
process.exitCode=findings?1:0;
