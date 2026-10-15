/* TaskHub features, part 1: menus, focus + plan my day, rescheduling, command palette,
   bulk paste, templates, keyboard control, task-dialog extras. Loaded after the main script. */

const todayKey=()=>{const d=new Date();return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`};
const isOwner=t=>t.owner_id===me.id;
const prefs=()=>(profile&&profile.prefs)||{};
let prefsWarned=false;
async function savePrefs(patch){
  profile.prefs={...prefs(),...patch};
  lsSet('taskhub.prefs.'+me.id,profile.prefs);
  const {error}=await sb.from('profiles').update({prefs:profile.prefs}).eq('id',me.id);
  if(error&&!prefsWarned){prefsWarned=true;toast('Saved on this device only',{sub:'Run setup-v2.sql in Supabase to sync across devices.'})}
}
function saveFile(name,text,type){
  const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([text],{type}));a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),2000);
}
const weekStartDay=()=>({mon:1,sat:6,sun:0})[S.weekStart||'mon'];
const dayLabel=ms=>new Date(ms).toLocaleDateString([],{weekday:'short',day:'numeric',month:'short'});

/* ===== popover menu ===== */
function closeMenu(){document.querySelectorAll('.menu').forEach(m=>m.remove())}
function menu(anchor,items){
  closeMenu();
  const m=document.createElement('div');m.className='menu';m.setAttribute('role','menu');
  m.innerHTML=items.map((it,i)=>it==='-'?'<hr>':it.head?`<div class="mh">${esc(it.head)}</div>`:`<button type="button" role="menuitem" data-i="${i}" class="${it.danger?'danger':''}" ${it.off?'disabled':''}>${it.icon?ic(it.icon):''}<span>${esc(it.label)}</span></button>`).join('');
  (document.querySelector('dialog[open]')||document.body).appendChild(m);
  const r=anchor.getBoundingClientRect(),w=m.offsetWidth,h=m.offsetHeight;
  let top=r.bottom+6;if(top+h>innerHeight-8)top=r.top-h-6;
  m.style.top=Math.max(8,top)+'px';m.style.left=Math.max(8,Math.min(r.left,innerWidth-w-8))+'px';
  m.onclick=e=>{const b=e.target.closest('button');if(!b||b.disabled)return;const it=items[+b.dataset.i];closeMenu();if(it.fn)it.fn()};
  setTimeout(()=>document.addEventListener('mousedown',function f(e){if(!m.contains(e.target)){closeMenu()}document.removeEventListener('mousedown',f)},{once:false}),0);
  const first=m.querySelector('button:not(:disabled)');if(first)first.focus();
}
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeMenu()},true);

/* ===== focus (starred tasks for today), stored in synced preferences ===== */
EXT.focusIds=()=>{const f=prefs().focus;return new Set(f&&f.day===todayKey()?f.ids:[])};
function toggleFocus(id){
  const s=EXT.focusIds();s.has(id)?s.delete(id):s.add(id);
  savePrefs({focus:{day:todayKey(),ids:[...s]}});render();
  if(s.size===4)toast('Four tasks in focus',{sub:'Three or fewer is easier to finish.'});
}

/* ===== rescheduling ===== */
function dueOn(dayStart,t){
  const base=t&&t.due?new Date(t.due):null,d=new Date(dayStart);
  d.setHours(base?base.getHours():(dayStart===sod()?17:9),base?base.getMinutes():0,0,0);return d.getTime();
}
function nextWeekStart(){
  const d=new Date();d.setHours(0,0,0,0);d.setDate(d.getDate()+((weekStartDay()-d.getDay()+7)%7||7));return d.getTime();
}
async function resched(t,dayStart){
  if(!isOwner(t)){toast('Only the owner can change the due date');return false}
  const patch={due:dueOn(dayStart,t)};
  if(t.remind==null&&S.defRemind!=='')patch.remind=Number(S.defRemind);
  return updateTask(t,patch,{log:'rescheduled'});
}
function pickDate(t){
  const i=document.createElement('input');i.type='date';i.style.cssText='position:fixed;left:50%;top:40%;opacity:0;pointer-events:none';
  document.body.append(i);
  i.onchange=()=>{if(i.value){const [y,m,d]=i.value.split('-').map(Number);resched(t,new Date(y,m-1,d).getTime())}i.remove()};
  i.onblur=()=>setTimeout(()=>i.remove(),400);
  try{i.showPicker()}catch{i.click()}
}
function reschedMenu(t,anchor){
  if(!isOwner(t)){toast('Only the owner can change the due date');return}
  const d0=sod();
  menu(anchor,[
    {head:'Move to'},
    {label:'Today',icon:'sun',fn:()=>resched(t,d0)},
    {label:'Tomorrow',icon:'next',fn:()=>resched(t,d0+DAY)},
    {label:'Next week',icon:'cal',fn:()=>resched(t,nextWeekStart())},
    {label:'Pick a date…',icon:'grid',fn:()=>pickDate(t)},
    t.due?'-':null,
    t.due?{label:'Remove the date',icon:'inbox',fn:()=>updateTask(t,{due:null,remind:null})}:null,
  ].filter(Boolean));
}

/* ===== row actions ===== */
EXT.rowActions=(t,fs)=>{
  const run=typeof timer!=='undefined'&&timer&&timer.taskId===t.id;
  return `<button class="x ia ${fs?'on':''}" data-act="star" title="${fs?'Remove from':'Add to'} today’s focus" aria-label="Focus">${ic('star')}</button>`+
    `<button class="x ia" data-act="resched" title="Reschedule" aria-label="Reschedule">${ic('cal')}</button>`+
    (DB2?`<button class="x ia ${run?'run':''}" data-act="timer" title="${run?'Stop timer':'Start timer'}" aria-label="Timer">${ic(run?'stop':'play')}</button>`:'');
};
EXT.act=(act,t,el)=>{
  if(act==='star')toggleFocus(t.id);
  else if(act==='resched')reschedMenu(t,el);
  else if(act==='timer')toggleTimer(t);
};

/* ===== plan my day ===== */
function buildPlanDialog(){
  const d=document.createElement('dialog');d.id='planDlg';
  d.innerHTML=`<h2>Plan your day</h2><div class="muted">Clear what’s overdue, then pick the few things that matter most today.</div><div id="planBody"></div><div class="actions"><button class="btn" id="planDone">Start my day</button></div>`;
  document.body.append(d);
  d.addEventListener('click',e=>{
    const b=e.target.closest('[data-pa]');if(!b)return;
    const t=tasks.find(x=>x.id===b.closest('[data-id]').dataset.id);if(!t)return;
    const pa=b.dataset.pa,d0=sod();
    if(pa==='star')toggleFocus(t.id);
    else if(pa==='today')resched(t,d0);
    else if(pa==='tomorrow')resched(t,d0+DAY);
    else if(pa==='week')resched(t,nextWeekStart());
    else if(pa==='clear')updateTask(t,{due:null,remind:null});
    setTimeout(renderPlan,60);
  });
  $('#planDone').onclick=()=>{savePrefs({lastPlan:todayKey()});d.close()};
}
function planRow(t,btns){
  return `<div class="prow" data-id="${t.id}"><div class="pt" dir="auto">${esc(t.title)}<small>${t.due?fmtDue(t.due):'No date'}${t.cat?' · '+esc(t.cat):''}</small></div><div class="pb">${btns}</div></div>`;
}
function renderPlan(){
  const fs=EXT.focusIds(),my=tasks.filter(t=>mine(t)&&!isDone(t));
  const over=my.filter(t=>t.due&&startOfDay(t.due)<sod()).sort((a,b)=>a.due-b.due);
  const today=my.filter(t=>t.due&&startOfDay(t.due)===sod()).sort((a,b)=>a.due-b.due);
  const loose=my.filter(t=>!t.due).sort((a,b)=>b.priority-a.priority).slice(0,5);
  const star=t=>`<button data-pa="star" class="${fs.has(t.id)?'on':''}">${fs.has(t.id)?'In focus':'Focus'}</button>`;
  const sec=(title,n,rows,empty)=>`<div class="psec">${title}<em>${n}</em></div>${rows||`<div class="pempty">${empty}</div>`}`;
  $('#planBody').innerHTML=
    sec('Overdue',over.length,over.map(t=>planRow(t,`<button data-pa="today">Today</button><button data-pa="tomorrow">Tomorrow</button><button data-pa="week">Next week</button><button data-pa="clear">Drop date</button>`)).join(''),'Nothing overdue. Nice.')+
    sec('Due today',today.length,today.map(t=>planRow(t,star(t))).join(''),'Nothing is scheduled for today yet.')+
    sec('No date, worth doing soon',loose.length,loose.map(t=>planRow(t,`<button data-pa="today">Do today</button>${star(t)}`)).join(''),'Your undated list is empty.')+
    `<div class="psec">Today’s focus<em>${fs.size}</em></div><div class="pempty">${fs.size?'Starred tasks appear first on your Today page.':'Press Focus on up to three tasks. They’ll lead your Today page.'}</div>`;
}
function openPlan(){if(!$('#planDlg'))buildPlanDialog();renderPlan();$('#planDlg').showModal()}
$('#planDayBtn').onclick=openPlan;
EXT.planPrompt=()=>{
  if(!S.seen)return;
  const p=prefs(),my=tasks.filter(t=>mine(t)&&!isDone(t)&&t.due&&startOfDay(t.due)<=sod());
  if(p.lastPlan===todayKey()||!my.length)return;
  savePrefs({lastPlan:todayKey()});
  toast('Ready to plan your day?',{sub:`${my.length} task${my.length>1?'s':''} due or overdue`,buttons:[['Plan my day',openPlan]],ms:12000});
};

/* ===== command palette ===== */
let palIdx=0,palRows=[];
function buildPalette(){
  const d=document.createElement('dialog');d.id='palDlg';
  d.innerHTML=`<input id="palInput" placeholder="Search tasks or type a command" autocomplete="off" aria-label="Search tasks or type a command"><div id="palList" role="listbox"></div><div class="pal-foot"><span><kbd>↑</kbd> <kbd>↓</kbd> to move</span><span><kbd>Enter</kbd> to choose</span><span><kbd>Esc</kbd> to close</span></div>`;
  document.body.append(d);
  $('#palInput').addEventListener('input',()=>{palIdx=0;renderPal()});
  $('#palInput').addEventListener('keydown',e=>{
    if(e.key==='ArrowDown'){e.preventDefault();palIdx=Math.min(palIdx+1,palRows.length-1);markPal()}
    else if(e.key==='ArrowUp'){e.preventDefault();palIdx=Math.max(palIdx-1,0);markPal()}
    else if(e.key==='Enter'){e.preventDefault();runPal(palIdx)}
  });
  $('#palList').addEventListener('click',e=>{const b=e.target.closest('[data-pi]');if(b)runPal(+b.dataset.pi)});
  d.addEventListener('click',e=>{if(e.target===d)d.close()});
}
function palCommands(){
  const go=(k,name,icon)=>({g:'Go to',label:name,icon,fn:()=>{view=k;render()}});
  const nav=NAV.filter(([k])=>k!=='h'&&!(EXT.hidden&&EXT.hidden(k))).map(([k,label,icon])=>go(k,label||FILTERS[k].n,icon));
  const act=[
    {g:'Actions',label:'New task',icon:'plus',fn:()=>openDlg(null)},
    {g:'Actions',label:'New goal',icon:'target',fn:()=>openGoal()},
    {g:'Actions',label:'Plan my day',icon:'sun',fn:openPlan},
    {g:'Actions',label:'Copy my standup',icon:'copy',fn:()=>copyStandup()},
    {g:'Actions',label:'Copy my weekly report',icon:'copy',fn:()=>copyWeekly()},
    {g:'Actions',label:'Copy today’s plan',icon:'copy',fn:()=>$('#planBtn').click()},
    {g:'Actions',label:'Import tasks from ClickUp (CSV)',icon:'upload',fn:()=>openImport()},
    {g:'Actions',label:'Export my tasks to a calendar (.ics)',icon:'cal',fn:()=>exportIcs()},
    {g:'Actions',label:'Switch light and dark theme',icon:'sun',fn:()=>{const dark=document.documentElement.dataset.theme==='dark'||(!document.documentElement.dataset.theme&&matchMedia('(prefers-color-scheme:dark)').matches);S.theme=dark?'light':'dark';lsSet('taskhub.settings',S);applyTheme()}},
    {g:'Actions',label:'Settings and team',icon:'sliders',fn:()=>$('#settingsBtn').click()},
    {g:'Actions',label:'How it works',icon:'help',fn:()=>$('#helpBtn').click()},
    {g:'Actions',label:'Sign out',icon:'lock',fn:()=>$('#signOut').click()},
  ];
  return [...act,...nav];
}
function renderPal(){
  const q=$('#palInput').value.trim().toLowerCase(),words=q.split(/\s+/).filter(Boolean);
  const hit=s=>words.every(w=>s.toLowerCase().includes(w));
  let rows=palCommands().filter(c=>!q||hit(c.label+' '+c.g));
  if(!q)rows=rows.filter(c=>c.g==='Actions').slice(0,6).concat(rows.filter(c=>c.g==='Go to').slice(0,8));
  const found=q?tasks.filter(t=>hit(t.title+' '+(t.cat||'')+' '+(t.notes||''))).slice(0,8).map(t=>({g:'Tasks',label:t.title,icon:isDone(t)?'done':'checksq',sub:t.due?fmtDue(t.due):'',fn:()=>openDlg(t)})):[];
  palRows=[...found,...rows];
  let last='',html='';
  palRows.forEach((r,i)=>{
    if(r.g!==last){html+=`<div class="pal-h">${r.g}</div>`;last=r.g}
    html+=`<button class="pal ${i===palIdx?'on':''}" data-pi="${i}" role="option">${ic(r.icon)}<span dir="auto">${esc(r.label)}</span>${r.sub?`<small>${esc(r.sub)}</small>`:''}</button>`;
  });
  $('#palList').innerHTML=html||'<div class="pempty" style="padding:18px">Nothing matches. Try a task name or “plan”.</div>';
}
function markPal(){document.querySelectorAll('#palList .pal').forEach((b,i)=>{b.classList.toggle('on',i===palIdx);if(i===palIdx)b.scrollIntoView({block:'nearest'})})}
function runPal(i){const r=palRows[i];if(!r)return;$('#palDlg').close();setTimeout(r.fn,30)}
function openPalette(){if(!me||!ws)return;if(!$('#palDlg'))buildPalette();palIdx=0;$('#palInput').value='';renderPal();if(!$('#palDlg').open)$('#palDlg').showModal();$('#palInput').focus()}
$('#palBtn').onclick=openPalette;
document.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();$('#palDlg')?.open?$('#palDlg').close():openPalette()}});

/* ===== bulk paste: many lines become many tasks ===== */
let bulkLines=[],bulkMode='each';
function buildBulk(){
  const d=document.createElement('dialog');d.id='bulkDlg';
  d.innerHTML=`<h2 id="bulkH">Add several tasks</h2><div class="muted" id="bulkSub"></div>
   <div class="seg" id="bulkSeg"><button type="button" data-m="each" class="on">One task per line</button><button type="button" data-m="list">One task with a checklist</button></div>
   <div id="bulkTitleWrap" hidden><label>Task title</label><input id="bulkTitle" dir="auto"></div>
   <div id="bulkRows"></div>
   <div class="actions"><button class="btn ghost" id="bulkCancel">Cancel</button><button class="btn" id="bulkAdd">Add</button></div>`;
  document.body.append(d);
  $('#bulkCancel').onclick=()=>d.close();
  $('#bulkSeg').onclick=e=>{const b=e.target.closest('button');if(!b)return;bulkMode=b.dataset.m;renderBulk()};
  $('#bulkAdd').onclick=addBulk;
}
function openBulk(lines){
  if(!$('#bulkDlg'))buildBulk();
  bulkLines=lines.slice(0,60);bulkMode='each';renderBulk();$('#bulkDlg').showModal();
}
function renderBulk(){
  $('#bulkSeg').querySelectorAll('button').forEach(b=>b.classList.toggle('on',b.dataset.m===bulkMode));
  $('#bulkSub').textContent=`${bulkLines.length} lines found. Dates, #category, !priority and @name work on each line.`;
  $('#bulkTitleWrap').hidden=bulkMode!=='list';
  if(bulkMode==='list'&&!$('#bulkTitle').value)$('#bulkTitle').value=parseQuick(bulkLines[0]).title;
  $('#bulkRows').innerHTML=bulkLines.map((l,i)=>{
    const p=parseQuick(l),chips=[p.due?ic('cal')+fmtDue(p.due):'',p.cat?'#'+esc(p.cat):'',p.pri?['','Low','Medium','High'][p.pri]:''].filter(Boolean);
    return `<div class="brow"><input type="checkbox" data-bi="${i}" checked aria-label="Include"><div class="bt" dir="auto">${esc(bulkMode==='list'&&i===0?'(title) '+p.title:p.title)}${bulkMode==='each'&&chips.length?`<small>${chips.map(c=>`<span class="chip">${c}</span>`).join('')}</small>`:''}</div></div>`}).join('');
  $('#bulkAdd').textContent=bulkMode==='each'?'Add tasks':'Add task';
}
function rowFromParsed(p){
  const a=resolveAssignee(p.assignee);
  const row={workspace_id:ws.id,title:p.title.slice(0,300),priority:p.pri||2,cat:p.cat,repeat:p.repeat,due:iso(p.due),
    remind:p.due?(p.remind!=null?p.remind:(S.defRemind===''?null:Number(S.defRemind))):null,
    assignee_id:a&&a.id!==me.id?a.id:null,visibility:p.team?'team':'private'};
  if(p.link){if(DB2)row.link=p.link;else row.notes=p.link}
  return row;
}
async function addBulk(){
  const chosen=[...document.querySelectorAll('#bulkRows [data-bi]')].filter(c=>c.checked).map(c=>bulkLines[+c.dataset.bi]);
  if(!chosen.length)return;
  let rows;
  if(bulkMode==='each')rows=chosen.map(l=>parseQuick(l)).filter(p=>p.title).map(rowFromParsed);
  else{
    const title=$('#bulkTitle').value.trim()||'Checklist';
    const steps=chosen.map(l=>parseQuick(l).title).filter(Boolean).filter(t=>t!==title);
    rows=[{workspace_id:ws.id,title,priority:2,cat:'',repeat:'',due:null,remind:null,assignee_id:null,visibility:'private',subs:steps.map(text=>({id:uid(),text,done:false}))}];
  }
  $('#bulkAdd').disabled=true;
  const {data,error}=await sb.from('tasks').insert(rows).select();
  $('#bulkAdd').disabled=false;
  if(error){toast('Could not add: '+error.message);return}
  data.forEach(r=>upsert(tasks,fromRow(r)));saveCache();render();ensureNotifPermission();
  $('#bulkDlg').close();$('#quickInput').value='';$('#chips').innerHTML=DEFAULT_TIP;
  toast(rows.length>1?`${rows.length} tasks added`:'Task added');
}
$('#quickInput').addEventListener('paste',e=>{
  const txt=(e.clipboardData||window.clipboardData).getData('text');
  const lines=txt.split(/\r?\n/).map(s=>s.replace(/^\s*(?:[-*•▪◦]|\d+[.)]|\[[ xX]?\])\s+/,'').trim()).filter(Boolean);
  if(lines.length<2)return;
  e.preventDefault();openBulk(lines);
});

