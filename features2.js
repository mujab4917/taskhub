/* TaskHub features, part 2: inbox, time tracking, calendar, standup + reports, insights,
   calendar export, ClickUp import. Starts the app at the end. */

let notifs=[],timeEntries=[],timer=lsGet('taskhub.timer',null),nchan=null;
const fmtDur=s=>{const h=Math.floor(s/3600),m=Math.round(s%3600/60);return h?`${h}h ${m}m`:`${Math.max(1,m)}m`};
const stamp=ms=>new Date(ms).toLocaleString([],{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});

/* ===== start-up hooks ===== */
EXT.hidden=k=>!DB2&&(k==='inbox'||k==='waiting');
EXT.badge=k=>k==='inbox'?(notifs.filter(n=>!n.read).length||''):'';
EXT.onOpen=async()=>{
  if(!profile.prefs||!Object.keys(profile.prefs).length)profile.prefs=lsGet('taskhub.prefs.'+me.id,{});
  const probe=await sb.from('notifications').select('id').limit(1);
  DB2=!probe.error;
  if(nchan){sb.removeChannel(nchan);nchan=null}
  if(DB2){
    await Promise.all([loadNotifs(),loadTime()]);
    nchan=sb.channel('notif-'+me.id).on('postgres_changes',{event:'INSERT',schema:'public',table:'notifications',filter:'user_id=eq.'+me.id},p=>{
      const n=p.new;notifs.unshift(n);const tx=notifText(n);notify(tx.title,tx.body,n.task_id);render();
    }).subscribe();
  }
  syncPill();
  EXT.planPrompt();
};
EXT.onSignOut=()=>{if(nchan)sb.removeChannel(nchan);nchan=null;notifs=[];timeEntries=[];timer=null;syncPill()};

/* ===== inbox ===== */
async function loadNotifs(){
  const {data}=await sb.from('notifications').select('*').order('created_at',{ascending:false}).limit(60);
  notifs=data||[];
}
function notifText(n){
  const who=n.actor_id?nameOf(n.actor_id):'Someone',t=tasks.find(x=>x.id===n.task_id),tt=t?t.title:'';
  const map={assigned:[`${who} assigned you a task`,tt||n.body],comment:[`${who} commented`,(tt?tt+': ':'')+n.body],mention:[`${who} mentioned you`,(tt?tt+': ':'')+n.body],nudge:[`${who} is asking for an update`,tt||n.body]};
  const [title,body]=map[n.kind]||['New update',n.body];return {title,body};
}
EXT.views.inbox=el=>{
  const un=notifs.filter(n=>!n.read).length;
  el.innerHTML=`<div class="rbar"><button class="btn ghost sm" id="nAll" ${un?'':'disabled'}>Mark all as read</button><button class="btn ghost sm" id="nClear" ${notifs.length?'':'disabled'}>Clear all</button></div>`+
   (notifs.length?notifs.map(n=>{const x=notifText(n);return `<div class="ncard ${n.read?'':'unread'}" data-nid="${n.id}">${av(n.actor_id)}<div class="nb"><b dir="auto">${esc(x.title)}</b><p dir="auto">${esc(x.body.slice(0,180))}</p><small>${stamp(Date.parse(n.created_at))}</small></div></div>`}).join(''):empty('bell','You’re all caught up','Assignments, comments, @mentions and nudges will show up here.'));
  $('#nAll').onclick=async()=>{notifs.forEach(n=>n.read=true);render();await sb.from('notifications').update({read:true}).eq('user_id',me.id).eq('read',false)};
  $('#nClear').onclick=async()=>{if(!confirm('Clear your whole inbox?'))return;notifs=[];render();await sb.from('notifications').delete().eq('user_id',me.id)};
  el.querySelectorAll('[data-nid]').forEach(c=>c.onclick=async()=>{
    const n=notifs.find(x=>x.id===c.dataset.nid);if(!n)return;
    if(!n.read){n.read=true;render();sb.from('notifications').update({read:true}).eq('id',n.id).then(()=>{})}
    const t=tasks.find(x=>x.id===n.task_id);
    if(t)openDlg(t);else toast('That task is no longer visible to you');
  });
};

