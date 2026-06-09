window.addEventListener('hashchange',()=>{ if(location.hash==='#notify') location.hash='#events'; });
let state={sites:[],routers:[],history:[],events:[],graphs:[],settings:{}};let autoTimer=null;let appStartedAt=Date.now();const $=id=>document.getElementById(id);
const APP_TITLE='MoonFox monitor';
const APP_SUBTITLE='Следит за системой, пока ты спишь.';
function tr(value){return window.I18N?I18N.text(value):value}
function availabilityFoxSource(percent,total){
  if(!total||percent>=100)return '/assets/fox-availability.png';
  if(percent<=0)return '/assets/fox-availability-0.png';
  if(percent<=20)return '/assets/fox-availability-20.png';
  if(percent<=40)return '/assets/fox-availability-40.png';
  if(percent<=60)return '/assets/fox-availability-60.png';
  return '/assets/fox-availability-80.png';
}
function previewCount(kind){
  try{
    let value=Number(localStorage.getItem('moonfox.previewCount.'+kind)||5);
    return Number.isInteger(value)&&value>=1&&value<=10?value:5;
  }catch(e){return 5}
}
function savePreviewCount(kind){
  let id=kind==='site'?'sitePreviewCount':'devicePreviewCount';
  let value=Math.max(1,Math.min(10,Number($(id)?.value||5)));
  try{localStorage.setItem('moonfox.previewCount.'+kind,String(value))}catch(e){}
  renderTables();
}
function orderButtons(kind,id,index,total){
  return `<span class="orderActions"><button class="orderButton" onclick="moveMonitoredObject('${kind}','${id}','up')" title="${tr('Поднять выше')}" aria-label="${tr('Поднять выше')}" ${index===0?'disabled':''}>↑</button><button class="orderButton" onclick="moveMonitoredObject('${kind}','${id}','down')" title="${tr('Опустить ниже')}" aria-label="${tr('Опустить ниже')}" ${index>=total-1?'disabled':''}>↓</button></span>`;
}
function previewDeleteButton(kind,id){
  let handler=kind==='site'?'delSite':'delRouter';
  return `<button class="orderButton previewDeleteButton" onclick="${handler}('${id}')" title="${tr('Удалить')}" aria-label="${tr('Удалить')}">×</button>`;
}
async function moveMonitoredObject(kind,id,direction){
  await api(kind==='site'?'/api/site/move':'/api/router/move',{id,direction});
  await load();
}
async function changeLanguage(language){
  state.settings=state.settings||{};
  state.settings.language=language==='en'?'en':'ru';
  I18N.set(state.settings.language);
  render();
  await saveSettingsSilent();
}

let editLock = false;
function isEditPage(){
  let active=document.querySelector('.page.active');
  return active && ['settings','sites','routers','graphs'].includes(active.id);
}
function isModalOpen(){
  return !!document.querySelector('.modal.show');
}
function openAboutModal(){
  $('aboutModal').classList.add('show');
}
function closeAboutModal(){
  $('aboutModal').classList.remove('show');
}
function shouldProtectForms(){
  return editLock || isEditingForm() || isModalOpen() || (isEditPage() && settingsDirty);
}
function lockEdit(){ editLock=true; }
function unlockEdit(){ editLock=false; modalDirty=false; }


let settingsDirty = false;
let modalDirty = false;

function isEditingForm(){
  const a = document.activeElement;
  if(!a) return false;
  return ['INPUT','TEXTAREA','SELECT'].includes(a.tagName);
}

function hookFormDirtyFlags(){
  document.addEventListener('input', e=>{
    if(e.target.closest && e.target.closest('#settings')){
      settingsDirty = true;
      lockEdit();
    }
    if(e.target.closest && e.target.closest('.modal')){
      modalDirty = true;
      lockEdit();
    }
  });
  document.addEventListener('change', e=>{
    if(e.target.closest && e.target.closest('#settings')){
      settingsDirty = true;
      lockEdit();
    }
    if(e.target.closest && e.target.closest('.modal')){
      modalDirty = true;
      lockEdit();
    }
  });
}

document.addEventListener('keydown',e=>{
  if(e.key==='Escape'&&$('aboutModal')?.classList.contains('show'))closeAboutModal();
  if(e.key==='Escape'&&$('diagnosticModal')?.classList.contains('show'))closeDiagnosticModal();
});

function organizeSettingsColumns(){
  const grid=$('settingsGrid');
  if(!grid || grid.querySelector('.settingsColumn'))return;
  const panels=[...grid.children].filter(x=>x.classList.contains('panel'));
  const left=document.createElement('div');
  const right=document.createElement('div');
  left.className='settingsColumn';
  right.className='settingsColumn';
  panels.forEach((panel,index)=>{
    const title=panel.querySelector('h3')?.textContent.trim();
    const useRight=index%2===1 || title==='Данные';
    (useRight?right:left).appendChild(panel);
  });
  grid.append(left,right);
}


function applyTheme(){
  let s=state.settings||{};
  let preset=s.themePreset||'dark';
  document.body.classList.remove('theme-light','theme-purple','theme-blue','theme-green');
  if(preset==='light') document.body.classList.add('theme-light');
  if(preset==='purple') document.body.classList.add('theme-purple');
  if(preset==='blue') document.body.classList.add('theme-blue');
  if(preset==='green') document.body.classList.add('theme-green');
  if(preset==='custom'){
    let root=document.documentElement.style;
    root.setProperty('--accent',s.themeAccent||'#7c5cff');
    root.setProperty('--button',s.themeButton||'#24457f');
    root.setProperty('--ok',s.themeOk||'#20e68a');
    root.setProperty('--bad',s.themeBad||'#ff4d6d');
    root.setProperty('--bg',s.themeBg||'#080d1b');
    root.setProperty('--panel',s.themePanel||'#101a36');
  }
  const custom=$('customThemeColors');
  if(custom) custom.style.display = preset==='custom' ? 'grid' : 'none';
}
function getSavedOverviewStyle(kind){
  try{
    const value=localStorage.getItem('monitorOverviewStyle.'+kind);
    return ['line','bar','pie'].includes(value)?value:null;
  }catch(e){return null}
}
function setSavedOverviewStyle(kind,value){
  try{localStorage.setItem('monitorOverviewStyle.'+kind,value)}catch(e){}
}
function previewThemeFromForm(){
  if(!state.settings)state.settings={};
  state.settings.themePreset=$('setThemePreset')?$('setThemePreset').value:'dark';
  state.settings.themeAccent=$('setThemeAccent')?$('setThemeAccent').value:'#7c5cff';
  state.settings.themeButton=$('setThemeButton')?$('setThemeButton').value:'#24457f';
  state.settings.themeOk=$('setThemeOk')?$('setThemeOk').value:'#20e68a';
  state.settings.themeBad=$('setThemeBad')?$('setThemeBad').value:'#ff4d6d';
  state.settings.themeBg=$('setThemeBg')?$('setThemeBg').value:'#080d1b';
  state.settings.themePanel=$('setThemePanel')?$('setThemePanel').value:'#101a36';
  applyTheme();
}

async function api(p,d){
  let o={method:d?'POST':'GET',headers:{'Content-Type':'application/json;charset=utf-8'}};
  if(d)o.body=JSON.stringify(d);
  let r=await fetch(p,o);
  let text=await r.text();
  if(!r.ok) throw new Error(text||('HTTP '+r.status));
  try{return JSON.parse(text)}catch(e){return {ok:true,raw:text}}
}
function esc(s){return String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]))}
function statusText(s){return tr(s==='OK'?'🟢 Доступен':s==='SLOW'?'🟡 Медленно':s==='BAD'?'🔴 Недоступен':'Ожидает проверки')}function statusClass(s){return s==='OK'?'statusOK':s==='SLOW'?'statusSLOW':s==='BAD'?'statusBAD':'statusWAIT'}function portStatusText(x){if(!x.port)return '—';return tr(x.portOk?'🟢 Открыт':'🔴 Закрыт')}function checkTypeText(x){return tr(x==='tcp'?'TCP-порт':x==='both'?'Ping + TCP':'Ping')}
const pageNames={overview:['Обзор','Общая панель состояния мониторинга'],sites:['Сайты','Редактирование и проверка сайтов'],routers:['Устройства','Ping-проверка роутеров, серверов, NAS, ПК и IP-узлов'],graphs:['Графики','Отдельные окна графиков мониторинга'],events:['События','История последних проверок'],settings:['Настройки','Название, внешний вид, проверки и уведомления'],help:['','']};
function showPage(id){document.querySelectorAll('.page').forEach(x=>x.classList.remove('active'));$(id).classList.add('active');document.querySelectorAll('.nav').forEach(x=>x.classList.toggle('active',x.dataset.page===id));$('pageTitle').textContent=tr(pageNames[id][0]);$('pageDesc').textContent=tr(pageNames[id][1])}
document.querySelectorAll('.nav').forEach(b=>b.onclick=()=>showPage(b.dataset.page));
async function load(){state=await api('/api/state');render()}async function checkNow(){state=await api('/api/check');render()}
function isProblem(x){return x&&x.status&&(x.status==='BAD'||x.status==='SLOW')}
function calcUptime(kind,obj){let h=(state.history||[]).filter(x=>x.kind===kind&&(x.objectId?x.objectId===obj.id:x.name===obj.name));if(!h.length)return '—';let ok=h.filter(x=>x.ok).length;return ((ok/h.length)*100).toFixed(1)+'%'}
function lastFailure(x){return tr(x.lastFailure&&x.lastFailure!=='-'?x.lastFailure:'Никогда')}


