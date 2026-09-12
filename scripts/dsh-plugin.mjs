#!/usr/bin/env node
import {spawnSync} from 'node:child_process';
import {readFile,access,realpath} from 'node:fs/promises';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

/** Parse only explicit installer options, never forward arbitrary shell arguments. */
export function parseOptions(args) {
  const options={action:'install',profile:'web',dryRun:false};
  if(args[0]&&!args[0].startsWith('--'))options.action=args.shift();
  if(!['install','uninstall','doctor'].includes(options.action))throw Error('Use install, uninstall or doctor.');
  for(let i=0;i<args.length;i++) {
    if(args[i]==='--profile')options.profile=args[++i];
    else if(args[i]==='--dry-run')options.dryRun=true;
    else if(args[i]==='--help')options.help=true;
    else throw Error('Unknown option: '+args[i]);
  }
  if(typeof options.profile!=='string'||! /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(options.profile))throw Error('Invalid profile name.');
  return options;
}
/** Construct a DSH argument vector without shell interpolation. */
export function pluginCommand({action,profile},root) {
  return ['plugin','--profile',profile,...(action==='uninstall'?['remove','dsh-kujira']:['add','link:'+root])];
}
/** Windows command shims require cmd.exe; quote every argument and reject expansion characters. */
export function windowsCommand(executable,args) {
  const parts=[executable,...args];
  if(parts.some(value=>/["%!\r\n]/.test(value)))throw Error('Windows install path cannot contain quotes, %, ! or line breaks. Move the extracted folder to a simple path.');
  return '"'+parts.map(value=>'"'+value+'"').join(' ')+'"';
}
const run=(command,args,options={})=>process.platform==='win32'
  ? spawnSync(process.env.ComSpec||'cmd.exe',['/d','/s','/c',windowsCommand(command,args)],{...options,shell:false})
  : spawnSync(command,args,{...options,shell:false});
export async function main(args=process.argv.slice(2)) {
  const options=parseOptions([...args]);
  if(options.help){console.log('node scripts/dsh-plugin.mjs [install|uninstall|doctor] [--profile web] [--dry-run]');return 0;}
  if(Number(process.versions.node.split('.')[0])<22)throw Error('Node.js 22 or newer is required.');
  const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
  const pkg=JSON.parse(await readFile(join(root,'package.json'),'utf8'));
  if(pkg.name!=='dsh-kujira'||!pkg.dsh?.bundle?.patch)throw Error('This is not a complete dsh-kujira package.');
  await access(join(root,pkg.dsh.bundle.patch));await access(join(root,'lib/index.js'));
  const command=pluginCommand(options,root);
  if(options.dryRun){console.log(JSON.stringify({executable:'dsh',arguments:command,profile:options.profile,version:pkg.version},null,2));return 0;}
  for(const name of ['dsh','pnpm']){
    const check=run(name,['--version'],{encoding:'utf8',timeout:15000});
    if(check.error||check.status!==0)throw Error(name+' is unavailable. Install it and reopen your terminal before continuing.');
    console.log(name+': '+String(check.stdout).trim().split('\n').at(-1));
  }
  if(options.action==='doctor'){console.log('Ready: dsh-kujira '+pkg.version+' · profile '+options.profile);return 0;}
  console.log((options.action==='uninstall'?'Removing':'Linking')+' dsh-kujira in profile '+options.profile+'…');
  const result=run('dsh',command,{cwd:root,stdio:'inherit'});
  if(result.error)throw result.error;
  if(result.status!==0)throw Error('DSH plugin command failed ('+(result.status??result.signal)+'). No service was restarted.');
  console.log(options.action==='uninstall'?'Removed. Saved companion data was preserved.':'Linked successfully. Keep this directory; the installation refers to it.');
  console.log('Restart DSH normally after active sessions finish, then refresh the browser. / 等会话结束后正常重启 DSH，再刷新页面。');
  return 0;
}
if(process.argv[1]&&pathToFileURL(await realpath(resolve(process.argv[1]))).href===import.meta.url)
  main().then(code=>{process.exitCode=code;}).catch(error=>{console.error(error.message);process.exitCode=1;});
