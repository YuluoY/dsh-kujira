import {createPeakScheduler} from '../../lib/host/scheduler.js';
let time=Date.parse('2026-09-11T09:00:00+08:00');
const scheduler=createPeakScheduler({directory:process.argv[2],now:()=>time,available:true,tickMs:10});
await scheduler.configure(true);
setTimeout(()=>{time=Date.parse('2026-09-11T12:00:00+08:00');},50).unref();
await scheduler.gate({agent:{id:'held'}},()=>process.stdout.write('continued'));
scheduler.dispose();