function eventKind(e){
  let t=String(e.text||e.message||'').toLowerCase();
  if(t.includes('сайт') || t.includes('site')) return 'site';
  if(t.includes('устройство') || t.includes('device') || t.includes('порт')) return 'device';
  return 'other';
}
function renderMiniEventList(id, items){
  let el=$(id);
  if(!el)return;
  let html=(items||[]).slice(0,5).map(e=>`<div class="event ${e.level||'ok'}"><b>${esc(e.time||'')}</b> ${esc(eventText(e.text||e.message||''))} <small>${levelName(e.level||'ok')}</small></div>`).join('');
  el.innerHTML=html||'<p>Событий нет.</p>';
}
function renderMiniEventsSplit(){
  let important=(state.events||[]).filter(e=>['bad','warn','recovered'].includes(e.level));
  renderMiniEventList('eventPreviewSites', important.filter(e=>eventKind(e)==='site'));
  renderMiniEventList('eventPreviewDevices', important.filter(e=>eventKind(e)==='device'));
  if($('eventsMini')){
    renderMiniEventList('eventsMini', important);
  }
}
function renderTopDevices(){
  let el=$('topDevices');
  if(!el)return;
  let dev=(state.routers||[]).filter(x=>Number(x.ping)>0).sort((a,b)=>Number(b.ping||0)-Number(a.ping||0)).slice(0,5);
  if(!dev.length){el.innerHTML='<p>Пока нет данных по устройствам.</p>';return;}
  el.innerHTML=dev.map(d=>`<div class="topLine"><span>${esc(d.name)}</span><b>${Number(d.ping||0)} мс</b></div>`).join('');
}

function renderNotifyPanel(items){
  let n = items || [];
  let panel=$('notifyPanel');
  if(!panel)return;
  panel.innerHTML=n.slice(0,8).map(e=>`<div><b>${esc(e.time||'')}</b> ${esc(e.text||'')}</div>`).join('')||'<div>Активных уведомлений нет.</div>';
}
function toggleNotifyPanel(event){
  if(event)event.stopPropagation();
  let panel=$('notifyPanel');
  if(panel){
    panel.classList.toggle('show');
    if($('notifyFox'))$('notifyFox').src=panel.classList.contains('show')?'/assets/fox-notify-open.png':'/assets/fox-notify-closed.png';
  }
}
document.addEventListener('click',e=>{
  let panel=$('notifyPanel');
  if(panel && !e.target.closest('.notifyStat')){
    panel.classList.remove('show');
    if($('notifyFox'))$('notifyFox').src='/assets/fox-notify-closed.png';
  }
});
function renderEventPreview(){
  renderMiniEventsSplit();
}
function renderTopResponse(){
  let sites=(state.sites||[]).filter(x=>Number(x.response)>0).sort((a,b)=>Number(b.response||0)-Number(a.response||0)).slice(0,5);
  let el=$('topResponse');
  if(!el)return;
  if(!sites.length){el.innerHTML='<p>Пока нет данных по сайтам. Нажми ⟳ после добавления сайтов.</p>';return;}
  el.innerHTML=sites.map(s=>`<div class="topLine"><span>${esc(s.name)}</span><b>${Number(s.response||0)} мс</b></div>`).join('');
}

function render(){let s=state.settings||{};s.siteOverviewStyle=getSavedOverviewStyle('site')||s.siteOverviewStyle||'line';s.deviceOverviewStyle=getSavedOverviewStyle('device')||s.deviceOverviewStyle||'line';ensureAutoOption(Number(s.autoRefresh||0));$('autoSel').value=String(Number(s.autoRefresh||0));startAutoRefresh(Number(s.autoRefresh||0));$('brandSub').textContent=APP_SUBTITLE;document.title=APP_TITLE;if($('siteIntervalQuick')&&document.activeElement!==$('siteIntervalQuick'))$('siteIntervalQuick').value=Number(s.siteInterval||s.interval||30);if($('deviceIntervalQuick')&&document.activeElement!==$('deviceIntervalQuick'))$('deviceIntervalQuick').value=Number(s.deviceInterval||s.interval||30);if($('siteOverviewStyle'))$('siteOverviewStyle').value=s.siteOverviewStyle;if($('deviceOverviewStyle'))$('deviceOverviewStyle').value=s.deviceOverviewStyle;if($('sitePreviewCount'))$('sitePreviewCount').value=String(previewCount('site'));if($('devicePreviewCount'))$('devicePreviewCount').value=String(previewCount('device'));let sites=state.sites||[],routers=state.routers||[];let siteOk=sites.filter(x=>x.status==='OK').length,routerOk=routers.filter(x=>x.status==='OK').length;let siteWarn=sites.filter(x=>x.status==='SLOW').length,routerWarn=routers.filter(x=>x.status==='SLOW').length;let siteAvailable=siteOk+siteWarn,deviceAvailable=routerOk+routerWarn;let total=sites.length+routers.length,availableTotal=siteAvailable+deviceAvailable;let siteAvailability=sites.length?Math.round((siteAvailable/sites.length)*100):null,deviceAvailability=routers.length?Math.round((deviceAvailable/routers.length)*100):null;let siteProblems=sites.filter(isProblem).length,deviceProblems=routers.filter(isProblem).length;let problemObjects=[...sites,...routers].filter(isProblem);let problems=problemObjects.length;let activeNotices=[...sites.filter(isProblem).map(x=>({time:x.checked||'',text:`Сайт «${x.name}»: ${statusText(x.status)}`})),...routers.filter(isProblem).map(x=>({time:x.checked||'',text:`Устройство «${x.name}»: ${statusText(x.status)}`}))];let checked=[...sites,...routers].map(x=>x.checked).filter(x=>x&&x!=='-'&&x!=='—');let lastCheck=checked.length?checked[checked.length-1]:'—';let resp=sites.filter(x=>(x.status==='OK'||x.status==='SLOW')&&Number(x.response)>0).map(x=>Number(x.response));let avg=resp.length?Math.round(resp.reduce((a,b)=>a+b,0)/resp.length):0;let availability=total?Math.round((availableTotal/total)*100):0;$('stSites').textContent=sites.length;$('stSitesOk').textContent='Онлайн: '+siteOk+(siteWarn?`, медленно: ${siteWarn}`:'');$('stRouters').textContent=routers.length;$('stRoutersOk').textContent='Доступно: '+routerOk+(routerWarn?`, медленно: ${routerWarn}`:'');$('stProblems').textContent=problems;if($('stSiteProblems'))$('stSiteProblems').textContent='Сайты: '+siteProblems;if($('stDeviceProblems'))$('stDeviceProblems').textContent='Устройства: '+deviceProblems;if($('problemsFox'))$('problemsFox').src=problems>0?'/assets/fox-problems-bad.png':'/assets/fox-problems-ok.png';if($('stCritical'))$('stCritical').textContent=[...sites,...routers].filter(x=>x.status==='BAD').length;$('stAvailability').textContent=total?availability+'%':'—';if($('availabilityFox'))$('availabilityFox').src=availabilityFoxSource(availability,total);if($('stSiteAvailability'))$('stSiteAvailability').textContent='Сайты: '+(siteAvailability===null?'—':siteAvailability+'%');if($('stDeviceAvailability'))$('stDeviceAvailability').textContent='Устройства: '+(deviceAvailability===null?'—':deviceAvailability+'%');$('stAvgResp').textContent=avg?avg+' мс':'—';$('stLastCheck').textContent='Проверка: '+lastCheck;if($('stLastUpdateCard'))$('stLastUpdateCard').textContent=lastCheck==='—'?'—':lastCheck;if($('stNotify'))$('stNotify').textContent=problems;if($('lastCheckSide'))$('lastCheckSide').textContent=lastCheck;let badEvents=(state.events||[]).filter(e=>e.level==='bad'||e.level==='warn');if($('stLastProblemTime')){$('stLastProblemTime').textContent=badEvents[0]?badEvents[0].time:'Нет';$('stLastProblemText').textContent=badEvents[0]?eventText(badEvents[0].text):'Нет проблем'}try{renderNotifyPanel(activeNotices)}catch(e){console.error(e)};applyScale();applyTheme();renderTables();renderEvents();renderMiniEventsSplit();if(!shouldProtectForms())renderSettings();if(!isModalOpen())renderGraphs();try{renderEventPreview()}catch(e){console.error(e)};try{renderTopResponse()}catch(e){console.error(e)};try{renderTopDevices()}catch(e){console.error(e)}}

