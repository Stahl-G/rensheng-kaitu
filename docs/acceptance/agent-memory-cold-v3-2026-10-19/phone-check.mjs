import { Workspace } from './repo/packages/core/dist/workspace.js';
import { runPhone } from './repo/packages/core/dist/phone-run.js';
const ws = new Workspace(process.argv[2], {maintain:false});
console.log(JSON.stringify(await runPhone(ws,{kind:'agent',name:'synthetic-cold-agent',spec:1}),null,2));
