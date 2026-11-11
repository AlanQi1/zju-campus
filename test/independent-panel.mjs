import assert from 'node:assert/strict';
import { createIndependentPanel } from '../src/independent-panel.js';
const sites = [{id:'physicsLab',name:'Lab'},{id:'engineering',name:'Engineering'}];
const accountResolver = () => ({username:'dummy',password:'test-secret',allowInsecureHttp:false});
const statusProvider = () => sites;
let logins=0, reads=0, closes=0;
const factories = {
  async physicsLab() { logins++; return {read:async()=>{reads++; return {records:[{title:'Test Lab'}]};},close(){closes++;}}; },
  async engineering() { logins++; return {read:async()=>({structureKnown:false,records:[],warnings:['Unknown structure']}),close(){closes++;}}; },
};
const panel = createIndependentPanel({allowIndependentHttp:true,enableEngineering:true}, factories, {accountResolver,statusProvider});
const [first,parallel] = await Promise.all([panel(),panel()]);
assert.equal(logins,2);
assert.equal(reads,1);
assert.equal(first[0].records.length,1);
assert.equal(first[1].status,'已登录，作业解析待适配');
assert(!JSON.stringify(first).includes('test-secret'));
assert.deepEqual(first,parallel);
await panel(); assert.equal(logins,2);
panel.dispose(); assert.equal(closes,2);
const blocked = createIndependentPanel({enableEngineering:true}, factories,{accountResolver,statusProvider});
const blockedStatus = await blocked();
assert(blockedStatus.every(s=>s.status==='待确认HTTP风险'));
assert.equal(logins,2);
let attempts=0;
const failed = createIndependentPanel({allowIndependentHttp:true},{physicsLab:async()=>{attempts++;throw new Error('secret-response');}}, {accountResolver,statusProvider:()=>[sites[0]]});
const errorStatus = await failed(); await failed();
assert.equal(attempts,1);
assert(!JSON.stringify(errorStatus).includes('secret-response'));
let touched = false;
const paused = createIndependentPanel({allowIndependentHttp:true},{engineering:async()=>{touched=true;throw new Error('must not run');}},{accountResolver:()=>{touched=true;return null;},statusProvider:()=>[sites[1]]});
assert.equal((await paused())[0].status,'暂缓接入');
assert.equal(touched,false);
console.log('PASS independent panel caching, consent, cooldown, cleanup and engineering paused without credential reads or requests');