function applyScale(){
  let s=state.settings||{};
  document.documentElement.style.setProperty('--ui-scale', String(s.uiScale||0.72));
  document.documentElement.style.setProperty('--text-scale', String(s.textScale||0.82));
}
function table(rows,heads){return `<table class="table"><thead><tr>${heads.map(h=>`<th>${h}</th>`).join('')}</tr></thead><tbody>${rows||''}</tbody></table>`}
function renderTables(){let sites=state.sites||[],routers=state.routers||[];let siteRows=sites.map(x=>`<tr><td><span class="colorDot" style="background:${esc(x.color||'#35f0ff')}"></span>${esc(x.name)}</td><td>${esc(x.url)}</td><td class="${statusClass(x.status)}">${statusText(x.status)}</td><td>${x.code||0}</td><td>${x.response||0} мс</td><td>${calcUptime('site',x)}</td><td>${esc(lastFailure(x))}</td><td>${x.checked||'-'}</td><td><div class="rowActions"><button class="edit" onclick="editSite('${x.id}')">Редактировать</button><button class="del" onclick="delSite('${x.id}')">Удалить</button></div></td></tr>`).join('');if($('sitesTable'))$('sitesTable').innerHTML=table(siteRows,['Название','URL','Статус','Код','Ответ','Аптайм','Последний сбой','Проверка','Действия']);if($('sitePreview'))$('sitePreview').innerHTML=table(sites.slice(0,4).map(x=>`<tr><td>${esc(x.name)}</td><td>${esc(x.url)}</td><td class="${statusClass(x.status)}">${statusText(x.status)}</td><td>${x.response||0} мс</td><td>${calcUptime('site',x)}</td></tr>`).join(''),['Название','URL','Статус','Ответ','Аптайм']);let routerRows=routers.map(x=>`<tr><td><span class="colorDot" style="background:${esc(x.color||'#7c5cff')}"></span>${esc(x.name)}</td><td>${esc(x.address)}</td><td>${x.port?esc(x.port):'—'}</td><td>${checkTypeText(x.checkType)}</td><td class="${statusClass(x.status)}">${statusText(x.status)}</td><td class="${x.port&&!x.portOk?'statusBAD':'statusOK'}">${portStatusText(x)}</td><td>${x.ping||0} мс</td><td>${calcUptime('router',x)}</td><td>${esc(lastFailure(x))}</td><td>${x.checked||'-'}</td><td><div class="rowActions"><button class="edit" onclick="editRouter('${x.id}')">Редактировать</button><button class="del" onclick="delRouter('${x.id}')">Удалить</button></div></td></tr>`).join('');if($('routersTable'))$('routersTable').innerHTML=table(routerRows,['Название','Адрес','Порт','Проверка','Статус','Порт','Ping','Аптайм','Последний сбой','Проверка','Действия']);if($('routerPreview'))$('routerPreview').innerHTML=table(routers.slice(0,4).map(x=>`<tr><td><span class="colorDot" style="background:${esc(x.color||'#7c5cff')}"></span>${esc(x.name)}</td><td>${esc(x.address)}</td><td class="${statusClass(x.status)}">${statusText(x.status)}</td><td>${x.ping||0} мс</td><td>${calcUptime('router',x)}</td></tr>`).join(''),['Название','Адрес','Статус','Ping','Аптайм'])}
function sslSummary(x){let s=x&&x.ssl;if(!s)return '—';if(!s.ok)return `<span class="statusBAD">${esc(s.error||'Ошибка SSL')}</span>`;let cls=Number(s.daysLeft)<=14?'statusBAD':Number(s.daysLeft)<=30?'statusSLOW':'statusOK';return `<span class="${cls}">${esc(s.validTo)} (${Number(s.daysLeft)} дн.)</span>`}
function compactSslSummary(x){let s=x&&x.ssl;if(!s)return '—';if(!s.ok)return `<span class="statusBAD previewEllipsis" title="${esc(s.error||'Ошибка SSL')}">Ошибка</span>`;let cls=Number(s.daysLeft)<=14?'statusBAD':Number(s.daysLeft)<=30?'statusSLOW':'statusOK';return `<span class="${cls}" title="${esc(s.issuer||'')}">${Number(s.daysLeft)} дн.</span>`}
function compactDnsSummary(x){let dns=x.dns||[];return dns.length?`<span class="previewEllipsis" title="${esc(dns.join(', '))}">${esc(dns[0])}${dns.length>1?' +'+(dns.length-1):''}</span>`:'—'}
function pingSummary(x){if(x&&x.pingSynthetic)return '<span class="statusSLOW" title="DNS использует Fake-IP 198.18.0.0/15">через прокси</span>';let ms=Number(x&&x.ping||0);return ms===0?'<span title="Ответ быстрее 1 миллисекунды">&lt;1 мс</span>':ms+' мс'}
function portsSummary(x){let results=x.portResults||[];if(results.length)return results.map(p=>`<span class="${p.open?'statusOK':'statusBAD'}">${p.port}</span>`).join(', ');let ports=(x.ports&&x.ports.length?x.ports:[x.port].filter(Boolean));return ports.length?ports.join(', '):'—'}
renderTables=function(){
  let sites=state.sites||[],routers=state.routers||[];
  let siteRows=sites.map((x,i)=>`<tr><td><span class="colorDot" style="background:${esc(x.color||'#35f0ff')}"></span>${esc(x.name)}</td><td>${esc(x.url)}</td><td class="${statusClass(x.status)}">${statusText(x.status)}</td><td>${x.code||0}</td><td>${x.response||0} мс</td><td>${pingSummary(x)}</td><td>${esc((x.dns||[]).join(', ')||'—')}</td><td>${sslSummary(x)}</td><td>${calcUptime('site',x)}</td><td><div class="rowActions wrap">${orderButtons('site',x.id,i,sites.length)}<button class="edit" onclick="openDiagnosticModal('site','${x.id}')">Диагностика</button><button class="edit" onclick="editSite('${x.id}')">Редактировать</button><button class="del" onclick="delSite('${x.id}')">Удалить</button></div></td></tr>`).join('');
  if($('sitesTable'))$('sitesTable').innerHTML=table(siteRows,['Название','URL','Статус','HTTP','Ответ','Ping','DNS','SSL','Аптайм','Действия']);
  if($('sitePreview'))$('sitePreview').innerHTML=table(sites.slice(0,previewCount('site')).map((x,i)=>`<tr><td><span class="previewName"><span class="colorDot" style="background:${esc(x.color||'#35f0ff')}"></span><span class="previewEllipsis" title="${esc(x.url)}">${esc(x.name)}</span></span></td><td class="${statusClass(x.status)}">${statusText(x.status)}</td><td>${x.response||0} мс</td><td>${pingSummary(x)}</td><td>${compactDnsSummary(x)}</td><td>${compactSslSummary(x)}</td><td><div class="previewRowActions"><button class="miniAction" onclick="openDiagnosticModal('site','${x.id}')">Диагностика</button>${orderButtons('site',x.id,i,sites.length)}${previewDeleteButton('site',x.id)}</div></td></tr>`).join(''),['Название','Статус','HTTP','Ping','DNS','SSL','Действия']);
  let routerRows=routers.map((x,i)=>`<tr><td><span class="colorDot" style="background:${esc(x.color||'#7c5cff')}"></span>${esc(x.name)}</td><td>${esc(x.address)}</td><td>${portsSummary(x)}</td><td>${checkTypeText(x.checkType)}</td><td class="${statusClass(x.status)}">${statusText(x.status)}</td><td>${x.ping||0} мс</td><td>${calcUptime('router',x)}</td><td><div class="rowActions wrap">${orderButtons('router',x.id,i,routers.length)}<button class="edit" onclick="openDiagnosticModal('router','${x.id}')">Диагностика</button><button class="edit" onclick="editRouter('${x.id}')">Редактировать</button><button class="del" onclick="delRouter('${x.id}')">Удалить</button></div></td></tr>`).join('');
  if($('routersTable'))$('routersTable').innerHTML=table(routerRows,['Название','Адрес','Порты','Проверка','Статус','Ping','Аптайм','Действия']);
  if($('routerPreview'))$('routerPreview').innerHTML=table(routers.slice(0,previewCount('device')).map((x,i)=>`<tr><td><span class="colorDot" style="background:${esc(x.color||'#7c5cff')}"></span>${esc(x.name)}</td><td>${esc(x.address)}</td><td class="${statusClass(x.status)}">${statusText(x.status)}</td><td>${x.ping||0} мс</td><td>${portsSummary(x)}</td><td><div class="previewRowActions"><button class="miniAction" onclick="openDiagnosticModal('router','${x.id}')">Диагностика</button>${orderButtons('router',x.id,i,routers.length)}${previewDeleteButton('router',x.id)}</div></td></tr>`).join(''),['Название','Адрес','Статус','Ping','Порты','Действия']);
}
function eventText(t){return tr(String(t||'').replace(/^Site /,'Сайт ').replace(/^Device /,'Устройство ').replace(/ available \(\d+\)/,' доступен').replace(/ available/,' доступен').replace(/ unavailable/,' недоступен'))}
function levelName(l){return tr(l==='bad'?'Ошибка':l==='warn'?'Предупреждение':l==='recovered'?'Восстановлено':'Инфо')}
function parseEventDate(e){
  if(e.ts){let d=new Date(e.ts); if(!isNaN(d)) return d;}
  if(e.date){
    let m=String(e.date).match(/^(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2}):(\d{2})/);
    if(m)return new Date(Number(m[3]),Number(m[2])-1,Number(m[1]),Number(m[4]),Number(m[5]),Number(m[6]));
  }
  if(e.time){
    let p=String(e.time).split(':').map(Number);
    if(p.length>=2){let d=new Date();d.setHours(p[0]||0,p[1]||0,p[2]||0,0);return d;}
  }
  return null;
}
function renderEvents(){
  let ev=[...(state.events||[])];
  let hours=Number(($('eventHoursFilter')&&$('eventHoursFilter').value)||24);
  if(hours>0){
    let from=Date.now()-hours*60*60*1000;
    ev=ev.filter(e=>{let d=parseEventDate(e);return !d || d.getTime()>=from});
  }
  let level=($('eventLevelFilter')&&$('eventLevelFilter').value)||'important';
  if(level==='important') ev=ev.filter(e=>['bad','warn','recovered'].includes(e.level));
  else if(level!=='all') ev=ev.filter(e=>(e.level||'ok')===level);
  let html=ev.slice(0,300).map(e=>`<div class="event ${e.level||'ok'}"><b>${esc(e.time||'')}</b> ${esc(eventText(e.text))} <small>${levelName(e.level||'ok')}</small></div>`).join('');
  $('eventsList').innerHTML=html||'<p>Событий за выбранный период нет.</p>';
}
async function clearEvents(){
  if(!confirm('Очистить журнал событий?'))return;
  await api('/api/events/clear',{});
  await load();
}

