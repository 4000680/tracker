import {FIELDS,STATUSES,esc,encode,decode,statusOf,filterLabs,nextLab,csvText,parseBackup,createStore} from './labs-core.mjs';
import {createGoogleSync} from './labs-google.mjs';
const $=id=>document.getElementById(id),tg=window.Telegram?.WebApp;
const store=createStore(tg,window.localStorage);
const titles={address:'Адреса и режим работы',prices:'Категории и цены',cooperation:'Сотрудничество',comment:'Комментарий',call:'Результат звонка'};
const hints={address:'Города, фактические адреса, свои или партнёрские площадки, график и запись.',prices:'Категории ТС, услуги и документы, цена клиенту и партнёру, сроки, доплаты и ограничения.',cooperation:'Что предложили по утильсбору, ответ, возражения, условия и следующий шаг.',comment:'Любые дополнительные сведения и договорённости.',call:'Отметьте результат и при необходимости дату следующего звонка.'};
let labs=[],state={},current=null,field=null,busy=false,initial='',toastTimer;
let googleSync=null,googleBusy=false;
function googleStatus(info){
 $('google-settings').textContent=info.connected?'Настройки Google':'Подключить Google';
 $('google-retry').disabled=!info.connected||info.running||googleBusy;
 $('google-status').textContent=info.error?'Записи в Telegram сохранены. Google: '+info.error+(info.pending?' Ожидают отправки: '+info.pending+'.':''):info.running?'Обновляем Google Таблицу… Осталось записей: '+info.pending:info.connected?(info.pending?'Ожидают отправки в Google: '+info.pending:'Все внесённые записи отправлены в Google Таблицу.'):'Таблица создана. Подключите автоматическое сохранение один раз.';
 $('google-status').className=info.error?'error':'muted';
}
function syncGoogle(){googleSync?.report();void googleSync?.sync();}
function toast(text){$('toast').textContent=text;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,3500);}
function errorMessage(e){return e?.message||String(e);}
function updateBack(){try{if(tg){tg.BackButton.show();}}catch{}}
function render(){
 const matches=filterLabs(labs,state,$('search').value,$('filter').value);
 const contacted=labs.filter(x=>statusOf(state,x.id)!=='new').length;
 $('count').textContent=`Показано ${matches.length} из ${labs.length} · с результатом звонка: ${contacted}`;
 $('list').innerHTML=matches.length?matches.map(lab=>{const s=state[lab.id]||{},status=statusOf(state,lab.id),date=s.call?.value?.date;
  return `<button class="org" data-id="${lab.id}" type="button"><span class="org-title"><span class="org-number">${lab.id}</span><span class="org-name">${esc(lab.shortName||lab.name)}</span></span><div class="org-meta">${esc(lab.phone)}<br>${esc(s.address?.value||'Адрес пока не уточнён').slice(0,160)}<br><span class="badge ${status==='callback'?'callback':''}">${esc(STATUSES[status])}</span>${date?' · '+esc(date.split('-').reverse().join('.')):''}</div></button>`;
 }).join(''):'<p class="muted">По выбранным условиям ничего не найдено. Измените поиск или выберите «Все организации».</p>';
 $('next').textContent=contacted?'Продолжить обзвон':'Начать обзвон';
}
function drawCard(){
 const lab=labs.find(x=>x.id===current),s=state[current]||{},call=s.call?.value||{};
 $('detail').innerHTML=`<p class="eyebrow">ЛАБОРАТОРИЯ ${lab.id} / ${labs.length}</p><h2>${esc(lab.name)}</h2><p class="muted">Аттестат: ${esc(lab.accr)}</p><div class="contacts"><a href="tel:${esc(lab.phone)}">Позвонить: ${esc(lab.phone)}</a><a href="mailto:${esc(lab.email)}">${esc(lab.email)}</a></div>${lab.sourceNote?'<p class="muted">'+esc(lab.sourceNote)+'</p>':''}<p><span class="badge">${esc(STATUSES[call.status||'new'])}</span>${call.date?' · Перезвонить '+esc(call.date.split('-').reverse().join('.')):''}</p>${call.contact?'<p class="muted">Контакт: '+esc(call.contact)+'</p>':''}<div class="edit-buttons">${FIELDS.map(f=>`<button type="button" data-edit="${f}">${esc(titles[f])}${s[f]?' ✓':''}</button>`).join('')}<button id="next-card" type="button">Следующая новая</button></div>${FIELDS.filter(f=>f!=='call').map(f=>`<section class="section"><h3>${esc(titles[f])}</h3><p class="${s[f]?.value?'':'muted'}">${esc(s[f]?.value||'Пока не заполнено')}</p></section>`).join('')}`;
 $('detail').querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>openEditor(b.dataset.edit));
 $('next-card').onclick=()=>openNext(current);
}
function openCard(id){current=id;drawCard();if(!$('card').open)$('card').showModal();updateBack();}
function openNext(id){const next=nextLab(labs,state,id);if(next&&next.id!==id)openCard(next.id);else toast('Остальных новых организаций нет. Выберите нужную из полного списка.');}
function formValue(){return field==='call'?{status:$('edit-status').value,date:$('edit-date').value,contact:$('edit-contact').value}:$('edit-text').value;}
function openEditor(name){
 field=name;const record=state[current]?.[field]?.value;
 $('edit-title').textContent=titles[field];$('edit-hint').textContent=hints[field];$('edit-error').textContent='';
 $('text-editor').hidden=field==='call';$('status-editor').hidden=field!=='call';
 if(field==='call'){$('edit-status').innerHTML=Object.entries(STATUSES).map(([key,title])=>`<option value="${key}">${title}</option>`).join('');$('edit-status').value=record?.status||'new';$('edit-date').value=record?.date||'';$('edit-contact').value=record?.contact||'';}
 else $('edit-text').value=record||'';
 initial=JSON.stringify(formValue());countChars();$('editor').showModal();
}
function countChars(){$('chars').textContent=`${$('edit-text').value.length} / 3400 символов`;}
function cancelEditor(){if(busy)return;if(JSON.stringify(formValue())!==initial&&!window.confirm('Закрыть без сохранения введённых изменений?'))return;$('editor').close();}
function closeCard(){if(busy)return;$('card').close();}
async function save(event){
 event.preventDefault();if(busy)return;
 let raw;try{raw=encode(field,formValue());}catch(e){$('edit-error').textContent=errorMessage(e);return;}
 busy=true;$('save').disabled=true;$('cancel-edit').disabled=true;$('save').textContent='Сохраняем…';$('edit-error').textContent='';
 try{await store.save(current,field,raw);(state[current]??={})[field]=decode(field,raw);$('editor').close();drawCard();render();toast(store.cloud?'Сохранено в Telegram':'Сохранено на этом устройстве');syncGoogle();}
 catch(e){$('edit-error').textContent='Не удалось сохранить. Текст остался в поле. '+errorMessage(e);}
 finally{busy=false;$('save').disabled=false;$('cancel-edit').disabled=false;$('save').textContent='Сохранить';}
}
async function download(filename,content,type){
 const file=new File([content],filename,{type});
 // File sharing keeps exports usable in Telegram's iOS webview.
 if(navigator.canShare?.({files:[file]})){try{await navigator.share({files:[file],title:'Лаборатории'});return;}catch(e){if(e.name==='AbortError')return;}}
 const url=URL.createObjectURL(file),a=document.createElement('a');a.href=url;a.download=filename;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
}
async function restore(file){
 if(!file||busy)return;
 if(file.size>2_000_000){toast('Файл слишком большой');return;}
 let writes;try{writes=parseBackup(await file.text(),labs);}catch(e){toast(errorMessage(e));return;}
 if(!writes.length){toast('В копии нет записей');return;}
 if(!window.confirm(`Загрузить ${writes.length} записей? Совпадающие поля будут заменены. Остальные записи сохранятся.`))return;
 busy=true;toggleControls(true);let done=0;
 try{for(const item of writes){await store.save(item.id,item.field,item.raw);(state[item.id]??={})[item.field]=decode(item.field,item.raw);done++;}toast('Копия загружена');}
 catch(e){window.alert(`Загружено ${done} из ${writes.length} записей. Загрузка остановлена: ${errorMessage(e)}. Можно повторно загрузить тот же файл.`);}
 finally{busy=false;toggleControls(false);render();syncGoogle();}
}
function toggleControls(disabled){for(const id of ['next','export','backup','restore','search','filter'])$(id).disabled=disabled;$('list').inert=disabled;}
async function start(){
 toggleControls(true);
 try{try{tg?.ready();tg?.expand();tg?.BackButton.onClick(()=>{if($('google-dialog').open)$('google-cancel').click();else if($('editor').open)cancelEditor();else if($('card').open)closeCard();else location.href='index.html';});updateBack();}catch{}
  const response=await fetch('labs-data.json?v=1');if(!response.ok)throw new Error('Не удалось загрузить список');
  labs=(await response.json()).laboratories;if(!Array.isArray(labs)||labs.length!==64)throw new Error('Некорректный список организаций');
  state=await store.load(labs);
  $('storage').textContent=store.cloud?'Записи сохраняются в облаке Telegram и доступны с другого устройства в этом же боте.':'Открыто вне мини-приложения Telegram. Записи сохраняются только в этом браузере. Для облачного сохранения откройте трекер кнопкой в боте.';
  $('storage').className=store.cloud?'':'warning';toggleControls(false);render();
  googleSync=createGoogleSync({tg,local:window.localStorage,labs,getState:()=>state,onStatus:googleStatus});await googleSync.init();$('google-settings').disabled=false;syncGoogle();
 }catch(e){$('storage').textContent='Записи не загружены. '+errorMessage(e);$('storage').className='error';$('list').innerHTML='<button id="retry" type="button">Повторить загрузку</button>';$('list').inert=false;$('retry').onclick=()=>location.reload();}
}
$('search').oninput=render;$('filter').onchange=render;
$('list').onclick=event=>{const row=event.target.closest('[data-id]');if(row&&!busy)openCard(Number(row.dataset.id));};
$('next').onclick=()=>openNext();$('close-card').onclick=closeCard;
$('card').addEventListener('cancel',event=>{event.preventDefault();closeCard();});
$('editor').addEventListener('cancel',event=>{event.preventDefault();cancelEditor();});
$('cancel-edit').onclick=cancelEditor;$('edit-form').onsubmit=save;$('edit-text').oninput=countChars;
$('export').onclick=()=>download('Laboratorii_GRANI.csv',csvText(labs,state),'text/csv;charset=utf-8').catch(e=>toast(errorMessage(e)));
$('backup').onclick=()=>download('Laboratorii_GRANI_backup.json',JSON.stringify({format:'grani-labs-v1',exportedAt:new Date().toISOString(),state},null,2),'application/json').catch(e=>toast(errorMessage(e)));
$('restore').onclick=()=>$('file').click();$('file').onchange=()=>{const file=$('file').files[0];$('file').value='';restore(file);};
$('google-settings').onclick=()=>{const config=googleSync?.getConfig();$('google-url').value=config?.url||'';$('google-code').value=config?.token||'';$('google-error').textContent='';$('google-disconnect').hidden=!config;$('google-dialog').showModal();};
$('google-cancel').onclick=()=>{if(!googleBusy){$('google-dialog').close();$('google-code').value='';}};
$('google-dialog').addEventListener('cancel',event=>{event.preventDefault();$('google-cancel').click();});
$('google-form').onsubmit=async event=>{event.preventDefault();if(googleBusy||!googleSync)return;googleBusy=true;$('google-connect').disabled=true;$('google-cancel').disabled=true;$('google-disconnect').disabled=true;$('google-error').textContent='';$('google-connect').textContent='Проверяем подключение…';try{await googleSync.connect({url:$('google-url').value.trim(),token:$('google-code').value.trim()});$('google-dialog').close();$('google-code').value='';toast('Google Таблица подключена');}catch(e){$('google-error').textContent=errorMessage(e);}finally{googleBusy=false;$('google-connect').disabled=false;$('google-cancel').disabled=false;$('google-disconnect').disabled=false;$('google-connect').textContent='Проверить и подключить';syncGoogle();}};
$('google-disconnect').onclick=async()=>{if(googleBusy||!window.confirm('Отключить отправку в Google? Существующие записи останутся в таблице и в Telegram.'))return;try{await googleSync.disconnect();$('google-dialog').close();$('google-code').value='';toast('Синхронизация отключена');}catch(e){$('google-error').textContent=errorMessage(e);}};
$('google-retry').onclick=syncGoogle;window.addEventListener('online',syncGoogle);document.addEventListener('visibilitychange',()=>{if(!document.hidden)syncGoogle();});
window.addEventListener('beforeunload',event=>{if(busy||($('editor').open&&JSON.stringify(formValue())!==initial)){event.preventDefault();event.returnValue='';}});
start();