/* ===== templates ===== */
const BUILTIN_TPL=[
 {id:'b1',name:'SEO page audit',title:'SEO audit: ',cat:'SEO',priority:2,notes:'Page or section:\nGoal of the audit:',steps:['Title tag and meta description','H1 and heading structure','Canonical and indexability','Internal links in and out','Structured data (schema)','Page speed and Core Web Vitals','Mobile rendering','Summarize the findings']},
 {id:'b2',name:'Content brief',title:'Content brief: ',cat:'Content',priority:2,notes:'Primary keyword:\nSecondary keywords:\nSearch intent:\nMarket and language:\nCompetitor URLs:',steps:['Keyword research (English and Arabic)','Review the top 5 results','Outline and headings','FAQ ideas','Internal link targets','Meta title and description','Brief approved by the lead']},
 {id:'b3',name:'Dev ticket (SEO fix)',title:'SEO fix: ',cat:'SEO',priority:2,notes:'Problem:\n\nWhere it happens (URLs or templates):\n\nCurrent behaviour:\n\nExpected behaviour:\n\nAcceptance criteria:\n- ',steps:['Add screenshots or examples','Create the ClickUp ticket and paste its link above','Follow up with the developer','Verify the fix on live','Close the ticket']},
 {id:'b4',name:'Monthly SEO report',title:'Monthly SEO report',cat:'Reporting',priority:2,repeat:'monthly',notes:'',steps:['Pull Search Console data','Compare traffic with last month','Check keyword rankings','Note wins and losses','List next month’s actions','Send the report']},
 {id:'b5',name:'New landing page launch',title:'Launch page: ',cat:'SEO',priority:2,notes:'URL:\nTarget keyword:',steps:['Confirm target keyword and URL','Write the title, meta description and H1','Add schema markup','Set canonical and index rules','Add internal links to the page','Add the page to the XML sitemap','Submit the URL in Search Console','Check rankings after one week']},
 {id:'b6',name:'Weekly sync prep',title:'Prepare weekly sync',cat:'Team',priority:1,repeat:'weekly',notes:'',steps:['Review last week’s wins','List blockers','Prepare a rankings and traffic snapshot','Add agenda items']},
];
const allTemplates=()=>[...BUILTIN_TPL,...(prefs().templates||[])];
function fillTemplateSelect(){
  const mineT=prefs().templates||[];
  $('#fTpl').innerHTML='<option value="">Blank task</option><optgroup label="Ready-made">'+BUILTIN_TPL.map(t=>`<option value="${t.id}">${esc(t.name)}</option>`).join('')+'</optgroup>'+(mineT.length?'<optgroup label="Your templates">'+mineT.map(t=>`<option value="${t.id}">${esc(t.name)}</option>`).join('')+'</optgroup>':'');
}
$('#fTpl').addEventListener('change',()=>{
  const t=allTemplates().find(x=>x.id===$('#fTpl').value);if(!t)return;
  $('#fTitle').value=t.title||'';$('#fNotes').value=t.notes||'';$('#fPri').value=t.priority||2;$('#fCat').value=t.cat||'';$('#fRepeat').value=t.repeat||'';
  editSubs=(t.steps||[]).map(text=>({id:uid(),text,done:false}));renderSubs();
  $('#fTitle').focus();const L=$('#fTitle').value.length;try{$('#fTitle').setSelectionRange(L,L)}catch{}
});
function saveTemplate(){
  const title=$('#fTitle').value.trim();if(!title){toast('Add a title first');return}
  const name=prompt('Name this template:',title.slice(0,40));if(!name)return;
  const list=[...(prefs().templates||[])];
  if(list.length>=20){toast('You can keep up to 20 templates');return}
  list.push({id:'u'+uid(),name:name.trim().slice(0,60),title,notes:$('#fNotes').value,priority:+$('#fPri').value,cat:$('#fCat').value.trim(),repeat:$('#fRepeat').value,steps:editSubs.map(s=>s.text)});
  savePrefs({templates:list});toast('Template saved',{sub:'Find it under “Start from a template” on any new task.'});
}
function renderTplList(){
  const l=prefs().templates||[];
  $('#tplList').innerHTML=l.length?`<label style="display:block;font-size:13px;font-weight:600;color:var(--ink-2);margin:16px 0 4px">Your templates</label>`+l.map(t=>`<div class="mrow"><span dir="auto">${esc(t.name)}</span><button type="button" class="x" style="margin-left:auto" data-tpldel="${t.id}" aria-label="Delete template">×</button></div>`).join(''):'';
}
$('#tplList').addEventListener('click',e=>{const id=e.target.dataset.tpldel;if(!id)return;savePrefs({templates:(prefs().templates||[]).filter(t=>t.id!==id)});renderTplList()});

