import {FIELDS} from './labs-core.mjs';
export const SHEET_ID='1CFu2d_uNfeQIEBAiivHlWy-UIcPS2S7Srs5voW00s_Y';
export const SHEET_URL='https://docs.google.com/spreadsheets/d/1CFu2d_uNfeQIEBAiivHlWy-UIcPS2S7Srs5voW00s_Y/edit';
const CONFIG_KEY='labs_google_config_v1';
export function validateConfig(value){
 if(!value||typeof value.url!=='string'||!/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(value.url)||typeof value.token!=='string'||!/^[a-f0-9]{64}$/i.test(value.token))throw new Error('Нужны адрес веб-приложения Google (заканчивается на /exec) и код подключения из 64 символов.');
 return {url:value.url,token:value.token};
}
export function pendingChanges(labs,state,marks){
 return labs.flatMap(lab=>FIELDS.filter(field=>state[lab.id]?.[field]&&marks[lab.id]?.[field]!==state[lab.id][field].updatedAt).map(field=>({id:lab.id,field,record:state[lab.id][field]})));
}
export function trustedGoogleOrigin(origin){try{const url=new URL(origin),host=url.hostname;return url.protocol==='https:'&&(host==='script.google.com'||host==='script.googleusercontent.com'||host.endsWith('-script.googleusercontent.com'));}catch{return false;}}
// HTML form + acknowledged postMessage works without relying on Apps Script CORS headers.
export function postToGoogle(config,body){
 validateConfig(config);
 return new Promise((resolve,reject)=>{
  const requestId=crypto.randomUUID(),frame=document.createElement('iframe'),form=document.createElement('form'),input=document.createElement('input');
  frame.name='labs-sync-'+requestId;frame.hidden=true;frame.setAttribute('aria-hidden','true');form.hidden=true;form.action=config.url;form.method='POST';form.target=frame.name;
  input.type='hidden';input.name='payload';input.value=JSON.stringify({...body,requestId,token:config.token,spreadsheetId:SHEET_ID});form.append(input);
  const cleanup=()=>{clearTimeout(timer);window.removeEventListener('message',listener);frame.remove();form.remove();};
  const listener=event=>{const data=event.data;if(!trustedGoogleOrigin(event.origin)||data?.type!=='grani-labs-sync-v1'||data.requestId!==requestId)return;cleanup();if(!data.ok)reject(new Error(data.error||'Google не подтвердил сохранение'));else if(data.spreadsheetId!==SHEET_ID)reject(new Error('Ответ получен от другой таблицы'));else resolve(data);};
  const timer=setTimeout(()=>{cleanup();reject(new Error('Google не ответил. Проверьте доступ «Все» в настройках веб-приложения и повторите синхронизацию.'));},45000);
  window.addEventListener('message',listener);document.body.append(frame,form);
  try{form.submit();}catch(e){cleanup();reject(e);}
 });
}
export function createGoogleSync({tg,local,labs,getState,onStatus,transport=postToGoogle}){
 const cloud=!!(tg?.initData&&tg?.CloudStorage),marks={};let config=null,running=false,lastError='',configError=false;
 const call=(method,...args)=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Telegram не ответил')),15000);try{tg.CloudStorage[method](...args,(error,result)=>{clearTimeout(timer);error?reject(new Error(String(error))):resolve(result);});}catch(e){clearTimeout(timer);reject(e);}});
 const get=key=>cloud?call('getItem',key):Promise.resolve(local.getItem(key));
 const set=async(key,value)=>{if(cloud){if(await call('setItem',key,value)!==true)throw new Error('Telegram не подтвердил настройки синхронизации');}else local.setItem(key,value);};
 const pending=()=>pendingChanges(labs,getState(),marks);
 const report=()=>onStatus({connected:!!config,running,pending:pending().length,error:lastError,configError});
 return {
  async init(){try{const raw=await get(CONFIG_KEY);if(raw)config=validateConfig(JSON.parse(raw));if(config){for(let i=0;i<labs.length;i+=50){const keys=labs.slice(i,i+50).map(x=>'labs_google_mark_'+x.id);const values=cloud?await call('getItems',keys):Object.fromEntries(keys.map(k=>[k,local.getItem(k)]));for(const [key,value]of Object.entries(values)){if(value)marks[key.slice('labs_google_mark_'.length)]=JSON.parse(value);}}}}catch(e){lastError=e.message;configError=true;config=null;}report();},
  connected:()=>!!config,
  getConfig:()=>config?{...config}:null,
  report,
  async connect(value){if(running)throw new Error('Дождитесь окончания текущей синхронизации');const next=validateConfig(value);await transport(next,{action:'ping'});await set(CONFIG_KEY,JSON.stringify(next));config=next;lastError='';configError=false;report();},
  async disconnect(){if(running)throw new Error('Дождитесь окончания текущей синхронизации');await set(CONFIG_KEY,'');config=null;lastError='';report();},
  async sync(){
   if(running||!config)return;running=true;lastError='';report();
   try{
    let changes=pending();
    while(changes.length){
     const batch=changes.slice(0,20),reply=await transport(config,{action:'sync',changes:batch});
     if(!Array.isArray(reply.results))throw new Error('Google не подтвердил записи');
     const ids=new Set();
     for(const change of batch){const key=change.id+'_'+change.field;const result=reply.results.find(x=>x.id===change.id&&x.field===change.field&&x.updatedAt===change.record.updatedAt);if(!result||result.status!=='applied'||ids.has(key))throw new Error(result?.status==='newer'?'В Google есть более новая запись. Откройте таблицу и проверьте данные, затем сохраните нужный текст в карточке.':'Google не подтвердил все записи');ids.add(key);}
     // Acknowledgement markers are independent of editable records; late replies cannot overwrite new text.
     const touched=new Set();for(const change of batch){(marks[change.id]??={})[change.field]=change.record.updatedAt;touched.add(change.id);}
     try{for(const id of touched)await set('labs_google_mark_'+id,JSON.stringify(marks[id]));}catch(e){for(const change of batch)delete marks[change.id][change.field];throw e;}
     changes=pending();report();
    }
   }catch(e){lastError=e.message;}finally{running=false;report();}
  }
 };
}