/* ===== time tracking ===== */
async function loadTime(){
  const {data}=await sb.from('time_entries').select('*').gte('started_at',iso(Date.now()-40*DAY)).order('started_at');
  timeEntries=data||[];
}
const elapsed=()=>timer?Math.floor((Date.now()-timer.start)/1000):0;
const hms=s=>(s>=3600?Math.floor(s/3600)+':'+pad(Math.floor(s%3600/60)):String(Math.floor(s/60)))+':'+pad(s%60);
function syncPill(){
  let p=$('#timerPill');
  if(!timer||!DB2){if(p)p.remove();return}
  if(!p){
    p=document.createElement('div');p.id='timerPill';p.className='tpill';
    p.innerHTML=`<span class="rec"></span><b id="tpTime"></b><span class="tt" dir="auto"></span><button id="tpStop">Stop</button><button class="x2" id="tpDrop" title="Discard" aria-label="Discard timer">×</button>`;
    document.body.append(p);
    $('#tpStop').onclick=()=>stopTimer();
    $('#tpDrop').onclick=()=>{if(confirm('Discard this timer without logging any time?')){timer=null;try{localStorage.removeItem('taskhub.timer')}catch{}syncPill();render()}};
  }
  p.querySelector('.tt').textContent=timer.label;$('#tpTime').textContent=hms(elapsed());
}
setInterval(()=>{const t=$('#tpTime');if(t&&timer)t.textContent=hms(elapsed())},1000);
async function startTimer(t){
  if(timer)await stopTimer(true);
  timer={taskId:t.id,label:t.title,start:Date.now(),ws:ws.id};lsSet('taskhub.timer',timer);
  syncPill();render();toast('Timer started',{sub:t.title});
}
async function stopTimer(silent){
  if(!timer)return;
  let secs=elapsed();const tm=timer;timer=null;try{localStorage.removeItem('taskhub.timer')}catch{}
  syncPill();
  if(secs<30){if(!silent)toast('Timer stopped. Under 30 seconds, so nothing was logged.');render();return}
  if(secs>12*3600){secs=12*3600;toast('Timer capped at 12 hours',{sub:'It was probably left running.'})}
  const {data,error}=await sb.from('time_entries').insert({task_id:tm.taskId,workspace_id:tm.ws||ws.id,label:tm.label,started_at:iso(tm.start),seconds:secs}).select().single();
  if(error)toast('Could not log the time: '+error.message);
  else{timeEntries.push(data);if(!silent)toast('Logged '+fmtDur(secs),{sub:tm.label})}
  render();
}
const toggleTimer=t=>timer&&timer.taskId===t.id?stopTimer():startTimer(t);

/* ===== calendar export (.ics) and Google Calendar ===== */
const icsEsc=s=>String(s||'').replace(/\\/g,'\\\\').replace(/\r?\n/g,'\\n').replace(/,/g,'\\,').replace(/;/g,'\\;');
const icsDate=ms=>new Date(ms).toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'');
function icsFor(list){
  const L=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//TaskHub//Tasks//EN','CALSCALE:GREGORIAN','METHOD:PUBLISH'];
  list.forEach(t=>{
    L.push('BEGIN:VEVENT',`UID:${t.id}@taskhub`,`DTSTAMP:${icsDate(Date.now())}`,`DTSTART:${icsDate(t.due)}`,`DTEND:${icsDate(t.due+30*6e4)}`,`SUMMARY:${icsEsc(t.title)}`);
    const desc=[t.notes,t.link].filter(Boolean).join('\n');if(desc)L.push('DESCRIPTION:'+icsEsc(desc));
    if(t.remind!=null)L.push('BEGIN:VALARM','ACTION:DISPLAY',`DESCRIPTION:${icsEsc(t.title)}`,`TRIGGER:-PT${t.remind}M`,'END:VALARM');
    L.push('END:VEVENT');
  });
  L.push('END:VCALENDAR');return L.join('\r\n');
}
function gcalOpen(t){
  const u='https://calendar.google.com/calendar/render?action=TEMPLATE&text='+encodeURIComponent(t.title)+'&dates='+icsDate(t.due)+'/'+icsDate(t.due+30*6e4)+'&details='+encodeURIComponent([t.notes,t.link].filter(Boolean).join('\n'));
  window.open(u,'_blank','noopener');
}
function exportIcs(){
  const list=tasks.filter(t=>mine(t)&&!isDone(t)&&t.due);
  if(!list.length){toast('No tasks with a due date to export');return}
  saveFile('taskhub-tasks.ics',icsFor(list),'text/calendar');
  toast(`${list.length} task${list.length>1?'s':''} exported`,{sub:'Open the file to add them to Outlook, Apple or Google Calendar, with reminders included.'});
}