/* ===== task dialog extras ===== */
const _openDlg=openDlg;
openDlg=function(t,prefill){
  _openDlg(t,prefill);
  $('#tplRow').hidden=!!t;if(!t)fillTemplateSelect();
  $('#linkRow').hidden=!DB2;
  $('#optBlocked').hidden=!DB2;$('#optBlocked').disabled=!DB2;
  if(t&&DB2&&typeof timeEntries!=='undefined'){
    const secs=timeEntries.filter(e=>e.task_id===t.id).reduce((a,e)=>a+e.seconds,0);
    if(secs)$('#dlgMeta').textContent+=` · ${fmtDur(secs)} tracked`;
  }
};
function copyClickupTitle(){const t=$('#fTitle').value.trim();if(t)copyText(t,'Title copied. Paste it into the ClickUp task name.')}
function copyClickupDesc(){
  const L=[],v=id=>$(id).value.trim(),opt=id=>$(id).selectedOptions[0]?.value?$(id).selectedOptions[0].textContent:'';
  if(v('#fNotes'))L.push(v('#fNotes'),'');
  const meta=[['Priority',['','Low','Medium','High'][+$('#fPri').value]],['Due',$('#fDue').value?new Date($('#fDue').value).toLocaleString([],{dateStyle:'medium',timeStyle:'short'}):''],['Category',v('#fCat')],['Assignee',opt('#fAssignee')],['Link',normLink($('#fLink').value)]].filter(x=>x[1]);
  meta.forEach(([k,x])=>L.push(`**${k}:** ${x}`));
  if(editSubs.length)L.push('','**Steps**',...editSubs.map(s=>`- [${s.done?'x':' '}] ${s.text}`));
  copyText(L.join('\n').trim()||'(no details yet)','Description copied. Paste it into the ClickUp description.');
}
function formTaskForCalendar(){
  const due=$('#fDue').value?new Date($('#fDue').value).getTime():null;
  if(!due){toast('Set a due date first');return null}
  const rem=$('#fRemind').value;
  return {id:editing?editing.id:uid(),title:$('#fTitle').value.trim()||'Task',notes:$('#fNotes').value,due,remind:rem===''?null:Number(rem),link:normLink($('#fLink').value)};
}
$('#moreAct').onclick=()=>{
  const t=editing,own=!t||isOwner(t);
  menu($('#moreAct'),[
    {head:'ClickUp'},
    {label:'Copy title',icon:'copy',fn:copyClickupTitle},
    {label:'Copy description',icon:'copy',fn:copyClickupDesc},
    '-',
    {head:'Calendar'},
    {label:'Add to Google Calendar',icon:'cal',fn:()=>{const f=formTaskForCalendar();if(f)gcalOpen(f)}},
    {label:'Download calendar file (.ics)',icon:'down',fn:()=>{const f=formTaskForCalendar();if(f)saveFile('task.ics',icsFor([f]),'text/calendar')}},
    '-',
    DB2&&t?{label:(typeof timer!=='undefined'&&timer&&timer.taskId===t.id)?'Stop timer':'Start timer',icon:'play',fn:()=>toggleTimer(t)}:null,
    DB2&&t&&own&&t.assignee_id&&t.assignee_id!==me.id?{label:'Nudge '+firstName(t.assignee_id)+' for an update',icon:'bell',fn:()=>nudge(t)}:null,
    own?{label:'Save as a template',icon:'star',fn:saveTemplate}:null,
  ].filter(x=>x!==null));
};
async function nudge(t){
  const {error}=await sb.rpc('nudge_task',{tid:t.id});
  toast(error?error.message:'Nudge sent to '+firstName(t.assignee_id));
}

