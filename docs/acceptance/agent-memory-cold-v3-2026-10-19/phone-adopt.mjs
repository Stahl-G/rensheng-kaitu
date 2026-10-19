import { initWorkspace } from './repo/packages/core/dist/init.js';
import { runPhone } from './repo/packages/core/dist/phone-run.js';
import { readFileSync } from 'node:fs';
const root='/tmp/kaitu-cold-v3/phone-memory';
const before=readFileSync(root+'/me/profile.md','utf8');
const ws=await initWorkspace(root,{timeZone:'Etc/UTC'});
if(readFileSync(root+'/me/profile.md','utf8')!==before)throw Error('profile changed');
console.log(JSON.stringify(await runPhone(ws,{kind:'agent',name:'synthetic-cold-agent',spec:1}),null,2));