function renderSettings(){
  let s=state.settings||{};
  if($('setLanguage'))$('setLanguage').value=s.language||I18N.current();
  if($('setSiteInterval'))$('setSiteInterval').value=s.siteInterval||s.interval||30;
  if($('setDeviceInterval'))$('setDeviceInterval').value=s.deviceInterval||s.interval||30;
  $('setTimeout').value=s.timeout||10;
  if($('setFailureConfirmChecks'))$('setFailureConfirmChecks').value=Number(s.failureConfirmChecks||2);
  if($('setPort'))$('setPort').value=s.port||8000;if($('currentAddress'))$('currentAddress').textContent='http://127.0.0.1:'+(s.port||8000);
  if($('setSiteWarn'))$('setSiteWarn').value=s.siteWarn||1000;if($('setSiteCrit'))$('setSiteCrit').value=s.siteCrit||3000;
  if($('setDeviceWarn'))$('setDeviceWarn').value=s.deviceWarn||150;if($('setDeviceCrit'))$('setDeviceCrit').value=s.deviceCrit||300;
  if($('setThemePreset'))$('setThemePreset').value=s.themePreset||'dark';
  if($('setThemeAccent'))$('setThemeAccent').value=s.themeAccent||'#7c5cff';
  if($('setThemeButton'))$('setThemeButton').value=s.themeButton||'#24457f';
  if($('setThemeOk'))$('setThemeOk').value=s.themeOk||'#20e68a';
  if($('setThemeBad'))$('setThemeBad').value=s.themeBad||'#ff4d6d';
  if($('setThemeBg'))$('setThemeBg').value=s.themeBg||'#080d1b';
  if($('setThemePanel'))$('setThemePanel').value=s.themePanel||'#101a36';
  if($('setThemePreset'))$('setThemePreset').onchange=previewThemeFromForm;
  ['setThemeAccent','setThemeButton','setThemeOk','setThemeBad','setThemeBg','setThemePanel'].forEach(id=>{if($(id))$(id).oninput=previewThemeFromForm});
  if($('setUiScale'))$('setUiScale').value=String(s.uiScale||0.9);$('setTextScale').value=String(s.textScale||1);$('setMs').checked=!!s.showMs;$('setOpen').checked=!!s.autoOpen;
  $('setToken').value=s.telegramToken||'';$('setChat').value=s.telegramChat||'';
  if($('setTelegramCommandsEnabled'))$('setTelegramCommandsEnabled').checked=s.telegramCommandsEnabled===true;
  if($('setTelegramCommandInterval'))$('setTelegramCommandInterval').value=String(s.telegramCommandInterval||5);
  if($('setNotifyDown'))$('setNotifyDown').checked=s.notifyDown!==false;
  if($('setNotifySlow'))$('setNotifySlow').checked=s.notifySlow!==false;
  if($('setNotifyRecovered'))$('setNotifyRecovered').checked=s.notifyRecovered!==false;
  const cleanTg=(v,d)=>{v=String(v||'').trim();return (!v||v.includes('{'))?d:v.split('\n')[0]};
  if($('setTgSiteDown'))$('setTgSiteDown').value=tr(cleanTg(s.tgSiteDown,'Сайт недоступен'));
  if($('setTgSiteSlow'))$('setTgSiteSlow').value=tr(cleanTg(s.tgSiteSlow,'Сайт отвечает медленно'));
  if($('setTgSiteRecovered'))$('setTgSiteRecovered').value=tr(cleanTg(s.tgSiteRecovered,'Сайт снова доступен'));
  if($('setTgDeviceDown'))$('setTgDeviceDown').value=tr(cleanTg(s.tgDeviceDown,'Устройство недоступно'));
  if($('setTgDeviceSlow'))$('setTgDeviceSlow').value=tr(cleanTg(s.tgDeviceSlow,'Высокий ping'));
  if($('setTgDeviceRecovered'))$('setTgDeviceRecovered').value=tr(cleanTg(s.tgDeviceRecovered,'Устройство снова доступно'));
  if($('setSiteRepeatMinutes'))$('setSiteRepeatMinutes').value=Number(s.siteRepeatMinutes??10);
  if($('setDeviceRepeatMinutes'))$('setDeviceRepeatMinutes').value=Number(s.deviceRepeatMinutes??10);
}
async function addSite(){let name=$('siteName').value.trim(),url=$('siteUrl').value.trim(),color=$('siteColor').value||'#35f0ff';if(!name||!url)return alert('Заполни название и URL сайта');await api('/api/site/add',{name,url,color});$('siteName').value='';$('siteUrl').value='';await load()}
function editSite(id){let x=state.sites.find(a=>a.id===id);if(!x)return;$('siteEditId').value=x.id;$('siteEditName').value=x.name||'';$('siteEditUrl').value=x.url||'';$('siteEditColor').value=x.color||'#35f0ff';lockEdit();$('siteModal').classList.add('show')}
function closeSiteModal(){unlockEdit();$('siteModal').classList.remove('show')}
async function saveSiteFromModal(){let id=$('siteEditId').value,name=$('siteEditName').value.trim(),url=$('siteEditUrl').value.trim(),color=$('siteEditColor').value||'#35f0ff';if(!name||!url)return alert('Заполни название и URL сайта');await api('/api/site/update',{id,name,url,color});unlockEdit();closeSiteModal();await checkNow()}async function delSite(id){if(confirm('Удалить сайт?')){await api('/api/site/delete',{id});await load()}}
function normalizePorts(value){let parts=String(value||'').split(/[,;\s]+/).filter(Boolean),ports=[...new Set(parts.map(Number).filter(x=>Number.isInteger(x)&&x>=1&&x<=65535))];return {ports,valid:parts.length===ports.length}}
async function addRouter(){let name=$('routerName').value.trim(),address=$('routerAddr').value.trim(),parsed=normalizePorts($('routerPort')?$('routerPort').value:''),checkType=$('routerCheckType')?$('routerCheckType').value:'ping',color=$('routerColor').value||'#7c5cff';if(!name||!address)return alert('Заполни название и IP/адрес');if(!parsed.valid)return alert('Порты должны быть числами от 1 до 65535');if(checkType!=='ping'&&!parsed.ports.length)return alert('Для проверки TCP укажи порт');await api('/api/router/add',{name,address,ports:parsed.ports,checkType,color});$('routerName').value='';$('routerAddr').value='';if($('routerPort'))$('routerPort').value='';await load()}
function editRouter(id){let x=state.routers.find(a=>a.id===id);if(!x)return;$('routerEditId').value=x.id;$('routerEditName').value=x.name||'';$('routerEditAddr').value=x.address||'';if($('routerEditPort'))$('routerEditPort').value=(x.ports&&x.ports.length?x.ports:[x.port].filter(Boolean)).join(', ');if($('routerEditCheckType'))$('routerEditCheckType').value=x.checkType||'ping';$('routerEditColor').value=x.color||'#7c5cff';lockEdit();$('routerModal').classList.add('show')}
function closeRouterModal(){unlockEdit();$('routerModal').classList.remove('show')}
async function saveRouterFromModal(){let id=$('routerEditId').value,name=$('routerEditName').value.trim(),address=$('routerEditAddr').value.trim(),parsed=normalizePorts($('routerEditPort')?$('routerEditPort').value:''),checkType=$('routerEditCheckType')?$('routerEditCheckType').value:'ping',color=$('routerEditColor').value||'#7c5cff';if(!name||!address)return alert('Заполни название и IP/адрес');if(!parsed.valid)return alert('Порты должны быть числами от 1 до 65535');if(checkType!=='ping'&&!parsed.ports.length)return alert('Для проверки TCP укажи порт');await api('/api/router/update',{id,name,address,ports:parsed.ports,checkType,color});unlockEdit();closeRouterModal();await checkNow()}async function delRouter(id){if(confirm('Удалить устройство?')){await api('/api/router/delete',{id});await load()}}
let networkScanDevices=[];
async function openNetworkScan(){
  networkScanDevices=[];
  $('networkScanResults').innerHTML='';
  $('networkScanStatus').textContent='Определение локальной сети...';
  lockEdit();$('networkScanModal').classList.add('show');
  try{
    let info=await api('/api/network/info');
    if(info.suggested)$('networkSubnet').value=info.suggested;
    $('networkScanStatus').textContent=info.suggested?'Подсеть определена. Нажмите «Начать сканирование».':'Не удалось определить подсеть автоматически. Введите её вручную.';
  }catch(e){$('networkScanStatus').textContent=tr(e.message||String(e))}
}
function closeNetworkScan(){unlockEdit();$('networkScanModal').classList.remove('show')}
function renderNetworkScanResults(){
  let known=new Set((state.routers||[]).map(x=>String(x.address||'').toLowerCase()));
  let rows=networkScanDevices.map((x,i)=>{
    let added=known.has(String(x.address).toLowerCase());
    return `<tr><td>${esc(x.address)}</td><td>${x.name?esc(x.name):'<span class="scanUnknown">—</span>'}</td><td>${x.mac?esc(x.mac):'<span class="scanUnknown">—</span>'}</td><td>${Number(x.ping)===0?'&lt;1':Number(x.ping)} мс</td><td>${added?'<span class="scanAdded">Уже добавлено</span>':`<button class="miniAction" onclick="addScannedDevice(${i})">Добавить</button>`}</td></tr>`;
  }).join('');
  $('networkScanResults').innerHTML=networkScanDevices.length?table(rows,['IP-адрес','Имя','MAC-адрес','Ping','Действия']):'<div class="panel scanEmpty">Активные устройства не найдены. Некоторые устройства могут блокировать Ping.</div>';
  I18N.apply($('networkScanResults'));
}
async function scanLocalNetwork(){
  let subnet=$('networkSubnet').value.trim(),button=$('networkScanButton');
  button.disabled=true;$('networkScanStatus').textContent='Сканирование выполняется, это может занять несколько секунд...';$('networkScanResults').innerHTML='';
  try{
    let result=await api('/api/network/scan',{subnet});
    networkScanDevices=result.devices||[];
    $('networkSubnet').value=result.subnet||subnet;
    $('networkScanStatus').textContent=`${tr('Найдено устройств:')} ${networkScanDevices.length}. ${tr('Проверено адресов:')} ${Number(result.scanned||0)}.`;
    renderNetworkScanResults();
  }catch(e){$('networkScanStatus').textContent=tr(e.message||String(e))}
  finally{button.disabled=false}
}
async function addScannedDevice(index){
  let device=networkScanDevices[index];if(!device)return;
  let name=device.name||('Устройство '+device.address);
  await api('/api/router/add',{name,address:device.address,ports:[],checkType:'ping',color:'#7c5cff'});
  await load();renderNetworkScanResults();
}
async function saveSettings(){
  let port=Number($('setPort')?$('setPort').value:8000);if(!port||port<1024||port>65535)return alert('Порт должен быть от 1024 до 65535');
  let siteInterval=Number($('setSiteInterval')?.value||30),deviceInterval=Number($('setDeviceInterval')?.value||30);
  if(siteInterval<1||deviceInterval<1)return alert('Интервалы проверки должны быть не меньше 1 секунды');
  let siteWarn=Number($('setSiteWarn').value||1000),siteCrit=Number($('setSiteCrit').value||3000),deviceWarn=Number($('setDeviceWarn').value||150),deviceCrit=Number($('setDeviceCrit').value||300);
  if(siteWarn>=siteCrit)return alert('Для сайтов критичный порог должен быть больше предупреждения');
  if(deviceWarn>=deviceCrit)return alert('Для устройств критичный порог должен быть больше предупреждения');
  await api('/api/settings/save',{
    title:APP_TITLE,subtitle:APP_SUBTITLE,interval:Math.min(siteInterval,deviceInterval),siteInterval,deviceInterval,timeout:$('setTimeout').value,port:port,
    language:$('setLanguage')?$('setLanguage').value:(state.settings.language||'ru'),
    failureConfirmChecks:Number($('setFailureConfirmChecks')?.value||2),
    siteWarn,siteCrit,deviceWarn,deviceCrit,showMs:$('setMs').checked,autoOpen:$('setOpen').checked,
    telegramToken:$('setToken').value,telegramChat:$('setChat').value,
    telegramCommandsEnabled:$('setTelegramCommandsEnabled')?$('setTelegramCommandsEnabled').checked:false,
    telegramCommandInterval:$('setTelegramCommandInterval')?Number($('setTelegramCommandInterval').value||5):5,
    uiScale:$('setUiScale').value,textScale:$('setTextScale').value,
    themePreset:$('setThemePreset')?$('setThemePreset').value:'dark',
    themeAccent:$('setThemeAccent')?$('setThemeAccent').value:'#7c5cff',
    themeButton:$('setThemeButton')?$('setThemeButton').value:'#24457f',
    themeOk:$('setThemeOk')?$('setThemeOk').value:'#20e68a',
    themeBad:$('setThemeBad')?$('setThemeBad').value:'#ff4d6d',
    themeBg:$('setThemeBg')?$('setThemeBg').value:'#080d1b',
    themePanel:$('setThemePanel')?$('setThemePanel').value:'#101a36',
    autoRefresh:Number((state.settings||{}).autoRefresh||0),
    notifyDown:$('setNotifyDown')?$('setNotifyDown').checked:true,
    notifySlow:$('setNotifySlow')?$('setNotifySlow').checked:true,
    notifyRecovered:$('setNotifyRecovered')?$('setNotifyRecovered').checked:true,
    tgSiteDown:$('setTgSiteDown')?$('setTgSiteDown').value:'',
    tgSiteSlow:$('setTgSiteSlow')?$('setTgSiteSlow').value:'',
    tgSiteRecovered:$('setTgSiteRecovered')?$('setTgSiteRecovered').value:'',
    tgDeviceDown:$('setTgDeviceDown')?$('setTgDeviceDown').value:'',
    tgDeviceSlow:$('setTgDeviceSlow')?$('setTgDeviceSlow').value:'',
    tgDeviceRecovered:$('setTgDeviceRecovered')?$('setTgDeviceRecovered').value:'',
    siteRepeatMinutes:$('setSiteRepeatMinutes')?Number($('setSiteRepeatMinutes').value||0):10,
    deviceRepeatMinutes:$('setDeviceRepeatMinutes')?Number($('setDeviceRepeatMinutes').value||0):10
  });
  settingsDirty=false;unlockEdit();await load();alert('Настройки сохранены. Если менял порт — перезапусти программу через RUN.cmd.');
}

