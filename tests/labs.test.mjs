import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {encode,decode,createStore,keyFor,filterLabs,nextLab,csvText,parseBackup} from '../labs-core.mjs';
const {laboratories:labs}=JSON.parse(await fs.readFile(new URL('../labs-data.json',import.meta.url),'utf8'));
const local=()=>{const data=new Map();return {getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,v)};};
function telegram(data={},fail=false){return {initData:'test',CloudStorage:{getKeys:cb=>cb(null,Object.keys(data)),getItems:(keys,cb)=>cb(null,Object.fromEntries(keys.map(k=>[k,data[k]]))),setItem:(k,v,cb)=>{if(fail)return cb('storage failed');data[k]=v;cb(null,true);}}};}
test('source: full 64 records, unique IDs, Cyrillic accreditation, special contacts preserved',()=>{
 assert.equal(labs.length,64);assert.equal(new Set(labs.map(x=>x.id)).size,64);assert.equal(new Set(labs.map(x=>x.accr)).size,64);
 assert.ok(labs.every(x=>/^\+7\d{10}$/.test(x.phone)&&x.name&&x.email.includes('@')));
 assert.equal(labs[54].email,'ptocreate@gmal.com');assert.equal(labs[56].phone,labs[57].phone);assert.notEqual(labs[56].accr,labs[57].accr);
});
test('cloud roundtrip, isolation from brokers, field preservation',async()=>{
 const data={broker2_status_v1:'untouched'},store=createStore(telegram(data),local());
 await store.save(1,'address',encode('address','СПб, Петроградская, 10–18'));
 await store.save(1,'prices',encode('prices','M1 25000; L не делают'));
 await store.save(2,'cooperation',encode('cooperation','Ждут предложение'));
 const state=await createStore(telegram(data),local()).load(labs);
 assert.equal(state[1].address.value,'СПб, Петроградская, 10–18');assert.equal(state[1].prices.value,'M1 25000; L не делают');assert.equal(state[2].cooperation.value,'Ждут предложение');assert.equal(data.broker2_status_v1,'untouched');
 assert.equal(filterLabs(labs,state).length,64);assert.deepEqual(filterLabs(labs,state,'Петроградская').map(x=>x.id),[1]);
});
test('failed cloud save rejects and does not alter stored data',async()=>{
 const raw=encode('prices','Старая цена'),data={[keyFor(1,'prices')]:raw};
 await assert.rejects(createStore(telegram(data,true),local()).save(1,'prices',encode('prices','Новая цена')));
 assert.equal(data[keyFor(1,'prices')],raw);
});
test('large notes, malformed records and invalid statuses rejected',()=>{
 assert.throws(()=>encode('address','а'.repeat(3401)));assert.doesNotThrow(()=>encode('address','Я'.repeat(3400)));
 assert.throws(()=>decode('prices','{broken'));assert.throws(()=>encode('call',{status:'fake',date:'',contact:''}));
});
test('next new skips contacted labs; filters do not hide default list',()=>{
 const state={1:{call:decode('call',encode('call',{status:'talked',date:'',contact:''}))},2:{call:decode('call',encode('call',{status:'callback',date:'2026-10-25',contact:'Иван'}))}};
 assert.equal(nextLab(labs,state).id,3);assert.equal(filterLabs(labs,state).length,64);assert.equal(filterLabs(labs,state,'','callback')[0].id,2);
 const all=Object.fromEntries(labs.map(x=>[x.id,state[1]]));assert.equal(nextLab(labs,all),undefined);
});
test('browser local save persists, corrupt cloud load never becomes empty local',async()=>{
 const memory=local(),store=createStore(null,memory);assert.equal(store.cloud,false);await store.save(4,'comment',encode('comment','Тест'));assert.equal((await store.load(labs))[4].comment.value,'Тест');
 const data={[keyFor(4,'comment')]:'broken'};await assert.rejects(createStore(telegram(data),memory).load(labs));
});
test('backup roundtrip validates before write; CSV includes every lab and neutralizes formula injection',()=>{
 const state={1:{comment:decode('comment',encode('comment','=1+2\nТекст; "цена"'))}};
 const writes=parseBackup(JSON.stringify({format:'grani-labs-v1',state}),labs);assert.equal(writes.length,1);assert.equal(decode('comment',writes[0].raw).value,state[1].comment.value);
 assert.throws(()=>parseBackup(JSON.stringify({format:'grani-labs-v1',state:{999:state[1]}}),labs));
 const csv=csvText(labs,state);assert.ok(csv.startsWith('\uFEFF'));assert.ok(csv.includes("'=1+2"));assert.ok(csv.includes("'+74912270021"));assert.ok(csv.includes('СФ ТЕСТ'));assert.ok(csv.includes('АКАДЕМ ТЕСТ'));
});