/* ===== calendar view ===== */
let calMonth=(()=>{const d=new Date();d.setDate(1);d.setHours(0,0,0,0);return d.getTime()})(),calScope='mine';
EXT.views.cal=el=>{
  const first=new Date(calMonth),y=first.getFullYear(),mo=first.getMonth(),sw=weekStartDay();
  const lead=(first.getDay()-sw+7)%7,days=new Date(y,mo+1,0).getDate(),n=Math.ceil((lead+days)/7)*7;
  const by={};tasks.filter(t=>t.due&&(calScope==='team'||mine(t))).forEach(t=>{const k=startOfDay(t.due);(by[k]=by[k]||[]).push(t)});
  const dows=[...Array(7)].map((_,i)=>`<div class="cal-dow">${new Date(2024,0,7+((sw+i)%7)).toLocaleDateString([],{weekday:'short'})}</div>`).join('');
  const chip=t=>`<div class="cchip p${t.priority} ${isDone(t)?'done':''}" data-id="${t.id}" draggable="${mine(t)&&isOwner(t)}" title="${esc(timeStr(t.due)+'  '+t.title)}"><b>${timeStr(t.due)}</b><span dir="auto">${esc(t.title)}</span></div>`;
  let cells='';
  for(let i=0;i<n;i++){
    const dt=new Date(y,mo,1-lead+i),k=startOfDay(dt.getTime()),items=(by[k]||[]).sort((a,b)=>a.due-b.due);
    cells+=`<div class="cell ${dt.getMonth()!==mo?'out':''} ${k===sod()?'today':''}" data-day="${k}"><span class="dn">${dt.getDate()}</span>${items.slice(0,3).map(chip).join('')}${items.length>3?`<span class="cmore" data-more="${k}">+${items.length-3} more</span>`:''}</div>`;
  }
  el.innerHTML=`<div class="cal"><div class="cal-top"><button class="btn ghost sm" data-c="prev" aria-label="Previous month">${ic('left')}</button><button class="btn ghost sm" data-c="next" aria-label="Next month">${ic('right')}</button><h2>${first.toLocaleDateString([],{month:'long',year:'numeric'})}</h2><button class="btn ghost sm" data-c="today">Today</button><span style="flex:1"></span>
    <select id="calScope" aria-label="Whose tasks"><option value="mine" ${calScope==='mine'?'selected':''}>My tasks</option><option value="team" ${calScope==='team'?'selected':''}>Everything I can see</option></select></div>
    <div class="cal-grid">${dows}${cells}</div><div class="hint" style="margin-top:10px">Click a day to add a task. Drag your own tasks to another day to reschedule them.</div></div>`;
  const root=el.querySelector('.cal');
  root.querySelector('#calScope').onchange=e=>{calScope=e.target.value;render()};
  root.onclick=e=>{
    const c=e.target.closest('[data-c]');
    if(c){const v=c.dataset.c;calMonth=v==='today'?new Date(new Date().getFullYear(),new Date().getMonth(),1).getTime():new Date(y,mo+(v==='next'?1:-1),1).getTime();render();return}
    const ch=e.target.closest('.cchip');if(ch){openDlg(tasks.find(t=>t.id===ch.dataset.id));return}
    const mr=e.target.closest('[data-more]');
    if(mr){const k=+mr.dataset.more;menu(mr,(by[k]||[]).sort((a,b)=>a.due-b.due).map(t=>({label:`${timeStr(t.due)}  ${t.title}`,icon:isDone(t)?'done':'checksq',fn:()=>openDlg(t)})));return}
    const cell=e.target.closest('.cell');
    if(cell){openDlg(null);$('#fDue').value=toLocalInput(+cell.dataset.day+9*36e5)}
  };
  root.ondragstart=e=>{const c=e.target.closest('.cchip');if(c)e.dataTransfer.setData('text/plain','cal:'+c.dataset.id)};
  root.ondragover=e=>{const c=e.target.closest('.cell');if(c){e.preventDefault();root.querySelectorAll('.cell.dropping').forEach(x=>x!==c&&x.classList.remove('dropping'));c.classList.add('dropping')}};
  root.ondrop=e=>{
    const c=e.target.closest('.cell');if(!c)return;e.preventDefault();c.classList.remove('dropping');
    const raw=e.dataTransfer.getData('text/plain');if(!raw.startsWith('cal:'))return;
    const t=tasks.find(x=>x.id===raw.slice(4));if(t)resched(t,+c.dataset.day);
  };
};