function resetTelegramTemplates(){
  if(!confirm('Сбросить тексты Telegram к стандартным?')) return;
  const defaults={
    setTgSiteDown:'Сайт недоступен',
    setTgSiteSlow:'Сайт отвечает медленно',
    setTgSiteRecovered:'Сайт снова доступен',
    setTgDeviceDown:'Устройство недоступно',
    setTgDeviceSlow:'Высокий ping',
    setTgDeviceRecovered:'Устройство снова доступно'
  };
  Object.entries(defaults).forEach(([id,val])=>{ if($(id)) $(id).value=tr(val); });
}

async function testTelegram(){
  await saveSettings();
  let r = await api('/api/telegram/test',{});
  if(r && r.ok) alert('Тестовое сообщение отправлено в Telegram.');
  else alert('Не удалось отправить Telegram: ' + ((r&&r.error)?r.error:'проверь токен и chat ID'));
}
async function testTelegramCommands(){
  let token=$('setToken')?.value.trim(),chat=$('setChat')?.value.trim();
  if(!token||!chat)return alert('Введите Telegram bot token и chat ID.');
  let r=await api('/api/telegram/commands/test',{telegramToken:token,telegramChat:chat});
  if(r&&r.ok)alert('Команды зарегистрированы. Бот отправил список команд в Telegram.');
  else alert('Не удалось проверить команды: '+((r&&r.error)?r.error:'проверьте токен, chat ID и сохраните настройки'));
}
async function checkPortSetting(){let port=Number($('setPort').value);if(!port||port<1024||port>65535)return alert('Порт должен быть от 1024 до 65535');let r=await api('/api/port/check',{port});alert(r.free?'Порт свободен: '+port:'Порт занят: '+port)}
async function clearHistory(){if(confirm('Очистить историю графиков и события?')){await api('/api/history/clear',{});await load()}}
function openGraphModal(id){
  let g=id?(state.graphs||[]).find(x=>x.id===id):null;
  $('graphEditId').value=g?g.id:'';
  $('graphModalTitle').textContent=g?'Редактировать график':'Добавить график';
  $('graphSaveBtn').textContent=g?'Сохранить':'Добавить график';
  $('graphTitle').value=g?g.title:'';
  $('graphType').value=g?g.type:'site_response';
  $('graphStyle').value=g?(g.style||'line'):'line';
  $('graphHeight').value=g?(g.height||260):260;
  $('graphNote').value=g?(g.note||''):'';
  lockEdit();$('graphModal').classList.add('show')
}

