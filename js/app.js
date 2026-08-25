window.addEventListener('hashchange',()=>{ if(location.hash==='#notify') location.hash='#events'; });
let state={sites:[],routers:[],history:[],events:[],graphs:[],settings:{},topology:{nodes:[],edges:[]}};let autoTimer=null;let autoTimerValue=null;let appStartedAt=Date.now();let settingsSaveInFlight=0;let settingsProtectUntil=0;let loadInFlight=false;let loadQueued=false;let graphHistoryCache={};let graphHistoryLoading={};const $=id=>document.getElementById(id);
const APP_TITLE='MoonFox monitor';
const APP_SUBTITLE='Следит за системой, пока ты спишь.';
const OVERVIEW_SETTING_KEYS=['siteOverviewStyle','deviceOverviewStyle','siteOverviewGraphId','deviceOverviewGraphId','siteOverviewRangeMinutes','deviceOverviewRangeMinutes','siteOverviewYMax','deviceOverviewYMax'];
const SERVICE_TYPES={
  website:{label:'Обычный сайт',path:'/'},
  jellyfin:{label:'Jellyfin',path:'/System/Info/Public'},
  nextcloud:{label:'Nextcloud',path:'/status.php'},
  homeassistant:{label:'Home Assistant',path:'/api/'},
  grafana:{label:'Grafana',path:'/api/health'},
  prometheus:{label:'Prometheus',path:'/-/healthy'}
};
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
function pauseButton(kind,x){
  let paused=!!x.paused||x.status==='PAUSED';
  return `<button class="miniAction pauseButton" onclick="togglePause('${kind}','${x.id}',${paused?'false':'true'})">${paused?tr('Возобновить'):tr('Пауза')}</button>`;
}
async function togglePause(kind,id,paused){
  await api(kind==='site'?'/api/site/pause':'/api/router/pause',{id,paused:!!paused});
  await load();
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
  return active && ['settings','sites','routers','graphs','map'].includes(active.id);
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
  if(e.key==='Escape'&&$('confirmActionModal')?.classList.contains('show'))resolveConfirmAction(false);
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
// For interpolating a value into a single-quoted JS string literal that itself sits inside an
// inline event handler attribute, e.g. onclick="fn('${jsAttr(id)}')". esc() alone is NOT enough
// there: the browser decodes HTML entities in an attribute value BEFORE treating it as JS source,
// so esc()'s "'" -> "&#39;" round-trips right back into a literal quote and still breaks out of
// the JS string. Escaping the backslash/quote for the JS-string layer first, then esc() for the
// HTML-attribute layer, closes that off. IDs are normally generated safely by this app itself
// (new_id()/mapNewId()), but imported config JSON can carry attacker-chosen ids, so anywhere an
// id reaches an inline handler needs this rather than plain esc().
function jsAttr(s){return esc(String(s??'').replace(/\\/g,'\\\\').replace(/'/g,"\\'"))}
function statusText(s){return tr(s==='OK'?'🟢 Доступен':s==='SLOW'?'🟡 Медленно':s==='BAD'?'🔴 Недоступен':s==='PAUSED'?'⏸️ Пауза':'Ожидает проверки')}function statusClass(s){return s==='OK'?'statusOK':s==='SLOW'?'statusSLOW':s==='BAD'?'statusBAD':s==='PAUSED'?'statusWAIT':'statusWAIT'}function portStatusText(x){if(!x.port)return '—';return tr(x.portOk?'🟢 Открыт':'🔴 Закрыт')}function checkTypeText(x){return tr(x==='tcp'?'TCP-порт':x==='both'?'Ping + TCP':'Ping')}
function serviceTypeText(x){return tr((SERVICE_TYPES[x]||SERVICE_TYPES.website).label)}
function serviceCheckPath(x){return (SERVICE_TYPES[x]||SERVICE_TYPES.website).path}
const pageNames={overview:['Обзор','Общая панель состояния мониторинга'],sites:['Сайты','Редактирование и проверка сайтов'],routers:['Устройства','Ping-проверка роутеров, серверов, NAS, ПК и IP-узлов'],graphs:['Графики','Отдельные окна графиков мониторинга'],map:['Карта сети','Схема сети в стиле эмулятора с узлами и соединениями'],events:['События','История последних проверок'],settings:['Настройки','Название, внешний вид, проверки и уведомления'],help:['','']};
function activePageId(){return document.querySelector('.page.active')?.id||'overview'}
function showPage(id){
  let prevActive=document.querySelector('.page.active');
  // settingsDirty AND editLock are both set by the same input/change listener the moment you
  // touch any field in #settings (see hookFormDirtyFlags()), and neither is ever cleared except
  // by a successful save (saveSettings()). Leaving the Settings page any other way (clicking
  // another nav item without saving) used to leave shouldProtectForms() permanently true -
  // silently freezing the Settings form (renderSettings() kept getting skipped) on every future
  // visit, even after a fresh load or a change made from another tab/the Telegram bot. Treat
  // navigating away unsaved as discarding the edit. unlockEdit() is safe to call unconditionally
  // here: a modal overlay covers the whole page while shown, so the user couldn't have clicked a
  // nav button to get here in the first place if editLock were legitimately held by an open modal.
  if(prevActive&&prevActive.id==='settings'&&id!=='settings'){settingsDirty=false;unlockEdit()}
  document.querySelectorAll('.page').forEach(x=>x.classList.remove('active'));$(id).classList.add('active');document.querySelectorAll('.nav').forEach(x=>x.classList.toggle('active',x.dataset.page===id));$('pageTitle').textContent=tr(pageNames[id][0]);$('pageDesc').textContent=tr(pageNames[id][1]);if(id==='overview'||id==='graphs')setTimeout(renderGraphs,0);if(id==='overview')setTimeout(renderTables,0);if(id==='map')setTimeout(renderMap,0)}
document.querySelectorAll('.nav').forEach(b=>b.onclick=()=>showPage(b.dataset.page));
function keepLocalOverviewSettings(nextState){
  if((!settingsSaveInFlight&&Date.now()>settingsProtectUntil)||!nextState||!nextState.settings)return nextState;
  let local=state.settings||{};
  OVERVIEW_SETTING_KEYS.forEach(k=>{
    if(Object.prototype.hasOwnProperty.call(local,k))nextState.settings[k]=local[k];
  });
  return nextState;
}
async function load(){
  if(loadInFlight){loadQueued=true;return}
  loadInFlight=true;
  try{
    state=keepLocalTopology(keepLocalOverviewSettings(await api('/api/state')));
    render();
  }finally{
    loadInFlight=false;
    if(loadQueued){loadQueued=false;setTimeout(load,0)}
  }
}
async function checkNow(){state=keepLocalTopology(keepLocalOverviewSettings(await api('/api/check')));render()}
function isProblem(x){return x&&x.status&&(x.status==='BAD'||x.status==='SLOW')}
function calcUptime(kind,obj){let h=(state.history||[]).filter(x=>x.kind===kind&&(x.objectId?x.objectId===obj.id:x.name===obj.name));if(!h.length)return '—';let ok=h.filter(x=>x.ok).length;return ((ok/h.length)*100).toFixed(1)+'%'}


function eventKind(e){
  // Event text is always generated as `Сайт "<name>"/Site "<name>" ...` or
  // `Устройство "<name>"/Device "<name>" ...` (see moonfox_server.py) - matching anywhere in
  // the string with .includes() used to misfire on the object's OWN name: a device named
  // e.g. "off-site-cam" or "Site-2-NAS" contains "site", so it got filed as a site event
  // instead of a device event. Only the fixed leading word actually indicates the kind.
  let t=String(e.text||e.message||'').toLowerCase().trim();
  if(/^(сайт|site)\b/.test(t)) return 'site';
  if(/^(устройство|device)\b/.test(t)) return 'device';
  return 'other';
}
function renderMiniEventList(id, items){
  let el=$(id);
  if(!el)return;
  let html=(items||[]).slice(0,5).map(e=>`<div class="event ${e.level||'ok'}"><b>${esc(formatEventDateTime(e))}</b> ${esc(eventText(e.text||e.message||''))} <small>${levelName(e.level||'ok')}</small></div>`).join('');
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
function render(){let s=state.settings||{};s.siteOverviewStyle=getSavedOverviewStyle('site')||s.siteOverviewStyle||'line';s.deviceOverviewStyle=getSavedOverviewStyle('device')||s.deviceOverviewStyle||'line';ensureAutoOption(Number(s.autoRefresh||0));$('autoSel').value=String(Number(s.autoRefresh||0));startAutoRefresh(Number(s.autoRefresh||0));$('brandSub').textContent=APP_SUBTITLE;document.title=APP_TITLE;if($('siteOverviewStyle'))$('siteOverviewStyle').value=s.siteOverviewStyle;if($('deviceOverviewStyle'))$('deviceOverviewStyle').value=s.deviceOverviewStyle;if($('sitePreviewCount'))$('sitePreviewCount').value=String(previewCount('site'));if($('devicePreviewCount'))$('devicePreviewCount').value=String(previewCount('device'));let sites=state.sites||[],routers=state.routers||[];let siteOk=sites.filter(x=>x.status==='OK').length,routerOk=routers.filter(x=>x.status==='OK').length;let siteWarn=sites.filter(x=>x.status==='SLOW').length,routerWarn=routers.filter(x=>x.status==='SLOW').length;let siteAvailable=siteOk+siteWarn,deviceAvailable=routerOk+routerWarn;let total=sites.length+routers.length,availableTotal=siteAvailable+deviceAvailable;let siteAvailability=sites.length?Math.round((siteAvailable/sites.length)*100):null,deviceAvailability=routers.length?Math.round((deviceAvailable/routers.length)*100):null;let siteProblems=sites.filter(isProblem).length,deviceProblems=routers.filter(isProblem).length;let problemObjects=[...sites,...routers].filter(isProblem);let problems=problemObjects.length;let activeNotices=[...sites.filter(isProblem).map(x=>({time:x.checked||'',text:`Сайт «${x.name}»: ${statusText(x.status)}`})),...routers.filter(isProblem).map(x=>({time:x.checked||'',text:`Устройство «${x.name}»: ${statusText(x.status)}`}))];let checked=[...sites,...routers].map(x=>x.checked).filter(x=>x&&x!=='-'&&x!=='—');let lastCheck=checked.length?checked[checked.length-1]:'—';let resp=sites.filter(x=>(x.status==='OK'||x.status==='SLOW')&&Number(x.response)>0).map(x=>Number(x.response));let avg=resp.length?Math.round(resp.reduce((a,b)=>a+b,0)/resp.length):0;let availability=total?Math.round((availableTotal/total)*100):0;$('stSites').textContent=sites.length;$('stSitesOk').textContent='Онлайн: '+siteOk+(siteWarn?`, медленно: ${siteWarn}`:'');$('stRouters').textContent=routers.length;$('stRoutersOk').textContent='Доступно: '+routerOk+(routerWarn?`, медленно: ${routerWarn}`:'');$('stProblems').textContent=problems;if($('stSiteProblems'))$('stSiteProblems').textContent='Сайты: '+siteProblems;if($('stDeviceProblems'))$('stDeviceProblems').textContent='Устройства: '+deviceProblems;if($('problemsFox'))$('problemsFox').src=problems>0?'/assets/fox-problems-bad.png':'/assets/fox-problems-ok.png';if($('stCritical'))$('stCritical').textContent=[...sites,...routers].filter(x=>x.status==='BAD').length;$('stAvailability').textContent=total?availability+'%':'—';if($('availabilityFox'))$('availabilityFox').src=availabilityFoxSource(availability,total);if($('stSiteAvailability'))$('stSiteAvailability').textContent='Сайты: '+(siteAvailability===null?'—':siteAvailability+'%');if($('stDeviceAvailability'))$('stDeviceAvailability').textContent='Устройства: '+(deviceAvailability===null?'—':deviceAvailability+'%');$('stAvgResp').textContent=avg?avg+' мс':'—';$('stLastCheck').textContent='Проверка: '+lastCheck;if($('stLastUpdateCard'))$('stLastUpdateCard').textContent=lastCheck==='—'?'—':lastCheck;if($('stNotify'))$('stNotify').textContent=problems;if($('lastCheckSide'))$('lastCheckSide').textContent=lastCheck;let badEvents=(state.events||[]).filter(e=>e.level==='bad'||e.level==='warn');if($('stLastProblemTime')){$('stLastProblemTime').textContent=badEvents[0]?badEvents[0].time:'Нет';$('stLastProblemText').textContent=badEvents[0]?eventText(badEvents[0].text):'Нет проблем'}try{renderNotifyPanel(activeNotices)}catch(e){console.error(e)};applyScale();applyTheme();renderTables();renderEvents();renderMiniEventsSplit();if(!shouldProtectForms())renderSettings();if(!isModalOpen())renderGraphs();if(!mapDragging&&!isModalOpen())renderMap();try{renderEventPreview()}catch(e){console.error(e)}}

function applyScale(){
  let s=state.settings||{};
  document.documentElement.style.setProperty('--ui-scale', String(s.uiScale||0.72));
  document.documentElement.style.setProperty('--text-scale', String(s.textScale||0.82));
}
function table(rows,heads){return `<table class="table"><thead><tr>${heads.map(h=>`<th>${h}</th>`).join('')}</tr></thead><tbody>${rows||''}</tbody></table>`}
function sslSummary(x){let s=x&&x.ssl;if(!s)return '—';if(!s.ok)return `<span class="statusBAD">${esc(s.error||'Ошибка SSL')}</span>`;let cls=Number(s.daysLeft)<=14?'statusBAD':Number(s.daysLeft)<=30?'statusSLOW':'statusOK';return `<span class="${cls}">${esc(s.validTo)} (${Number(s.daysLeft)} дн.)</span>`}
function compactSslSummary(x){let s=x&&x.ssl;if(!s)return '—';if(!s.ok)return `<span class="statusBAD previewEllipsis" title="${esc(s.error||'Ошибка SSL')}">Ошибка</span>`;let cls=Number(s.daysLeft)<=14?'statusBAD':Number(s.daysLeft)<=30?'statusSLOW':'statusOK';return `<span class="${cls}" title="${esc(s.issuer||'')}">${Number(s.daysLeft)} дн.</span>`}
function compactDnsSummary(x){let dns=x.dns||[];return dns.length?`<span class="previewEllipsis" title="${esc(dns.join(', '))}">${esc(dns[0])}${dns.length>1?' +'+(dns.length-1):''}</span>`:'—'}
function pingSummary(x){if(x&&x.pingSynthetic)return '<span class="statusSLOW" title="DNS использует Fake-IP 198.18.0.0/15">через прокси</span>';let ms=Number(x&&x.ping||0);return ms===0?'<span title="Ответ быстрее 1 миллисекунды">&lt;1 мс</span>':ms+' мс'}
function portsSummary(x){let results=x.portResults||[];if(results.length)return results.map(p=>`<span class="${p.open?'statusOK':'statusBAD'}">${p.port}</span>`).join(', ');let ports=(x.ports&&x.ports.length?x.ports:[x.port].filter(Boolean));return ports.length?ports.join(', '):'—'}
// `width` below is a relative WEIGHT, not a literal percentage - previewTable()
// re-normalizes the weights of whichever columns are actually visible so they
// always add up to exactly 100%. A table-layout:fixed table hands any width left
// unclaimed by the declared columns to the last column, so with a static % per
// column that only summed to 100% for one particular set of visible columns,
// picking a different column set (the default trimmed set, "Колонки" with extras
// re-enabled, etc.) always left the "Действия" column either starved (buttons
// clipped) or overfed (a dead gap after the buttons) - normalizing at render time
// fixes both.
const previewColumnDefs={
  site:[
    {key:'name',title:'Название',width:30,required:true,cell:x=>`<span class="previewName"><span class="colorDot" style="background:${esc(x.color||'#35f0ff')}"></span><span class="previewEllipsis" title="${esc(x.url)}">${esc(x.name)}</span></span>`},
    {key:'status',title:'Статус',width:17,cell:x=>`<span class="${statusClass(x.status)}">${statusText(x.status)}</span>`},
    {key:'http',title:'HTTP',width:10,cell:x=>`${x.response||0} мс`},
    {key:'ping',title:'Ping',width:13,cell:x=>pingSummary(x)},
    {key:'dns',title:'DNS',width:14,cell:x=>compactDnsSummary(x)},
    {key:'ssl',title:'SSL',width:9,cell:x=>compactSslSummary(x)},
    {key:'actions',title:'Действия',width:28,cell:(x,i,all)=>`<div class="previewRowActions"><button class="miniAction" onclick="openDiagnosticModal('site','${x.id}')">Диагностика</button>${pauseButton('site',x)}${orderButtons('site',x.id,i,all.length)}${previewDeleteButton('site',x.id)}</div>`}
  ],
  device:[
    {key:'name',title:'Название',width:28,required:true,cell:x=>`<span class="previewName"><span class="colorDot" style="background:${esc(x.color||'#7c5cff')}"></span><span class="previewEllipsis" title="${esc(x.address)}">${esc(x.name)}</span></span>`},
    {key:'address',title:'Адрес',width:17,cell:x=>esc(x.address)},
    {key:'status',title:'Статус',width:17,cell:x=>`<span class="${statusClass(x.status)}">${statusText(x.status)}</span>`},
    {key:'ping',title:'Ping',width:10,cell:x=>`${x.ping||0} мс`},
    {key:'ports',title:'Порты',width:10,cell:x=>portsSummary(x)},
    {key:'actions',title:'Действия',width:34,cell:(x,i,all)=>`<div class="previewRowActions"><button class="miniAction" onclick="openDiagnosticModal('router','${x.id}')">Диагностика</button>${pauseButton('router',x)}${orderButtons('router',x.id,i,all.length)}${previewDeleteButton('router',x.id)}</div>`}
  ]
};
function previewColumnStorageKey(kind){return 'moonfox_preview_columns_'+kind}
// Showing every column by default crammed the compact overview cards (two per row,
// roughly half the page width each) so tightly that the "Действия" column - the
// buttons themselves - regularly got pushed out of view with no visible scrollbar
// hint. DNS/SSL/HTTP/Порты are still one click away in "Колонки" or the full
// Диагностика dialog, so trim the *default* selection to what fits comfortably;
// anyone who already customized their columns keeps their own saved choice.
const DEFAULT_PREVIEW_COLUMNS={site:['name','status','ping','actions'],device:['name','address','status','ping','actions']};
function defaultPreviewColumnKeys(kind){
  let curated=(DEFAULT_PREVIEW_COLUMNS[kind]||[]).filter(k=>(previewColumnDefs[kind]||[]).some(d=>d.key===k));
  return curated.length?curated:previewColumnDefs[kind].map(x=>x.key);
}
function previewColumnKeys(kind){
  let defs=previewColumnDefs[kind]||[];
  let fallback=defaultPreviewColumnKeys(kind);
  try{
    let saved=JSON.parse(localStorage.getItem(previewColumnStorageKey(kind))||'null');
    if(Array.isArray(saved)&&saved.length)fallback=saved;
  }catch(e){}
  let valid=new Set(defs.map(x=>x.key));
  let keys=fallback.filter(x=>valid.has(x));
  defs.filter(x=>x.required&&!keys.includes(x.key)).forEach(x=>keys.unshift(x.key));
  return keys.length?keys:defaultPreviewColumnKeys(kind);
}
function setPreviewColumn(kind,key,checked){
  let defs=previewColumnDefs[kind]||[],required=defs.find(x=>x.key===key)?.required;
  let keys=previewColumnKeys(kind);
  if(required)return;
  keys=checked?[...new Set([...keys,key])]:keys.filter(x=>x!==key);
  localStorage.setItem(previewColumnStorageKey(kind),JSON.stringify(keys));
  renderTables();
}
function movePreviewColumn(kind,key,dir){
  let defs=previewColumnDefs[kind]||[],valid=new Set(defs.map(x=>x.key));
  let keys=previewColumnKeys(kind).filter(x=>valid.has(x));
  let i=keys.indexOf(key),j=i+dir;
  if(i<0||j<0||j>=keys.length)return;
  [keys[i],keys[j]]=[keys[j],keys[i]];
  localStorage.setItem(previewColumnStorageKey(kind),JSON.stringify(keys));
  renderTables();
}
function previewTable(kind,items){
  let defs=previewColumnDefs[kind]||[],keys=previewColumnKeys(kind);
  let cols=keys.map(k=>defs.find(d=>d.key===k)).filter(Boolean);
  // Normalize weights of the columns actually visible so they always sum to 100%,
  // regardless of which optional columns the user shows/hides via "Колонки" - see
  // the comment on previewColumnDefs for why a static per-column % breaks this.
  let totalWeight=cols.reduce((s,c)=>s+(Number(c.width)||1),0)||1;
  let colgroup='<colgroup>'+cols.map(c=>`<col style="width:${((Number(c.width)||1)/totalWeight*100).toFixed(2)}%">`).join('')+'</colgroup>';
  let heads=cols.map(c=>`<th>${tr(c.title)}</th>`).join('');
  let rows=items.map((x,i)=>`<tr>${cols.map(c=>`<td>${c.cell(x,i,items)}</td>`).join('')}</tr>`).join('');
  return `<table class="table previewTable ${kind==='site'?'sitePreviewTable':'devicePreviewTable'}">${colgroup}<thead><tr>${heads}</tr></thead><tbody>${rows}</tbody></table>`;
}
// The normalized weights above give "Действия" a sensible SHARE of the table,
// but a share still grows with the table's own width - on a wide/undocked
// window the column can end up much bigger than the buttons actually need,
// which is exactly the "too much empty space after the buttons" complaint.
// Buttons have a fixed, deterministic pixel footprint (same font/padding on
// every row), so once the table is actually in the DOM we measure that real
// footprint and pin the "Действия" column to it in pixels, handing whatever
// width that frees up to the other columns instead of leaving it empty.
function tuneActionsColumnWidth(containerId){
  let container=$(containerId);
  if(!container)return;
  let tableEl=container.querySelector('table');
  if(!tableEl)return;
  let cols=[...tableEl.querySelectorAll('colgroup col')];
  let ths=[...tableEl.querySelectorAll('thead th')];
  let actionsIdx=ths.findIndex(th=>th.textContent.trim()===tr('Действия'));
  if(actionsIdx<0||!cols[actionsIdx])return;
  let rows=[...tableEl.querySelectorAll('tbody tr')];
  if(!rows.length)return;
  let tableWidth=tableEl.getBoundingClientRect().width;
  if(tableWidth<100)return; // table isn't actually visible right now (hidden page) - nothing reliable to measure
  let maxContent=0;
  rows.forEach(row=>{
    let td=row.children[actionsIdx];
    let inner=td&&td.querySelector('.previewRowActions');
    if(!inner||!inner.children.length)return;
    let tdRect=td.getBoundingClientRect();
    let lastRect=inner.children[inner.children.length-1].getBoundingClientRect();
    let contentWidth=lastRect.right-tdRect.left;
    if(contentWidth>maxContent)maxContent=contentWidth;
  });
  if(!maxContent)return;
  let desiredPx=Math.ceil(maxContent+14);
  let desiredPercent=Math.min(60,Math.max(5,desiredPx/tableWidth*100));
  let currentPercents=cols.map(c=>parseFloat(c.style.width)||0);
  let othersSum=currentPercents.reduce((s,v,i)=>i===actionsIdx?s:s+v,0)||1;
  let remaining=100-desiredPercent;
  cols.forEach((c,i)=>{
    c.style.width=(i===actionsIdx?desiredPercent:currentPercents[i]/othersSum*remaining).toFixed(2)+'%';
  });
}
function renderColumnPickers(){
  ['site','device'].forEach(kind=>{
    let box=$(kind==='site'?'siteColumnPicker':'deviceColumnPicker');if(!box)return;
    let selected=new Set(previewColumnKeys(kind));
    let ordered=previewColumnKeys(kind).map(k=>(previewColumnDefs[kind]||[]).find(c=>c.key===k)).filter(Boolean);
    let hidden=(previewColumnDefs[kind]||[]).filter(c=>!selected.has(c.key));
    let cols=[...ordered,...hidden];
    box.innerHTML=cols.map((c,i)=>{
      let visible=selected.has(c.key);
      return `<div class="columnPickerRow"><label><input type="checkbox" ${visible?'checked':''} ${c.required?'disabled':''} onchange="setPreviewColumn('${kind}','${c.key}',this.checked)"> ${tr(c.title)}</label><div class="columnMoveActions"><button type="button" class="orderButton" ${!visible||i===0?'disabled':''} onclick="movePreviewColumn('${kind}','${c.key}',-1)">↑</button><button type="button" class="orderButton" ${!visible||i>=ordered.length-1?'disabled':''} onclick="movePreviewColumn('${kind}','${c.key}',1)">↓</button></div></div>`;
    }).join('');
  });
}
function toggleColumnPicker(event,kind){
  if(event)event.stopPropagation();
  renderColumnPickers();
  let id=kind==='site'?'siteColumnPicker':'deviceColumnPicker';
  let other=kind==='site'?'deviceColumnPicker':'siteColumnPicker';
  if($(other))$(other).classList.remove('show');
  if($(id))$(id).classList.toggle('show');
}
document.addEventListener('click',e=>{
  if(e.target.closest&&e.target.closest('.columnPicker, .columnPickerButton'))return;
  document.querySelectorAll('.columnPicker.show').forEach(x=>x.classList.remove('show'));
});
renderTables=function(){
  let sites=state.sites||[],routers=state.routers||[];
  let siteRows=sites.map((x,i)=>`<tr><td><span class="colorDot" style="background:${esc(x.color||'#35f0ff')}"></span>${esc(x.name)}</td><td>${esc(x.url)}</td><td>${serviceTypeText(x.serviceType||'website')} <span class="muted">${esc(x.checkPath||serviceCheckPath(x.serviceType))}</span></td><td class="${statusClass(x.status)}">${statusText(x.status)}</td><td>${x.code||0}</td><td>${x.response||0} мс</td><td>${pingSummary(x)}</td><td>${esc((x.dns||[]).join(', ')||'—')}</td><td>${sslSummary(x)}</td><td>${calcUptime('site',x)}</td><td><div class="rowActions wrap">${orderButtons('site',x.id,i,sites.length)}${pauseButton('site',x)}<button class="edit" onclick="openDiagnosticModal('site','${x.id}')">Диагностика</button><button class="edit" onclick="editSite('${x.id}')">Редактировать</button><button class="del" onclick="delSite('${x.id}')">Удалить</button></div></td></tr>`).join('');
  if($('sitesTable'))$('sitesTable').innerHTML=table(siteRows,['Название','URL','Проверка','Статус','HTTP','Ответ','Ping','DNS','SSL','Аптайм','Действия']);
  if($('sitePreview')){$('sitePreview').innerHTML=previewTable('site',sites.slice(0,previewCount('site')));tuneActionsColumnWidth('sitePreview')}
  let routerRows=routers.map((x,i)=>`<tr><td><span class="colorDot" style="background:${esc(x.color||'#7c5cff')}"></span>${esc(x.name)}</td><td>${esc(x.address)}</td><td>${portsSummary(x)}</td><td>${checkTypeText(x.checkType)}</td><td class="${statusClass(x.status)}">${statusText(x.status)}</td><td>${x.ping||0} мс</td><td>${calcUptime('router',x)}</td><td><div class="rowActions wrap">${orderButtons('router',x.id,i,routers.length)}${pauseButton('router',x)}<button class="edit" onclick="openDiagnosticModal('router','${x.id}')">Диагностика</button><button class="edit" onclick="editRouter('${x.id}')">Редактировать</button><button class="del" onclick="delRouter('${x.id}')">Удалить</button></div></td></tr>`).join('');
  if($('routersTable'))$('routersTable').innerHTML=table(routerRows,['Название','Адрес','Порты','Проверка','Статус','Ping','Аптайм','Действия']);
  if($('routerPreview')){$('routerPreview').innerHTML=previewTable('device',routers.slice(0,previewCount('device')));tuneActionsColumnWidth('routerPreview')}
  renderColumnPickers();
}
let previewResizeTimer=null;
window.addEventListener('resize',()=>{
  clearTimeout(previewResizeTimer);
  previewResizeTimer=setTimeout(()=>{tuneActionsColumnWidth('sitePreview');tuneActionsColumnWidth('routerPreview')},150);
});
function eventText(t){return tr(String(t||'').replace(/^Site /,'Сайт ').replace(/^Device /,'Устройство ').replace(/ available \(\d+\)/,' доступен').replace(/ available/,' доступен').replace(/ unavailable/,' недоступен'))}
function levelName(l){return tr(l==='bad'?'Ошибка':l==='warn'?'Предупреждение':l==='recovered'?'Восстановлено':'Инфо')}
function formatEventDateTime(e){
  if(e&&e.date)return String(e.date);
  if(e&&e.ts){let d=new Date(e.ts);if(!isNaN(d))return d.toLocaleDateString(I18N.current()==='en'?'en-US':'ru-RU')+' '+d.toLocaleTimeString(I18N.current()==='en'?'en-US':'ru-RU',{hour12:false})}
  if(e&&e.time){let d=new Date();return pad2(d.getDate())+'.'+pad2(d.getMonth()+1)+'.'+d.getFullYear()+' '+e.time}
  return '—';
}
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
  let html=ev.slice(0,300).map(e=>`<div class="event ${e.level||'ok'}"><b>${esc(formatEventDateTime(e))}</b> ${esc(eventText(e.text))} <small>${levelName(e.level||'ok')}</small></div>`).join('');
  $('eventsList').innerHTML=html||'<p>Событий за выбранный период нет.</p>';
}
async function clearEvents(){
  if(!await confirmAction({title:'Очистить события?',text:'Журнал событий будет очищен.',hint:'Сайты, устройства и настройки останутся без изменений.',okText:'Очистить',danger:true,icon:'!'}))return;
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
  if($('setHistoryRetentionMode'))$('setHistoryRetentionMode').value=s.historyRetentionMode||'days';
  if($('setHistoryRetentionDays'))$('setHistoryRetentionDays').value=String(Number(s.historyRetentionDays||7));
  if($('setHistoryMaxRecords'))$('setHistoryMaxRecords').value=Number(s.historyMaxRecords||10000);
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
  if($('setTelegramEnabled'))$('setTelegramEnabled').checked=s.telegramEnabled!==false;
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
async function addSite(){let name=$('siteName').value.trim(),url=$('siteUrl').value.trim(),color=$('siteColor').value||'#35f0ff',serviceType=$('siteServiceType')?$('siteServiceType').value:'website';if(!name||!url)return alert('Заполни название и URL сайта');await api('/api/site/add',{name,url,color,serviceType});$('siteName').value='';$('siteUrl').value='';if($('siteServiceType'))$('siteServiceType').value='website';await load()}
function editSite(id){let x=state.sites.find(a=>a.id===id);if(!x)return;$('siteEditId').value=x.id;$('siteEditName').value=x.name||'';$('siteEditUrl').value=x.url||'';if($('siteEditServiceType'))$('siteEditServiceType').value=x.serviceType||'website';$('siteEditColor').value=x.color||'#35f0ff';if($('siteEditPaused'))$('siteEditPaused').checked=!!x.paused;lockEdit();$('siteModal').classList.add('show')}
function closeSiteModal(){unlockEdit();$('siteModal').classList.remove('show')}
let confirmActionResolve=null;
function ensureConfirmActionModal(){
  if($('confirmActionModal'))return;
  let modal=document.createElement('div');
  modal.className='modal confirmDeleteModal';
  modal.id='confirmActionModal';
  modal.innerHTML=`<div class="modalBox small confirmDeleteBox" role="dialog" aria-modal="true" aria-labelledby="confirmActionTitle">
    <div id="confirmActionIcon" class="confirmDeleteIcon">!</div>
    <h3 id="confirmActionTitle">Подтвердите действие</h3>
    <p id="confirmActionText" class="confirmDeleteText"></p>
    <p id="confirmActionHint" class="hint"></p>
    <div class="modalActions confirmDeleteActions"><button type="button" onclick="resolveConfirmAction(false)">Отмена</button><button type="button" id="confirmActionOk" class="danger" onclick="resolveConfirmAction(true)">Подтвердить</button></div>
  </div>`;
  modal.onclick=e=>{if(e.target===modal)resolveConfirmAction(false)};
  document.body.appendChild(modal);
  I18N.apply(modal);
}
function resolveConfirmAction(ok){
  let modal=$('confirmActionModal');
  if(modal)modal.classList.remove('show');
  unlockEdit();
  if(confirmActionResolve){let done=confirmActionResolve;confirmActionResolve=null;done(!!ok)}
}
function confirmAction(opts={}){
  ensureConfirmActionModal();
  $('confirmActionTitle').textContent=tr(opts.title||'Подтвердите действие');
  $('confirmActionText').innerHTML=opts.html||esc(opts.text||'');
  $('confirmActionHint').textContent=tr(opts.hint||'');
  $('confirmActionHint').style.display=opts.hint?'':'none';
  $('confirmActionIcon').textContent=opts.icon||'!';
  let ok=$('confirmActionOk');
  ok.textContent=tr(opts.okText||'Подтвердить');
  ok.classList.toggle('danger',opts.danger!==false);
  let cancel=$('confirmActionModal').querySelector('.confirmDeleteActions button:first-child');
  if(cancel)cancel.style.display=opts.hideCancel?'none':'';
  lockEdit();$('confirmActionModal').classList.add('show');
  // The confirm dialog is a single shared modal with one resolver slot. Without this, opening
  // a second confirmation (e.g. clicking "Удалить" on another row before answering the first)
  // would silently overwrite confirmActionResolve, leaving the FIRST caller's `await` promise
  // pending forever - no error, no timeout, just a permanently stuck confirm() call. Resolve
  // any still-pending one as a cancel before handing out a new resolver.
  if(confirmActionResolve){let prev=confirmActionResolve;confirmActionResolve=null;prev(false)}
  return new Promise(resolve=>{confirmActionResolve=resolve});
}
function showMessage(opts={}){
  return confirmAction({title:opts.title||'MoonFox monitor',text:opts.text||'',html:opts.html,hint:opts.hint||'',okText:opts.okText||'OK',danger:false,icon:opts.icon||'✓',hideCancel:true});
}
function confirmDelete(kind,name){
  let isDevice=kind==='device';
  let objectLabel=tr(isDevice?'Устройство':'Сайт');
  return confirmAction({
    title:isDevice?'Удалить устройство?':'Удалить сайт?',
    html:`${objectLabel} <b>${esc(name||'')}</b> ${tr('будет удалён из MoonFox monitor.')}`,
    hint:'Объект будет удалён из списка мониторинга. История по нему тоже очистится.',
    okText:'Удалить',
    danger:true,
    icon:'!'
  });
}
async function saveSiteFromModal(){let id=$('siteEditId').value,name=$('siteEditName').value.trim(),url=$('siteEditUrl').value.trim(),color=$('siteEditColor').value||'#35f0ff',serviceType=$('siteEditServiceType')?$('siteEditServiceType').value:'website',paused=$('siteEditPaused')?$('siteEditPaused').checked:false;if(!name||!url)return alert('Заполни название и URL сайта');await api('/api/site/update',{id,name,url,color,serviceType,paused});unlockEdit();closeSiteModal();await checkNow()}async function delSite(id){let x=(state.sites||[]).find(a=>a.id===id);if(await confirmDelete('site',x?.name||x?.url||id)){await api('/api/site/delete',{id});await load()}}
// Keep in sync with MAX_PORTS_PER_OBJECT in moonfox_server.py - each port gets its own
// sequential TCP check every cycle, so an unbounded list (a typo'd range, a huge paste) would
// make that device's check take minutes. The server enforces this regardless; capping here too
// means the user sees it happen instead of quietly ending up with fewer saved ports than typed.
const MAX_PORTS_PER_OBJECT=32;
function normalizePorts(value){let parts=String(value||'').split(/[,;\s]+/).filter(Boolean),unique=[...new Set(parts.map(Number).filter(x=>Number.isInteger(x)&&x>=1&&x<=65535))],truncated=unique.length>MAX_PORTS_PER_OBJECT,ports=unique.slice(0,MAX_PORTS_PER_OBJECT);return {ports,valid:parts.length===unique.length,truncated}}
async function addRouter(){let name=$('routerName').value.trim(),address=$('routerAddr').value.trim(),parsed=normalizePorts($('routerPort')?$('routerPort').value:''),checkType=$('routerCheckType')?$('routerCheckType').value:'ping',color=$('routerColor').value||'#7c5cff';if(!name||!address)return alert('Заполни название и IP/адрес');if(!parsed.valid)return alert('Порты должны быть числами от 1 до 65535');if(checkType!=='ping'&&!parsed.ports.length)return alert('Для проверки TCP укажи порт');if(parsed.truncated)alert(`Сохранены только первые ${MAX_PORTS_PER_OBJECT} портов - остальные проигнорированы`);await api('/api/router/add',{name,address,ports:parsed.ports,checkType,color});$('routerName').value='';$('routerAddr').value='';if($('routerPort'))$('routerPort').value='';await load()}
function editRouter(id){let x=state.routers.find(a=>a.id===id);if(!x)return;$('routerEditId').value=x.id;$('routerEditName').value=x.name||'';$('routerEditAddr').value=x.address||'';if($('routerEditPort'))$('routerEditPort').value=(x.ports&&x.ports.length?x.ports:[x.port].filter(Boolean)).join(', ');if($('routerEditCheckType'))$('routerEditCheckType').value=x.checkType||'ping';$('routerEditColor').value=x.color||'#7c5cff';if($('routerEditPaused'))$('routerEditPaused').checked=!!x.paused;lockEdit();$('routerModal').classList.add('show')}
function closeRouterModal(){unlockEdit();$('routerModal').classList.remove('show')}
async function saveRouterFromModal(){let id=$('routerEditId').value,name=$('routerEditName').value.trim(),address=$('routerEditAddr').value.trim(),parsed=normalizePorts($('routerEditPort')?$('routerEditPort').value:''),checkType=$('routerEditCheckType')?$('routerEditCheckType').value:'ping',color=$('routerEditColor').value||'#7c5cff',paused=$('routerEditPaused')?$('routerEditPaused').checked:false;if(!name||!address)return alert('Заполни название и IP/адрес');if(!parsed.valid)return alert('Порты должны быть числами от 1 до 65535');if(checkType!=='ping'&&!parsed.ports.length&&!paused)return alert('Для проверки TCP укажи порт');if(parsed.truncated)alert(`Сохранены только первые ${MAX_PORTS_PER_OBJECT} портов - остальные проигнорированы`);await api('/api/router/update',{id,name,address,ports:parsed.ports,checkType,color,paused});unlockEdit();closeRouterModal();await checkNow()}async function delRouter(id){let x=(state.routers||[]).find(a=>a.id===id);if(await confirmDelete('device',x?.name||x?.address||id)){await api('/api/router/delete',{id});await load()}}
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
    siteWarn,siteCrit,deviceWarn,deviceCrit,historyRetentionMode:$('setHistoryRetentionMode')?$('setHistoryRetentionMode').value:'days',historyRetentionDays:$('setHistoryRetentionDays')?Number($('setHistoryRetentionDays').value||7):7,historyMaxRecords:$('setHistoryMaxRecords')?Number($('setHistoryMaxRecords').value||10000):10000,showMs:$('setMs').checked,autoOpen:$('setOpen').checked,
    telegramEnabled:$('setTelegramEnabled')?$('setTelegramEnabled').checked:true,
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
    siteOverviewGraphId:(state.settings||{}).siteOverviewGraphId||'__default',
    deviceOverviewGraphId:(state.settings||{}).deviceOverviewGraphId||'__default',
    siteOverviewRangeMinutes:Number((state.settings||{}).siteOverviewRangeMinutes||60),
    deviceOverviewRangeMinutes:Number((state.settings||{}).deviceOverviewRangeMinutes||60),
    siteOverviewYMax:Number((state.settings||{}).siteOverviewYMax||0),
    deviceOverviewYMax:Number((state.settings||{}).deviceOverviewYMax||0),
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
  settingsDirty=false;unlockEdit();await load();await showMessage({title:'Настройки сохранены',text:'Если менял порт — перезапусти программу через RUN.cmd.',okText:'OK',icon:'✓'});
}

async function resetTelegramTemplates(){
  if(!await confirmAction({title:'Сбросить тексты Telegram?',text:'Тексты уведомлений будут заменены стандартными шаблонами.',hint:'Токен, chat ID и остальные настройки Telegram не изменятся.',okText:'Сбросить',danger:false,icon:'↺'})) return;
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
  else if(r&&r.error==='Telegram notifications are disabled') alert('Telegram-уведомления выключены.');
  else alert('Не удалось отправить Telegram: ' + ((r&&r.error)?r.error:'проверь токен и chat ID'));
}
function toggleTokenVisibility(){
  let input=$('setToken'),btn=$('toggleTokenBtn');
  if(!input)return;
  let show=input.type==='password';
  input.type=show?'text':'password';
  if(btn)btn.textContent=show?'Скрыть':'Показать';
}
async function testTelegramCommands(){
  let token=$('setToken')?.value.trim(),chat=$('setChat')?.value.trim();
  if(!token||!chat)return alert('Введите Telegram bot token и chat ID.');
  let r=await api('/api/telegram/commands/test',{telegramToken:token,telegramChat:chat});
  if(r&&r.ok)alert('Команды зарегистрированы. Бот отправил список команд в Telegram.');
  else if(r&&r.error==='Telegram notifications are disabled')alert('Telegram-уведомления выключены.');
  else alert('Не удалось проверить команды: '+((r&&r.error)?r.error:'проверьте токен, chat ID и сохраните настройки'));
}
async function checkPortSetting(){let port=Number($('setPort').value);if(!port||port<1024||port>65535)return alert('Порт должен быть от 1024 до 65535');let r=await api('/api/port/check',{port});alert(r.free?'Порт свободен: '+port:'Порт занят: '+port)}
async function clearHistory(){if(await confirmAction({title:'Очистить историю графиков?',text:'История графиков и события будут очищены.',hint:'Список сайтов, устройств, графиков и настройки останутся.',okText:'Очистить',danger:true,icon:'!'})){await api('/api/history/clear',{});await load()}}
function graphUsesDevices(type){return type==='router_ping'||type==='device_availability'}
function graphObjectsForType(type){return graphUsesDevices(type)?(state.routers||[]):(state.sites||[])}
function normalizeObjectIds(ids){return Array.isArray(ids)?ids.filter(Boolean):(ids?[ids]:[])}
function currentGraphObjectIds(){
  return [...document.querySelectorAll('#graphObjectsList input[type="checkbox"]:checked')].map(x=>x.value);
}
function setGraphObjectSelection(checked){
  document.querySelectorAll('#graphObjectsList input[type="checkbox"]').forEach(x=>x.checked=!!checked);
}
function renderGraphObjectPicker(selectedIds){
  let type=$('graphType')?.value||'site_response';
  let objects=graphObjectsForType(type);
  let selected=new Set(normalizeObjectIds(selectedIds||currentGraphObjectIds()));
  if(!objects.some(x=>selected.has(x.id)))selected=new Set(objects.map(x=>x.id));
  if($('graphObjectsLabel'))$('graphObjectsLabel').textContent=graphUsesDevices(type)?'Устройства на графике':'Сайты на графике';
  if(!$('graphObjectsList'))return;
  let fallbackColor=graphUsesDevices(type)?'#7c5cff':'#35f0ff';
  $('graphObjectsList').innerHTML=objects.length?objects.map(x=>`<label class="graphObjectItem"><input type="checkbox" value="${esc(x.id)}" ${selected.has(x.id)?'checked':''}><span class="colorDot" style="background:${esc(x.color||fallbackColor)}"></span><span>${esc(x.name||x.address||x.url||x.id)}</span></label>`).join(''):'<span class="muted">Нет объектов для выбора</span>';
}
function openGraphModal(id){
  let g=id?(state.graphs||[]).find(x=>x.id===id):null;
  $('graphEditId').value=g?g.id:'';
  $('graphModalTitle').textContent=g?'Редактировать график':'Добавить график';
  $('graphSaveBtn').textContent=g?'Сохранить':'Создать график';
  $('graphTitle').value=g?g.title:'';
  $('graphType').value=g?g.type:'site_response';
  $('graphStyle').value=g?(g.style||'line'):'line';
  $('graphHeight').value=g?(g.height||260):260;
  $('graphNote').value=g?(g.note||''):'';
  renderGraphObjectPicker(g&&g.objectIds?g.objectIds:null);
  lockEdit();$('graphModal').classList.add('show')
}

async function resetAllData(){
  if(!await confirmAction({title:'Удалить все данные?',text:'Будут удалены сайты, устройства, графики, события и история.',hint:'Настройки программы останутся. Это действие нельзя отменить.',okText:'Удалить всё',danger:true,icon:'!'})) return;
  await api('/api/reset/all',{});
  await load();
  alert('Все данные мониторинга удалены.');
}

function closeGraphModal(){unlockEdit();$('graphModal').classList.remove('show')}
async function saveGraphFromModal(){
  let id=$('graphEditId').value;
  let existing=id?(state.graphs||[]).find(x=>x.id===id):null;
  let title=$('graphTitle').value.trim(),type=$('graphType').value,style=$('graphStyle').value,height=+$('graphHeight').value,note=$('graphNote').value.trim();
  if(!title)return alert('Напиши название графика');
  let objectIds=currentGraphObjectIds();
  if(!objectIds.length)return alert('Выбери хотя бы один объект для графика');
  let payload={id,title,type,style,height,note,objectIds,rangeMinutes:graphRangeMinutes(existing),yMax:graphYMax(existing)};
  await api(id?'/api/graph/update':'/api/graph/add',payload);
  unlockEdit();closeGraphModal();await load()
}
async function delGraph(id){let g=(state.graphs||[]).find(x=>x.id===id);if(await confirmAction({title:'Удалить график?',html:`${tr('График')} <b>${esc(g?.title||id)}</b> ${tr('будет удалён из MoonFox monitor.')}`,hint:'Сайты, устройства и история проверок останутся.',okText:'Удалить',danger:true,icon:'!'})){await api('/api/graph/delete',{id});await load()}}
let diagnosticContext={kind:'',id:'',address:''};
function openDiagnosticModal(kind,id){
  let obj=(kind==='site'?state.sites:state.routers).find(x=>x.id===id);
  if(!obj)return;
  diagnosticContext={kind,id,address:''};
  $('diagnosticTitle').textContent='Диагностика';
  $('diagnosticTarget').textContent=(obj.name||'')+' — '+(kind==='site'?obj.url:obj.address);
  $('diagnosticResult').textContent='Выберите проверку.';
  lockEdit();$('diagnosticModal').classList.add('show');
}
function openMapAdhocDiagnostic(label,address){
  diagnosticContext={kind:'map',id:'',address};
  $('diagnosticTitle').textContent=tr('Диагностика узла карты');
  $('diagnosticTarget').textContent=(label||tr('Узел'))+' — '+address;
  $('diagnosticResult').textContent=tr('Выберите проверку.');
  lockEdit();$('diagnosticModal').classList.add('show');
}
function closeDiagnosticModal(){unlockEdit();$('diagnosticModal').classList.remove('show')}
function diagnosticHtml(result){
  if(result.type==='whois'&&result.notFound)return `<div class="diagProxyWarning">RDAP-данные для этого домена или IP не найдены.</div><div class="diagItem"><b>Запрос</b><br>${esc(result.query||result.host||'—')}</div>`;
  if(result.error)return `<span class="diagBad">${esc(result.error)}</span>`;
  if(result.type==='ping'){let warning=result.syntheticProxy?`<div class="diagProxyWarning">DNS вернул Fake-IP ${esc((result.addresses||[]).join(', '))}. Реальный ping скрыт VPN/прокси.</div>`:'';return warning+`<div class="diagGrid">${(result.values||result.results||[]).map((x,i)=>`<div class="diagItem"><b>#${i+1}</b><br><span class="${x.ok?'diagGood':'diagBad'}">${x.ok?(result.syntheticProxy?'через прокси':(Number(x.ms)===0?'&lt;1 мс':x.ms+' мс')):esc(x.status||'Нет ответа')}</span></div>`).join('')}</div>`}
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
    let result=await api('/api/diagnostic',{kind:diagnosticContext.kind,id:diagnosticContext.id,address:diagnosticContext.address,type});
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
function historyMs(x){
  if(!x)return 0;
  if(Number.isFinite(x._moonfoxMs))return x._moonfoxMs;
  let ms=Date.parse(x.ts||'');
  ms=Number.isFinite(ms)?ms:0;
  try{Object.defineProperty(x,'_moonfoxMs',{value:ms,writable:true,configurable:true})}catch(e){x._moonfoxMs=ms}
  return ms;
}
function axisTimeLabel(ms,rangeMinutes=0){
  let d=new Date(ms);
  if(isNaN(d))return '';
  let en=I18N.current()==='en';
  if(Number(rangeMinutes)>=1440)return d.toLocaleDateString(en?'en-US':'ru-RU',{day:'2-digit',month:'2-digit'})+' '+d.toLocaleTimeString(en?'en-US':'ru-RU',{hour:'2-digit',minute:'2-digit',hour12:false});
  return d.toLocaleTimeString(en?'en-US':'ru-RU',{hour:'2-digit',minute:'2-digit',hour12:false});
}
function axisTicks(min,max,rangeMinutes=0,count=6){
  if(!Number.isFinite(min)||!Number.isFinite(max)||max<=min)return [];
  let result=[];
  for(let i=0;i<count;i++){
    let ms=min+((max-min)*i/Math.max(1,count-1));
    result.push({ms,label:axisTimeLabel(ms,rangeMinutes)});
  }
  return result;
}
function historyKindForGraph(type){return (type==='router_ping'||type==='device_availability')?'router':'site'}
function graphHistoryObjectKey(objectIds){
  let ids=normalizeObjectIds(objectIds);
  return ids.length?ids.slice().sort().join(','):'*';
}
function graphHistoryCacheKey(type,rangeMinutes,objectIds=null){return historyKindForGraph(type)+'|'+Math.max(1,Math.round(Number(rangeMinutes||60)))+'|'+graphHistoryObjectKey(objectIds)}
function graphHistoryFor(type,rangeMinutes,objectIds=null){
  let key=graphHistoryCacheKey(type,rangeMinutes,objectIds);
  let cached=graphHistoryCache[key];
  return cached&&Array.isArray(cached.history)?cached.history:null;
}
const GRAPH_HISTORY_CACHE_LIMIT=40;
function pruneGraphHistoryCache(){
  // If the dashboard tab stays open for days/weeks and the user cycles through
  // many different graphs/ranges/object selections, graphHistoryCache would
  // otherwise grow forever (one entry per distinct combination, never
  // evicted). Cap it to the most recently used entries.
  let keys=Object.keys(graphHistoryCache);
  if(keys.length<=GRAPH_HISTORY_CACHE_LIMIT)return;
  keys.sort((a,b)=>(graphHistoryCache[a].at||0)-(graphHistoryCache[b].at||0));
  keys.slice(0,keys.length-GRAPH_HISTORY_CACHE_LIMIT).forEach(k=>delete graphHistoryCache[k]);
}
function graphMaxPoints(rangeMinutes){
  let minutes=Number(rangeMinutes||60);
  if(minutes<=60)return 1200;
  if(minutes<=180)return 1800;
  if(minutes<=720)return 2400;
  return 3000;
}
function ensureGraphHistory(type,rangeMinutes,objectIds=null){
  let minutes=Math.max(1,Math.round(Number(rangeMinutes||60)));
  let ids=normalizeObjectIds(objectIds);
  let key=graphHistoryCacheKey(type,minutes,ids);
  let cached=graphHistoryCache[key];
  let maxAge=Math.max(10000,Math.min(30000,Number((state.settings||{}).autoRefresh||10)*1000));
  if(cached&&Date.now()-cached.at<maxAge)return;
  if(graphHistoryLoading[key])return;
  graphHistoryLoading[key]=true;
  api('/api/history/query',{kind:historyKindForGraph(type),minutes,objectIds:ids,maxPoints:graphMaxPoints(minutes)})
    .then(res=>{
      graphHistoryCache[key]={at:Date.now(),history:Array.isArray(res.history)?res.history:[]};
      pruneGraphHistoryCache();
      if(activePageId()==='overview'||activePageId()==='graphs')renderGraphs();
    })
    .catch(e=>console.error('History query error',e))
    .finally(()=>{delete graphHistoryLoading[key]});
}
function datasetFor(type,objectIds=null,rangeMinutes=null){
  let h=graphHistoryFor(type,rangeMinutes,objectIds)||(state.history||[]);
  let isDevice=(type==='router_ping'||type==='device_availability');
  let objects=(isDevice?state.routers:state.sites)||[];
  let objectById=new Map(objects.map(o=>[o.id,o]));
  let objectByName=new Map(objects.map(o=>[o.name,o]));
  let minutes=Number(rangeMinutes||0);
  let labelMs=null,axisMin=null,axisMax=null,ticks=null;
  let now=Date.now(),cutoff=minutes>0?now-minutes*60000:0;
  const historyKey=x=>x.objectId||objectByName.get(x.name)?.id||x.name;
  let entries=[];
  h.forEach(x=>{
    if((isDevice?x.kind==='router':x.kind==='site')===false)return;
    let ms=historyMs(x);
    if(minutes>0&&(!ms||ms<cutoff||ms>now))return;
    entries.push({row:x,ms,key:historyKey(x)});
  });
  entries.sort((a,b)=>a.ms-b.ms);
  if(minutes>0){
    axisMin=cutoff;axisMax=now;ticks=axisTicks(axisMin,axisMax,minutes,6);
  }else{
    entries=entries.slice(-60);
  }
  labelMs=[...new Set(entries.map(x=>x.ms).filter(Boolean))];
  let labels=labelMs?labelMs.map(ms=>axisTimeLabel(ms,minutes)):[...new Set(entries.map(x=>x.time))];
  let historyKeys=[...new Set(entries.map(x=>x.key))];
  let availableKeys=new Set(historyKeys);
  let orderedKeys=objects.map(x=>x.id).filter(id=>availableKeys.has(id));
  let selectedIds=normalizeObjectIds(objectIds);
  let keys=selectedIds.length?selectedIds:[...orderedKeys,...historyKeys.filter(key=>!orderedKeys.includes(key))].slice(0,8);
  let firstNameByKey=new Map();
  let entryByKeyMs=new Map();
  entries.forEach(item=>{
    if(!firstNameByKey.has(item.key))firstNameByKey.set(item.key,item.row.name);
    entryByKeyMs.set(item.key+'\u0000'+item.ms,item.row);
  });
  let names=keys.map(key=>objectById.get(key)?.name||firstNameByKey.get(key)||key);
  let colors=paletteFor(names,isDevice);
  return downsampleDataset({labels,labelMs,axisMin,axisMax,ticks,names,colors,values:keys.map(key=>labelMs.map(ms=>{let r=entryByKeyMs.get(key+'\u0000'+ms);if(!r)return null;if(type==='site_availability'||type==='device_availability')return r.ok?100:0;if(type==='site_codes')return r.code||0;if(type==='site_errors')return r.ok?0:1;return r.value||0}))},minutes)
}
function chartPointLimit(rangeMinutes){
  let minutes=Number(rangeMinutes||0);
  if(minutes<=60)return 900;
  if(minutes<=180)return 1100;
  if(minutes<=720)return 1400;
  return 1800;
}
function downsampleDataset(d,rangeMinutes){
  let n=(d.labelMs||[]).length,limit=chartPointLimit(rangeMinutes);
  if(n<=limit||!d.values||!d.values.length)return d;
  let perBucket=Math.max(2,d.values.length*2+2);
  let bucketCount=Math.max(1,Math.floor(limit/perBucket));
  let bucketSize=Math.max(1,Math.ceil(n/bucketCount));
  let keep=new Set([0,n-1]);
  for(let start=0;start<n;start+=bucketSize){
    let end=Math.min(n,start+bucketSize);
    keep.add(start);keep.add(end-1);
    d.values.forEach(vals=>{
      let minIdx=-1,maxIdx=-1,minVal=Infinity,maxVal=-Infinity;
      for(let i=start;i<end;i++){
        let v=vals[i];
        if(v===null||!Number.isFinite(Number(v)))continue;
        v=Number(v);
        if(v<minVal){minVal=v;minIdx=i}
        if(v>maxVal){maxVal=v;maxIdx=i}
      }
      if(minIdx>=0)keep.add(minIdx);
      if(maxIdx>=0)keep.add(maxIdx);
    });
  }
  let indexes=[...keep].filter(i=>i>=0&&i<n).sort((a,b)=>a-b);
  return {...d,labels:indexes.map(i=>d.labels[i]),labelMs:indexes.map(i=>d.labelMs[i]),values:d.values.map(vals=>indexes.map(i=>vals[i]))};
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
function percentile(values,p){
  let arr=values.map(Number).filter(v=>Number.isFinite(v)&&v>=0).sort((a,b)=>a-b);
  if(!arr.length)return 0;
  let idx=Math.min(arr.length-1,Math.max(0,Math.ceil(arr.length*p)-1));
  return arr[idx];
}
function autoGraphMax(info,values){
  if(info.fixedMax)return info.fixedMax;
  let clean=values.map(Number).filter(v=>Number.isFinite(v)&&v>=0);
  if(!clean.length)return niceMax(1,info.maxMin||1);
  let maxVal=Math.max(...clean);
  if(clean.length>=20){
    let p95=percentile(clean,.95);
    if(p95>0&&maxVal>p95*3)return niceMax(p95*1.35,info.maxMin||1);
  }
  return niceMax(maxVal,info.maxMin||1);
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
function drawCanvas(canvas,type,style='line',height=210,legendId=null,objectIds=null,rangeMinutes=null,yMax=null){
  if(!canvas)return;
  if(Number(rangeMinutes||0)>0)ensureGraphHistory(type,rangeMinutes,objectIds);
  let ctx=canvas.getContext('2d'),ratio=devicePixelRatio||1;
  let W=canvas.clientWidth,H=Number(height)||210;
  if(W<20){
    let retry=Number(canvas.dataset.drawRetry||0);
    if(retry<10){
      canvas.dataset.drawRetry=String(retry+1);
      setTimeout(()=>drawCanvas(canvas,type,style,height,legendId,objectIds,rangeMinutes,yMax),50);
    }
    return;
  }
  canvas.dataset.drawRetry='0';
  canvas.style.height=H+'px'; canvas.width=W*ratio; canvas.height=H*ratio; ctx.setTransform(ratio,0,0,ratio,0,0);
  ctx.clearRect(0,0,W,H);
  let d=datasetFor(type,objectIds,rangeMinutes);renderLegend(legendId,d);
  let info=metricInfo(type);
  if(style==='pie'){
    drawPieChart(ctx,d,info,W,H);
    return;
  }
  let left=58,right=10,top=24,bottom=30;
  let plotW=Math.max(10,W-left-right),plotH=Math.max(10,H-top-bottom);
  let manualMax=Number(yMax||0);
  let all=d.values.flat().filter(v=>v!==null),max=manualMax>0?manualMax:autoGraphMax(info,all);
  drawYAxis(ctx,info,left,top,plotW,plotH,max);
  ctx.fillStyle='#8fa0bd';ctx.font='11px Segoe UI';
  if(!all.length){
    ctx.fillText(tr('Нет данных. Нажми «⟳» после добавления объектов.'),left+8,Math.round(top+plotH/2));
    drawTimeScale(ctx,d,left,top,plotW,plotH,W,H);
    return;
  }
  d.values.forEach((vals,si)=>{
    ctx.strokeStyle=d.colors[si]||'#35f0ff';ctx.fillStyle=d.colors[si]||'#35f0ff';ctx.lineWidth=2;
    if(style==='bar'){
      let groupW=plotW/Math.max(1,d.labels.length),barW=Math.max(2,groupW/(d.values.length+1));
      vals.forEach((v,i)=>{if(v===null)return;let baseX=xForLabel(d,i,left,plotW);let x=baseX-groupW*.4+si*barW;let bh=Math.min(plotH,(v/max)*plotH);let y=top+plotH-bh;ctx.fillRect(x,y,barW*.85,bh)})
    }else{
      let gapLimit=d.labelMs&&d.axisMin&&d.axisMax?Math.max(120000,Math.min(15*60000,(d.axisMax-d.axisMin)/18)):0;
      ctx.beginPath();let moved=false,lastMs=null;vals.forEach((v,i)=>{if(v===null)return;let x=xForLabel(d,i,left,plotW);let y=Math.max(top,top+plotH-(v/max)*plotH);let ms=d.labelMs?d.labelMs[i]:null;if(!moved||lastMs&&ms&&gapLimit&&ms-lastMs>gapLimit){ctx.moveTo(x,y);moved=true}else ctx.lineTo(x,y);lastMs=ms});ctx.stroke();
      if((d.labels||[]).length<=500)vals.forEach((v,i)=>{if(v===null)return;let x=xForLabel(d,i,left,plotW);let y=Math.max(top,top+plotH-(v/max)*plotH);ctx.beginPath();ctx.arc(x,y,2.2,0,Math.PI*2);ctx.fill()})
    }
  });
  drawTimeScale(ctx,d,left,top,plotW,plotH,W,H);
}
function xForLabel(d,i,left,plotW){
  if(d.labelMs&&d.labelMs.length>1){
    let min=Number.isFinite(d.axisMin)?d.axisMin:d.labelMs[0],max=Number.isFinite(d.axisMax)?d.axisMax:d.labelMs[d.labelMs.length-1];
    return left+((d.labelMs[i]-min)/Math.max(1,max-min))*plotW;
  }
  return left+(i/Math.max(1,d.labels.length-1))*plotW;
}
function xForMs(d,ms,left,plotW){
  let min=Number.isFinite(d.axisMin)?d.axisMin:(d.labelMs&&d.labelMs.length?d.labelMs[0]:ms);
  let max=Number.isFinite(d.axisMax)?d.axisMax:(d.labelMs&&d.labelMs.length?d.labelMs[d.labelMs.length-1]:ms);
  return left+((ms-min)/Math.max(1,max-min))*plotW;
}
function drawTimeScale(ctx,d,left,top,plotW,plotH,W,H){
  ctx.save();
  ctx.strokeStyle='rgba(255,255,255,.18)';ctx.fillStyle='#8fa0bd';ctx.lineWidth=1;ctx.font='11px Segoe UI';ctx.textAlign='center';ctx.textBaseline='top';
  let y=top+plotH;
  ctx.beginPath();ctx.moveTo(left,y);ctx.lineTo(left+plotW,y);ctx.stroke();
  if(d.ticks&&d.ticks.length){
    d.ticks.forEach(t=>{
      let x=xForMs(d,t.ms,left,plotW);
      ctx.strokeStyle='rgba(255,255,255,.16)';ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x,y+5);ctx.stroke();
      ctx.fillText(t.label,x,y+8);
    });
    ctx.restore();
    return;
  }
  let labels=d.labels||[];
  if(labels&&labels.length){
    let maxTicks=Math.min(6,labels.length);
    let used=new Set();
    for(let t=0;t<maxTicks;t++){
      let idx=maxTicks===1?0:Math.round(t*(labels.length-1)/(maxTicks-1));
      if(used.has(idx))continue; used.add(idx);
      let x=xForLabel(d,idx,left,plotW);
      ctx.strokeStyle='rgba(255,255,255,.16)';ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x,y+5);ctx.stroke();
      ctx.fillText(labels[idx],x,y+8);
    }
  }else{
    ctx.fillText(tr('Время'),left+plotW/2,y+8);
  }
  ctx.restore();
}
function draw(id,type,style,height,legendId,objectIds=null,rangeMinutes=null,yMax=null){drawCanvas($(id),type,style,height,legendId,objectIds,rangeMinutes,yMax)}
const OVERVIEW_RANGE_PRESETS=[60,180,360,720,1440];
const GRAPH_RANGE_PRESETS=[60,180,360,720,1440];
function rangePresetOptions(value){
  let labels={60:'1 час',180:'3 часа',360:'6 часов',720:'12 часов',1440:'24 часа'};
  return GRAPH_RANGE_PRESETS.map(v=>`<option value="${v}" ${Number(value)===v?'selected':''}>${labels[v]}</option>`).join('')+`<option value="custom" ${GRAPH_RANGE_PRESETS.includes(Number(value))?'':'selected'}>Свой</option>`;
}
function graphRangeMinutes(g){
  let v=Number(g&&g.rangeMinutes);
  return Number.isFinite(v)&&v>0?Math.min(10080,Math.max(1,Math.round(v))):60;
}
function graphYMax(g){
  let v=Number(g&&g.yMax);
  return Number.isFinite(v)&&v>0?Math.min(1000000,Math.max(1,Math.round(v))):0;
}
function graphPayload(g,overrides={}){
  return {
    id:g.id,title:g.title,type:g.type,style:g.style||'line',height:Number(g.height||260),
    note:g.note||'',objectIds:normalizeObjectIds(g.objectIds),rangeMinutes:graphRangeMinutes(g),yMax:graphYMax(g),
    ...overrides
  };
}
async function saveGraphCardStyle(id){
  let g=(state.graphs||[]).find(x=>x.id===id),sel=$('graphStyle_'+id);
  if(!g||!sel)return;
  g.style=sel.value||'line';
  renderGraphs();
  await api('/api/graph/update',graphPayload(g));
  await load();
}
async function saveGraphCardRangePreset(id){
  let g=(state.graphs||[]).find(x=>x.id===id),preset=$('graphRangePreset_'+id),input=$('graphRange_'+id);
  if(!g||!preset)return;
  if(preset.value==='custom'){if(input)setTimeout(()=>input.focus(),30);return}
  let value=Math.round(Number(preset.value));
  if(!Number.isFinite(value)||value<1||value>10080)return;
  g.rangeMinutes=value;
  if(input)input.value=String(value);
  renderGraphs();
  await api('/api/graph/update',graphPayload(g));
  await load();
}
async function saveGraphCardRange(id){
  let g=(state.graphs||[]).find(x=>x.id===id),input=$('graphRange_'+id);
  if(!g||!input)return;
  let value=Math.round(Number(input.value));
  if(!Number.isFinite(value)||value<1||value>10080){
    alert(tr('Укажи период от 1 до 10080 минут'));
    input.value=String(graphRangeMinutes(g));
    return;
  }
  g.rangeMinutes=value;
  let preset=$('graphRangePreset_'+id);
  if(preset)preset.value=GRAPH_RANGE_PRESETS.includes(value)?String(value):'custom';
  renderGraphs();
  await api('/api/graph/update',graphPayload(g));
  await load();
}
async function saveGraphCardYMax(id){
  let g=(state.graphs||[]).find(x=>x.id===id),input=$('graphYMax_'+id);
  if(!g||!input)return;
  let value=Math.round(Number(input.value||0));
  if(!Number.isFinite(value)||value<0||value>1000000){
    alert(tr('Укажи максимум Y от 0 до 1000000'));
    input.value=String(graphYMax(g));
    return;
  }
  g.yMax=value;
  renderGraphs();
  await api('/api/graph/update',graphPayload(g));
  await load();
}
function defaultOverviewGraph(kind){
  return kind==='device'
    ?{id:'__default',title:'Все устройства',type:'router_ping',objectIds:null,style:'line'}
    :{id:'__default',title:'Все сайты',type:'site_response',objectIds:null,style:'line'};
}
function overviewGraphList(kind){
  let isDevice=kind==='device';
  let custom=(state.graphs||[]).filter(g=>graphUsesDevices(g.type)===isDevice);
  return [defaultOverviewGraph(kind),...custom];
}
function overviewGraphSettingKey(kind){return kind==='device'?'deviceOverviewGraphId':'siteOverviewGraphId'}
function overviewRangeSettingKey(kind){return kind==='device'?'deviceOverviewRangeMinutes':'siteOverviewRangeMinutes'}
function overviewYMaxSettingKey(kind){return kind==='device'?'deviceOverviewYMax':'siteOverviewYMax'}
function selectedOverviewGraph(kind){
  let id=(state.settings||{})[overviewGraphSettingKey(kind)]||'__default';
  return overviewGraphList(kind).find(g=>g.id===id)||defaultOverviewGraph(kind);
}
function overviewRangeMinutes(kind){
  let v=Number((state.settings||{})[overviewRangeSettingKey(kind)]||60);
  return Number.isFinite(v)&&v>0?Math.min(10080,Math.max(1,Math.round(v))):60;
}
function overviewYMax(kind){
  let v=Number((state.settings||{})[overviewYMaxSettingKey(kind)]||0);
  return Number.isFinite(v)&&v>0?Math.min(1000000,Math.max(1,Math.round(v))):0;
}
function renderOverviewGraphControls(){
  ['site','device'].forEach(kind=>{
    let graphSel=$(kind==='device'?'deviceOverviewGraph':'siteOverviewGraph');
    if(graphSel){
      let list=overviewGraphList(kind);
      let selected=selectedOverviewGraph(kind).id;
      graphSel.innerHTML=list.map(g=>`<option value="${esc(g.id)}">${esc(g.title||'График')}</option>`).join('');
      graphSel.value=selected;
    }
    let range=overviewRangeMinutes(kind);
    let preset=$(kind==='device'?'deviceOverviewRangePreset':'siteOverviewRangePreset');
    let input=$(kind==='device'?'deviceOverviewRange':'siteOverviewRange');
    if(input&&document.activeElement!==input)input.value=String(range);
    if(preset){
      let value=OVERVIEW_RANGE_PRESETS.includes(range)?String(range):'custom';
      if(document.activeElement!==preset)preset.value=value;
    }
    let yInput=$(kind==='device'?'deviceOverviewYMax':'siteOverviewYMax');
    if(yInput&&document.activeElement!==yInput)yInput.value=String(overviewYMax(kind));
  });
}
async function saveOverviewGraph(kind){
  let sel=$(kind==='device'?'deviceOverviewGraph':'siteOverviewGraph');
  state.settings=state.settings||{};
  state.settings[overviewGraphSettingKey(kind)]=sel?.value||'__default';
  renderGraphs();
  await saveSettingsSilent();
}
async function saveOverviewRangePreset(kind){
  let preset=$(kind==='device'?'deviceOverviewRangePreset':'siteOverviewRangePreset');
  let input=$(kind==='device'?'deviceOverviewRange':'siteOverviewRange');
  if(!preset)return;
  if(preset.value==='custom'){if(input)setTimeout(()=>input.focus(),30);return}
  let value=Math.round(Number(preset.value));
  if(!Number.isFinite(value)||value<1||value>10080)return;
  if(input)input.value=String(value);
  state.settings=state.settings||{};
  state.settings[overviewRangeSettingKey(kind)]=value;
  renderGraphs();
  await saveSettingsSilent();
}
async function saveOverviewRange(kind){
  let input=$(kind==='device'?'deviceOverviewRange':'siteOverviewRange');
  let value=Math.round(Number(input?.value));
  if(!Number.isFinite(value)||value<1||value>10080){
    alert(tr('Укажи период от 1 до 10080 минут'));
    if(input)input.value=String(overviewRangeMinutes(kind));
    return;
  }
  state.settings=state.settings||{};
  state.settings[overviewRangeSettingKey(kind)]=value;
  let preset=$(kind==='device'?'deviceOverviewRangePreset':'siteOverviewRangePreset');
  if(preset)preset.value=OVERVIEW_RANGE_PRESETS.includes(value)?String(value):'custom';
  renderGraphs();
  await saveSettingsSilent();
}
async function saveOverviewYMax(kind){
  let input=$(kind==='device'?'deviceOverviewYMax':'siteOverviewYMax');
  let value=Math.round(Number(input?.value||0));
  if(!Number.isFinite(value)||value<0||value>1000000){
    alert(tr('Укажи максимум Y от 0 до 1000000'));
    if(input)input.value=String(overviewYMax(kind));
    return;
  }
  state.settings=state.settings||{};
  state.settings[overviewYMaxSettingKey(kind)]=value;
  renderGraphs();
  await saveSettingsSilent();
}
function renderGraphs(){
  let s=state.settings||{};
  let page=activePageId();
  if(page==='overview'){
    renderOverviewGraphControls();
    let siteGraph=selectedOverviewGraph('site'),deviceGraph=selectedOverviewGraph('device');
    draw('chartOverview1',siteGraph.type,s.siteOverviewStyle||siteGraph.style||'line',210,'legendOverview1',siteGraph.objectIds||null,overviewRangeMinutes('site'),overviewYMax('site'));
    draw('chartOverview2',deviceGraph.type,s.deviceOverviewStyle||deviceGraph.style||'line',210,'legendOverview2',deviceGraph.objectIds||null,overviewRangeMinutes('device'),overviewYMax('device'));
  }
  if(page!=='graphs')return;
  let graphs=state.graphs||[];
  let html=graphs.map(g=>{
    let range=graphRangeMinutes(g),safeId=jsAttr(g.id);
    return `<div class="panel chartCard"><div class="chartTop"><div><h3>${esc(g.title)}</h3>${g.note?`<p>${esc(g.note)}</p>`:''}</div><div class="chartControls graphCardControls"><label class="chartStyleControl">Вид <select id="graphStyle_${safeId}" onchange="saveGraphCardStyle('${safeId}')"><option value="line" ${(g.style||'line')==='line'?'selected':''}>Линия</option><option value="bar" ${(g.style||'line')==='bar'?'selected':''}>Столбцы</option><option value="pie" ${(g.style||'line')==='pie'?'selected':''}>Круговая</option></select></label><label class="chartRangeControl">Период <select id="graphRangePreset_${safeId}" onchange="saveGraphCardRangePreset('${safeId}')">${rangePresetOptions(range)}</select><input id="graphRange_${safeId}" type="number" min="1" max="10080" value="${range}" onchange="saveGraphCardRange('${safeId}')" onkeydown="if(event.key==='Enter')this.blur()"> мин</label><label class="chartYControl">Макс. мс <input id="graphYMax_${safeId}" type="number" min="0" max="1000000" value="${graphYMax(g)}" onchange="saveGraphCardYMax('${safeId}')" onkeydown="if(event.key==='Enter')this.blur()"></label><button class="edit" onclick="openGraphModal('${safeId}')">Редактировать</button><button class="delGraph" onclick="delGraph('${safeId}')">Удалить</button></div></div><div class="chartArea"><div id="leg_${safeId}" class="chartLegend"></div><canvas id="g_${safeId}"></canvas></div></div>`;
  }).join('');
  if($('graphGrid'))$('graphGrid').innerHTML=html;
  graphs.forEach(g=>setTimeout(()=>{if($('g_'+g.id))draw('g_'+g.id,g.type,g.style||'line',g.height||220,'leg_'+g.id,g.objectIds||null,graphRangeMinutes(g),graphYMax(g))},20))
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
  v=Number(v||0);
  if(autoTimerValue===v)return;
  clearInterval(autoTimer);
  autoTimer=null;
  autoTimerValue=v;
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
  settingsSaveInFlight++;
  settingsProtectUntil=Date.now()+15000;
  try{
    await api('/api/settings/save',{title:APP_TITLE,subtitle:APP_SUBTITLE,language:ss.language||I18N.current(),interval:ss.interval||30,siteInterval:ss.siteInterval||ss.interval||30,deviceInterval:ss.deviceInterval||ss.interval||30,timeout:ss.timeout||10,port:ss.port||8000,siteWarn:ss.siteWarn||1000,siteCrit:ss.siteCrit||3000,deviceWarn:ss.deviceWarn||150,deviceCrit:ss.deviceCrit||300,failureConfirmChecks:ss.failureConfirmChecks||2,historyRetentionMode:ss.historyRetentionMode||'days',historyRetentionDays:Number(ss.historyRetentionDays||7),historyMaxRecords:Number(ss.historyMaxRecords||10000),siteOverviewStyle:ss.siteOverviewStyle||'line',deviceOverviewStyle:ss.deviceOverviewStyle||'line',siteOverviewGraphId:ss.siteOverviewGraphId||'__default',deviceOverviewGraphId:ss.deviceOverviewGraphId||'__default',siteOverviewRangeMinutes:Number(ss.siteOverviewRangeMinutes||60),deviceOverviewRangeMinutes:Number(ss.deviceOverviewRangeMinutes||60),siteOverviewYMax:Number(ss.siteOverviewYMax||0),deviceOverviewYMax:Number(ss.deviceOverviewYMax||0),showMs:!!ss.showMs,autoOpen:!!ss.autoOpen,telegramEnabled:ss.telegramEnabled!==false,telegramToken:ss.telegramToken||'',telegramChat:ss.telegramChat||'',telegramCommandsEnabled:!!ss.telegramCommandsEnabled,telegramCommandInterval:Number(ss.telegramCommandInterval||5),uiScale:ss.uiScale||0.9,textScale:ss.textScale||1,autoRefresh:Number(ss.autoRefresh||0)});
  }finally{
    settingsProtectUntil=Date.now()+15000;
    settingsSaveInFlight=Math.max(0,settingsSaveInFlight-1);
  }
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

async function exportConfig(){
  let fullState=await api('/api/export/config');
  let blob=new Blob([JSON.stringify(fullState,null,2)],{type:'application/json'});
  let a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='monitoring_config.json';a.click();URL.revokeObjectURL(a.href);
}
function downloadTextFile(name,text,type){
  let blob=new Blob([text],{type:type||'text/plain;charset=utf-8'});
  let a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;a.click();URL.revokeObjectURL(a.href);
}
function reportRowsFor(kind,hours,sourceHistory=null){
  let objects=kind==='site'?(state.sites||[]):(state.routers||[]);
  let cutoff=Date.now()-Number(hours||24)*60*60*1000;
  let allHistory=Array.isArray(sourceHistory)?sourceHistory:(state.history||[]);
  return objects.map(obj=>{
    let history=allHistory.filter(x=>x.kind===kind&&(x.objectId?x.objectId===obj.id:x.name===obj.name)).filter(x=>{let ms=historyMs(x);return !ms||ms>=cutoff});
    let ok=history.filter(x=>x.ok).length,total=history.length;
    let values=history.map(x=>Number(x.value||0)).filter(x=>x>0);
    let avg=values.length?Math.round(values.reduce((a,b)=>a+b,0)/values.length):0;
    return {name:obj.name||'',target:kind==='site'?obj.url:obj.address,status:statusText(obj.status),paused:!!obj.paused||obj.status==='PAUSED',uptime:total?((ok/total)*100).toFixed(1)+'%':'—',avg,checks:total,problems:history.filter(x=>x.status==='BAD'||x.status==='SLOW'||x.observedStatus==='BAD'||x.observedStatus==='SLOW').length};
  });
}
function csvEscape(v){
  // Device/site names can come from untrusted sources (e.g. a LAN neighbour's
  // reverse-DNS/PTR record picked up by the network scanner). Prefixing a
  // leading =, +, -, @ or tab neutralizes CSV/formula injection when the
  // exported report is later opened in Excel/Sheets.
  let s=String(v??'');
  if(/^[=+\-@\t\r]/.test(s))s="'"+s;
  return `"${s.replace(/"/g,'""')}"`;
}
function reportSummary(hours,sourceHistory=null){
  let siteRows=reportRowsFor('site',hours,sourceHistory),deviceRows=reportRowsFor('router',hours,sourceHistory);
  let values=[...siteRows,...deviceRows].map(x=>x.avg).filter(Boolean);
  return {siteRows,deviceRows,avg:values.length?Math.round(values.reduce((a,b)=>a+b,0)/values.length):0,problems:[...siteRows,...deviceRows].reduce((a,b)=>a+b.problems,0),paused:[...siteRows,...deviceRows].filter(x=>x.paused).length};
}
async function exportReport(format){
  let hours=Number($('reportPeriod')?.value||24),minutes=Math.max(1,Math.min(10080,hours*60));
  let siteHistory=await api('/api/history/query',{kind:'site',minutes,full:true});
  let deviceHistory=await api('/api/history/query',{kind:'router',minutes,full:true});
  let summary=reportSummary(hours,[...(siteHistory.history||[]),...(deviceHistory.history||[])]),period=hours===168?'7 дней':'24 часа',stamp=new Date().toISOString().slice(0,10);
  if(format==='csv'){
    let lines=[['Тип','Название','Адрес','Статус','Пауза','Аптайм','Средний отклик, мс','Проверок','Проблем'].map(csvEscape).join(';')];
    summary.siteRows.forEach(x=>lines.push(['Сайт',x.name,x.target,x.status,x.paused?'Да':'Нет',x.uptime,x.avg,x.checks,x.problems].map(csvEscape).join(';')));
    summary.deviceRows.forEach(x=>lines.push(['Устройство',x.name,x.target,x.status,x.paused?'Да':'Нет',x.uptime,x.avg,x.checks,x.problems].map(csvEscape).join(';')));
    downloadTextFile(`moonfox_report_${hours}h_${stamp}.csv`,lines.join('\r\n'),'text/csv;charset=utf-8');
    return;
  }
  let tableHtml=(title,rows)=>`<h2>${esc(title)}</h2><table><thead><tr><th>Название</th><th>Адрес</th><th>Статус</th><th>Пауза</th><th>Аптайм</th><th>Средний отклик</th><th>Проверок</th><th>Проблем</th></tr></thead><tbody>${rows.map(x=>`<tr><td>${esc(x.name)}</td><td>${esc(x.target)}</td><td>${esc(x.status)}</td><td>${x.paused?'Да':'Нет'}</td><td>${esc(x.uptime)}</td><td>${x.avg?x.avg+' мс':'—'}</td><td>${x.checks}</td><td>${x.problems}</td></tr>`).join('')}</tbody></table>`;
  let html=`<!doctype html><html><head><meta charset="utf-8"><title>MoonFox report</title><style>body{font-family:Segoe UI,Arial,sans-serif;background:#080d1b;color:#dce7ff;padding:24px}h1,h2{color:#fff}.cards{display:flex;gap:12px;flex-wrap:wrap}.card{background:#101a36;border:1px solid #26365d;border-radius:14px;padding:14px;min-width:160px}table{width:100%;border-collapse:collapse;margin:12px 0 26px}th,td{border:1px solid #26365d;padding:9px;text-align:left}th{color:#9fb0c8;background:#101a36}</style></head><body><h1>MoonFox monitor: отчёт за ${period}</h1><p>Сформировано: ${new Date().toLocaleString()}</p><div class="cards"><div class="card"><b>Сайтов</b><br>${summary.siteRows.length}</div><div class="card"><b>Устройств</b><br>${summary.deviceRows.length}</div><div class="card"><b>Проблем</b><br>${summary.problems}</div><div class="card"><b>Средний отклик</b><br>${summary.avg?summary.avg+' мс':'—'}</div><div class="card"><b>На паузе</b><br>${summary.paused}</div></div>${tableHtml('Сайты',summary.siteRows)}${tableHtml('Устройства',summary.deviceRows)}</body></html>`;
  downloadTextFile(`moonfox_report_${hours}h_${stamp}.html`,html,'text/html;charset=utf-8');
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
  if(!await confirmAction({title:'Импортировать конфигурацию?',text:'Текущие сайты, устройства, графики и история будут заменены данными из файла.',hint:'Перед импортом лучше экспортировать текущую конфигурацию, если она нужна.',okText:'Импортировать',danger:true,icon:'!'})){input.value='';return;}
  await api('/api/import/config',data);
  input.value='';
  await load();
  alert('Конфигурация импортирована.');
}

organizeSettingsColumns();
hookFormDirtyFlags();
I18N.startObserver();

/* ---- v0.7.1 network map ("Карта") ---- */
let mapDragging=false;
let mapDragState=null;
let mapConnectMode=false;
let mapConnectFirst=null;
let mapSaveTimer=null;
let topologyProtectUntil=0;
let mapDisconnectMenuFor=null;
const MAP_TYPE_LABELS={router:'Роутер',firewall:'Firewall',switch:'Коммутатор',server:'Сервер / NAS',pc:'ПК',laptop:'Ноутбук',phone:'Телефон',ap:'Wi-Fi точка',printer:'Принтер',cloud:'Интернет / облако',generic:'Прочее'};
const MAP_ICONS={
  router:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="10" width="20" height="8" rx="2"/><path d="M7 10V6M12 10V4M17 10V6"/><circle cx="6" cy="14" r="1" fill="currentColor" stroke="none"/><circle cx="10" cy="14" r="1" fill="currentColor" stroke="none"/></svg>',
  firewall:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3z"/><path d="M8 9h8M8 13h8M12 9v4"/></svg>',
  switch:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="8" width="20" height="8" rx="2"/><path d="M5 16v2M9 16v2M13 16v2M17 16v2"/></svg>',
  server:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="3" width="16" height="6" rx="1.5"/><rect x="4" y="10" width="16" height="6" rx="1.5"/><rect x="4" y="17" width="16" height="4" rx="1.5"/><circle cx="7.2" cy="6" r=".7" fill="currentColor" stroke="none"/><circle cx="7.2" cy="13" r=".7" fill="currentColor" stroke="none"/></svg>',
  pc:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="12" rx="1.5"/><path d="M9 20h6M12 16v4"/></svg>',
  laptop:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="10" rx="1.2"/><path d="M2 18h20l-2-3H4l-2 3z"/></svg>',
  phone:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/></svg>',
  ap:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="18" r="1.4" fill="currentColor" stroke="none"/><path d="M8 15a5.7 5.7 0 0 1 8 0M5 11.5a10 10 0 0 1 14 0M2.5 8a13.9 13.9 0 0 1 19 0"/></svg>',
  printer:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="3" width="12" height="5"/><rect x="3" y="8" width="18" height="8" rx="1.5"/><rect x="7" y="14" width="10" height="7"/></svg>',
  cloud:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M7 18a4 4 0 0 1-.5-7.97A5 5 0 0 1 16 8a4.5 4.5 0 0 1 1 8.9"/><path d="M7 18h10"/></svg>',
  generic:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/></svg>'
};
function mapIcon(type){return MAP_ICONS[type]||MAP_ICONS.generic}
function mapEnsureTopology(){
  if(!state.topology||typeof state.topology!=='object')state.topology={nodes:[],edges:[]};
  if(!Array.isArray(state.topology.nodes))state.topology.nodes=[];
  if(!Array.isArray(state.topology.edges))state.topology.edges=[];
}
function keepLocalTopology(nextState){
  if(!nextState)return nextState;
  if(Date.now()>topologyProtectUntil)return nextState;
  nextState.topology=state.topology;
  return nextState;
}
function mapNewId(){return 'n'+Date.now().toString(36)+Math.random().toString(36).slice(2,8)}
function mapLinkedObject(node){
  if(!node||!node.linkedKind||!node.linkedId)return null;
  let list=node.linkedKind==='site'?state.sites:state.routers;
  return (list||[]).find(x=>x.id===node.linkedId)||null;
}
function mapHostFromUrl(u){try{return new URL(u).hostname||u||''}catch(e){return u||''}}
function mapNodeAddress(node){
  if(!node)return '';
  let obj=mapLinkedObject(node);
  if(obj){
    if(node.linkedKind==='router')return obj.address||node.ip||'';
    if(node.linkedKind==='site')return mapHostFromUrl(obj.url)||node.ip||'';
  }
  return node.ip||'';
}
function mapAutoFillIpFromLink(){
  let sel=$('mapNodeEditLink');
  if(!sel||!sel.value)return;
  let idx=sel.value.indexOf(':');
  let kind=sel.value.slice(0,idx),id=sel.value.slice(idx+1);
  let obj=(kind==='site'?state.sites:state.routers).find(x=>x.id===id);
  if(!obj)return;
  let address=kind==='site'?mapHostFromUrl(obj.url):(obj.address||'');
  if(address&&$('mapNodeEditIp'))$('mapNodeEditIp').value=address;
}
function mapOpenNode(id){
  mapEnsureTopology();
  let node=state.topology.nodes.find(n=>n.id===id);
  if(!node)return;
  let obj=mapLinkedObject(node);
  let url;
  if(obj&&node.linkedKind==='site'){
    url=obj.url;
  }else{
    let address=mapNodeAddress(node);
    if(!address){showMessage({title:'Нет адреса',text:'У узла не указан IP/адрес. Открой карточку узла (клик по нему) и заполни поле «IP / адрес».'});return;}
    url=`${node.scheme||'http'}://${address}`;
  }
  window.open(url,'_blank','noopener');
}
function mapDiagnoseNode(id){
  mapEnsureTopology();
  let node=state.topology.nodes.find(n=>n.id===id);
  if(!node)return;
  if(node.linkedKind&&node.linkedId){
    openDiagnosticModal(node.linkedKind,node.linkedId);
    return;
  }
  let address=mapNodeAddress(node);
  if(!address){showMessage({title:'Нет адреса',text:'Укажи IP/адрес в карточке узла (клик по нему), чтобы запускать диагностику и пинг.'});return;}
  openMapAdhocDiagnostic(node.label,address);
}
function scheduleTopologySave(){
  mapEnsureTopology();
  let snapshot={nodes:JSON.parse(JSON.stringify(state.topology.nodes)),edges:JSON.parse(JSON.stringify(state.topology.edges))};
  topologyProtectUntil=Date.now()+3000;
  clearTimeout(mapSaveTimer);
  mapSaveTimer=setTimeout(async()=>{
    try{await api('/api/topology/save',snapshot)}catch(e){console.error(e)}
  },400);
}
function addMapNode(){
  mapEnsureTopology();
  let type=$('mapNodeType')?$('mapNodeType').value:'generic';
  let count=state.topology.nodes.length;
  let node={id:mapNewId(),type,label:tr(MAP_TYPE_LABELS[type]||'Узел'),x:80+(count%6)*200,y:70+Math.floor(count/6)*170,linkedKind:null,linkedId:null};
  state.topology.nodes.push(node);
  scheduleTopologySave();
  renderMap();
  openMapNodeModal(node.id);
}
function toggleMapConnectMode(){
  mapConnectMode=!mapConnectMode;
  mapConnectFirst=null;
  mapDisconnectMenuFor=null;
  if($('mapConnectBtn'))$('mapConnectBtn').classList.toggle('active',mapConnectMode);
  if($('mapHint'))$('mapHint').textContent=mapConnectMode?tr('Кликните по двум узлам, чтобы соединить их.'):'';
  if($('mapCancelConnectBtn'))$('mapCancelConnectBtn').style.display=mapConnectMode?'':'none';
  renderMap();
}
function clearMapConnectSelection(){
  mapConnectMode=false;
  mapConnectFirst=null;
  mapDisconnectMenuFor=null;
  if($('mapConnectBtn'))$('mapConnectBtn').classList.remove('active');
  if($('mapHint'))$('mapHint').textContent='';
  if($('mapCancelConnectBtn'))$('mapCancelConnectBtn').style.display='none';
  renderMap();
}
// These three actions are triggered by a click on a button that lives INSIDE
// the very node card renderMap() regenerates (#mapNodes.innerHTML=...). Doing
// that replacement synchronously, while the browser is still mid-dispatch for
// the click that's still bubbling from the (about-to-be-destroyed) button,
// made the browser fire a stray pointercancel/pointerup with an empty id once
// the replacement swapped the DOM out from under it - occasionally opening an
// accidental connection to nothing, or leaving state briefly inconsistent.
// Deferring the actual re-render by one tick (setTimeout(...,0)) lets the
// current click finish dispatching first, so the state change is still
// effectively instant but never races the DOM it was triggered from.
function mapStartConnectFromNode(id){
  mapEnsureTopology();
  let node=state.topology.nodes.find(n=>n.id===id);
  mapDisconnectMenuFor=null;
  mapConnectMode=true;
  mapConnectFirst=id;
  if($('mapConnectBtn'))$('mapConnectBtn').classList.add('active');
  if($('mapCancelConnectBtn'))$('mapCancelConnectBtn').style.display='';
  if($('mapHint'))$('mapHint').textContent=node?`${tr('Выбран узел')} «${node.label||''}» — ${tr('кликните по второму узлу, чтобы соединить.')}`:tr('Кликните по двум узлам, чтобы соединить их.');
  setTimeout(renderMap,0);
}
function mapToggleDisconnectMenu(id){
  mapDisconnectMenuFor=(mapDisconnectMenuFor===id)?null:id;
  setTimeout(renderMap,0);
}
function mapDisconnectEdge(edgeId){
  mapEnsureTopology();
  state.topology.edges=state.topology.edges.filter(e=>e.id!==edgeId);
  mapDisconnectMenuFor=null;
  scheduleTopologySave();
  setTimeout(renderMap,0);
}
document.addEventListener('click',e=>{
  if(!mapDisconnectMenuFor)return;
  if(e.target.closest&&e.target.closest('.mapDisconnectMenu, .mapDisconnectBtn'))return;
  mapDisconnectMenuFor=null;
  renderMap();
});
function mapAddEdge(fromId,toId){
  mapEnsureTopology();
  let style=$('mapEdgeStyle')?$('mapEdgeStyle').value:'solid';
  let existing=state.topology.edges.find(e=>(e.from===fromId&&e.to===toId)||(e.from===toId&&e.to===fromId));
  if(existing)existing.style=style;
  else state.topology.edges.push({id:mapNewId(),from:fromId,to:toId,style});
  scheduleTopologySave();
}
function mapHandleNodeClick(id){
  mapDisconnectMenuFor=null;
  if(mapConnectMode){
    if(!mapConnectFirst){
      mapConnectFirst=id;
    }else if(mapConnectFirst===id){
      mapConnectFirst=null;
    }else{
      mapAddEdge(mapConnectFirst,id);
      mapConnectFirst=null;
    }
    renderMap();
    return;
  }
  openMapNodeModal(id);
}
function mapEdgeClick(id){
  mapEnsureTopology();
  let edge=state.topology.edges.find(e=>e.id===id);
  if(!edge)return;
  confirmAction({title:'Удалить соединение?',text:'Линия связи между узлами будет удалена с карты.',okText:'Удалить',danger:true,icon:'!'}).then(ok=>{
    if(!ok)return;
    state.topology.edges=state.topology.edges.filter(e=>e.id!==id);
    scheduleTopologySave();
    renderMap();
  });
}
function mapNodePointerDown(e,id){
  if(e.pointerType==='mouse'&&e.button!==0)return;
  let el=e.currentTarget;
  try{el.setPointerCapture(e.pointerId)}catch(err){}
  let node=(state.topology&&state.topology.nodes||[]).find(n=>n.id===id);
  if(!node)return;
  mapDragState={id,pointerId:e.pointerId,startX:e.clientX,startY:e.clientY,origX:node.x||0,origY:node.y||0,moved:false,el};
  e.preventDefault();
}
function mapNodePointerMove(e,id){
  if(!mapDragState||mapDragState.id!==id)return;
  let dx=e.clientX-mapDragState.startX,dy=e.clientY-mapDragState.startY;
  if(!mapDragState.moved&&(Math.abs(dx)>4||Math.abs(dy)>4)){mapDragState.moved=true;mapDragging=true}
  if(!mapDragState.moved)return;
  let node=(state.topology&&state.topology.nodes||[]).find(n=>n.id===id);
  if(!node)return;
  node.x=Math.max(0,mapDragState.origX+dx);
  node.y=Math.max(0,mapDragState.origY+dy);
  mapDragState.el.style.left=node.x+'px';
  mapDragState.el.style.top=node.y+'px';
  mapRedrawEdges();
}
function mapNodePointerUp(e,id){
  if(!mapDragState||mapDragState.id!==id)return;
  let wasMoved=mapDragState.moved;
  try{mapDragState.el.releasePointerCapture(mapDragState.pointerId)}catch(err){}
  mapDragState=null;
  mapDragging=false;
  if(wasMoved)scheduleTopologySave();
  else mapHandleNodeClick(id);
}
function mapPopulateLinkOptions(selectedValue){
  let sel=$('mapNodeEditLink');
  if(!sel)return;
  let opts=[`<option value="">${tr('Не привязывать')}</option>`];
  if((state.sites||[]).length){
    opts.push(`<optgroup label="${esc(tr('Сайты'))}">`);
    state.sites.forEach(s=>opts.push(`<option value="site:${s.id}">${esc(s.name||s.url)}</option>`));
    opts.push('</optgroup>');
  }
  if((state.routers||[]).length){
    opts.push(`<optgroup label="${esc(tr('Устройства'))}">`);
    state.routers.forEach(r=>opts.push(`<option value="router:${r.id}">${esc(r.name||r.address)}</option>`));
    opts.push('</optgroup>');
  }
  sel.innerHTML=opts.join('');
  sel.value=selectedValue||'';
}
function openMapNodeModal(id){
  mapEnsureTopology();
  let node=state.topology.nodes.find(n=>n.id===id);
  if(!node)return;
  $('mapNodeEditId').value=node.id;
  $('mapNodeEditLabel').value=node.label||'';
  if($('mapNodeEditType'))$('mapNodeEditType').value=node.type||'generic';
  let linkValue=(node.linkedKind&&node.linkedId)?`${node.linkedKind}:${node.linkedId}`:'';
  mapPopulateLinkOptions(linkValue);
  if($('mapNodeEditIp'))$('mapNodeEditIp').value=node.ip||'';
  if($('mapNodeEditScheme'))$('mapNodeEditScheme').value=node.scheme||'http';
  lockEdit();
  $('mapNodeModal').classList.add('show');
}
function closeMapNodeModal(){unlockEdit();$('mapNodeModal').classList.remove('show')}
function saveMapNodeFromModal(){
  mapEnsureTopology();
  let id=$('mapNodeEditId').value;
  let node=state.topology.nodes.find(n=>n.id===id);
  if(!node)return;
  let type=$('mapNodeEditType')?$('mapNodeEditType').value:'generic';
  node.type=type||'generic';
  node.label=$('mapNodeEditLabel').value.trim()||tr(MAP_TYPE_LABELS[node.type]||'Узел');
  let linkVal=$('mapNodeEditLink')?$('mapNodeEditLink').value:'';
  if(linkVal){
    let idx=linkVal.indexOf(':');
    node.linkedKind=linkVal.slice(0,idx)==='site'?'site':'router';
    node.linkedId=linkVal.slice(idx+1);
  }else{
    node.linkedKind=null;
    node.linkedId=null;
  }
  node.ip=($('mapNodeEditIp')?$('mapNodeEditIp').value.trim():'')||'';
  node.scheme=($('mapNodeEditScheme')?$('mapNodeEditScheme').value:'http')||'http';
  scheduleTopologySave();
  closeMapNodeModal();
  renderMap();
}
async function deleteMapNodeFromModal(){
  mapEnsureTopology();
  let id=$('mapNodeEditId').value;
  let node=state.topology.nodes.find(n=>n.id===id);
  if(!node)return;
  if(!await confirmAction({title:'Удалить узел карты?',html:`${tr('Узел')} <b>${esc(node.label||'')}</b> ${tr('и все его соединения будут удалены с карты.')}`,okText:'Удалить',danger:true,icon:'!'}))return;
  state.topology.nodes=state.topology.nodes.filter(n=>n.id!==id);
  state.topology.edges=state.topology.edges.filter(e=>e.from!==id&&e.to!==id);
  scheduleTopologySave();
  closeMapNodeModal();
  renderMap();
}
function renderMap(){
  mapEnsureTopology();
  let nodesEl=$('mapNodes'),edgesEl=$('mapEdges');
  if(!nodesEl||!edgesEl)return;
  nodesEl.innerHTML=state.topology.nodes.map(n=>{
    let obj=mapLinkedObject(n);
    let statusCls=obj?('linked-'+statusClass(obj.status)):'';
    let pendingCls=(mapConnectMode&&mapConnectFirst===n.id)?'connectPending':'';
    let menuOpenCls=(mapDisconnectMenuFor===n.id)?'menuOpen':'';
    let linkBadge=obj?`<div class="mapNodeLinkBadge">${esc(statusText(obj.status))}</div>`:'';
    let address=mapNodeAddress(n);
    let addrHtml=address?`<div class="mapNodeAddr">${esc(address)}</div>`:'';
    let safeNodeId=jsAttr(n.id);
    let nodeEdges=state.topology.edges.filter(e=>e.from===n.id||e.to===n.id);
    let disconnectDisabled=nodeEdges.length?'':' disabled';
    let actions=`<div class="mapNodeActions"><button type="button" title="${tr('Открыть')}" onpointerdown="event.stopPropagation()" onclick="event.stopPropagation();mapOpenNode('${safeNodeId}')">🌐</button><button type="button" title="${tr('Диагностика / пинг')}" onpointerdown="event.stopPropagation()" onclick="event.stopPropagation();mapDiagnoseNode('${safeNodeId}')">🔍</button><button type="button" title="${tr('Соединить с другим узлом')}" onpointerdown="event.stopPropagation()" onclick="event.stopPropagation();mapStartConnectFromNode('${safeNodeId}')">🔗</button><button type="button" class="mapDisconnectBtn" title="${tr('Отсоединить')}"${disconnectDisabled} onpointerdown="event.stopPropagation()" onclick="event.stopPropagation();mapToggleDisconnectMenu('${safeNodeId}')">✂️</button></div>`;
    let disconnectMenu='';
    if(mapDisconnectMenuFor===n.id){
      let byId={};
      state.topology.nodes.forEach(x=>byId[x.id]=x);
      let rows=nodeEdges.map(e=>{
        let otherId=e.from===n.id?e.to:e.from;
        let other=byId[otherId];
        let safeEdgeId=jsAttr(e.id);
        return `<button type="button" onpointerdown="event.stopPropagation()" onclick="event.stopPropagation();mapDisconnectEdge('${safeEdgeId}')">✕ ${esc(other?other.label||'':tr('Узел удалён'))}</button>`;
      }).join('');
      disconnectMenu=`<div class="mapDisconnectMenu" onpointerdown="event.stopPropagation()">${rows||`<div class="mapDisconnectEmpty">${tr('Нет соединений')}</div>`}</div>`;
    }
    return `<div class="mapNode ${statusCls} ${pendingCls} ${menuOpenCls}" data-node-id="${esc(n.id)}" style="left:${n.x||0}px;top:${n.y||0}px" onpointerdown="mapNodePointerDown(event,'${safeNodeId}')" onpointermove="mapNodePointerMove(event,'${safeNodeId}')" onpointerup="mapNodePointerUp(event,'${safeNodeId}')" onpointercancel="mapNodePointerUp(event,'${safeNodeId}')" title="${esc(n.label||'')}">${actions}${disconnectMenu}<div class="mapNodeIcon">${mapIcon(n.type)}</div><div class="mapNodeLabel">${esc(n.label||'')}</div>${addrHtml}${linkBadge}</div>`;
  }).join('');
  mapRedrawEdges();
}
// Nodes can now grow taller/wider than a fixed 96x96 box (long labels wrap
// instead of getting cut off), so edges can no longer assume a node's center
// is always +48/+48 from its stored x/y - they measure the real rendered
// element instead. Falls back to the old fixed-size guess only if the node
// isn't in the DOM yet (shouldn't normally happen, renderMap() draws nodes
// before calling this).
function mapNodeCenter(node){
  let canvas=$('mapCanvas');
  let el=canvas&&node?canvas.querySelector(`.mapNode[data-node-id="${CSS.escape(node.id)}"]`):null;
  if(el&&canvas){
    let elRect=el.getBoundingClientRect(),canvasRect=canvas.getBoundingClientRect();
    return {x:(elRect.left-canvasRect.left)+elRect.width/2,y:(elRect.top-canvasRect.top)+elRect.height/2};
  }
  return {x:(node&&node.x||0)+48,y:(node&&node.y||0)+48};
}
function mapRedrawEdges(){
  mapEnsureTopology();
  let edgesEl=$('mapEdges');
  if(!edgesEl)return;
  let byId={};
  state.topology.nodes.forEach(n=>byId[n.id]=n);
  edgesEl.innerHTML=state.topology.edges.map(e=>{
    let a=byId[e.from],b=byId[e.to];
    if(!a||!b)return '';
    let ac=mapNodeCenter(a),bc=mapNodeCenter(b);
    let ax=ac.x,ay=ac.y,bx=bc.x,by=bc.y;
    let mx=(ax+bx)/2,my=(ay+by)/2;
    let dashed=e.style==='dashed';
    let safeEdgeId=jsAttr(e.id);
    return `<line class="mapEdgeHit" x1="${ax}" y1="${ay}" x2="${bx}" y2="${by}" onclick="mapEdgeClick('${safeEdgeId}')"></line><line class="mapEdgeLine ${dashed?'dashed':'wired'}" x1="${ax}" y1="${ay}" x2="${bx}" y2="${by}"></line><g class="mapEdgePlay" transform="translate(${mx},${my})" onclick="event.stopPropagation();mapPingEdge('${safeEdgeId}')"><title>${esc(tr('Пропинговать по этой линии'))}</title><circle r="9"></circle><path d="M-3 -4.5 L5 0 L-3 4.5 Z"></path></g>`;
  }).join('');
}
function mapAnimatePulse(ax,ay,bx,by,ok,durationMs){
  let svg=$('mapEdges');
  if(!svg)return;
  let ns='http://www.w3.org/2000/svg';
  let dot=document.createElementNS(ns,'circle');
  dot.setAttribute('r','6');
  dot.setAttribute('class','mapPulse '+(ok?'ok':'bad'));
  dot.setAttribute('cx',ax);
  dot.setAttribute('cy',ay);
  svg.appendChild(dot);
  let start=null;
  function step(ts){
    if(!dot.parentNode)return;
    if(start===null)start=ts;
    let t=Math.min(1,(ts-start)/durationMs);
    dot.setAttribute('cx',ax+(bx-ax)*t);
    dot.setAttribute('cy',ay+(by-ay)*t);
    if(t<1){
      requestAnimationFrame(step);
    }else{
      setTimeout(()=>{if(dot.parentNode)dot.parentNode.removeChild(dot)},350);
    }
  }
  requestAnimationFrame(step);
}
function mapShowPingLabel(x,y,ok,ms,error){
  let canvas=$('mapCanvas');
  if(!canvas)return;
  let el=document.createElement('div');
  el.className='mapPingLabel '+(ok?'ok':'bad');
  el.style.left=(x+14)+'px';
  el.style.top=(y-30)+'px';
  el.textContent=ok?`${Number(ms)||0} ${tr('мс')}`:tr('Нет ответа');
  canvas.appendChild(el);
  setTimeout(()=>{if(el.parentNode)el.parentNode.removeChild(el)},2200);
}
async function mapPingEdge(edgeId){
  mapEnsureTopology();
  let edge=state.topology.edges.find(e=>e.id===edgeId);
  if(!edge)return;
  let byId={};
  state.topology.nodes.forEach(n=>byId[n.id]=n);
  let from=byId[edge.from],to=byId[edge.to];
  if(!from||!to)return;
  let address=mapNodeAddress(to)||mapNodeAddress(from);
  if(!address){
    showMessage({title:'Нет адреса',text:'Ни у одного из узлов этой линии не указан IP/адрес. Открой карточку узла (клик по нему) и заполни поле «IP / адрес», чтобы можно было пинговать по линии.'});
    return;
  }
  let fc=mapNodeCenter(from),tc=mapNodeCenter(to);
  let ax=fc.x,ay=fc.y,bx=tc.x,by=tc.y;
  let result;
  try{
    result=await api('/api/map/ping',{address});
  }catch(e){
    result={ok:false,error:String(e.message||e)};
  }
  let duration=result.ok?Math.max(400,Math.min(1600,(result.ms||300)*3)):900;
  mapAnimatePulse(ax,ay,bx,by,!!result.ok,duration);
  setTimeout(()=>{mapShowPingLabel(bx,by,!!result.ok,result.ms,result.error)},duration);
}