/* ===== standup + weekly report ===== */
let repPrivate=true;
const isPrivateT=t=>t.visibility==='private'&&!t.shared_with.length&&!t.assignee_id;
function standupFor(uid,incPriv=repPrivate){
  const y=sod()-DAY;
  let l=tasks.filter(t=>uid===me.id?mine(t):(t.assignee_id===uid||(t.owner_id===uid&&!t.assignee_id)));
  if(uid===me.id&&!incPriv)l=l.filter(t=>!isPrivateT(t));
  const done=l.filter(t=>isDone(t)&&(t.completed_at||0)>=y).sort((a,b)=>b.completed_at-a.completed_at);
  const blk=l.filter(t=>!isDone(t)&&(t.status==='blocked'||isOver(t)));
  const today=l.filter(t=>!isDone(t)&&!blk.includes(t)&&((t.due&&startOfDay(t.due)===sod())||t.status==='doing'));
  return {done,today,blk};
}
const bullet=(a,f)=>a.length?a.map(f).join('\n'):'- None';
function standupText(uid,incPriv=repPrivate){
  const s=standupFor(uid,incPriv);
  return `Standup: ${realName(uid)}, ${dayLabel(Date.now())}\nYesterday:\n${bullet(s.done,t=>'- '+t.title+(t.cat?` [${t.cat}]`:''))}\nToday:\n${bullet(s.today,t=>'- '+t.title+(t.cat?` [${t.cat}]`:''))}\nBlockers:\n${bullet(s.blk,t=>'- '+t.title+(t.status==='blocked'?' (waiting)':' (overdue)'))}`;
}
const copyStandup=()=>copyText(standupText(me.id),'Standup copied. Paste it into your team chat.');
function weeklyText(){
  const from=sod()-6*DAY;let l=tasks.filter(mine);if(!repPrivate)l=l.filter(t=>!isPrivateT(t));
  const done=l.filter(t=>isDone(t)&&(t.completed_at||0)>=from),group={};
  done.forEach(t=>{const k=t.cat||'General';(group[k]=group[k]||[]).push(t)});
  const prog=l.filter(t=>!isDone(t)&&['doing','review','blocked'].includes(t.status));
  const next=l.filter(t=>!isDone(t)&&t.due&&t.due>=sod()&&t.due<sod()+8*DAY).sort((a,b)=>a.due-b.due);
  const secs=DB2?timeEntries.filter(e=>Date.parse(e.started_at)>=from).reduce((a,e)=>a+e.seconds,0):0;
  return `Weekly report: ${realName(me.id)}, ${dayLabel(from)} to ${dayLabel(Date.now())}\n\nCompleted (${done.length}):\n`+
    (done.length?Object.entries(group).map(([k,a])=>`${k}\n`+a.map(t=>'- '+t.title).join('\n')).join('\n'):'- Nothing completed')+
    `\n\nIn progress (${prog.length}):\n${bullet(prog,t=>'- '+t.title+(t.status==='blocked'?' (waiting)':''))}\n\nPlanned for next week (${next.length}):\n${bullet(next,t=>`- ${t.title} (${dayLabel(t.due)})`)}`+
    (secs?`\n\nTime tracked: ${fmtDur(secs)}`:'');
}
const copyWeekly=()=>copyText(weeklyText(),'Weekly report copied. Paste it into an email or doc.');
EXT.views.standup=el=>{
  const list=a=>a.length?`<ul>${a.slice(0,8).map(t=>`<li dir="auto">${esc(t.title)}</li>`).join('')}</ul>${a.length>8?`<div class="none">+${a.length-8} more</div>`:''}`:'<div class="none">None</div>';
  const ordered=[...members].sort((a,b)=>(b.id===me.id)-(a.id===me.id));
  el.innerHTML=`<div class="rbar"><button class="btn sm" id="sMe">Copy my standup</button><button class="btn ghost sm" id="sWeek">Copy my weekly report</button><button class="btn ghost sm" id="sTeam">Copy team standup</button><label><input type="checkbox" id="sPriv" ${repPrivate?'checked':''}>Include my private tasks in my own reports</label></div>
   <div class="sgrid">${ordered.map(m=>{const s=standupFor(m.id);return `<div class="scard"><h3>${av(m.id,'md')}<span dir="auto">${esc(m.name)}${m.id===me.id?' (you)':''}</span></h3><div class="scol"><div class="done"><h4>Finished since yesterday</h4>${list(s.done)}</div><div><h4>Working on today</h4>${list(s.today)}</div><div class="blk"><h4>Waiting or overdue</h4>${list(s.blk)}</div></div></div>`}).join('')}</div>
   <div class="note">${ic('lock')}Teammates appear here only through tasks they’ve assigned or shared. Your private tasks are included in your own reports. Untick the box to leave them out. The team standup never includes them.</div>`;
  $('#sMe').onclick=copyStandup;$('#sWeek').onclick=copyWeekly;
  $('#sTeam').onclick=()=>copyText(ordered.map(m=>standupText(m.id,false)).join('\n\n'),'Team standup copied.');
  $('#sPriv').onchange=e=>{repPrivate=e.target.checked;render()};
};