async function resetAllData(){
  if(!confirm('Удалить все сайты, устройства, графики, события и историю? Настройки программы останутся.')) return;
  if(!confirm('Точно удалить все данные мониторинга? Это действие нельзя отменить.')) return;
  await api('/api/reset/all',{});
  await load();
  alert('Все данные мониторинга удалены.');
}

function closeGraphModal(){unlockEdit();$('graphModal').classList.remove('show')}
async function saveGraphFromModal(){
  let id=$('graphEditId').value;
  let title=$('graphTitle').value.trim(),type=$('graphType').value,style=$('graphStyle').value,height=+$('graphHeight').value,note=$('graphNote').value.trim();
  if(!title)return alert('Напиши название графика');
  let payload={id,title,type,style,height,note};
  await api(id?'/api/graph/update':'/api/graph/add',payload);
  unlockEdit();closeGraphModal();await load()
}
async function delGraph(id){if(confirm('Удалить график?')){await api('/api/graph/delete',{id});await load()}}
let diagnosticContext={kind:'',id:''};
function openDiagnosticModal(kind,id){
  let obj=(kind==='site'?state.sites:state.routers).find(x=>x.id===id);
  if(!obj)return;
  diagnosticContext={kind,id};
  $('diagnosticTitle').textContent='Диагностика';
  $('diagnosticTarget').textContent=(obj.name||'')+' — '+(kind==='site'?obj.url:obj.address);
  $('diagnosticResult').textContent='Выберите проверку.';
  lockEdit();$('diagnosticModal').classList.add('show');
}
function closeDiagnosticModal(){unlockEdit();$('diagnosticModal').classList.remove('show')}
function diagnosticHtml(result){
  if(result.type==='whois'&&result.notFound)return `<div class="diagProxyWarning">RDAP-данные для этого домена или IP не найдены.</div><div class="diagItem"><b>Запрос</b><br>${esc(result.query||result.host||'—')}</div>`;
  if(result.error)return `<span class="diagBad">${esc(result.error)}</span>`;
  if(result.type==='ping'){let warning=result.syntheticProxy?`<div class="diagProxyWarning">DNS вернул Fake-IP ${esc((result.addresses||[]).join(', '))}. Реальный ping скрыт VPN/прокси.</div>`:'';return warning+`<div class="diagGrid">${(result.results||[]).map((x,i)=>`<div class="diagItem"><b>#${i+1}</b><br><span class="${x.ok?'diagGood':'diagBad'}">${x.ok?(result.syntheticProxy?'через прокси':(Number(x.ms)===0?'&lt;1 мс':x.ms+' мс')):esc(x.status)}</span></div>`).join('')}</div>`}
  if(result.type==='dns'){let records=result.records||[];if(records.length)return `<div class="diagGrid">${records.map(x=>`<div class="diagItem"><b>${esc(x.type)}</b><br>${esc(x.value)}<br><small>TTL: ${Number(x.ttl||0)}</small></div>`).join('')}</div>`;return (result.addresses||[]).length?`<div class="diagGrid">${result.addresses.map(x=>`<div class="diagItem">${esc(x)}</div>`).join('')}</div>`:'DNS-записи не найдены.'}
  if(result.type==='ports')return (result.results||[]).length?`<div class="diagGrid">${result.results.map(x=>`<div class="diagItem"><b>${x.port}</b><br><span class="${x.open?'diagGood':'diagBad'}">${x.open?'Открыт':'Закрыт'}</span></div>`).join('')}</div>`:'Порты не указаны.';
  if(result.type==='ssl'){let c=result.certificate||{};return `<div class="diagGrid"><div class="diagItem"><b>Статус</b><br><span class="${c.ok?'diagGood':'diagBad'}">${c.ok?'Действителен':'Ошибка'}</span></div><div class="diagItem"><b>Действует до</b><br>${esc(c.validTo||'—')} (${Number(c.daysLeft??-1)} дн.)</div><div class="diagItem"><b>Издатель</b><br>${esc(c.issuer||'—')}</div><div class="diagItem"><b>Субъект</b><br>${esc(c.subject||c.error||'—')}</div></div>`}
  if(result.type==='trace')return esc(result.output||'Нет данных.');
  if(result.type==='whois'){return `<div class="diagGrid"><div class="diagItem"><b>Домен</b><br>${esc(result.name||result.host||'—')}</div><div class="diagItem"><b>Статус</b><br>${esc((result.status||[]).join(', ')||'—')}</div><div class="diagItem"><b>Nameservers</b><br>${esc((result.nameservers||[]).join(', ')||'—')}</div><div class="diagItem"><b>События</b><br>${esc((result.events||[]).map(x=>`${x.action}: ${x.date}`).join('\n')||'—')}</div></div>`}
  return `<pre>${esc(JSON.stringify(result,null,2))}</pre>`;
}
async function runDiagnostic(type){
  let resultEl=$('diagnosticResult');
  resultEl.textContent='Выполняется проверка...';
  try{
    let result=await api('/api/diagnostic',{kind:diagnosticContext.kind,id:diagnosticContext.id,type});
    resultEl.innerHTML=diagnosticHtml(result);
    I18N.apply(resultEl);
  }catch(e){resultEl.innerHTML=`<span class="diagBad">${esc(e.message||String(e))}</span>`}
}
function paletteFor(names,isDevice){
  const defaults=['#35f0ff','#7d61ff','#39e58c','#ffcf66','#ff5f78','#ff8a00','#ff4db8','#4aa3ff'];
  return names.map((n,i)=>{
    if(!isDevice){let s=(state.sites||[]).find(x=>x.name===n); if(s&&s.color)return s.color}
    if(isDevice){let r=(state.routers||[]).find(x=>x.name===n); if(r&&r.color)return r.color}
    return defaults[i%defaults.length]
  })
}
function datasetFor(type){
  let h=state.history||[];
  let labels=[...new Set(h.slice(-60).map(x=>x.time))];
  let isDevice=(type==='router_ping'||type==='device_availability');
  let objects=(isDevice?state.routers:state.sites)||[];
  let entries=h.filter(x=>isDevice?x.kind==='router':x.kind==='site');
  const historyKey=x=>x.objectId||objects.find(o=>o.name===x.name)?.id||x.name;
  let historyKeys=[...new Set(entries.map(historyKey))];
  let availableKeys=new Set(historyKeys);
  let orderedKeys=objects.map(x=>x.id).filter(id=>availableKeys.has(id));
  let keys=[...orderedKeys,...historyKeys.filter(key=>!orderedKeys.includes(key))].slice(0,8);
  let names=keys.map(key=>objects.find(x=>x.id===key)?.name||entries.find(x=>historyKey(x)===key)?.name||key);
  let colors=paletteFor(names,isDevice);
  return {labels,names,colors,values:keys.map(key=>labels.map(t=>{let r=[...entries].reverse().find(x=>x.time===t&&historyKey(x)===key);if(!r)return null;if(type==='site_availability'||type==='device_availability')return r.ok?100:0;if(type==='site_codes')return r.code||0;if(type==='site_errors')return r.ok?0:1;return r.value||0}))}
}
function renderLegend(legendId,d){
  let el=$(legendId); if(!el)return;
  if(!d.names.length){el.innerHTML='<span class="muted">Нет объектов</span>';return}
  el.innerHTML=d.names.map((n,i)=>`<div class="legendItem"><i style="background:${d.colors[i]}"></i><span>${esc(n)}</span></div>`).join('')
}
function metricInfo(type){
  if(type==='router_ping')return {label:'Ping',suffix:tr(' мс'),maxMin:100};
  if(type==='device_availability')return {label:tr('Доступность'),suffix:'%',maxMin:100,fixedMax:100};
  if(type==='site_availability')return {label:tr('Доступность'),suffix:'%',maxMin:100,fixedMax:100};
  if(type==='site_codes')return {label:tr('HTTP-код'),suffix:'',maxMin:500};
  if(type==='site_errors')return {label:tr('Ошибки'),suffix:'',maxMin:1,fixedMax:1};
  return {label:tr('Ответ'),suffix:tr(' мс'),maxMin:100};
}
function niceMax(v,minVal=1){
  v=Math.max(Number(v)||0,minVal);
  let pow=Math.pow(10,Math.floor(Math.log10(v)));
  let n=Math.ceil(v/pow);
  if(n<=2)n=2; else if(n<=5)n=5; else n=10;
  return n*pow;
}
function drawYAxis(ctx,info,left,top,plotW,plotH,max){
  ctx.save();
  ctx.strokeStyle='rgba(255,255,255,.18)';ctx.fillStyle='#9fb0c8';ctx.lineWidth=1;ctx.font='11px Segoe UI';
  ctx.textAlign='right';ctx.textBaseline='middle';
  ctx.beginPath();ctx.moveTo(left,top);ctx.lineTo(left,top+plotH);ctx.stroke();
  for(let i=0;i<5;i++){
    let val=Math.round(max-(max*i/4));
    let y=top+i*plotH/4;
    ctx.fillText(val+info.suffix,left-8,y);
    ctx.strokeStyle='rgba(255,255,255,.07)';ctx.beginPath();ctx.moveTo(left,y);ctx.lineTo(left+plotW,y);ctx.stroke();
  }
  ctx.textAlign='left';ctx.textBaseline='top';ctx.fillStyle='#35f0ff';ctx.font='11px Segoe UI';
  ctx.fillText(info.label, left, 3);
  ctx.restore();
}
function drawPieChart(ctx,d,info,W,H){
  let values=d.values.map(series=>{
    let latest=[...series].reverse().find(v=>v!==null);
    return Math.max(0,Number(latest)||0);
  });
  let total=values.reduce((a,b)=>a+b,0);
  if(total<=0){
    ctx.fillStyle='#8fa0bd';ctx.font='12px Segoe UI';ctx.textAlign='center';
    ctx.fillText(tr('Нет данных для круговой диаграммы.'),W/2,H/2);
    return;
  }
  let cx=W/2,cy=H/2,radius=Math.max(35,Math.min(W,H)*.34),start=-Math.PI/2;
  values.forEach((value,i)=>{
    if(value<=0)return;
    let angle=(value/total)*Math.PI*2;
    ctx.beginPath();ctx.moveTo(cx,cy);ctx.arc(cx,cy,radius,start,start+angle);ctx.closePath();
    ctx.fillStyle=d.colors[i]||'#35f0ff';ctx.fill();
    ctx.strokeStyle='#0b1226';ctx.lineWidth=2;ctx.stroke();
    start+=angle;
  });
  ctx.beginPath();ctx.arc(cx,cy,radius*.48,0,Math.PI*2);ctx.fillStyle='#0b1226';ctx.fill();
  ctx.fillStyle='#dce7ff';ctx.textAlign='center';ctx.textBaseline='middle';ctx.font='600 13px Segoe UI';
  ctx.fillText(info.label,cx,cy-8);
  ctx.fillStyle='#9fb0c8';ctx.font='11px Segoe UI';ctx.fillText(tr('последние значения'),cx,cy+11);
}
function drawCanvas(canvas,type,style='line',height=210,legendId=null){
  if(!canvas)return;
  let ctx=canvas.getContext('2d'),ratio=devicePixelRatio||1;
  let W=canvas.clientWidth,H=Number(height)||210;
  canvas.style.height=H+'px'; canvas.width=W*ratio; canvas.height=H*ratio; ctx.setTransform(ratio,0,0,ratio,0,0);
  ctx.clearRect(0,0,W,H);
  let d=datasetFor(type);renderLegend(legendId,d);
  let info=metricInfo(type);
  if(style==='pie'){
    drawPieChart(ctx,d,info,W,H);
    return;
  }
  let left=58,right=10,top=24,bottom=30;
  let plotW=Math.max(10,W-left-right),plotH=Math.max(10,H-top-bottom);
  let all=d.values.flat().filter(v=>v!==null),max=info.fixedMax||niceMax(Math.max(1,...all),info.maxMin||1);
  drawYAxis(ctx,info,left,top,plotW,plotH,max);
  ctx.fillStyle='#8fa0bd';ctx.font='11px Segoe UI';
  if(!all.length){
    ctx.fillText(tr('Нет данных. Нажми «⟳» после добавления объектов.'),left+8,Math.round(top+plotH/2));
    drawTimeScale(ctx,d.labels,left,top,plotW,plotH,W,H);
    return;
  }
  d.values.forEach((vals,si)=>{
    ctx.strokeStyle=d.colors[si]||'#35f0ff';ctx.fillStyle=d.colors[si]||'#35f0ff';ctx.lineWidth=2;
    if(style==='bar'){
      let groupW=plotW/Math.max(1,d.labels.length),barW=Math.max(2,groupW/(d.values.length+1));
      vals.forEach((v,i)=>{if(v===null)return;let x=left+i*groupW+si*barW;let bh=(v/max)*plotH;let y=top+plotH-bh;ctx.fillRect(x,y,barW*.85,bh)})
    }else{
      ctx.beginPath();let moved=false;vals.forEach((v,i)=>{if(v===null)return;let x=left+(i/Math.max(1,d.labels.length-1))*plotW;let y=top+plotH-(v/max)*plotH;if(!moved){ctx.moveTo(x,y);moved=true}else ctx.lineTo(x,y)});ctx.stroke();
      vals.forEach((v,i)=>{if(v===null)return;let x=left+(i/Math.max(1,d.labels.length-1))*plotW;let y=top+plotH-(v/max)*plotH;ctx.beginPath();ctx.arc(x,y,2.2,0,Math.PI*2);ctx.fill()})
    }
  });
  drawTimeScale(ctx,d.labels,left,top,plotW,plotH,W,H);
}
function drawTimeScale(ctx,labels,left,top,plotW,plotH,W,H){
  ctx.save();
  ctx.strokeStyle='rgba(255,255,255,.18)';ctx.fillStyle='#8fa0bd';ctx.lineWidth=1;ctx.font='11px Segoe UI';ctx.textAlign='center';ctx.textBaseline='top';
  let y=top+plotH;
  ctx.beginPath();ctx.moveTo(left,y);ctx.lineTo(left+plotW,y);ctx.stroke();
  if(labels&&labels.length){
    let maxTicks=Math.min(6,labels.length);
    let used=new Set();
    for(let t=0;t<maxTicks;t++){
      let idx=maxTicks===1?0:Math.round(t*(labels.length-1)/(maxTicks-1));
      if(used.has(idx))continue; used.add(idx);
      let x=left+(idx/Math.max(1,labels.length-1))*plotW;
      ctx.strokeStyle='rgba(255,255,255,.16)';ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x,y+5);ctx.stroke();
      ctx.fillText(labels[idx],x,y+8);
    }
  }else{
    ctx.fillText(tr('Время'),left+plotW/2,y+8);
  }
  ctx.restore();
}
function draw(id,type,style,height,legendId){drawCanvas($(id),type,style,height,legendId)}
function renderGraphs(){
  let s=state.settings||{};
  draw('chartOverview1','site_response',s.siteOverviewStyle||'line',210,'legendOverview1');draw('chartOverview2','router_ping',s.deviceOverviewStyle||'line',210,'legendOverview2');
  let graphs=state.graphs||[];
  let html=graphs.map(g=>`<div class="panel chartCard"><div class="chartTop"><div><h3>${esc(g.title)}</h3></div><div class="rowActions"><button class="edit" onclick="openGraphModal('${g.id}')">Редактировать</button><button class="delGraph" onclick="delGraph('${g.id}')">Удалить</button></div></div><div class="chartArea"><div id="leg_${g.id}" class="chartLegend"></div><canvas id="g_${g.id}"></canvas></div></div>`).join('');
  if($('graphGrid'))$('graphGrid').innerHTML=html;
  graphs.forEach(g=>setTimeout(()=>{if($('g_'+g.id))draw('g_'+g.id,g.type,g.style||'line',g.height||220,'leg_'+g.id)},20))
}

