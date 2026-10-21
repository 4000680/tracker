// Bound Google Apps Script for the private laboratories spreadsheet.
// Run setupLabsSync once, then deploy as a Web app (execute as yourself).
const LABS_SHEET_ID = '1CFu2d_uNfeQIEBAiivHlWy-UIcPS2S7Srs5voW00s_Y';
const LABS_TAB = 'Лаборатории';
const LABS_ORIGIN = 'https://4000680.github.io';
const LABS_STATUS = {new:'Ещё не звонили',no_answer:'Не дозвонились',callback:'Перезвонить',talked:'Обсудили',closed:'Неактуально'};
const LABS_COLUMNS = {address:'Адреса и режим работы',prices:'Категории и цены',cooperation:'Сотрудничество',comment:'Комментарии'};

function setupLabsSync() {
  labsSheet_();
  const props=PropertiesService.getScriptProperties();
  let code=props.getProperty('LABS_ACCESS_CODE');
  if(!code){code=Utilities.getUuid().replace(/-/g,'')+Utilities.getUuid().replace(/-/g,'');props.setProperty('LABS_ACCESS_CODE',code);}
  console.log('КОД ПОДКЛЮЧЕНИЯ (вставьте только в настройках трекера, не в чате): '+code);
  console.log('Таблица проверена. Разверните этот проект как веб-приложение от своего имени, доступ — Все.');
}

function doGet() {
  return HtmlService.createHtmlOutput('Синхронизация лабораторий Грани. Подключение выполняется из настроек мини-приложения.');
}

function labsSheet_() {
  const sheet=SpreadsheetApp.openById(LABS_SHEET_ID).getSheetByName(LABS_TAB);
  if(!sheet)throw new Error('Не найдена вкладка «Лаборатории»');
  const headers=sheet.getRange(1,1,1,14).getValues()[0];
  const required=['ID','Статус звонка','Дата повторного звонка','Контактное лицо','Последнее обновление'].concat(Object.values(LABS_COLUMNS));
  required.forEach(name=>{if(headers.indexOf(name)<0)throw new Error('Отсутствует столбец: '+name);});
  return {sheet:sheet,headers:headers};
}

function labsValidateChange_(change) {
  if(!change||!Number.isInteger(change.id)||change.id<1||change.id>64)throw new Error('Неизвестная лаборатория');
  const field=change.field,record=change.record;
  if(!Object.prototype.hasOwnProperty.call(LABS_COLUMNS,field)&&field!=='call')throw new Error('Неизвестное поле');
  if(!record||typeof record.updatedAt!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(record.updatedAt)||!Number.isFinite(Date.parse(record.updatedAt))||Date.parse(record.updatedAt)>Date.now()+300000)throw new Error('Некорректная дата записи');
  const value=record.value;
  if(field==='call'){
    if(!value||!Object.prototype.hasOwnProperty.call(LABS_STATUS,value.status)||typeof value.date!=='string'||(value.date&&!/^\d{4}-\d{2}-\d{2}$/.test(value.date))||typeof value.contact!=='string'||value.contact.length>1000)throw new Error('Некорректный результат звонка');
  } else if(typeof value!=='string'||value.length>3400)throw new Error('Некорректный текст записи');
}

function labsSafeText_(text) {
  text=String(text||'');
  return /^[\s]*[=+@-]/.test(text)?"'"+text:text;
}

function doPost(e) {
  let request={},result={ok:false,error:'Не удалось обработать запрос'};
  try {
    const raw=e&&e.parameter&&e.parameter.payload;
    if(typeof raw!=='string'||raw.length>120000)throw new Error('Некорректный запрос');
    request=JSON.parse(raw);
    if(typeof request.requestId!=='string'||!/^[a-z0-9-]{16,80}$/i.test(request.requestId))throw new Error('Некорректный номер запроса');
    const expected=PropertiesService.getScriptProperties().getProperty('LABS_ACCESS_CODE');
    if(!expected||typeof request.token!=='string'||request.token.length!==64||!labsEqual_(request.token,expected))throw new Error('Неверный код подключения');
    if(request.spreadsheetId!==LABS_SHEET_ID)throw new Error('Выбрана другая таблица');
    if(request.action==='ping'){labsSheet_();result={ok:true,spreadsheetId:LABS_SHEET_ID};}
    else if(request.action==='sync'){
      if(!Array.isArray(request.changes)||request.changes.length>20)throw new Error('Слишком много записей');
      request.changes.forEach(labsValidateChange_);
      const lock=LockService.getScriptLock();lock.waitLock(20000);
      try {result=labsApply_(request.changes);}finally{lock.releaseLock();}
    } else throw new Error('Неизвестная операция');
  }catch(error){result={ok:false,error:error.message||'Ошибка синхронизации'};}
  const response=JSON.stringify(Object.assign({type:'grani-labs-sync-v1',requestId:typeof request.requestId==='string'?request.requestId.slice(0,80):''},result)).replace(/</g,'\\u003c').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029');
  return HtmlService.createHtmlOutput('<!doctype html><meta charset="utf-8"><script>window.top.postMessage('+response+', '+JSON.stringify(LABS_ORIGIN)+');</script>').setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function labsEqual_(a,b){let difference=a.length^b.length;for(let i=0;i<a.length;i++)difference|=a.charCodeAt(i)^b.charCodeAt(i);return difference===0;}

function labsApply_(changes) {
  const context=labsSheet_(),sheet=context.sheet,headers=context.headers,props=PropertiesService.getScriptProperties();
  const col=name=>headers.indexOf(name)+1;
  const ids=sheet.getRange(2,col('ID'),Math.max(1,sheet.getLastRow()-1),1).getValues().flat(),rows={};
  ids.forEach((id,index)=>{if(id!==''){if(rows[String(id)])throw new Error('Повторяющийся ID в таблице');rows[String(id)]=index+2;}});
  changes.forEach(change=>{if(!rows[change.id])throw new Error('ID '+change.id+' отсутствует в таблице');});
  const results=[];
  changes.forEach(change=>{
    const key='labs_version_'+change.id+'_'+change.field,previous=props.getProperty(key)||'',record=change.record;
    if(previous>record.updatedAt){results.push({id:change.id,field:change.field,updatedAt:record.updatedAt,status:'newer'});return;}
    // Reapply equal versions: makes retry safe if an earlier request stopped after writing cells.
    const row=rows[change.id],value=record.value;
    if(change.field==='call'){
      sheet.getRange(row,col('Статус звонка')).setValue(LABS_STATUS[value.status]);
      sheet.getRange(row,col('Дата повторного звонка')).setNumberFormat('dd.MM.yyyy').setValue(value.date?new Date(value.date+'T12:00:00Z'):'');
      sheet.getRange(row,col('Контактное лицо')).setNumberFormat('@').setValue(labsSafeText_(value.contact));
    }else sheet.getRange(row,col(LABS_COLUMNS[change.field])).setNumberFormat('@').setValue(labsSafeText_(value));
    const updated=sheet.getRange(row,col('Последнее обновление')),old=updated.getValue(),date=new Date(record.updatedAt);
    if(!(old instanceof Date)||old.getTime()<date.getTime())updated.setNumberFormat('dd.MM.yyyy HH:mm').setValue(date);
    SpreadsheetApp.flush();props.setProperty(key,record.updatedAt);
    results.push({id:change.id,field:change.field,updatedAt:record.updatedAt,status:'applied'});
  });
  return {ok:true,spreadsheetId:LABS_SHEET_ID,results:results};
}