/* ===== my insights ===== */
EXT.views.insights=el=>{
  const my=tasks.filter(mine),doneT=my.filter(t=>isDone(t)&&t.completed_at);
  const byDay={};doneT.forEach(t=>{const k=startOfDay(t.completed_at);byDay[k]=(byDay[k]||0)+1});
  let streak=0,d=sod();if(!byDay[d])d=startOfDay(d-1);
  for(let i=0;i<400;i++){const wk=[0,6].includes(new Date(d).getDay());if(byDay[d])streak++;else if(!wk)break;d=startOfDay(d-1)}
  const days=[];{let x=sod();for(let i=0;i<14;i++){days.unshift(x);x=startOfDay(x-1)}}
  const week=days.slice(-7).reduce((a,k)=>a+(byDay[k]||0),0);
  const recent=doneT.filter(t=>t.due&&t.completed_at>=sod()-29*DAY),ontime=recent.filter(t=>t.completed_at<=startOfDay(t.due)+DAY).length;
  const rate=recent.length?Math.round(ontime/recent.length*100):null;
  const bars=(arr,key)=>{const max=Math.max(1,...arr.map(a=>a[key]));return `<div class="chart">${arr.map(a=>`<div class="bar1 ${a[key]?'':'zero'} ${a.today?'today':''}"><b>${a[key]||''}</b><i style="height:${Math.round(a[key]/max*78)}%"></i><span>${a.label}</span></div>`).join('')}</div>`};
  const lab=k=>new Date(k).toLocaleDateString([],{weekday:'narrow'});
  const done14=days.map(k=>({label:lab(k),n:byDay[k]||0,today:k===sod()}));
  const ahead=[];{let x=sod();for(let i=0;i<7;i++){const k=x;ahead.push({label:lab(k),n:my.filter(t=>!isDone(t)&&t.due&&startOfDay(t.due)===k).length,today:i===0});x=startOfDay(x+DAY+3*36e5)}}
  let timeHtml='';
  if(DB2){
    const wk=timeEntries.filter(e=>Date.parse(e.started_at)>=sod()-6*DAY),tot=wk.reduce((a,e)=>a+e.seconds,0);
    const todaySecs=timeEntries.filter(e=>Date.parse(e.started_at)>=sod()).reduce((a,e)=>a+e.seconds,0);
    const cat={};wk.forEach(e=>{const t=tasks.find(x=>x.id===e.task_id);const k=(t&&t.cat)||'No category';cat[k]=(cat[k]||0)+e.seconds});
    const rows=Object.entries(cat).sort((a,b)=>b[1]-a[1]),max=rows.length?rows[0][1]:1;
    timeHtml=`<div class="scard" style="margin-top:12px"><h3>Time tracked</h3>${tot?`<div class="hbars">${rows.map(([k,v])=>`<div class="hbar"><span dir="auto">${esc(k)}</span><div class="tr"><i style="width:${Math.round(v/max*100)}%"></i></div><span>${fmtDur(v)}</span></div>`).join('')}</div>`:'<div class="muted">No time logged this week. Press the play button on a task to start a timer.</div>'}<div class="hint" style="margin-top:12px">Today ${fmtDur(todaySecs||0)}${todaySecs?'':' (nothing yet)'}, last 7 days ${tot?fmtDur(tot):'none'}. Only you can see your time.</div></div>`;
  }
  el.innerHTML=`<div class="cards">
    <div class="stat"><b>${streak}</b><span>Day streak (weekends don’t break it)</span></div>
    <div class="stat"><b>${week}</b><span>Finished in the last 7 days</span></div>
    <div class="stat"><b>${rate==null?'—':rate+'%'}</b><span>Finished on time, last 30 days</span></div>
    <div class="stat"><b>${my.filter(t=>!isDone(t)).length}</b><span>Open right now</span></div></div>
   <div class="sgrid"><div class="scard"><h3>Finished per day</h3>${bars(done14,'n')}</div>
   <div class="scard"><h3>Coming up in the next 7 days</h3>${bars(ahead,'n')}</div></div>${timeHtml}
   <div class="note">${ic('lock')}These numbers are about you only. Nobody else sees them.</div>`;
};