function ensureAutoOption(v){
  let sel=$('autoSel');
  if(!sel)return;
  v=Number(v||0);
  let known=[0,10,20,30,60];
  let old=sel.querySelector('option[data-custom="1"]');
  if(old)old.remove();
  if(v>0 && !known.includes(v)){
    let opt=document.createElement('option');
    opt.value=String(v); opt.textContent=v+' сек'; opt.dataset.custom='1';
    sel.insertBefore(opt, sel.querySelector('option[value="custom"]'));
  }
}
function startAutoRefresh(v){
  clearInterval(autoTimer);
  v=Number(v||0);
  if(v>0)autoTimer=setInterval(load,v*1000);
}
async function saveAutoRefresh(v){
  v=Number(v||0);
  ensureAutoOption(v);
  $('autoSel').value=String(v);
  state.settings=state.settings||{};
  state.settings.autoRefresh=v;
  startAutoRefresh(v);
  await saveSettingsSilent();
}
function openAutoModal(){
  $('autoCustomValue').value='';
  $('autoModal').classList.add('show');
  setTimeout(()=>$('autoCustomValue').focus(),50);
}
function closeAutoModal(){
  $('autoModal').classList.remove('show');
  let v=Number((state.settings||{}).autoRefresh||0);
  ensureAutoOption(v); $('autoSel').value=String(v);
}
async function saveCustomAutoRefresh(){
  let v=Number($('autoCustomValue').value);
  if(!Number.isFinite(v) || v<5 || v>3600)return alert('Укажи интервал от 5 до 3600 секунд');
  closeAutoModal();
  await saveAutoRefresh(Math.round(v));
}
async function saveSettingsSilent(){
  let ss=state.settings||{};
  await api('/api/settings/save',{title:APP_TITLE,subtitle:APP_SUBTITLE,language:ss.language||I18N.current(),interval:ss.interval||30,siteInterval:ss.siteInterval||ss.interval||30,deviceInterval:ss.deviceInterval||ss.interval||30,timeout:ss.timeout||10,port:ss.port||8000,siteWarn:ss.siteWarn||1000,siteCrit:ss.siteCrit||3000,deviceWarn:ss.deviceWarn||150,deviceCrit:ss.deviceCrit||300,failureConfirmChecks:ss.failureConfirmChecks||2,siteOverviewStyle:ss.siteOverviewStyle||'line',deviceOverviewStyle:ss.deviceOverviewStyle||'line',showMs:!!ss.showMs,autoOpen:!!ss.autoOpen,telegramToken:ss.telegramToken||'',telegramChat:ss.telegramChat||'',telegramCommandsEnabled:!!ss.telegramCommandsEnabled,telegramCommandInterval:Number(ss.telegramCommandInterval||5),uiScale:ss.uiScale||0.9,textScale:ss.textScale||1,autoRefresh:Number(ss.autoRefresh||0)});
}

