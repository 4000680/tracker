import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {encode,decode} from '../labs-core.mjs';
import {createGoogleSync,pendingChanges,validateConfig,trustedGoogleOrigin,SHEET_ID} from '../labs-google.mjs';
const labs=[{id:1},{id:2}],config={url:'https://script.google.com/macros/s/test-deployment/exec',token:'a'.repeat(64)};
function memory(){const map=new Map();return {map,getItem:k=>map.get(k)||null,setItem:(k,v)=>map.set(k,v)};}
const record=value=>decode('address',encode('address',value));
test('configuration restricted to Apps Script and message origins are not suffix-spoofable',()=>{
 assert.deepEqual(validateConfig(config),config);
 assert.throws(()=>validateConfig({...config,url:'https://example.com/exec'}));assert.throws(()=>validateConfig({...config,token:'short'}));
 assert.equal(trustedGoogleOrigin('https://n-123-script.googleusercontent.com'),true);assert.equal(trustedGoogleOrigin('https://script.google.com'),true);assert.equal(trustedGoogleOrigin('https://script.google.com.evil.test'),false);assert.equal(trustedGoogleOrigin('http://script.google.com'),false);
});
test('only actual edited fields are pending, unchanged acknowledged notes are excluded',()=>{
 const state={1:{address:record('Адрес')}};assert.equal(pendingChanges(labs,state,{}).length,1);assert.equal(pendingChanges(labs,state,{1:{address:state[1].address.updatedAt}}).length,0);
});
test('confirmed sync survives reload; failed remote write stays pending and local text is intact',async()=>{
 const local=memory(),state={1:{address:record('Санкт-Петербург')}};let fail=true,last;
 const transport=async(c,body)=>{if(body.action==='ping')return {ok:true,spreadsheetId:SHEET_ID};if(fail)throw Error('network failed');return {results:body.changes.map(c=>({id:c.id,field:c.field,updatedAt:c.record.updatedAt,status:'applied'}))};};
 const make=()=>createGoogleSync({local,labs,getState:()=>state,onStatus:s=>last=s,transport});
 const sync=make();await sync.init();await sync.connect(config);await sync.sync();assert.equal(last.pending,1);assert.match(last.error,/network/);assert.equal(state[1].address.value,'Санкт-Петербург');
 fail=false;await sync.sync();assert.equal(last.pending,0);assert.equal(last.error,'');const reloaded=make();await reloaded.init();assert.equal(last.pending,0);assert.equal(last.connected,true);
});
test('incomplete acknowledgement cannot mark records as synced',async()=>{
 const state={1:{address:record('A')},2:{address:record('B')}};let last;
 const sync=createGoogleSync({local:memory(),labs,getState:()=>state,onStatus:s=>last=s,transport:async(c,b)=>b.action==='ping'?{}:{results:[{id:1,field:'address',updatedAt:state[1].address.updatedAt,status:'applied'}]}});
 await sync.init();await sync.connect(config);await sync.sync();assert.equal(last.pending,2);assert.match(last.error,/подтвердил/);
});
test('text saved during in-flight request is sent next without overwriting it',async()=>{
 const first=record('Старый'),second={value:'Новый',updatedAt:new Date(Date.parse(first.updatedAt)+1).toISOString()},state={1:{address:first}},sent=[];let last;
 const sync=createGoogleSync({local:memory(),labs,getState:()=>state,onStatus:s=>last=s,transport:async(c,b)=>{if(b.action==='ping')return {};sent.push(b.changes[0].record.value);if(sent.length===1)state[1].address=second;return {results:b.changes.map(x=>({id:x.id,field:x.field,updatedAt:x.record.updatedAt,status:'applied'}))};}});
 await sync.init();await sync.connect(config);await sync.sync();assert.deepEqual(sent,['Старый','Новый']);assert.equal(last.pending,0);assert.equal(state[1].address.value,'Новый');
});

const code=await fs.readFile(new URL('../google-sync/Code.gs',import.meta.url),'utf8');
function backend(){
 const headers=['ID','Лаборатория','Аттестат','Телефон','Email','Статус звонка','Дата повторного звонка','Контактное лицо','Адреса и режим работы','Категории и цены','Сотрудничество','Комментарии','Последнее обновление','Уточнения источника'];
 // Deliberately sorted so id 2 is above id 1.
 const cells=[headers,[2,'Lab2','','+70000000002','2@example.com'],[1,'Lab1','','+70000000001','1@example.com']],props=new Map([['LABS_ACCESS_CODE',config.token]]);let writes=0;
 const sheet={getLastRow:()=>3,getRange:(r,c,h=1,w=1)=>({getValues:()=>Array.from({length:h},(_,i)=>Array.from({length:w},(_,j)=>cells[r-1+i]?.[c-1+j]??'')),getValue:()=>cells[r-1]?.[c-1]??'',setNumberFormat(){return this;},setValue(v){(cells[r-1]??=[])[c-1]=v;writes++;return this;}})};
 const context={console,PropertiesService:{getScriptProperties:()=>({getProperty:k=>props.get(k)||null,setProperty:(k,v)=>props.set(k,v)})},SpreadsheetApp:{openById:id=>{assert.equal(id,SHEET_ID);return {getSheetByName:name=>{assert.equal(name,'Лаборатории');return sheet;}};},flush:()=>{}},LockService:{getScriptLock:()=>({waitLock:()=>{},releaseLock:()=>{}})},HtmlService:{XFrameOptionsMode:{ALLOWALL:'allow'},createHtmlOutput:content=>({content,setXFrameOptionsMode(){return this;}})}};
 vm.createContext(context);vm.runInContext(code,context);
 const request=changes=>JSON.parse(context.doPost({parameter:{payload:JSON.stringify({action:'sync',requestId:'test-1234567890-abcd',token:config.token,spreadsheetId:SHEET_ID,changes})}}).content.match(/postMessage\((.*), "https:\/\/4000680.github.io"\)/)[1]);
 return {cells,props,request,context,writes:()=>writes};
}
test('backend routes by stable ID despite sorting and updates only selected field',()=>{
 const b=backend(),r=record('Москва, 10–18');const response=b.request([{id:1,field:'address',record:r}]);assert.equal(response.ok,true);assert.equal(b.cells[2][8],'Москва, 10–18');assert.equal(b.cells[1][8],undefined);assert.equal(b.cells[2][3],'+70000000001');
 const repeated=b.request([{id:1,field:'address',record:r}]);assert.equal(repeated.results[0].status,'applied');assert.equal(b.cells.length,3);
});
test('backend validates entire batch before writing and rejects unknown ID, missing code',()=>{
 const b=backend(),r=record('Тест');assert.equal(b.request([{id:1,field:'address',record:r},{id:99,field:'address',record:r}]).ok,false);assert.equal(b.writes(),0);
 b.props.set('LABS_ACCESS_CODE','b'.repeat(64));assert.equal(b.request([{id:1,field:'address',record:r}]).ok,false);assert.equal(b.writes(),0);
});
test('older retry cannot overwrite newer text; formula-like user content is stored as text',()=>{
 const b=backend(),newer=record('=IMPORTXML("url")'),older={value:'Старое',updatedAt:new Date(Date.parse(newer.updatedAt)-1000).toISOString()};
 assert.equal(b.request([{id:1,field:'prices',record:newer}]).ok,true);assert.equal(b.cells[2][9],"'=IMPORTXML(\"url\")");const result=b.request([{id:1,field:'prices',record:older}]);assert.equal(result.results[0].status,'newer');assert.equal(b.cells[2][9],"'=IMPORTXML(\"url\")");
});