/* team dashboard gets a 14-day chart too */
const _renderDash=renderDash;
renderDash=function(el){
  _renderDash(el);
  const days=[];{let x=sod();for(let i=0;i<14;i++){days.unshift(x);x=startOfDay(x-1)}}
  const cnt={};tasks.filter(t=>isDone(t)&&t.completed_at).forEach(t=>{const k=startOfDay(t.completed_at);cnt[k]=(cnt[k]||0)+1});
  const max=Math.max(1,...days.map(k=>cnt[k]||0));
  el.insertAdjacentHTML('beforeend',`<div class="scard" style="margin-top:14px;max-width:920px"><h3>Team: finished per day</h3><div class="chart">${days.map(k=>`<div class="bar1 ${cnt[k]?'':'zero'} ${k===sod()?'today':''}"><b>${cnt[k]||''}</b><i style="height:${Math.round((cnt[k]||0)/max*78)}%"></i><span>${new Date(k).toLocaleDateString([],{weekday:'narrow'})}</span></div>`).join('')}</div></div>`);
};

/* ===== ClickUp CSV import ===== */
let impItems=[],impHasAssignee=false;
function parseCSV(text){
  text=text.replace(/^\uFEFF/,'');const rows=[];let row=[],f='',q=false;
  for(let i=0;i<text.length;i++){
    const c=text[i];
    if(q){if(c==='"'){if(text[i+1]==='"'){f+='"';i++}else q=false}else f+=c}
    else if(c==='"')q=true;
    else if(c===','){row.push(f);f=''}
    else if(c==='\n'||c==='\r'){if(c==='\r'&&text[i+1]==='\n')i++;row.push(f);rows.push(row);row=[];f=''}
    else f+=c;
  }
  if(f!==''||row.length){row.push(f);rows.push(row)}
  return rows.filter(r=>r.some(x=>x.trim()!==''));
}
function looseDate(s){
  s=(s||'').trim();if(!s)return null;
  if(/^\d{12,13}$/.test(s))return Number(s);
  const iso8=s.match(/^(\d{4})-(\d{2})-(\d{2})$/);if(iso8)return new Date(+iso8[1],+iso8[2]-1,+iso8[3],9,0).getTime();
  const t=Date.parse(s);if(isNaN(t))return null;
  const d=new Date(t);if(!d.getHours()&&!d.getMinutes())d.setHours(9,0,0,0);return d.getTime();
}
function mapClickup(rows){
  if(rows.length<2)return [];
  const head=rows[0].map(h=>h.trim().toLowerCase());
  const idx=(...n)=>{for(const x of n){const i=head.indexOf(x);if(i>=0)return i}return -1};
  const c={title:idx('task name','name','title','task'),desc:idx('task content','description','content','notes'),due:idx('due date','due','due date text'),pri:idx('priority'),st:idx('status'),as:idx('assignees','assignee'),id:idx('task id','id'),tag:idx('tags','tag'),list:idx('list name','list','folder name'),url:idx('url','task url','link')};
  if(c.title<0)return null;
  impHasAssignee=c.as>=0;
  const g=(r,i)=>i>=0?(r[i]||'').trim():'';
  return rows.slice(1).map(r=>{
    const pri=g(r,c.pri).toLowerCase(),st=g(r,c.st).toLowerCase(),id=g(r,c.id);
    return {title:g(r,c.title),notes:g(r,c.desc).slice(0,4000),due:looseDate(g(r,c.due)),
      priority:/urgent|high/.test(pri)?3:/low/.test(pri)?1:2,
      status:/complete|closed|done/.test(st)?'done':/progress/.test(st)?'doing':/review/.test(st)?'review':'todo',
      assignees:g(r,c.as).split(/[;,]/).map(x=>x.trim()).filter(Boolean),
      cat:(g(r,c.tag).split(/[;,]/)[0]||g(r,c.list)).slice(0,40),
      link:g(r,c.url)||(id?'https://app.clickup.com/t/'+id.replace(/^#/,''):'')};
  }).filter(x=>x.title);
}
function buildImport(){
  const d=document.createElement('dialog');d.id='impDlg';
  d.innerHTML=`<h2>Import from ClickUp</h2><div id="impBody"></div><div class="actions"><button class="btn ghost" id="impCancel">Close</button><button class="btn" id="impGo" hidden>Import</button></div>`;
  document.body.append(d);
  $('#impCancel').onclick=()=>d.close();
  $('#impGo').onclick=runImport;
}
function openImport(){
  if(!$('#impDlg'))buildImport();
  impItems=[];$('#impGo').hidden=true;
  $('#impBody').innerHTML=`<p class="muted" style="margin-top:0">Export your tasks from ClickUp as a CSV file, then drop it here. TaskHub keeps each task’s name, notes, due date, priority, status and a link back to the ClickUp ticket.</p>
   <label class="dropzone" for="impFile"><b>Choose your ClickUp CSV file</b>It stays on your computer until you confirm the import.</label><input type="file" id="impFile" accept=".csv,text/csv" hidden>`;
  $('#impFile').onchange=async e=>{
    const f=e.target.files[0];if(!f)return;
    const items=mapClickup(parseCSV(await f.text()));
    if(!items||!items.length){$('#impBody').insertAdjacentHTML('beforeend','<div class="err">That file doesn’t look like a ClickUp export (no task name column).</div>');return}
    impItems=items;renderImport();
  };
  $('#impDlg').showModal();
}
function myNameMatch(a){const me1=(profile.name||'').toLowerCase().split(/\s+/)[0];return !!me1&&a.toLowerCase().includes(me1)}
function impFiltered(){
  const inc=$('#impDone')?.checked,only=$('#impMine')?.checked;
  return impItems.filter(x=>(inc||x.status!=='done')&&(!only||x.assignees.some(myNameMatch)));
}
function renderImport(){
  const hasMine=impItems.some(x=>x.assignees.some(myNameMatch));
  $('#impBody').innerHTML=`<p style="margin-top:0"><b>${impItems.length}</b> tasks found.</p>
   <label class="check"><input type="checkbox" id="impDone"><span>Include tasks that are already complete</span></label>
   ${impHasAssignee?`<label class="check"><input type="checkbox" id="impMine" ${hasMine?'checked':''}><span>Only tasks assigned to me (${esc((profile.name||'').split(' ')[0])})</span></label>`:''}
   <div id="impPrev"></div><div class="hint">Imported tasks are private to you. You can share or assign them afterwards.</div>`;
  const upd=()=>{const l=impFiltered();$('#impPrev').innerHTML=`<div class="psec">Ready to import<em>${l.length}</em></div>`+l.slice(0,6).map(x=>`<div class="prow"><div class="pt" dir="auto">${esc(x.title)}<small>${x.due?fmtDue(x.due):'No date'}${x.cat?' · '+esc(x.cat):''}</small></div></div>`).join('')+(l.length>6?`<div class="pempty">…and ${l.length-6} more</div>`:'');$('#impGo').hidden=!l.length;$('#impGo').textContent=`Import ${l.length} task${l.length===1?'':'s'}`};
  $('#impBody').onchange=upd;upd();
}
async function runImport(){
  const l=impFiltered();if(!l.length)return;$('#impGo').disabled=true;
  const rows=l.map(x=>{
    const other=members.find(m=>m.id!==me.id&&x.assignees.some(a=>a.toLowerCase().includes((m.name||'').toLowerCase().split(/\s+/)[0]||'~~')));
    const r={workspace_id:ws.id,title:x.title.slice(0,300),notes:x.notes,due:iso(x.due),priority:x.priority,cat:x.cat,status:x.status,
      completed_at:x.status==='done'?iso(Date.now()):null,remind:x.due&&x.status!=='done'?(S.defRemind===''?null:Number(S.defRemind)):null,
      assignee_id:!$('#impMine')?.checked&&other?other.id:null,visibility:'private'};
    if(x.link){if(DB2)r.link=x.link;else r.notes=(r.notes?r.notes+'\n\n':'')+x.link}
    return r;
  });
  let added=0;
  for(let i=0;i<rows.length;i+=40){
    const {data,error}=await sb.from('tasks').insert(rows.slice(i,i+40)).select();
    if(error){toast('Import stopped: '+error.message);break}
    data.forEach(r=>upsert(tasks,fromRow(r)));added+=data.length;
  }
  $('#impGo').disabled=false;saveCache();render();$('#impDlg').close();
  if(added)toast(`${added} task${added>1?'s':''} imported`,{sub:'They’re private to you until you share them.'});
}

/* ===== go ===== */
EXT.afterRender2=()=>{
  const un=notifs.filter(n=>!n.read).length,od=tasks.filter(FILTERS.overdue.f).length;
  document.title=(un+od?`(${un+od}) `:'')+'TaskHub';
};
window.__booted=true;
boot();