async function saveOverviewStyle(kind){
  const id=kind==='site'?'siteOverviewStyle':'deviceOverviewStyle';
  const value=$(id)?.value||'line';
  state.settings=state.settings||{};
  state.settings[kind==='site'?'siteOverviewStyle':'deviceOverviewStyle']=value;
  setSavedOverviewStyle(kind,value);
  renderGraphs();
  await saveSettingsSilent();
}

async function saveQuickInterval(kind){
  const id=kind==='site'?'siteIntervalQuick':'deviceIntervalQuick';
  const input=$(id);
  const value=Math.round(Number(input?.value));
  if(!Number.isFinite(value)||value<1||value>86400){
    alert('Укажи интервал от 1 до 86400 секунд');
    if(input)input.value=Number((state.settings||{})[kind==='site'?'siteInterval':'deviceInterval']||30);
    return;
  }
  state.settings=state.settings||{};
  state.settings[kind==='site'?'siteInterval':'deviceInterval']=value;
  state.settings.interval=Math.min(Number(state.settings.siteInterval||value),Number(state.settings.deviceInterval||value));
  await saveSettingsSilent();
  if($('setSiteInterval'))$('setSiteInterval').value=state.settings.siteInterval;
  if($('setDeviceInterval'))$('setDeviceInterval').value=state.settings.deviceInterval;
}

function exportConfig(){
  let blob=new Blob([JSON.stringify(state,null,2)],{type:'application/json'});
  let a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='monitoring_config.json';a.click();URL.revokeObjectURL(a.href);
}
$('autoSel').onchange=async()=>{let val=$('autoSel').value;if(val==='custom'){openAutoModal();return}await saveAutoRefresh(Number(val))};
const renderBase=render;
render=function(){
  const language=(state.settings&&state.settings.language)||I18N.saved();
  I18N.set(language);
  renderBase();
  I18N.apply();
};
function pad2(n){return String(n).padStart(2,'0')}
function updateSideClock(){let d=new Date(),en=I18N.current()==='en';$('clock').textContent=d.toLocaleTimeString(en?'en-US':'ru-RU');if($('sideDate'))$('sideDate').textContent=en?d.toLocaleDateString('en-US'):pad2(d.getDate())+'.'+pad2(d.getMonth()+1)+'.'+d.getFullYear();let m=Math.floor((Date.now()-appStartedAt)/60000),h=Math.floor(m/60);m=m%60;if($('uptimeSide'))$('uptimeSide').textContent=h?(en?`${h}h ${m}m`:`${h}ч ${m}м`):(en?`${m}m`:`${m}м`)}
setInterval(updateSideClock,1000);updateSideClock();load();


async function importConfigFile(input){
  let file=input.files&&input.files[0];
  if(!file)return;
  let text=await file.text();
  let data;
  try{data=JSON.parse(text)}catch(e){alert('Файл не похож на JSON-конфигурацию');return;}
  if(!confirm('Импортировать конфигурацию? Текущие сайты, устройства, графики и история будут заменены.'))return;
  await api('/api/import/config',data);
  input.value='';
  await load();
  alert('Конфигурация импортирована.');
}

organizeSettingsColumns();
hookFormDirtyFlags();
I18N.startObserver();