/* ===== settings extras ===== */
$('#settingsBtn').addEventListener('click',()=>{
  renderTplList();
  const n=$('#dbNotice');n.hidden=DB2;
  if(!DB2)n.textContent='Some features are waiting for a one-time database update (setup-v2.sql): Inbox, Waiting status, ClickUp links, time tracking and synced focus. Everything else works now.';
});
$('#memberList').addEventListener('click',async e=>{
  const id=e.target.dataset.rm;if(!id)return;
  const m=mem(id);if(!confirm(`Remove ${m?m.name:'this person'} from ${ws.name}? Their private tasks stay private to them.`))return;
  const {error}=await sb.rpc('remove_member',{ws:ws.id,uid:id});
  if(error){toast(error.message);return}
  await loadMembers();$('#settingsBtn').click();toast('Removed from the team');
});
$('#icsBtn').onclick=()=>exportIcs();
$('#importCsvBtn').onclick=()=>{$('#setDlg').close();openImport()};

/* ===== keyboard control of the list ===== */
let selId=null;
function applySel(){
  document.querySelectorAll('#list .task.sel').forEach(x=>x.classList.remove('sel'));
  if(!selId)return;const el=document.querySelector(`#list .task[data-id="${selId}"]`);
  if(el){el.classList.add('sel');el.scrollIntoView({block:'nearest'})}else selId=null;
}
EXT.afterRender=()=>{applySel();if(EXT.afterRender2)EXT.afterRender2()};
document.addEventListener('keydown',e=>{
  if(!me||!ws||e.ctrlKey||e.metaKey||e.altKey||document.querySelector('dialog[open]'))return;
  if(/input|textarea|select/i.test(e.target.tagName)||e.target.isContentEditable)return;
  const rows=[...document.querySelectorAll('#list .task')],ids=rows.map(r=>r.dataset.id),k=e.key;
  if(k==='j'||k==='k'){
    if(!ids.length)return;e.preventDefault();
    let i=ids.indexOf(selId);i=k==='j'?Math.min(i+1,ids.length-1):Math.max(i<0?0:i-1,0);selId=ids[i];applySel();return;
  }
  const t=selId&&tasks.find(x=>x.id===selId);if(!t)return;
  if(k==='x'&&mine(t)){e.preventDefault();setStatus(t,isDone(t)?'todo':'done')}
  else if(k==='Enter'||k==='e'){e.preventDefault();openDlg(t)}
  else if(k==='s'&&mine(t)){e.preventDefault();toggleFocus(t.id)}
  else if(k==='t'&&isOwner(t)){e.preventDefault();resched(t,sod()+DAY)}
  else if(k==='m'&&mine(t)&&DB2){e.preventDefault();toggleTimer(t)}
  else if(k==='Escape'){selId=null;applySel()}
});

/* ===== help text ===== */
(()=>{
  const d=$('#helpDlg');if(!d)return;
  const keys=d.querySelector('p:nth-of-type(3)');
  if(keys)keys.innerHTML='<b>Shortcuts.</b> <kbd>Ctrl</kbd> <kbd>K</kbd> search and commands, <kbd>N</kbd> new task, <kbd>/</kbd> search, <kbd>J</kbd> <kbd>K</kbd> move through the list, then <kbd>X</kbd> done, <kbd>E</kbd> open, <kbd>S</kbd> focus, <kbd>T</kbd> tomorrow, <kbd>M</kbd> timer.';
  const more=document.createElement('p');
  more.innerHTML='<b>Make it yours.</b> Paste a list of lines into the top box to create many tasks at once. Press <b>Plan my day</b> each morning, star up to three tasks, and use <b>Standup</b> to copy your daily update or weekly report. Paste a ClickUp link into any task to keep the ticket one click away.';
  d.querySelector('.actions').before(more);
})();
