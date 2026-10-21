export const PREFIX='labs_v1_';
export const FIELDS=['address','prices','cooperation','comment','call'];
export const STATUSES={new:'Ещё не звонили',no_answer:'Не дозвонились',callback:'Перезвонить',talked:'Обсудили',closed:'Неактуально'};
export const keyFor=(id,field)=>`${PREFIX}${id}_${field}`;
export const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function validValue(field,value){
 if(field==='call')return value&&typeof value==='object'&&Object.hasOwn(STATUSES,value.status)&&typeof value.date==='string'&&(!value.date||/^\d{4}-\d{2}-\d{2}$/.test(value.date))&&typeof value.contact==='string'&&value.contact.length<=1000;
 return typeof value==='string'&&value.length<=3400;
}
export function decode(field,raw){
 const v=JSON.parse(raw);
 if(!v||!validValue(field,v.value)||typeof v.updatedAt!=='string')throw new Error('Повреждена сохранённая запись');
 return v;
}
export function encode(field,value){
 if(!FIELDS.includes(field)||!validValue(field,value))throw new Error('Проверьте введённые данные');
 const raw=JSON.stringify({value,updatedAt:new Date().toISOString()});
 if(raw.length>4096)throw new Error('Запись слишком длинная. Сократите её и сохраните снова.');
 return raw;
}
export function statusOf(state,id){return state[id]?.call?.value?.status||'new';}
export function filterLabs(labs,state,query='',status='all'){
 const q=query.trim().toLocaleLowerCase('ru');
 return labs.filter(lab=>(status==='all'||statusOf(state,lab.id)===status)&&(!q||[lab.name,lab.phone,lab.email,lab.accr,...Object.values(state[lab.id]||{}).map(x=>typeof x.value==='string'?x.value:JSON.stringify(x.value))].join(' ').toLocaleLowerCase('ru').includes(q)));
}
export function nextLab(labs,state,current){
 const pos=Math.max(-1,labs.findIndex(x=>x.id===current));
 const ordered=[...labs.slice(pos+1),...labs.slice(0,pos+1)];
 return ordered.find(x=>statusOf(state,x.id)==='new');
}
export function csvText(labs,state){
 const cell=x=>'"'+String(x??'').replace(/^[=+@-]/,"'$&").replace(/"/g,'""')+'"';
 const rows=[['ID','Лаборатория','Аттестат','Телефон','Email','Статус звонка','Дата повторного звонка','Контактное лицо','Адреса и режим работы','Категории и цены','Сотрудничество','Комментарии','Последнее обновление']];
 for(const lab of labs){const s=state[lab.id]||{},call=s.call?.value||{};rows.push([lab.id,lab.name,lab.accr,lab.phone,lab.email,STATUSES[call.status||'new'],call.date,call.contact,s.address?.value,s.prices?.value,s.cooperation?.value,s.comment?.value,Object.values(s).map(x=>x.updatedAt).sort().at(-1)]);}
 return '\uFEFF'+rows.map(r=>r.map(cell).join(';')).join('\r\n');
}
export function parseBackup(text,labs){
 const backup=JSON.parse(text),ids=new Set(labs.map(x=>String(x.id))),writes=[];
 if(backup?.format!=='grani-labs-v1'||!backup.state||typeof backup.state!=='object'||Array.isArray(backup.state))throw new Error('Выберите резервную копию лабораторий');
 for(const [id,fields] of Object.entries(backup.state)){
  if(!ids.has(id)||!fields||typeof fields!=='object'||Array.isArray(fields))throw new Error('Неизвестная организация в копии');
  for(const [field,record] of Object.entries(fields)){
   if(!FIELDS.includes(field))throw new Error('Неизвестное поле в копии');
   const raw=JSON.stringify(record);decode(field,raw);if(raw.length>4096)throw new Error('Слишком длинная запись в копии');writes.push({id:Number(id),field,raw});
  }
 }
 return writes;
}
export function createStore(tg,local){
 const cloud=!!(tg?.initData&&tg?.CloudStorage),cs=tg?.CloudStorage;
 const invoke=(method,...args)=>new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(new Error('Telegram не ответил. Попробуйте снова.')),15000);
  try{cs[method](...args,(error,value)=>{clearTimeout(timer);error?reject(new Error(String(error))):resolve(value);});}catch(e){clearTimeout(timer);reject(e);}
 });
 return {cloud,
  async load(labs){
   const state={},allowed=new Set(labs.flatMap(x=>FIELDS.map(f=>keyFor(x.id,f))));let values={};
   if(cloud){const keys=(await invoke('getKeys')).filter(k=>allowed.has(k));for(let i=0;i<keys.length;i+=50)Object.assign(values,await invoke('getItems',keys.slice(i,i+50)));}
   else {for(const key of allowed){const value=local.getItem(key);if(value)values[key]=value;}}
   for(const [key,raw] of Object.entries(values)){if(!raw)continue;const match=key.match(/^labs_v1_(\d+)_(\w+)$/);if(!match||!allowed.has(key))continue;const [,id,field]=match;(state[id]??={})[field]=decode(field,raw);}
   return state;
  },
  async save(id,field,raw){
   decode(field,raw);if(raw.length>4096)throw new Error('Запись слишком длинная');const key=keyFor(id,field);
   if(cloud){const ok=await invoke('setItem',key,raw);if(ok!==true)throw new Error('Telegram не подтвердил сохранение');}
   else local.setItem(key,raw);
  }
 };
}
