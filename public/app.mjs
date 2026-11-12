import {uid,clone,day,addDays,parseDate,newPlanner,newTask,labelName,bucketName,sorts,filtered,sortTasks,saveTask,toggleTask,removeBucket,removeLabel,moveTask,palettes,rank,validateNotifications,newProject,projectDue,taskDue,toggleProjectCompletion,newMessageForm,newSection,sectionStatuses,dueConditions,sectionTitle,notificationFormats,projectName,projectStats,matchesProject,removeProject,projectLabelId,taskLabels} from './model.mjs';
const $=(s,root=document)=>root.querySelector(s), $$=(s,root=document)=>[...root.querySelectorAll(s)];
const esc=x=>String(x??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
const icons={goal:'M5 21V4c5-4 9 4 14 0v11c-5 4-9-4-14 0',home:'M3 10 12 3l9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z',board:'M3 4h5v16H3z M10 4h5v10h-5z M17 4h4v13h-4z',calendar:'M4 5h16v16H4z M4 10h16 M8 3v4 M16 3v4',timeline:'M4 5h10v4H4z M9 12h11v4H9z M4 3v19',chart:'M4 20V10h4v10 M10 20V4h4v16 M16 20v-7h4v7',list:'M8 6h13 M8 12h13 M8 18h13 M3 6h1 M3 12h1 M3 18h1',settings:'M9 4h6l1 4 4 1v6l-4 1-1 4H9l-1-4-4-1V9l4-1Z M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0',collapse:'M4 4h16v16H4z M9 4v16 M16 9l-3 3 3 3',plus:'M12 5v14 M5 12h14',close:'M6 6l12 12 M6 18 18 6',trash:'M4 7h16 M9 7V4h6v3 M6 7l1 14h10l1-14 M10 10v7 M14 10v7',edit:'m4 16 12-12 4 4L8 20H4z M14 6l4 4',arrow:'M5 12h14 m-5-5 5 5-5 5',filter:'M4 5h16 M7 12h10 M10 19h4',sort:'M8 4v16 m-4-4 4 4 4-4 M14 5h7 M14 10h5 M14 15h3',more:'M5 12h.1 M12 12h.1 M19 12h.1',check:'m5 12 4 4L19 6',restore:'M4 10a8 8 0 1 1 1 8 M4 4v6h6',copy:'M8 8h13v13H8z M3 16V3h13',grip:'M9 5h.1 M15 5h.1 M9 12h.1 M15 12h.1 M9 19h.1 M15 19h.1'};
const icon=name=>`<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round">${(icons[name]||icons.more).split(' | ').map(d=>`<path d="${d}"/>`).join('')}</svg>`;
function btn(action,text='',{id='',cls='',title='',disabled=false,extra=''}={}) {return `<button type="button" data-action="${action}" data-id="${esc(id)}" class="${cls}" ${title?`title="${esc(title)}" aria-label="${esc(title)}"`:''} ${disabled?'disabled':''} ${extra}>${text}</button>`;}
const ib=(action,ic,title,id='',disabled=false)=>btn(action,icon(ic),{id,cls:'icon-button',title,disabled});
const opts=(items,value)=>items.map(([v,t])=>`<option value="${esc(v)}" ${String(v)===String(value)?'selected':''}>${esc(t)}</option>`).join('');
const select=(attr,items,value)=>`<select ${attr}>${opts(items,value)}</select>`;
const field=(label,control,cls='')=>`<label class="field ${cls}"><span>${label}</span>${control}</label>`;
const input=(attr,value='',type='text')=>`<input type="${type}" ${attr} value="${esc(value)}">`;
const check=(attr,value,label)=>`<label class="check"><input type="checkbox" ${attr} ${value?'checked':''}><span>${label}</span></label>`;
const empty=text=>`<div class="empty">${text}</div>`;
const menus=[['projects','goal','목표','목표 진행과 일정'],['board','board','보드','버킷별 작업 흐름'],['calendar','calendar','일정','시작 날짜와 기한 기준 캘린더'],['timeline','timeline','타임라인','Task 기간과 진행 상태 Gantt'],['chart','chart','차트','완료, 버킷, 우선순위 통계'],['list','list','전체','모든 Task 조회와 빠른 완료 처리'],['settings','settings','설정','완료 액션, 버킷, 레이블 관리']];
let state,revision,status,selected=null,view='home',trash=false,modal=null,pop=null,task=null,notificationDrafts=new Map(),formSelection=new Map(),rowSelection=new Map(),saveChain=Promise.resolve(),saveError='',saving=0,busyActions=0;
let month=day().slice(0,7),timelineStart=addDays(day(),-3),suppressClick=0,drag=null,taskDateBaseline=null,dateValidationErrors=[];
const collapsedProjects=new Set();
const wideProjectView=matchMedia('(min-width: 1100px)');
let projectPreview=null;
let showClosedProjects=false;
let includeClosedBoardProjects=false;
let messagePreviewChannel='teams';
const planner=()=>state.planners.find(p=>p.id===selected&&!p.deletedAt);
function notify(message,error=false){const t=$('#toast');t.textContent=message;t.className=error?'error':'visible';clearTimeout(notify.timer);notify.timer=setTimeout(()=>{t.className='';},error?6500:2800);}
async function api(route,method='GET',body){const res=await fetch(route,{method,headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});const data=await res.json();if(!res.ok){const e=Error(data.error||'요청 실패');e.data=data;throw e;}return data;}
let savedState,plannerVersions=new Map(),uiVersion,latestKnownRevision=0;
function acceptWorkspace(data){
  state=data.state;
  savedState=clone(state);
  plannerVersions=new Map(Object.entries(data.plannerVersions??{}));
  uiVersion=data.uiVersion;
  revision=data.revision;
  latestKnownRevision=data.revision;
  status=data.status;
}
function acknowledgeSave(result){
  latestKnownRevision=Math.max(latestKnownRevision,result.revision);
  if(result.previousRevision===revision)revision=result.revision;
  status.savedAt=result.savedAt??new Date().toISOString();
}
function enqueueSave(operation,{keepError=false}={}){
  saving++;
  storageLabel();
  const run=saveChain.then(async()=>{
    if(saveError)throw Error(saveError);
    return operation();
  });
  saveChain=run.catch(error=>{if(keepError)saveError=error.message;}).finally(()=>{saving--;storageLabel();});
  return run;
}
function persist(message='저장 완료'){
  const snapshot=clone(state);
  return enqueueSave(async()=>{
    if(JSON.stringify(snapshot.ui)!==JSON.stringify(savedState.ui)){
      const result=await api('/api/planner','PUT',{ui:snapshot.ui,version:uiVersion});
      savedState.ui=snapshot.ui;
      uiVersion=result.version;
      acknowledgeSave(result);
    }
    const committed=new Map(savedState.planners.map((p,index)=>[p.id,index]));
    for(const planner of snapshot.planners){
      const index=committed.get(planner.id);
      const previous=savedState.planners[index];
      // A Task edit can have been queued before the notifications were saved.
      if(previous)planner.notifications=previous.notifications;
      if(previous&&JSON.stringify(planner)===JSON.stringify(previous))continue;
      const result=await api('/api/planner','PUT',{planner,version:plannerVersions.get(planner.id)??null});
      if(previous)savedState.planners[index]=planner;
      else savedState.planners.push(planner);
      plannerVersions.set(planner.id,result.version);
      acknowledgeSave(result);
    }
    if(message)notify(message);
  },{keepError:true}).catch(error=>{notify(error.message,true);throw error;});
}
function storageLabel(){const el=$('#save-state');if(el)el.textContent=saveError?'저장 실패 · 입력 유지':saving?'저장 중…':'모든 변경 저장됨';const detail=$('#storage-detail');if(detail)detail.textContent=saveError||`단일 base 내부에 저장됨 · 마지막 저장 ${new Date(status.savedAt).toLocaleString('ko-KR')}`;}
function render(){
  hideOutput();
  rememberProjectPreview();
  const p=planner();
  if(!p)view='home';
  if(view!=='projects'||!p?.projects.some(project=>project.id===projectPreview?.id&&!!project.closed===showClosedProjects))projectPreview=null;
  const colors=p?.appearance.colors||palettes[0].colors;
  ['--site','--sidebar','--bucket','--popup'].forEach((key,i)=>document.documentElement.style.setProperty(key,colors[i]));document.documentElement.style.setProperty('--bucket-width',`${p?.appearance.width||340}px`);
  const count=state.planners.filter(p=>!p.deletedAt).length,current=menus.find(x=>x[0]===view);
  $('#app').innerHTML=`<aside class="sidebar ${state.ui.collapsed?'collapsed':''}"><div class="sidebar-top">${ib('collapse','collapse','사이드바 확장·축소')}<span class="beta">BETA</span></div><button class="brand" data-action="home" title="Planner 홈"><img src="/icon.svg" alt=""><span><strong>${esc(p?.name||'Kanban Planner')}</strong><small>${esc(p?.description||'Kanban planner')}</small></span></button><div class="workspace-label">WORKSPACE</div><nav>${btn('home',`${icon('home')}<span>내 Planner</span><b>${count}</b>`,{cls:view==='home'?'active':'',title:'내 Planner'})}${view==='home'?'':`<div class="nav-divider"></div>${menus.filter(([id])=>id!=='projects'||status.projects).map(([id,ic,name])=>btn('nav',`${icon(ic)}<span>${name}</span>`,{id,cls:view===id?'active':'',title:name})).join('')}`}</nav><div class="sidebar-bottom"><span class="status-dot"></span><span id="save-state"></span><small>LOCAL WORKSPACE</small></div></aside>
  <main><header><div><div class="eyebrow">${view==='home'?'YOUR PERSONAL WORKSPACE':esc(p.name)}</div><h1>${view==='home'?'Planner':current[2]}</h1><p>${view==='home'?(trash?'30일 보관':'워크스페이스'):current[3]}</p></div><div class="toolbar">${view==='home'?(trash?'':btn('planner-new',icon('plus')+'새 Planner',{cls:'primary'})):view==='projects'?btn('project-new',icon('plus')+'새 목표',{cls:'primary'}):view==='settings'?'':`${btn('sort',icon('sort')+'정렬',{cls:p.sort!=='manual'?'selected':''})}${btn('filter',icon('filter')+'필터'+(filtersActive(p)?'<i class="active-dot"></i>':''),{cls:filtersActive(p)?'selected':''})}${view==='board'?btn('bucket-new',icon('plus')+'버킷'):''}${btn('task-new',icon('plus')+'Task',{cls:'primary'})}`}</div></header><section id="content" class="content ${view}">${p&&view!=='projects'&&view!=='home'&&view!=='settings'?activeFilterChips(p):''}${view==='home'?home()+(count?'':backupPanel()):view==='projects'?projectsView(p):view==='board'?board(p):view==='calendar'?calendar(p):view==='timeline'?timeline(p):view==='chart'?charts(p):view==='list'?table(p):settings(p)}</section><footer><span>Kanban Planner <b>Beta</b></span><span>생각을 정리하고, 다음으로 나아가세요.</span></footer></main>`;
  syncProjectPreview(p);
  storageLabel();if(pop)renderPopover();
}
const dueFilterOptions=[['all','전체'],['overdue','기한 초과'],['today','오늘'],['week','7일 이내'],['none','기한 없음']];
const statusFilterOptions=[['all','전체'],['complete','완료'],['incomplete','미완료']];
function filtersActive(p){const f=p.filters;return ['bucket','priority','due','status'].some(k=>f[k]!=='all')||(f.project??'all')!=='all'||f.from||f.to||f.labels.length;}
function home(){const list=state.planners.filter(p=>trash?!!p.deletedAt:!p.deletedAt);return `<div class="home-heading"><div class="tabs">${btn('home-normal','내 Planner',{cls:!trash?'active':''})}${btn('home-trash',`휴지통 <span class="count">${state.planners.filter(p=>p.deletedAt).length}</span>`,{cls:trash?'active':''})}</div><span class="muted">${list.length}개의 Planner</span></div>${list.length?`<div class="planner-list">${list.map(p=>`<article class="planner-row"><div class="planner-mark">${icon(trash?'trash':'board')}</div>${trash?`<div class="planner-title"><strong>${esc(p.name)}</strong><small>${esc(p.description)}</small></div><div class="retention"><b>${Math.max(0,Math.ceil((Date.parse(p.deletedAt)+30*86400000-Date.now())/86400000))}일 남음</b><small>${day(new Date(Date.parse(p.deletedAt)+30*86400000))} 영구 삭제 예정</small></div>${ib('planner-restore','restore','Planner 복원',p.id)}`:`<button class="planner-title" data-action="planner-open" data-id="${p.id}"><strong>${esc(p.name)}</strong><small>${esc(p.description)||'설명 없음'}</small></button><div class="planner-count"><b>${p.tasks.length}</b><small>전체 Task</small></div><div class="planner-count"><b>${p.tasks.filter(t=>!t.completed).length}</b><small>미완료</small></div><div class="row-actions">${ib('planner-edit','edit','Planner 편집',p.id)}${ib('planner-delete','trash','Planner 삭제',p.id)}</div>${ib('planner-open','arrow','Planner 열기',p.id)}`}</article>`).join('')}</div>`:empty(trash?'휴지통이 비어 있습니다.':'Planner가 없습니다. 새 Planner를 만들어 시작하세요.')}<div class="home-note"><span class="status-dot"></span>모든 작업은 이 PC의 단일 base 안에 보관됩니다.</div>`;}
function chips(p,ids){return ids.map(id=>{const l=p.labels.find(x=>x.id===id);return l?`<span class="chip" data-label-id="${id}" style="--label:${l.color}"><i></i>${esc(labelName(p,id))}</span>`:'';}).join('');}
const completion=(p,t)=>btn('task-toggle',t.completed?icon('check'):'',{id:t.id,cls:`completion ${t.completed?'done':''}`,title:t.completed?'미완료로 변경':'Task 완료'});
function card(p,t){const labels=taskLabels(p,t),due=taskDue(p,t);return `<article class="task-card ${t.completed?'completed':''}" data-task="${t.id}" tabindex="0" role="button" aria-label="Task 편집: ${esc(t.title)}"><div class="card-title">${completion(p,t)}<strong>${esc(t.title)}</strong></div>${t.projectId?`<span class="project-badge">${esc(projectName(p,t.projectId))}</span>`:''}${t.showChecklist?`<div class="card-checklist">${t.checklist.filter(c=>!c.done&&c.text.trim()).map(c=>btn('card-check',`<span class="mini-check"></span>${esc(c.text)}`,{id:t.id,extra:`data-check="${c.id}"`})).join('')}</div>`:''}${t.showNotes&&t.notes.trim()?`<p class="note-preview">${esc(t.notes.trim())}</p>`:''}${labels.length?`<div class="chips">${chips(p,labels)}</div>`:''}<div class="card-meta"><span class="priority p${rank(t.priority)}"><i></i>${esc(t.priority)}</span>${due?`<span class="${!t.completed&&due<day()?'overdue':!t.completed&&due===day()?'due-today':''}">${icon('calendar')}기한 ${due}</span>`:''}${t.checklist.length?`<span>${icon('check')}${t.checklist.filter(c=>c.done).length}/${t.checklist.length}</span>`:''}${t.completed?`<span>완료 ${t.completed}</span>`:''}</div></article>`;}
const projectOptions=(p,all=false,selected)=>[
  ...(all?[['all','전체 목표']]:[]),['none','목표 없음'],
  ...(p.projects??[]).map(x=>[x.id,x.name+(x.closed?' (완료)':'')]),
  ...(selected&&!['all','none'].includes(selected)&&!p.projects?.some(x=>x.id===selected)?[[selected,'삭제된 목표']]:[])
];
const projectKey=(p,view,id)=>p.id+'/'+view+'/'+id;
const progressText=s=>'Task '+s.done+'/'+s.total+' 완료';
function activeFilterChips(p){
  const f=p.filters, chips=[];
  if(status.projects&&f.project!=='all'){
    const name=projectOptions(p,true,f.project).find(([id])=>id===f.project)?.[1];
    chips.push(['project',`목표: ${name}`]);
  }
  if(f.bucket!=='all')chips.push(['bucket',`버킷: ${bucketName(p,f.bucket)}`]);
  if(f.priority!=='all')chips.push(['priority',`우선순위: ${f.priority}`]);
  if(f.due!=='all')chips.push(['due',`기한: ${dueFilterOptions.find(([value])=>value===f.due)[1]}`]);
  if(f.status!=='all')chips.push(['status',`Task 상태: ${statusFilterOptions.find(([value])=>value===f.status)[1]}`]);
  if(f.from||f.to){
    const range=f.from&&f.to?`${f.from} ~ ${f.to}`:f.from?`${f.from} 이후`:`${f.to} 이전`;
    chips.push(['dates',`완료일: ${range}`]);
  }
  if(f.labels.length){
    const label=f.labels.length===1?`레이블: ${labelName(p,f.labels[0])}`:`레이블 ${f.labels.length}개`;
    chips.push(['labels',label]);
  }
  if(!chips.length)return '';
  const buttons=chips.map(([id,label])=>btn('filter-chip-clear',`<span>${esc(label)}</span>${icon('close')}`,{
    id,cls:'filter-chip',title:`${label} 필터 해제`
  })).join('');
  const reset=chips.length>1?btn('filter-reset','모두 해제',{id:'chips'}):'';
  return `<div class="active-filters" role="group" aria-label="적용된 필터">${buttons}${reset}</div>`;
}
function projectsView(p){
  const closedCount=p.projects.filter(project=>project.closed).length;
  const tabs=`<div class="tabs project-status-tabs" role="group" aria-label="목표 상태">${[
    ['active','진행 중',p.projects.length-closedCount,false],
    ['closed','완료',closedCount,true]
  ].map(([id,label,count,closed])=>{
    const active=closed===showClosedProjects;
    return btn('project-status',`${label} · ${count}`,{id,cls:active?'active':'',extra:`aria-pressed="${active}"`});
  }).join('')}</div>`;
  const projects=p.projects.filter(project=>!!project.closed===showClosedProjects);
  if(!projects.length)return tabs+empty(showClosedProjects?'완료된 목표가 없습니다.':p.projects.length?'진행 중인 목표가 없습니다.':'목표를 만들어 관련 Task를 한곳에서 관리하세요.');
  const today=day();
  const year=today.slice(0,4);
  const dateText=date=>date?`<time datetime="${esc(date)}">${esc(date.startsWith(year)?date.slice(5).replace('-','/'):date)}</time>`:'—';
  const dockedProject=wideProjectView.matches&&projects.find(project=>project.id===projectPreview?.id);
  const cards=`<div class="project-grid${dockedProject?' project-grid-compact':''}">${projects.map(project=>{
    const s=projectStats(p.tasks.filter(t=>t.projectId===project.id),today,project.due);
    const label=project.labelId&&chips(p,[project.labelId]);
    const selected=project.id===dockedProject?.id;
    const previewAttrs=wideProjectView.matches
      ? `aria-expanded="${selected}"${selected?' aria-current="true" aria-controls="project-preview"':''}`
      : 'aria-haspopup="dialog"';
    return `<article class="panel project-panel${selected?' project-panel-selected':''}">
      <div class="project-panel-title"><h2>${btn('project-preview',esc(project.name)+icon('arrow'),{id:project.id,cls:'project-preview-trigger',extra:previewAttrs})}</h2><span class="project-badge">${project.closed?'완료':'진행 중'}</span></div>
      ${label||project.description?`<div class="project-meta">
        ${label?`<div class="chips project-label">${label}</div>`:''}
        ${project.description?`<p class="muted project-description">${esc(project.description)}</p>`:''}
      </div>`:''}
      <div class="project-metrics"><b>${progressText(s)}</b><span class="${s.overdue?'overdue':''}">기한 초과 ${s.overdue}</span><span>다음 기한 ${dateText(s.nextDue)}</span>${project.completed?`<span class="muted">완료일 ${dateText(project.completed)}</span>`:''}</div>
      <progress max="${s.total||1}" value="${s.done}" aria-label="${progressText(s)}"></progress>
      <div class="project-panel-footer">
        <p class="muted">일정 ${dateText(project.start)} ~ ${dateText(project.due)}</p>
        <div class="row-actions">${btn('project-open','보드 열기',{id:project.id,cls:'primary'})}${btn('project-edit','편집',{id:project.id})}${btn('project-close',project.closed?'재개':'완료',{id:project.id})}${ib('project-delete','trash','목표 삭제',project.id)}</div>
      </div>
    </article>`;
  }).join('')}</div>`;
  if(!dockedProject)return tabs+cards;
  return tabs+`<div class="project-workspace">${cards}${projectPreviewPanel(p,dockedProject,true)}</div>`;
}
function focusProjectStatus(){
  $('[data-action="project-status"][aria-pressed="true"]')?.focus();
}
function rememberProjectPreview(){
  const panel=$('#project-preview');
  if(!projectPreview||panel?.dataset.projectId!==projectPreview.id)return;
  projectPreview.scrollTop=$('.project-preview-body',panel).scrollTop;
  projectPreview.completedOpen=!!$('.project-preview-completed',panel)?.open;
}

function focusProjectCard(id){
  $(`[data-action="project-preview"][data-id="${CSS.escape(id)}"]`)?.focus({preventScroll:true});
}

function openProjectPreview(id){
  if(projectPreview?.id===id)return;
  projectPreview={id,scrollTop:0,completedOpen:false};
  render();
  if(wideProjectView.matches)focusProjectCard(id);
}

function closeProjectPreview(){
  const id=projectPreview.id;
  projectPreview=null;
  render();
  focusProjectCard(id);
}

function syncProjectPreview(p){
  const wasModal=modal?.kind==='project-preview';
  if(projectPreview&&!wideProjectView.matches&&(!modal||wasModal)){
    const project=p.projects.find(x=>x.id===projectPreview.id);
    modal={kind:'project-preview',id:project.id};
    $('#overlay').innerHTML=`<div class="modal-backdrop project-preview-backdrop">${projectPreviewPanel(p,project,false)}</div>`;
    $('.project-preview [data-action="project-preview-close"]').focus();
  }else if(wasModal){
    modal=null;
    $('#overlay').replaceChildren();
    if(projectPreview)focusProjectCard(projectPreview.id);
  }
  const list=$('.project-preview-body');
  if(list)list.scrollTop=projectPreview.scrollTop;
}
function projectPreviewPanel(p,project,docked){
  const tasks=p.tasks.filter(t=>t.projectId===project.id);
  const stats=projectStats(tasks,day(),project.due);
  const today=day();
  const incomplete=sortTasks(p,tasks.filter(t=>!t.completed),'dueAsc');
  const completed=sortTasks(p,tasks.filter(t=>t.completed),'completedDesc');
  const list=items=>`<ul class="project-preview-list">${items.map(t=>{
    const date=taskDue(p,t);
    const due=date?`기한 ${date}`:'기한 없음';
    const overdue=!t.completed&&date&&date<today;
    const unlinkId=`project-unlink-${esc(t.id)}`;
    const unlinkLabel=esc(`${t.title} · 목표에서 제외`);
    return `<li>${btn('task-open',`<strong>${esc(t.title)}</strong><small><span>${esc(bucketName(p,t.bucket))}</span><span class="${overdue?'overdue':''}">${overdue?'기한 초과 · ':''}${due}</span></small>`,{id:t.id,cls:'project-preview-task',extra:'aria-haspopup="dialog"'})}
      <button type="button" class="icon-button project-preview-unlink" popovertarget="${unlinkId}" aria-haspopup="dialog" title="${unlinkLabel}" aria-label="${unlinkLabel}">${icon('close')}</button>
      <div id="${unlinkId}" class="project-inline-popover project-unlink-popover" popover role="dialog" aria-label="목표에서 제외" aria-describedby="${unlinkId}-message">
        <p id="${unlinkId}-message">"${esc(t.title)}" Task를 이 목표에서 제외할까요?</p>
        <div class="row-actions">
          <button type="button" popovertarget="${unlinkId}" popovertargetaction="hide" autofocus>취소</button>
          ${btn('project-task-unlink','제외',{id:t.id,cls:'danger'})}
        </div>
      </div></li>`;
  }).join('')}</ul>`;
  const presentation=docked?'role="region" class="panel project-preview project-preview-docked"':'role="dialog" aria-modal="true" class="dialog project-preview"';
  return `<section id="project-preview" data-project-id="${esc(project.id)}" ${presentation} aria-labelledby="project-preview-title">
      <div class="project-preview-summary">
      <div class="project-preview-header">
        <div><p class="muted">목표 미리보기</p><h2 id="project-preview-title" tabindex="-1">${esc(project.name)}</h2></div>
        ${ib('project-preview-close','close','미리보기 닫기')}
      </div>
      <div class="project-metrics"><b>${progressText(stats)}</b><span class="${stats.overdue?'overdue':''}">기한 초과 ${stats.overdue}</span></div>
      <progress max="${stats.total||1}" value="${stats.done}" aria-label="${progressText(stats)}"></progress>
      <div class="project-preview-actions">
        ${btn('project-open','보드 열기',{id:project.id,cls:'primary'})}
        <button type="button" id="project-task-add" popovertarget="project-task-dropdown">${icon('plus')}Task 추가</button>
        ${projectTaskDropdown(p,project.id)}
      </div>
      </div>
      <div class="project-preview-body">
      <h3>미완료 Task <span class="count">${incomplete.length}</span></h3>
      ${incomplete.length?list(incomplete):empty(tasks.length?'미완료 Task가 없습니다.':'목표에 소속된 Task가 없습니다.')}
      ${completed.length?`<details class="project-preview-completed" ${projectPreview.completedOpen?'open':''}><summary>완료 Task <span class="count">${completed.length}</span></summary>${list(completed)}</details>`:''}
      </div>
    </section>`;
}
function boardTrack(p,items,group){
  const lane=group===undefined?'':`data-project="${group}"`;
  return `<div class="board-track">${p.buckets.filter(b=>p.filters.bucket==='all'||p.filters.bucket===b.id).map((b,i)=>{
    const tasks=sortTasks(p,items.filter(t=>t.bucket===b.id),b.sort||p.sort);
    const name=group===undefined?`<input class="bucket-name" data-bucket-name="${b.id}" aria-label="버킷명 ${esc(b.name)}" value="${esc(b.name)}" maxlength="160">`:`<strong class="lane-bucket-name">${esc(b.name)}</strong>`;
    return `<section class="bucket" data-bucket="${b.id}" ${lane}><div class="bucket-header"><i class="bucket-dot" style="--dot:${['#8d9b96','#cba563','#8d92ad','#659682'][i%4]}"></i>${name}<span class="count">${tasks.length}</span>${ib('bucket-sort','sort','버킷 정렬',b.id)}${group===undefined?ib('task-new','plus','이 버킷에 Task 추가',b.id)+ib('bucket-delete','trash','버킷 삭제',b.id,p.buckets.length===1):''}</div><div class="bucket-tasks" data-drop-bucket="${b.id}">${tasks.length?tasks.map(t=>card(p,t)).join(''):empty('아직 Task가 없습니다')}</div>${btn('task-new',icon('plus')+'Task 추가',{id:b.id,cls:'add-task',extra:lane})}</section>`;
  }).join('')}</div>`;
}
function board(p){
  const items=filtered(p),grouped=status.projects&&p.boardGrouped;
  const projectFilter=p.filters.project;
  const closedToggle=grouped&&projectFilter==='all'
    ? check('data-board-include-closed',includeClosedBoardProjects,'완료 목표 포함')
    : '';
  const mode=status.projects?`<div class="view-toolbar project-board-mode"><div class="segmented">${btn('board-group','전체 보드',{id:'flat',cls:grouped?'':'active',extra:`aria-pressed="${!grouped}"`})}${btn('board-group','목표별 보드',{id:'project',cls:grouped?'active':'',extra:`aria-pressed="${!!grouped}"`})}</div>${closedToggle}</div>`:'';
  if(!grouped)return mode+boardTrack(p,items);
  const groups=[...p.projects,{id:'none',name:'목표 없음'}].filter(project=>
    projectFilter==='all' ? includeClosedBoardProjects||!project.closed : project.id===projectFilter
  );
  return mode+`<div class="project-lanes">${groups.map(project=>{
    const tasks=items.filter(t=>matchesProject(t.projectId,project.id));
    const key=projectKey(p,'board',project.id);
    const edit=project.id!=='none';
    return `<div class="project-lane-group${edit?' project-lane-editable':''}">
      ${edit?btn('board-project-edit','편집',{id:project.id,cls:'project-lane-edit',extra:`aria-label="${esc(project.name)} · 편집" aria-haspopup="dialog"`}):''}
      <details class="project-lane" data-project-lane="${key}" ${collapsedProjects.has(key)?'':'open'}><summary><strong>${esc(project.name)}</strong><span>${progressText(projectStats(p.tasks.filter(t=>matchesProject(t.projectId,project.id))))}</span></summary>${boardTrack(p,tasks,project.id)}</details>
    </div>`;
  }).join('')}</div>`;
}
function calendar(p){const [y,m]=month.split('-').map(Number),first=new Date(y,m-1,1,12);first.setDate(first.getDate()-first.getDay());const tasks=sortTasks(p,filtered(p).filter(t=>p.calendarCompleted||!t.completed));const days=Array.from({length:42},(_,i)=>addDays(day(first),i));return `<div class="view-toolbar"><div class="period-nav">${btn('month-prev','‹',{title:'이전 달'})}<h2>${y}년 ${m}월</h2>${btn('month-next','›',{title:'다음 달'})}${btn('month-today','오늘')}</div>${check('data-calendar-completed',p.calendarCompleted,'완료 Task 표시')}</div><div class="calendar-grid">${['일','월','화','수','목','금','토'].map(x=>`<div class="weekday">${x}</div>`).join('')}${days.map(d=>`<div class="calendar-day ${d.slice(0,7)!==month?'outside':''} ${d===day()?'today':''}"><div class="day-number"><span>${+d.slice(8)}</span><small>${d}</small></div>${tasks.filter(t=>t.start===d||taskDue(p,t)===d).map(t=>btn('task-open',`<small>${t.start===d&&taskDue(p,t)===d?'시작 · 기한':t.start===d?'시작':'기한'}</small>${esc(t.title)}`,{id:t.id,cls:`calendar-task ${t.completed?'completed':''}`,extra:`style="--task-color:${taskColor(p,t)}"`})).join('')}</div>`).join('')}</div>`;}
const taskColor=(p,t)=>{const [id]=taskLabels(p,t);return p.labels.find(l=>l.id===id)?.color||['#b96b54','#a68e54','#698479'][rank(t.priority)];};
function timeline(p){
  const count=p.timelineMode,end=addDays(timelineStart,count-1),tasks=sortTasks(p,filtered(p));
  const days=Array.from({length:count},(_,i)=>addDays(timelineStart,i));
  const dayLines=days.map(d=>`<i class="${d===day()?'today-line':''}"></i>`).join('');
  function row(item,summary=false,child=false){
    const due=summary?item.due:taskDue(p,item);
    const a=[item.start||due,due||item.start].sort()[0], b=item.start>due?item.start:due||item.start;
    const hasBar=a&&a<=end&&b>=timelineStart, dateOffset=d=>Math.round((Date.parse(d+'T12:00:00Z')-Date.parse(timelineStart+'T12:00:00Z'))/86400000);
    if(!summary&&a&&!hasBar)return '';
    const left=hasBar?Math.max(0,dateOffset(a)):0,right=hasBar?Math.min(count-1,dateOffset(b)):0;
    const action=summary?'timeline-project-toggle':'task-open',name=summary?item.name:item.title;
    const expanded=summary?!collapsedProjects.has(projectKey(p,'timeline',item.id)):false;
    const caption=summary?progressText(projectStats(p.tasks.filter(t=>t.projectId===item.id),day(),item.due)):`${bucketName(p,item.bucket)} · ${item.priority}${a?'':' · 날짜 없음'}`;
    return `<div class="timeline-info ${summary?'timeline-project':child?'timeline-child':''}">${btn(action,(summary?(expanded?'▾ ':'▸ '):'')+esc(name),{id:item.id,extra:summary?`aria-expanded="${expanded}"`:''})}<small>${esc(caption)}</small></div><div class="timeline-cells ${summary?'timeline-project':''}" style="--days:${count}">${dayLines}${hasBar?btn(summary?'project-edit':action,`${a<timelineStart?'‹ ':''}${esc(name)}${b>end?' ›':''}`,{id:item.id,cls:`timeline-bar ${summary?'project-bar':item.completed?'completed':''}`,title:`${name} · ${a} ~ ${b}`,extra:`style="left:calc(${left} * 100% / ${count});width:calc(${right-left+1} * 100% / ${count} - 6px);--task-color:${summary?'#315d50':taskColor(p,item)}"`}):''}</div>`;
  }
  const projects=status.projects?p.projects.filter(x=>matchesProject(x.id,p.filters.project)):[];
  const standalone=tasks.filter(t=>!projects.some(x=>x.id===t.projectId));
  const undated=standalone.filter(t=>!t.start&&!taskDue(p,t));
  const rows=projects.map(project=>row(project,true)+(collapsedProjects.has(projectKey(p,'timeline',project.id))?'':tasks.filter(t=>t.projectId===project.id).map(t=>row(t,false,true)).join(''))).join('')+standalone.filter(t=>t.start||taskDue(p,t)).map(t=>row(t)).join('');
  return `<div class="view-toolbar"><div class="segmented">${[7,14,28].map((n,i)=>btn('timeline-mode',['1-Week','2-Weeks','4-Weeks'][i],{id:String(n),cls:count===n?'active':''})).join('')}</div><div class="period-nav">${[-7,-1].map((n,i)=>btn('timeline-shift',['«','‹'][i],{id:String(n),title:`이전 ${-n}일`})).join('')}<b>${timelineStart} ~ ${end}</b>${[1,7].map((n,i)=>btn('timeline-shift',['›','»'][i],{id:String(n),title:`다음 ${n}일`})).join('')}${btn('timeline-today','오늘')}</div></div><div class="timeline-scroll"><div class="timeline-grid" style="--timeline-width:${Math.max(700,count*58)}px"><div class="timeline-info timeline-head">${projects.length?'목표 / Task':'Task'}</div><div class="timeline-dates">${days.map(d=>`<div class="${d===day()?'today':''}"><small>${['일','월','화','수','목','금','토'][new Date(d+'T12:00:00').getDay()]}</small>${d.slice(5).replace('-','/')}</div>`).join('')}</div>${rows}</div></div>${!rows?empty(tasks.some(t=>t.start||taskDue(p,t))?'현재 기간에 표시할 Task 없음':'표시할 날짜가 있는 Task 없음'):''}${undated.length?`<section class="panel"><h3>날짜 없음 <span class="count">${undated.length}</span></h3><div class="undated">${undated.map(t=>btn('task-open',esc(t.title),{id:t.id})).join('')}</div></section>`:''}`;
}
function charts(p){const tasks=filtered(p),total=tasks.length,done=tasks.filter(t=>t.completed).length,overdue=tasks.filter(t=>!t.completed&&taskDue(p,t)&&taskDue(p,t)<day()).length,ratio=total?Math.round(done/total*100):0;const bars=items=>{const max=Math.max(1,...items.map(x=>x[1]));return `<div class="bars">${items.map(([name,n,color])=>`<div><span>${esc(name)}</span><div class="bar-track"><i style="width:${n/max*100}%;background:${color||'#6f9284'}"></i></div><b>${n}</b></div>`).join('')}</div>`;};return `<div class="stat-grid">${[['전체 Task',total],['완료',done],['미완료',total-done],['기한 초과',overdue]].map(([label,n],i)=>`<div class="stat"><span>${label}</span><strong class="${i===3&&n?'overdue':''}">${n}<small>Tasks</small></strong></div>`).join('')}</div><div class="chart-grid"><section class="panel"><h3>완료 상태</h3><div class="donut" style="--percent:${ratio}%"><div><strong>${ratio}%</strong><small>${done}/${total} 완료</small></div></div><p class="muted center">완료 <b>${done}</b> · 미완료 <b>${total-done}</b></p></section><section class="panel"><h3>버킷별 Task</h3>${bars(p.buckets.map(b=>[b.name,tasks.filter(t=>t.bucket===b.id).length]))}</section><section class="panel"><h3>우선순위별 Task</h3>${bars(['상','중','하'].map((x,i)=>[x,tasks.filter(t=>t.priority===x).length,['#b96b54','#c4aa6d','#7a9c8e'][i]]))}</section></div>`;}
function table(p){const tasks=sortTasks(p,filtered(p));return `<div class="table-summary"><b>${tasks.length}</b>개의 Task<span class="muted">제목을 눌러 상세 내용을 편집하세요</span></div><div class="table-scroll"><table><thead><tr>${['Task',...(status.projects?['목표']:[]),'버킷','레이블','우선순위','시작','기한','완료'].map(x=>`<th>${x}</th>`).join('')}</tr></thead><tbody>${tasks.map(t=>`<tr class="${t.completed?'completed':''}"><td><div class="table-task">${completion(p,t)}${btn('task-open',esc(t.title),{id:t.id,cls:'text-button'})}</div></td>${status.projects?`<td>${esc(projectName(p,t.projectId))}</td>`:''}<td>${esc(bucketName(p,t.bucket))}</td><td><div class="chips">${chips(p,taskLabels(p,t))||'-'}</div></td><td><span class="priority p${rank(t.priority)}">${t.priority}</span></td><td>${t.start||'-'}</td><td class="${!t.completed&&taskDue(p,t)&&taskDue(p,t)<day()?'overdue':''}">${taskDue(p,t)||'-'}</td><td>${t.completed||'-'}</td></tr>`).join('')||'<tr><td colspan="'+(status.projects?8:7)+'">'+empty('조건에 맞는 Task가 없습니다.')+'</td></tr>'}</tbody></table></div>`;}

function dateControl(attr,value,label='날짜'){return `<div class="date-control">${input(`${attr} placeholder="YYYY-MM-DD" aria-label="${label}" inputmode="numeric"`,value)}<label class="calendar-picker" title="${label} 달력 선택">${icon('calendar')}<input type="date" data-date-picker aria-label="${label} 달력" value="${/^\d{4}-\d{2}-\d{2}$/.test(value)?value:''}"></label></div>`;}
function settings(p){return `<div class="settings-general"><div class="section-heading"><span class="eyebrow">MAKE IT YOURS</span><h2>일반 설정</h2></div><div class="general-grid"><section class="panel"><h3>Planner</h3><form data-form="planner-settings">${field('이름',input('name="name" maxlength="160"',p.name))}${field('설명',input('name="description" maxlength="300"',p.description))}<button class="primary">저장</button></form></section><section class="panel appearance"><h3>화면</h3><div class="width-setting">${field('버킷 가로 넓이',`<input type="range" data-width min="260" max="480" step="10" value="${p.appearance.width}">`)}${input('data-width-number min="260" max="480" step="10" aria-label="버킷 넓이 숫자"',p.appearance.width,'number')}<span>px</span>${btn('width-reset','초기화')}</div><div class="color-inputs">${['사이트 배경','사이드바','버킷 배경','Task 팝업'].map((name,i)=>field(name,input(`data-color="${i}" aria-label="${name}"`,p.appearance.colors[i].slice(0,7),'color'))).join('')}</div><p class="label-title">추천 색상 조합</p><div class="palette-list">${palettes.map((x,i)=>paletteButton(x,'palette',String(i))).join('')}</div><div class="subheading"><b>사용자 지정 조합</b>${btn('palette-add','현재 조합 추가')}</div><div class="palette-list">${p.appearance.custom.map((x,i)=>`<div class="custom-palette">${paletteButton(x,'palette-custom',String(i))}${ib('palette-delete','close','사용자 조합 삭제',String(i))}</div>`).join('')||'<span class="muted">저장된 조합 없음</span>'}</div>${btn('palette-reset','색상 초기화')}</section><section class="panel"><h3>완료 액션</h3><p class="muted">미완료 Task를 완료로 바꿀 때 적용합니다. 삭제는 Task를 영구 삭제합니다.</p><form data-form="completion">${field('동작',select('name="action" data-completion-action',[['none','없음'],['move','특정 버킷으로 이동'],['label','레이블 변경'],['delete','삭제']],p.completion.action))}<div id="completion-target">${completionTarget(p,p.completion.action)}</div><button class="primary">저장</button></form></section><section class="panel"><h3>버킷</h3><div class="management-list" data-bucket-manage>${p.buckets.map((b,i)=>`<div class="management-row" data-bucket-row="${b.id}"><span class="drag-handle" data-bucket-handle="${b.id}" tabindex="0" title="버킷 순서 이동">${icon('grip')}</span>${input(`data-manage-bucket="${b.id}" aria-label="버킷 이름 ${esc(b.name)}" maxlength="160"`,b.name)}${btn('bucket-up','↑',{id:b.id,title:'버킷 위로',disabled:i===0})}${btn('bucket-down','↓',{id:b.id,title:'버킷 아래로',disabled:i===p.buckets.length-1})}${ib('bucket-delete','trash','버킷 삭제',b.id,p.buckets.length===1)}</div>`).join('')}</div><form data-form="bucket-add" class="inline-form">${input('name="name" placeholder="새 버킷 이름" aria-label="새 버킷 이름" maxlength="160"')}<button>추가</button></form></section><section class="panel"><h3>레이블</h3>${p.labels.map(l=>`<div class="management-row">${input(`data-label-color="${l.id}" aria-label="${esc(labelName(p,l.id))} 색상"`,l.color,'color')}${input(`data-label-name="${l.id}" aria-label="${esc(labelName(p,l.id))} 이름" placeholder="${esc(labelName(p,l.id))}" maxlength="160"`,l.name)}${ib('label-delete','trash','레이블 삭제',l.id)}</div>`).join('')}<form data-form="label-add" class="inline-form">${input('name="name" placeholder="새 레이블명" aria-label="새 레이블명" maxlength="160"')}${input('name="color" aria-label="새 레이블 색상"','#2f8f83','color')}<button>추가</button></form></section><section class="panel storage"><h3>저장소</h3><div class="storage-icon">${icon('check')}</div><b>하나의 base, 하나의 워크스페이스</b><p id="storage-detail"></p><p class="muted">코드 · 설정 · Task · 보고서를 이 앱 폴더 안에서 관리합니다. PC와 서비스가 실행 중일 때 예약을 확인합니다.</p>${btn('save-retry','저장 다시 시도')}</section></div></div>${notifications(p)}${backupPanel()}`;}
function completionTarget(p,a){return a==='move'?field('대상 버킷',select('name="bucket"',p.buckets.map(b=>[b.id,b.name]),p.completion.bucket)):a==='label'?field('대상 레이블',select('name="label"',p.labels.map(l=>[l.id,labelName(p,l.id)]),p.completion.label)):'';}
function paletteButton(x,action,id){return btn(action,`<span class="swatches">${x.colors.map(c=>`<i style="background:${c}"></i>`).join('')}</span>${esc(x.name)}`,{id,cls:'palette'});}
const sameNotifications=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
function notificationEdit(p){
  let edit=notificationDrafts.get(p.id);
  if(!edit||sameNotifications(edit.value,edit.baseline)&&!sameNotifications(edit.baseline,p.notifications)){
    edit={baseline:clone(p.notifications),value:clone(p.notifications)};
    notificationDrafts.set(p.id,edit);
  }
  return edit;
}
function draft(p){return notificationEdit(p).value;}
async function saveNotificationEdit(p,notifications,test){
  const edit=notificationEdit(p);
  return enqueueSave(async()=>{
    try{
      const saved=await api('/api/action','POST',{action:'notification-save',planner:p.id,
        baseline:edit.baseline,notifications,test});
      const current=state.planners.find(item=>item.id===p.id);
      if(current)current.notifications=clone(notifications);
      const previous=savedState.planners.find(item=>item.id===p.id);
      if(previous)previous.notifications=clone(notifications);
      edit.baseline=clone(notifications);
      if(plannerVersions.get(p.id)===saved.previousVersion)plannerVersions.set(p.id,saved.version);
      acknowledgeSave(saved);
      status.pendingReports=saved.pendingReports;
      if(view==='settings'&&planner()?.id===p.id)redrawScheduleStatus();
      return saved;
    }catch(error){
      if(error.data?.notifications){
        const current=state.planners.find(item=>item.id===p.id);
        if(current)current.notifications=error.data.notifications;
        if(view==='settings'&&planner()?.id===p.id)redrawNotifications();
      }
      throw error;
    }
  });
}
function selectedMessageRow(p){
  const rows=draft(p).rows;
  return rows.find(r=>r.id===rowSelection.get(p.id))||rows[0];
}
function editingMessageForm(p){
  const forms=draft(p).forms;
  return forms.find(form=>form.id===formSelection.get(p.id))||forms[0];
}
const messageFormOptions=n=>n.forms.map(form=>[form.id,form.name||'이름 없는 양식']);
function messageFormEditor(p,n){
  const form=editingMessageForm(p);
  const used=n.rows.some(row=>row.formId===form.id);
  const sections=form.sections.map((section,index)=>`<li class="message-section">
    <div class="subheading"><b data-section-title>${esc(sectionTitle(section))}</b><div class="row-actions">
      ${btn('message-section-up','↑',{id:section.id,title:`섹션 ${index+1} 위로 이동`,disabled:index===0})}
      ${btn('message-section-down','↓',{id:section.id,title:`섹션 ${index+1} 아래로 이동`,disabled:index===form.sections.length-1})}
      ${ib('message-section-remove','close',`섹션 ${index+1} 제거`,section.id,form.sections.length===1)}
    </div></div>
    <div class="two-col">
      ${field('완료 상태',select(`data-message-section="${section.id}" data-key="status" aria-label="섹션 ${index+1} 완료 상태"`,sectionStatuses,section.status))}
      ${field('기한',select(`data-message-section="${section.id}" data-key="condition" aria-label="섹션 ${index+1} 기한"`,dueConditions,section.condition))}
    </div>
    ${section.condition==='range'?`<div class="two-col">
      ${field('기간 시작',input(`data-message-section="${section.id}" data-key="from"`,section.from,'date'))}
      ${field('기간 끝',input(`data-message-section="${section.id}" data-key="to"`,section.to,'date'))}
    </div>`:''}
  </li>`).join('');
  return `<section class="panel message-composer"><h3>메시지 양식</h3>
    <div class="message-controls">
      ${field('편집할 양식',select('data-message-form',messageFormOptions(n),form.id))}
      ${btn('message-form-add','새 양식',{disabled:n.forms.length>=1000})}
      ${btn('message-form-delete','양식 삭제',{disabled:used||n.forms.length===1})}
    </div>
    ${used?'<p class="muted">사용 중인 양식은 시간별 알림에서 다른 양식으로 바꾼 뒤 삭제할 수 있습니다.</p>':''}
    ${field('양식 이름',input('data-message-field="name" maxlength="80" autocomplete="off"',form.name))}
    <ol class="message-sections" aria-label="메시지 섹션">${sections}</ol>
    ${btn('message-section-add','섹션 추가',{disabled:form.sections.length>=1000})}
    <fieldset class="message-outlook"><legend>Outlook 전용</legend>
      ${field('메일 제목',input(`data-message-field="outlookSubject" maxlength="160" placeholder="${esc(p.name+' · Task 알림')}"`,form.outlookSubject))}
      <div class="checks">${check('data-message-field="outlookChecklist"',form.outlookChecklist,'상세 메일에 체크리스트 포함')}${check('data-message-field="outlookNotes"',form.outlookNotes,'상세 메일에 메모 포함')}</div>
    </fieldset>
  </section>`;
}
function notificationSchedule(n){
  const forms=messageFormOptions(n);
  return `<h3>시간별 알림 설정</h3><div class="schedule-rows">${n.rows.map((row,index)=>`<div class="schedule-row">
    <div class="schedule-checks">${['teams','outlook','export'].map((key,i)=>check(`data-row="${row.id}" data-key="${key}"`,row[key],['Teams','Outlook','내보내기'][i])).join('')}</div>
    <div class="schedule-fields">
      ${field('시간',input(`data-row="${row.id}" data-key="time" aria-label="발송 시간 ${index+1}" placeholder="08:00"`,row.time))}
      ${field('메시지 양식',select(`data-row="${row.id}" data-key="formId" aria-label="발송 ${index+1} 양식"`,forms,row.formId))}
      ${field('출력 수준',select(`data-row="${row.id}" data-key="format" aria-label="발송 ${index+1} 출력 수준"`,notificationFormats,row.format))}
      <div class="row-actions">${ib('row-add','plus','시간행 추가',row.id,n.rows.length>=1000)}${ib('row-delete','close','시간행 제거',row.id,n.rows.length===1)}</div>
    </div>
    ${row.reviewRequired?`<div class="message-review"><span class="overdue">검토 필요 · 자동 실행 대기</span>
      ${btn('message-review-open','양식 확인',{id:row.id})}${btn('message-review-save','검토 완료 및 저장',{id:row.id})}</div>`:''}
  </div>`).join('')}</div>`;
}
function notificationActions(n,row){
  return `<section class="panel notification-preview-panel"><h3>미리보기와 테스트</h3>
    <div class="notification-actions">
      ${field('발송 시간',select('data-preview-row',n.rows.map(r=>[r.id,r.time]),row.id))}
      ${field('미리보기 채널',select('data-message-preview-channel',[['teams','Teams'],['outlook','Outlook']],messagePreviewChannel))}
      ${btn('notification-preview','미리보기')}${btn('notification-save','저장',{cls:'primary'})}
    </div>
    <div class="notification-actions">
      ${btn('notification-teams','Teams 테스트 전송')}${btn('notification-outlook','Outlook 메일 테스트 전송')}${btn('notification-export','테스트 내보내기')}
    </div>
    <p class="muted">테스트 전송은 현재 설정을 저장하고 실제 연결로 보냅니다. 테스트 내보내기는 설정과 예약 기록을 변경하지 않습니다.</p>
    <div id="notification-output" class="output" role="status" hidden></div>
  </section>`;
}
function notificationDestinations(n){
  const toggle=(id,label)=>btn('channel-toggle',`<span class="status-dot ${n[id]?'on':''}"></span>${label} ${n[id]?'ON':'OFF'}`,{
    id,cls:n[id]?'selected':'',extra:`aria-pressed="${n[id]}"`
  });
  const result=id=>`<small class="destination-result" data-destination-result="${id}" role="status"></small>`;
  const channels=[['teams','Teams','Teams 알림','Teams Workflows 연결 주소'],['outlook','Outlook','Outlook 메일','Power Automate 메일 연결 주소']];
  return channels.map(([id,name,label,address])=>`<div class="channel-row">${toggle(id,label)}
    ${field(address,input(`data-n="${id}Url" autocomplete="off" spellcheck="false" placeholder="연결 주소를 입력하세요"`,n[id+'Url'],'password'))}
    ${btn('connection-test',`${name} 연결 테스트`,{id})}
    ${result(id)}</div>`).join('')+`<div class="channel-row">${toggle('export','내보내기')}
    ${field('내보내기 폴더',input(`data-n="exportFolder" maxlength="4096" spellcheck="false" placeholder="${esc(status.reportPath)}"`,n.exportFolder??''))}
    <div class="destination-actions">${status.nativeFolderPicker!==false?btn('folder-picker','폴더 선택'):''}${btn('folder-test','위치 테스트')}</div>
    <small class="muted">폴더를 선택하거나 절대 경로를 입력하세요. 비워 두면 앱의 reports 폴더에 저장합니다.</small>${result('export')}</div>`;
}
function setReportFolder(p,selectedFolder){
  const folder=selectedFolder===status.reportPath?'':selectedFolder;
  draft(p).exportFolder=folder;
  $('[data-n="exportFolder"]').value=folder;
  $('[data-destination-result="export"]').textContent='';
  hideOutput();
}
function notifications(p){
  const {baseline,value:n}=notificationEdit(p),selectedRow=selectedMessageRow(p);
  rowSelection.set(p.id,selectedRow.id);
  const deliveries=status.delivery?.filter(item=>item.key.startsWith(p.id+'/')).slice(-8)||[];
  const pending=status.pendingReports?.[p.id];
  return `<div class="notification-section">
    <div class="section-heading"><span class="eyebrow">STAY IN THE LOOP</span><h2>알림과 예약 내보내기</h2><p>월~금, PC 로컬 시각에 실행합니다. 미리보기는 저장하거나 전송하지 않습니다.</p></div>
    ${!sameNotifications(baseline,p.notifications)?`<section class="panel notification-conflict" aria-label="알림 설정 충돌">
      <p role="status">다른 화면에서 알림 설정이 변경되었습니다. 이 화면의 입력을 보관하고 최신 설정을 불러온 뒤 필요한 변경을 다시 적용하세요.</p>
      ${btn('notification-reload','최신 설정 불러오기')}
    </section>`:''}
    <div class="notification-top"><section class="panel">
      <h3>채널</h3>${notificationDestinations(n)}${notificationSchedule(n)}
    </section>${messageFormEditor(p,n)}</div>
    ${notificationActions(n,selectedRow)}
    <section class="panel schedule-status"><h3>최근 예약 실행 상태</h3>
      ${pending?.retry?`<p class="overdue">보고서 ${pending.retry}건 재시도 대기</p>`:''}
      ${pending?.paused?`<p class="muted">보고서 ${pending.paused}건 보류 중</p>`:''}
      ${deliveries.length?deliveries.map(item=>`<p class="${item.success?'':'overdue'}">${esc(item.key.split('/').slice(1).join(' · '))} · ${item.success?'완료':esc(item.error)}</p>`).join(''):'<p class="muted">아직 실행 기록이 없습니다.</p>'}
    </section></div>`;
}
function openPlannerModal(id=null){const p=state.planners.find(p=>p.id===id);modal={kind:'planner',id};$('#overlay').innerHTML=`<div class="modal-backdrop"><section role="dialog" aria-modal="true" aria-labelledby="modal-title" class="dialog small"><div class="dialog-header"><h2 id="modal-title">${p?'Planner 편집':'새 Planner'}</h2>${ib('modal-cancel','close','닫기')}</div><form data-form="planner-modal">${field('이름',input('name="name" required maxlength="160" autocomplete="off"',p?.name||''))}${field('설명',input('name="description" maxlength="300"',p?.description||''))}<div class="dialog-actions">${btn('modal-cancel','취소')}<button class="primary">${p?'저장':'만들기'}</button></div></form></section></div>`;$('input[name="name"]',$('#overlay')).focus();}
function openProject(id,boardEdit=false){
  const p=planner(),project=p.projects.find(x=>x.id===id)||newProject();
  modal={kind:'project',id:id||null,boardEdit};
  $('#overlay').innerHTML=`<div class="modal-backdrop"><section role="dialog" aria-modal="true" aria-labelledby="modal-title" class="dialog small"><div class="dialog-header"><h2 id="modal-title">${id?'목표 편집':'새 목표'}</h2>${ib('modal-cancel','close','닫기')}</div><form data-form="project-modal">${field('목표 이름',input('name="name" required maxlength="160"',project.name))}${field('설명',`<textarea name="description" maxlength="300" rows="3">${esc(project.description)}</textarea>`)}${status.projectLabels?field('목표 레이블',select('name="labelId" aria-label="목표 레이블" aria-describedby="project-label-hint"',[['','레이블 없음'],...p.labels.map(l=>[l.id,labelName(p,l.id)])],project.labelId??'')+`<small id="project-label-hint" class="muted">소속 Task에 자동으로 적용됩니다.</small>`):''}<div class="two-col">${field('시작일',input('name="start"',project.start,'date'))}${field('기한',input('name="due"',project.due,'date'))}</div><div class="dialog-actions">${btn('modal-cancel','취소')}<button type="submit" class="primary">저장</button></div></form></section></div>`;
  $('input[name="name"]',$('#overlay')).focus();
}
function focusBoardProjectEdit(id){
  $(`[data-action="board-project-edit"][data-id="${CSS.escape(id)}"]`)?.focus({preventScroll:true});
}
const canLinkProjectTask=t=>!t.projectId&&!t.completed;
function projectTaskDropdown(p,id){
  const tasks=sortTasks(p,p.tasks.filter(canLinkProjectTask),'title');
  return `<div id="project-task-dropdown" class="project-inline-popover" popover aria-label="Task 추가" role="region">
    ${btn('project-task-create','새 Task 만들기',{id,extra:'aria-haspopup="dialog"'})}
    ${tasks.length?`
      ${input('id="project-task-search" aria-label="Task 제목 검색" placeholder="Task 제목 검색"','','search')}
      <ul class="project-task-results" aria-label="목표 없는 미완료 Task">
        ${tasks.map(t=>`<li>${check(`data-project-link-task="${esc(t.id)}"`,false,`<strong>${esc(t.title)}</strong><small class="muted">${esc(bucketName(p,t.bucket))}</small>`)}</li>`).join('')}
        <li id="project-task-no-results" class="empty" hidden>검색 결과가 없습니다.</li>
      </ul>
      ${btn('project-task-link-save','0개 연결',{id,cls:'primary',disabled:true})}
    `:'<p class="muted">목표가 없는 미완료 Task가 없습니다.</p>'}
  </div>`;
}
function updateProjectTaskResults(dropdown){
  const query=$('#project-task-search',dropdown).value.trim().toLocaleLowerCase('ko-KR');
  let matches=0,selected=0;
  for(const item of $$('[data-project-link-task]',dropdown)){
    const row=item.closest('li');
    row.hidden=!$('strong',row).textContent.toLocaleLowerCase('ko-KR').includes(query);
    if(!row.hidden)matches++;
    if(item.checked)selected++;
  }
  $('#project-task-no-results',dropdown).hidden=!!matches;
  const link=$('[data-action="project-task-link-save"]',dropdown);
  link.textContent=`${selected}개 연결`;
  link.disabled=!selected;
}
function focusProjectTaskAdd(){
  $('#project-task-add')?.focus({preventScroll:true});
}
function openBucketModal(){modal={kind:'bucket'};$('#overlay').innerHTML=`<div class="modal-backdrop"><section role="dialog" aria-modal="true" aria-labelledby="modal-title" class="dialog small"><div class="dialog-header"><h2 id="modal-title">버킷 추가</h2>${ib('modal-cancel','close','닫기')}</div><form data-form="bucket-modal">${field('버킷명',input('name="name" required maxlength="160"'))}<div class="dialog-actions">${btn('modal-cancel','취소')}<button class="primary">추가</button></div></form></section></div>`;$('input[name="name"]',$('#overlay')).focus();}
function confirmAction(title,message,confirmLabel='삭제'){return new Promise(resolve=>{const prior=document.activeElement,div=document.createElement('div');div.id='confirm';div.innerHTML=`<div class="modal-backdrop"><section role="alertdialog" aria-modal="true" class="dialog small" aria-labelledby="confirm-title"><h2 id="confirm-title">${esc(title)}</h2><p>${esc(message)}</p><div class="dialog-actions"><button data-confirm="no">취소</button><button class="danger" data-confirm="yes">${esc(confirmLabel)}</button></div></section></div>`;document.body.append(div);const finish=value=>{div.remove();prior?.focus({preventScroll:true});resolve(value);};div.addEventListener('click',e=>{if(e.target.closest('[data-confirm]'))finish(e.target.closest('[data-confirm]').dataset.confirm==='yes');});div.addEventListener('keydown',e=>{if(e.key==='Escape'){e.stopPropagation();finish(false);}});$('[data-confirm="no"]',div).focus();});}
function openTask(id,bucket,projectId){
  const p=planner(),existing=p.tasks.find(t=>t.id===id);
  rememberProjectPreview();
  const previewTaskId=projectPreview&&existing?.projectId===projectPreview.id?id:null;
  task=clone(existing||newTask(p,bucket,projectId));
  taskDateBaseline={start:task.start,due:task.due};
  modal={kind:'task',existing:!!existing,previewTaskId,previewAdd:!!projectPreview&&!existing&&projectPreview.id===projectId};
  renderTask();
  $('#task-title').focus();
}
function inheritedLabel(p,id){
  const label=projectLabelId(p,id);
  return label?`<span class="muted">목표에서 상속</span> ${chips(p,[label])}`:'';
}
function inheritedDueHint(p,projectId,due){
  const fallback=projectDue(p,projectId);
  return !due&&fallback?`목표 기한 · ${fallback}`:'';
}
function updateTaskDueHint(p){
  const field=$('#task-due-source');
  if(field)field.textContent=inheritedDueHint(p,$('#task-project')?.value,$('#task-due').value.trim());
}
function renderTask(){const p=planner();$('#overlay').innerHTML=`<div class="modal-backdrop"><section role="dialog" aria-modal="true" aria-label="Task 상세" class="dialog task-dialog"><div class="task-dialog-top">${select('id="task-bucket" aria-label="Task 버킷"',p.buckets.map(b=>[b.id,b.name]),task.bucket)}<div class="row-actions">${modal.existing?ib('task-options','more','Task 옵션'):''}${ib('task-close','close','닫기 · 자동 저장')}</div></div><form data-form="task" id="task-form"><button type="submit" hidden aria-hidden="true" tabindex="-1">저장</button><div class="task-main"><input id="task-title" name="title" placeholder="Task 제목" value="${esc(task.title)}" aria-label="Task 제목" autocomplete="off" required><div class="task-labels"><div class="chips">${task.labels.map(id=>`<span class="chosen-label">${chips(p,[id])}${ib('task-label-remove','close','Task에서 레이블 해제',id)}</span>`).join('')}</div><input id="label-search" placeholder="레이블 검색 또는 선택" autocomplete="off" aria-label="레이블 검색 또는 선택"><div id="task-inherited-label" class="chips inherited-label">${inheritedLabel(p,task.projectId)}</div></div><div class="subheading"><h3>체크리스트 <span class="count">${task.checklist.filter(c=>c.done).length}/${task.checklist.length}</span></h3>${check('id="show-checklist"',task.showChecklist,'보드에서 표시')}</div><div id="checklist" class="checklist">${task.checklist.map(c=>`<div class="checklist-row ${c.done?'completed':''}" data-check-row="${c.id}"><span class="drag-handle" data-check-handle="${c.id}" title="체크리스트 순서 변경">${icon('grip')}</span><input type="checkbox" data-task-check="${c.id}" aria-label="체크리스트 완료 ${esc(c.text)}" ${c.done?'checked':''}>${input(`data-check-text="${c.id}" aria-label="체크리스트 내용"`,c.text)}${ib('check-delete','close','체크리스트 항목 삭제',c.id)}</div>`).join('')}</div><div class="inline-form">${input('id="check-add-input" placeholder="항목 추가" aria-label="새 체크리스트 항목"')}${btn('check-add',icon('plus'),{title:'체크리스트 추가'})}</div><div class="subheading"><h3>메모</h3>${check('id="show-notes"',task.showNotes,'보드에서 표시')}</div><textarea id="task-notes" placeholder="메모를 남겨보세요" aria-label="메모" rows="6">${esc(task.notes)}</textarea></div><aside class="task-aside"><span class="label-title">TASK DETAILS</span>${status.projects?field('목표',select('id="task-project"',projectOptions(p),task.projectId??'none')):''}${btn('task-draft-toggle',`${task.completed?icon('check'):'<span class="mini-check"></span>'}${task.completed?'완료':'미완료'}`,{cls:`task-status ${task.completed?'selected':''}`})}${field('우선순위',select('id="task-priority"',['상','중','하'].map(x=>[x,x]),task.priority))}${field('시작 날짜',dateControl('id="task-start"',task.start,'시작 날짜'))}${field('기한',dateControl('id="task-due" aria-describedby="task-due-source"',task.due,'기한')+`<small class="muted" id="task-due-source">${inheritedDueHint(p,task.projectId,task.due)}</small>`)}${field('완료 날짜',`<span class="readonly">${task.completed||'-'}${task.completedByProject?' · 목표에서 상속':''}</span>`)}${modal.existing?`<div class="task-timestamps"><small>생성 ${new Date(task.createdAt).toLocaleString('ko-KR')}</small><small>수정 ${new Date(task.updatedAt).toLocaleString('ko-KR')}</small></div>`:''}</aside><div class="task-save-note">닫으면 현재 내용이 자동 저장됩니다.${btn('task-close','완료',{cls:'primary'})}</div></form></section></div>`;autoGrow($('#task-notes'));}
function captureTask(normalize=false){if(normalize)dateValidationErrors=[];if(!task||!$('#task-title'))return;task.title=$('#task-title').value;task.bucket=$('#task-bucket').value;const project=$('#task-project')?.value;if(project)task.projectId=project==='none'?null:project;task.priority=$('#task-priority').value;task.notes=$('#task-notes').value;task.showChecklist=$('#show-checklist').checked;task.showNotes=$('#show-notes').checked;for(const key of ['start','due']){const text=$('#task-'+key).value;if(normalize){try{task[key]=parseDate(text);}catch{task[key]=taskDateBaseline[key];dateValidationErrors.push(key==='start'?'시작 날짜':'기한');}}else task[key]=text;}task.checklist.forEach(c=>{const inp=$(`[data-check-text="${c.id}"]`),box=$(`[data-task-check="${c.id}"]`);if(inp)c.text=inp.value;if(box)c.done=box.checked;});}
function finishTask(){
  const {previewTaskId,previewAdd}=modal??{};
  task=null;
  modal=null;
  closePop();
  $('#overlay').replaceChildren();
  render();
  if(previewAdd&&projectPreview)focusProjectTaskAdd();
  else if(previewTaskId&&projectPreview){
    const previous=$(`#project-preview [data-action="task-open"][data-id="${CSS.escape(previewTaskId)}"]`);
    const visible=previous&&!previous.closest('details:not([open])');
    (visible?previous:$('#project-preview-title'))?.focus({preventScroll:true});
  }
}
function closeTask(){captureTask(true);const saved=saveTask(planner(),task);finishTask();persist(dateValidationErrors.length?`${dateValidationErrors.join(', ')} 오류: 기존 날짜 유지 · 나머지 내용 저장 완료`:saved?'Task 저장 완료':'변경 저장 완료').catch(()=>{});}
function closeModal(){
  if(modal?.applying)return;
  if(modal?.kind==='task'){closeTask();return;}
  if(modal?.kind==='project-preview'){closeProjectPreview();return;}
  const previous=modal;
  modal=null;
  $('#overlay').replaceChildren();
  closePop();
  if(previous?.boardEdit)focusBoardProjectEdit(previous.id);
  if(previous?.kind==='backup-review')previous.trigger.focus({preventScroll:true});
}
function autoGrow(el){if(!el)return;el.style.height='auto';el.style.height=Math.max(130,el.scrollHeight)+'px';}
function closePop(){pop=null;$('#popover').innerHTML='';$$(':is([data-action="sort"],[data-action="filter"],[data-action="bucket-sort"],[data-action="task-options"],#label-search)[aria-expanded="true"]').forEach(e=>e.setAttribute('aria-expanded','false'));}
function openPop(kind,button,id=''){if(pop?.kind===kind&&pop.id===id&&pop.trigger===button){closePop();return;}closePop();pop={kind,id,trigger:button,anchor:button.getBoundingClientRect()};button.setAttribute('aria-expanded','true');renderPopover();}
function renderPopover(){if(!pop)return;const p=planner(),{kind,id}=pop;let html='';
  if(kind==='sort'||kind==='bucket-sort'){const value=kind==='sort'?p.sort:p.buckets.find(b=>b.id===id).sort;html=`<div class="menu-label">${kind==='sort'?'Task 정렬':'버킷 정렬'}</div>${(kind==='bucket-sort'?[[null,'전체 정렬 따르기'],...sorts]:sorts).map(([mode,name])=>btn('sort-choose',`${esc(name)}${value===mode?icon('check'):''}`,{id:mode||'inherit',cls:value===mode?'active':''})).join('')}`;}
  if(kind==='filter'){const f=p.filters;html=`<div class="subheading"><h3>필터</h3>${btn('filter-reset','초기화')}</div>${status.projects?field('목표',select('data-filter="project"',projectOptions(p,true),f.project)):''}${field('버킷',select('data-filter="bucket"',[['all','전체'],...p.buckets.map(b=>[b.id,b.name])],f.bucket))}${field('우선순위',select('data-filter="priority"',[['all','전체'],...['상','중','하'].map(x=>[x,x])],f.priority))}${field('기한',select('data-filter="due"',dueFilterOptions,f.due))}${field('Task 상태',select('data-filter="status"',statusFilterOptions,f.status))}${field('완료 일자 시작',dateControl('data-filter="from"',f.from,'완료 일자 시작'))}${field('완료 일자 끝',dateControl('data-filter="to"',f.to,'완료 일자 끝'))}<b class="label-title">레이블</b><div class="filter-labels">${p.labels.map(l=>btn('filter-label',chips(p,[l.id]),{id:l.id,cls:f.labels.includes(l.id)?'selected':''})).join('')}</div>`;}
  if(kind==='task-options')html=btn('task-copy',icon('copy')+'Task 복사')+btn('task-delete',icon('trash')+'Task 삭제',{cls:'danger-text'});
  if(kind==='labels'){const q=($('#label-search')?.value||'').toLowerCase(),list=p.labels.filter(l=>(labelName(p,l.id)+' '+l.color).toLowerCase().includes(q));html=`<div class="label-results">${list.map(l=>`<div class="label-option">${btn('task-label-toggle',`<span class="mini-check ${task.labels.includes(l.id)?'checked':''}">${task.labels.includes(l.id)?icon('check'):''}</span>${chips(p,[l.id])}`,{id:l.id})}${ib('label-rename','edit','레이블 이름 변경',l.id)}${input(`data-label-color="${l.id}" aria-label="레이블 색상"`,l.color,'color')}</div>`).join('')||empty('선택 가능한 결과 없음')}</div><div class="new-label">${input('id="new-label-name" placeholder="새 레이블명" aria-label="새 레이블명" maxlength="160"')}${input('id="new-label-color" aria-label="새 레이블 색상"','#2f8f83','color')}${btn('task-label-add','추가')}</div>`;}
  $('#popover').innerHTML=`<div class="popover ${kind==='filter'?'filter-panel':''} ${kind==='labels'?'label-panel':''}" role="${kind==='filter'?'region':'menu'}" aria-label="${esc(kind)}">${html}</div>`;
  const trigger=pop.trigger?.isConnected?pop.trigger:$(`[data-action="${kind}"]${id?`[data-id="${id}"]`:''}`);trigger?.setAttribute('aria-expanded','true');
  const el=$('.popover'),width=kind==='filter'?320:kind==='labels'?380:250,a=pop.anchor;el.style.width=`${Math.min(width,window.innerWidth-24)}px`;el.style.left=`${Math.max(12,Math.min(a.left,window.innerWidth-width-12))}px`;el.style.top=`${Math.max(12,Math.min(a.bottom+8,window.innerHeight-Math.min(el.scrollHeight,window.innerHeight-32)-12))}px`;
}

async function handleAction(action,id,el,e){const p=planner();
  if(action.startsWith('backup-'))return handleBackup(action,el);
  switch(action){
    case 'project-status':{
      const closed=id==='closed';
      if(closed===showClosedProjects)break;
      showClosedProjects=closed;
      render();
      focusProjectStatus();
      break;
    }
    case 'project-new':openProject();break;
    case 'project-edit':openProject(id);break;
    case 'board-project-edit':openProject(id,true);break;
    case 'project-preview':openProjectPreview(id);break;
    case 'project-preview-close':closeProjectPreview();break;
    case 'project-task-create':
      $('#project-task-dropdown').hidePopover();
      openTask(null,p.buckets[0].id,id);
      break;
    case 'project-task-link-save':{
      const selectedTasks=new Set($$('#project-task-dropdown [data-project-link-task]:checked').map(input=>input.dataset.projectLinkTask));
      const tasks=p.tasks.filter(t=>canLinkProjectTask(t)&&selectedTasks.has(t.id));
      if(!tasks.length||projectPreview?.id!==id)break;
      for(const t of tasks)saveTask(p,{...t,projectId:id});
      render();
      focusProjectTaskAdd();
      await persist(`Task ${tasks.length}개 연결 완료`);
      break;
    }
    case 'project-task-unlink':{
      const item=p.tasks.find(t=>t.id===id);
      if(!item||item.projectId!==projectPreview?.id)break;
      const row=el.closest('li');
      const neighbor=$('[data-action="task-open"]',row.nextElementSibling||row.previousElementSibling||row);
      saveTask(p,{...item,projectId:null});
      render();
      const next=$(`#project-preview [data-action="task-open"][data-id="${CSS.escape(neighbor.dataset.id)}"]`);
      (next||$('#project-preview-title'))?.focus({preventScroll:true});
      await persist('목표에서 제외 완료');
      break;
    }
    case 'project-open':p.filters.project=id;view='board';closePop();render();await persist('');break;
    case 'board-group':p.boardGrouped=id==='project';closePop();render();await persist('');break;
    case 'timeline-project-toggle':{
      const key=projectKey(p,'timeline',id);
      if(collapsedProjects.has(key))collapsedProjects.delete(key);else collapsedProjects.add(key);
      const scroll=$('.timeline-scroll').scrollLeft;
      render();$('.timeline-scroll').scrollLeft=scroll;
      $(`[data-action="timeline-project-toggle"][data-id="${id}"]`).focus({preventScroll:true});
      break;
    }
    case 'project-close':{
      const project=toggleProjectCompletion(p,id);
      render();
      focusProjectStatus();
      await persist(project.closed?'목표 완료':'목표 재개');
      break;
    }
    case 'project-delete':{
      const project=p.projects.find(x=>x.id===id);
      if(await confirmAction('목표 삭제',`“${project.name}”을 삭제할까요? 소속 Task는 목표 없음으로 이동합니다.`)){
        removeProject(p,id);render();await persist('목표 삭제 완료');
      }
      break;
    }
    case 'collapse':state.ui.collapsed=!state.ui.collapsed;render();await persist('');break;
    case 'home':
      selected=null;view='home';trash=false;showClosedProjects=false;includeClosedBoardProjects=false;
      closePop();render();break;
    case 'home-normal':trash=false;render();break;case 'home-trash':trash=true;render();break;
    case 'nav':view=id;closePop();render();break;
    case 'planner-open':selected=id;view='board';trash=false;render();break;
    case 'planner-new':openPlannerModal();break;case 'planner-edit':openPlannerModal(id);break;
    case 'planner-delete':{const plan=state.planners.find(p=>p.id===id);if(await confirmAction('Planner 삭제',`“${plan.name}”을 휴지통으로 이동할까요? 30일 동안 복원할 수 있습니다.`)){plan.deletedAt=new Date().toISOString();if(selected===id){selected=null;view='home';}render();await persist('휴지통으로 이동했습니다.');}break;}
    case 'planner-restore':{const plan=state.planners.find(p=>p.id===id);if(Date.now()-Date.parse(plan.deletedAt)>=30*86400000)throw Error('보관 기간이 지났습니다.');plan.deletedAt=null;render();await persist('Planner 복원 완료');break;}
    case 'modal-cancel':closeModal();break;
    case 'bucket-new':openBucketModal();break;
    case 'bucket-delete':{const b=p.buckets.find(b=>b.id===id),dest=p.buckets.find(b=>b.id!==id),n=p.tasks.filter(t=>t.bucket===id).length;if(!dest)break;if(await confirmAction('버킷 삭제',`“${b.name}”을 삭제할까요?${n?` Task ${n}개는 “${dest.name}”으로 이동합니다.`:''}`)){removeBucket(p,id);render();await persist('버킷 삭제 완료');}break;}
    case 'bucket-up':case 'bucket-down':{const i=p.buckets.findIndex(b=>b.id===id),to=i+(action==='bucket-up'?-1:1);if(to<0||to>=p.buckets.length)break;const [b]=p.buckets.splice(i,1);p.buckets.splice(to,0,b);render();await persist('');break;}
    case 'sort':case 'filter':case 'bucket-sort':case 'task-options':openPop(action,el,id);break;
    case 'sort-choose':{if(pop.kind==='bucket-sort')p.buckets.find(b=>b.id===pop.id).sort=id==='inherit'?null:id;else{p.sort=id;p.buckets.forEach(b=>b.sort=null);}closePop();render();await persist('정렬 저장 완료');break;}
    case 'filter-chip-clear':{
      const index=$$('.filter-chip').indexOf(el);
      if(id==='dates')p.filters.from=p.filters.to='';
      else if(id==='labels')p.filters.labels=[];
      else p.filters[id]='all';
      closePop();
      render();
      const remaining=$$('.filter-chip');
      (remaining[index]||remaining[index-1]||$('[data-action="filter"]'))?.focus();
      await persist('');
      break;
    }
    case 'filter-reset':
      p.filters={project:'all',bucket:'all',priority:'all',due:'all',status:'all',from:'',to:'',labels:[]};
      if(id==='chips')closePop();
      render();
      if(id==='chips')$('[data-action="filter"]')?.focus();
      await persist('필터 초기화');break;
    case 'filter-label':{const f=p.filters;f.labels=f.labels.includes(id)?f.labels.filter(x=>x!==id):[...f.labels,id];render();await persist('');break;}
    case 'task-new':openTask(null,id||undefined,el.dataset.project);break;case 'task-open':openTask(id);break;
    case 'task-close':closeTask();break;
    case 'task-toggle':toggleTask(p,id);render();await persist('');break;
    case 'task-draft-toggle':captureTask(true);task.completed=task.completed?'':day();delete task.completedByProject;renderTask();break;
    case 'card-check':{const t=p.tasks.find(t=>t.id===id);t.checklist.find(c=>c.id===el.dataset.check).done=true;t.updatedAt=new Date().toISOString();render();await persist('');break;}
    case 'check-add':{const text=$('#check-add-input').value.trim();if(text){captureTask();task.checklist.push({id:uid(),text,done:false});renderTask();$('#check-add-input').focus();}break;}
    case 'check-delete':captureTask();task.checklist=task.checklist.filter(c=>c.id!==id);renderTask();break;
    case 'task-copy':captureTask(true);saveTask(p,task,{copy:true});closePop();render();notify('Task 복사 완료');await persist('');break;
    case 'task-delete':{closePop();if(await confirmAction('Task 삭제',`“${task.title||p.tasks.find(t=>t.id===task.id).title}”을 영구 삭제할까요?`)){p.tasks=p.tasks.filter(t=>t.id!==task.id);finishTask();await persist('Task 삭제 완료');}break;}
    case 'task-label-remove':case 'task-label-toggle':captureTask();task.labels=task.labels.includes(id)?task.labels.filter(x=>x!==id):[...task.labels,id];{const anchor=pop?.anchor;renderTask();if(action==='task-label-toggle'){pop={kind:'labels',id:'',anchor};renderPopover();}}break;
    case 'task-label-add':{const name=$('#new-label-name').value.trim(),color=$('#new-label-color').value,l={id:uid(),name,color};captureTask();p.labels.push(l);task.labels.push(l.id);const anchor=pop.anchor;renderTask();pop={kind:'labels',id:'',anchor};renderPopover();await persist('레이블 추가 완료');break;}
    case 'label-rename':{const l=p.labels.find(l=>l.id===id),row=el.closest('.label-option');row.innerHTML=`<form data-form="label-rename" data-id="${id}" class="inline-form">${input('name="name" aria-label="레이블명 편집" maxlength="160"',l.name)}<button>저장</button>${btn('label-rename-cancel','취소')}</form>`;$('input',row).focus();break;}
    case 'label-rename-cancel':renderPopover();break;
    case 'label-delete':removeLabel(p,id);render();await persist('레이블 삭제 완료');break;
    case 'month-prev':case 'month-next':{const d=new Date(month+'-01T12:00:00');d.setMonth(d.getMonth()+(action==='month-prev'?-1:1));month=day(d).slice(0,7);render();break;}
    case 'month-today':month=day().slice(0,7);render();break;
    case 'timeline-mode':p.timelineMode=+id;render();await persist('');break;
    case 'timeline-shift':timelineStart=addDays(timelineStart,+id);render();break;
    case 'timeline-today':timelineStart=addDays(day(),-({7:3,14:6,28:13}[p.timelineMode]));render();break;
    case 'width-reset':p.appearance.width=340;render();await persist('넓이 초기화');break;
    case 'palette':p.appearance.colors=clone(palettes[+id].colors);render();await persist('색상 적용 완료');break;
    case 'palette-custom':p.appearance.colors=clone(p.appearance.custom[+id].colors);render();await persist('색상 적용 완료');break;
    case 'palette-add':p.appearance.custom.push({name:`사용자 조합 ${p.appearance.custom.length+1}`,colors:clone(p.appearance.colors)});p.appearance.custom=p.appearance.custom.slice(0,12);render();await persist('조합 저장 완료 (최대 12개)');break;
    case 'palette-delete':p.appearance.custom.splice(+id,1);render();await persist('');break;
    case 'palette-reset':p.appearance.colors=clone(palettes[0].colors);render();await persist('색상 초기화');break;
    case 'save-retry':saveError='';await persist();break;
    case 'channel-toggle':{
      const edit=draft(p),n=clone(edit);
      n[id]=!n[id];
      validateNotifications(n);
      edit[id]=n[id];
      await saveNotificationEdit(p,n);
      if(view==='settings'&&planner()?.id===p.id)redrawNotifications();
      notify('알림 설정 저장 완료');
      break;
    }
    case 'notification-reload':{
      if(await confirmAction('최신 알림 설정 불러오기','이 화면의 저장하지 않은 알림 설정을 최신 설정으로 교체할까요?','불러오기')){
        const requestedRevision=revision;
        const fresh=await api('/api/state');
        if(fresh.revision<latestKnownRevision)throw Error('설정이 다시 변경되었습니다. 최신 설정을 다시 불러오세요.');
        const latest=fresh.state.planners.find(item=>item.id===p.id&&!item.deletedAt);
        const current=state.planners.find(item=>item.id===p.id);
        if(!latest||!current)throw Error('Planner를 찾을 수 없습니다.');
        if(!saving&&!saveError&&!modal&&revision===requestedRevision){
          acceptWorkspace(fresh);
        }else current.notifications=latest.notifications;
        notificationDrafts.delete(p.id);
        if(view==='settings'&&planner()?.id===p.id){
          redrawNotifications();
          $('[data-action="notification-save"]')?.focus();
        }
      }
      break;
    }
    case 'row-add':{
      const n=draft(p),i=n.rows.findIndex(row=>row.id===id),used=new Set(n.rows.map(row=>row.time));
      const [hours,minutes]=n.rows[i].time.split(':').map(Number);
      let minute=Number.isFinite(hours+minutes)?(hours*60+minutes+60)%1440:480;
      const timeAt=value=>`${String(Math.floor(value/60)).padStart(2,'0')}:${String(value%60).padStart(2,'0')}`;
      while(used.has(timeAt(minute)))minute=(minute+1)%1440;
      const row={...n.rows[i],id:uid(),time:timeAt(minute),reviewRequired:false};
      n.rows.splice(i+1,0,row);
      redrawNotifications();
      $(`[data-row="${row.id}"][data-key="time"]`).focus();
      break;
    }
    case 'row-delete':{const n=draft(p);if(n.rows.length===1)break;n.rows=n.rows.filter(r=>r.id!==id);if(rowSelection.get(p.id)===id)rowSelection.set(p.id,n.rows[0].id);redrawNotifications();break;}
    case 'folder-picker':{
      const folder=draft(p).exportFolder;
      el.disabled=true;
      busyActions++;
      try{
        const data=await api('/api/action','POST',{action:'folder-pick',planner:p.id,folder});
        if(view!=='settings'||planner()?.id!==p.id)return;
        if(data.folder)setReportFolder(p,data.folder);
      }finally{
        busyActions--;
        el.disabled=false;
        if(!modal&&el.isConnected)el.focus();
      }
      break;
    }
    case 'connection-test':case 'folder-test':{
      const key=action==='connection-test'?id:'export';
      const result=$(`[data-destination-result="${key}"]`);
      const n=draft(p);
      const field=key==='export'?'exportFolder':key+'Url';
      const value=n[field]?.trim()||'';
      const payload=key==='export'?{folder:value}:{channel:id,url:value};
      el.disabled=true;
      busyActions++;
      result.textContent='테스트 중…';
      let message;
      try{
        const data=await api('/api/action','POST',{action,planner:p.id,...payload});
        message=data.text;
      }catch(e){message=e.message;}
      finally{el.disabled=false;busyActions--;}
      if((draft(p)[field]?.trim()||'')===value)result.textContent=message;
      break;
    }
    case 'message-form-add':{
      const n=draft(p);
      let i=1;while(n.forms.some(form=>form.name.trim()===`양식 ${i}`))i++;
      const form=newMessageForm(`양식 ${i}`);
      n.forms.push(form);
      formSelection.set(p.id,form.id);
      redrawNotifications();
      const name=$('[data-message-field="name"]');
      name.focus();name.select();
      break;
    }
    case 'message-form-delete':{
      const n=draft(p),form=editingMessageForm(p);
      if(n.rows.some(row=>row.formId===form.id)||n.forms.length===1)break;
      n.forms=n.forms.filter(item=>item.id!==form.id);
      formSelection.delete(p.id);
      redrawNotifications();
      $('[data-message-form]').focus();
      break;
    }
    case 'message-section-add':{
      const section=newSection();
      editingMessageForm(p).sections.push(section);
      redrawNotifications();
      $(`[data-message-section="${section.id}"]`).focus();
      break;
    }
    case 'message-section-remove':case 'message-section-up':case 'message-section-down':{
      const sections=editingMessageForm(p).sections;
      const index=sections.findIndex(section=>section.id===id);
      const [section]=sections.splice(index,1);
      if(action!=='message-section-remove')sections.splice(index+(action==='message-section-up'?-1:1),0,section);
      redrawNotifications();
      const target=$(`[data-action="${action}"][data-id="${id}"]:not(:disabled)`);
      const next=sections[Math.min(index,sections.length-1)];
      (target||$(`[data-message-section="${action==='message-section-remove'?next.id:id}"]`)).focus();
      break;
    }
    case 'message-review-open':{
      const row=draft(p).rows.find(item=>item.id===id);
      formSelection.set(p.id,row.formId);
      rowSelection.set(p.id,row.id);
      redrawNotifications();
      $('[data-message-form]').focus();
      break;
    }
    case 'message-review-save':case 'notification-save':{
      const edit=draft(p),n=clone(edit);
      if(action==='message-review-save')n.rows.find(row=>row.id===id).reviewRequired=false;
      validateNotifications(n);
      if(action==='message-review-save')edit.rows.find(row=>row.id===id).reviewRequired=false;
      await saveNotificationEdit(p,n);
      notify('알림 설정 저장 완료');
      if(action==='message-review-save'){
        if(view==='settings'&&planner()?.id===p.id){
          redrawNotifications();
          $(`[data-row="${id}"][data-key="formId"]`)?.focus();
        }
      }
      break;
    }
    case 'notification-preview':case 'notification-export':case 'notification-teams':case 'notification-outlook':{
      const n=clone(draft(p)),channel=messagePreviewChannel,row=selectedMessageRow(p).id;
      validateNotifications(n);
      el.disabled=true;busyActions++;hideOutput();
      try{
        let data;
        const command=action.slice(13);
        if(command==='teams'||command==='outlook'){
          const {ticket}=await saveNotificationEdit(p,n,{channel:command,row});
          data=await api('/api/action','POST',{action:'notification-test',ticket});
        }else{
          await saveChain;
          if(saveError)throw Error(saveError);
          data=await api('/api/action','POST',{action:command,planner:p.id,notifications:n,row,channel});
        }
        const out=view==='settings'&&planner()?.id===p.id?$('#notification-output'):null;
        if(out){
          out.hidden=false;
          out.textContent=action==='notification-preview'&&channel==='outlook'?`제목: ${data.subject}\n\n${data.text}`:data.text;
          if(data.file||data.download)addReportDownload(out,data);
        }
        if(action!=='notification-preview')notify(data.text);
      }catch(e){
        const out=view==='settings'&&planner()?.id===p.id?$('#notification-output'):null;
        if(out){out.hidden=false;out.textContent=e.message;}
        throw e;
      }finally{el.disabled=false;busyActions--;}
      break;
    }
  }
}
function addReportDownload(out,data){
  const link=document.createElement('a');
  link.textContent='보고서 열기 / 다운로드';
  if(data.download){
    link.href=URL.createObjectURL(new Blob([data.download.text],{type:'text/plain;charset=utf-8'}));
    link.download=data.download.name;
  }else link.href=data.file;
  out.append(document.createElement('br'),link);
}
function backupPanel(){
  if(!status.backups)return '';
  return `<section class="panel backup-panel" aria-labelledby="backup-title">
    <h3 id="backup-title">데이터 백업</h3>
    <p class="muted">선택한 Planner의 목표·Task·설정·변경 기록을 백업합니다.</p>
    <div class="backup-options">
      <div>
        ${field('백업 범위',select('id="backup-planner"',[['','전체 작업 공간'],...state.planners.filter(p=>!p.deletedAt).map(p=>[p.id,p.name])],planner()?.id??''))}
        ${check('id="backup-connections"',false,'Teams·Outlook 연결 주소 포함')}
        <div class="row-actions">${btn('backup-download','JSON 백업 내려받기')}</div>
      </div>
      <div>
        ${field('백업 JSON 파일',input('id="backup-file" accept=".json,application/json"','','file'))}
        <div class="row-actions">${btn('backup-preview-file','JSON 가져오기')}</div>
      </div>
    </div>
  </section>`;
}
function openBackupReview(backup,summary,trigger){
  modal={kind:'backup-review',backup,summary,trigger};
  const targets=state.planners.filter(p=>!p.deletedAt);
  const sourceOptions=summary.choices.map(p=>[p.id,`${p.name} · Task ${p.tasks}개`]);
  const sourceDefault=sourceOptions.length===1?sourceOptions[0][0]:'';
  const modes=[['append','새 Planner로 추가']];
  if(targets.length&&sourceOptions.length)modes.push(['replace-planner','기존 Planner 하나에 복원']);
  if(summary.scope!=='planner')modes.push(['replace','전체 복원 · 작업 공간 교체 전 백업']);
  $('#overlay').innerHTML=`<div class="modal-backdrop"><section role="dialog" aria-modal="true" aria-labelledby="backup-review-title" class="dialog small">
    <div class="dialog-header"><h2 id="backup-review-title">백업 JSON 가져오기</h2>${ib('modal-cancel','close','닫기')}</div>
    <p>Planner ${summary.planners}개 · Task ${summary.tasks}개</p>
    ${field('가져오기 방식',select('id="backup-import-mode"',modes,sourceOptions.length?'append':'replace'))}
    ${field('백업의 Planner',select('id="backup-source-planner"',[['','활성 Planner 모두'],...sourceOptions],sourceDefault))}
    <div id="backup-target-field" hidden>
      ${field('복원할 기존 Planner',select('id="backup-target-planner"',targets.map(p=>[p.id,p.name]),planner()?.id))}
      <p class="muted">복원 전에 현재 데이터를 백업한 뒤 선택한 기존 Planner를 교체합니다.</p>
    </div>
    <p class="muted">가져온 Planner의 자동 알림과 예약 내보내기는 설정에서 다시 켤 수 있습니다.</p>
    <p id="backup-review-error" class="danger-text" role="status"></p>
    <div class="dialog-actions">${btn('modal-cancel','취소')}${btn('backup-apply','가져오기',{cls:'primary'})}</div>
  </section></div>`;
  updateBackupMode();
  $('#backup-import-mode').focus();
}
function updateBackupMode(){
  const mode=$('#backup-import-mode').value;
  const source=$('#backup-source-planner');
  source.closest('label').hidden=mode==='replace';
  source.options[0].disabled=mode==='replace-planner';
  if(mode==='replace-planner'&&!source.value)source.selectedIndex=1;
  $('#backup-target-field').hidden=mode!=='replace-planner';
}
async function handleBackup(action,button){
  button.disabled=true;
  busyActions++;
  try{
    await saveChain;
    if(saveError)throw Error(saveError);
    if(!button.isConnected)return;
    if(action==='backup-download'){
      const planner=$('#backup-planner').value||undefined;
      const res=await fetch('/api/backup',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({action:'download',planner,includeConnections:$('#backup-connections').checked})});
      if(!res.ok)throw Error((await res.json()).error);
      const url=URL.createObjectURL(await res.blob());
      const link=document.createElement('a');
      link.href=url;
      link.download=`kanban-${planner?'planner':'backup'}-${day()}.json`;
      link.click();
      setTimeout(()=>URL.revokeObjectURL(url),1000);
      return;
    }
    if(action==='backup-apply'){
      const review=modal;
      const {backup,summary}=review;
      const mode=$('#backup-import-mode').value;
      const sourcePlanner=mode==='replace'?undefined:$('#backup-source-planner').value||undefined;
      const targetPlanner=mode==='replace-planner'?$('#backup-target-planner').value:undefined;
      if(mode==='append'&&!summary.activePlanners)throw Error('추가할 활성 Planner가 없습니다. 전체 복원을 선택할 수 있습니다.');
      review.applying=true;
      $('#backup-review-error').textContent='가져오는 중…';
      try{
        await api('/api/backup','POST',{kind:'file',backup,action:'apply',mode,sourcePlanner,targetPlanner,revision:summary.currentRevision});
        const fresh=await api('/api/state');
        acceptWorkspace(fresh);
        for(const map of [notificationDrafts,formSelection,rowSelection]){
          if(mode==='replace')map.clear();
          else if(targetPlanner)map.delete(targetPlanner);
        }
        if(!planner()){selected=null;view='home';}
        review.applying=false;
        closeModal();
        render();
        notify('데이터 가져오기 완료');
      }finally{review.applying=false;}
      return;
    }
    const file=$('#backup-file').files[0];
    if(!file)throw Error('가져올 JSON 파일을 선택하세요.');
    if(file.size>64*1024*1024)throw Error('64 MiB 이하의 JSON 파일을 선택하세요.');
    let backup;
    try{backup=JSON.parse((await file.text()).replace(/^\uFEFF/,''));}
    catch{throw Error('백업 JSON 파일을 읽을 수 없습니다.');}
    const summary=await api('/api/backup','POST',{kind:'file',backup,action:'preview'});
    if(summary.currentRevision!==revision)throw Error('다른 화면에서 데이터가 변경되었습니다. 새로고침 후 다시 확인하세요.');
    if(button.isConnected&&!modal)openBackupReview(backup,summary,button);
  }catch(error){
    if(action==='backup-apply'&&modal?.kind==='backup-review')$('#backup-review-error').textContent=error.message;
    throw error;
  }finally{
    busyActions--;
    button.disabled=false;
  }
}
function hideOutput(){
  const el=$('#notification-output');
  if(!el)return;
  const download=$('a[download]',el);
  if(download)URL.revokeObjectURL(download.href);
  el.hidden=true;el.textContent='';
}
function redrawNotifications(){
  hideOutput();
  $('.notification-section').outerHTML=notifications(planner());
}
function redrawScheduleStatus(){
  const panel=$('.schedule-status');
  if(!panel)return;
  const next=document.createElement('div');
  next.innerHTML=notifications(planner());
  panel.replaceWith(next.querySelector('.schedule-status'));
}
document.addEventListener('click',e=>{if(e.target.closest('#confirm'))return;const action=e.target.closest('[data-action]');if(action){e.preventDefault();if(action.disabled)return;handleAction(action.dataset.action,action.dataset.id,action,e).catch(err=>notify(err.message,true));return;}if(e.target.classList.contains('modal-backdrop')){closeModal();return;}if(e.target.closest('#label-search')){if(pop?.kind!=='labels')openPop('labels',e.target);return;}const card=e.target.closest('[data-task]');if(card&&!e.target.closest('input,button')&&Date.now()>suppressClick)openTask(card.dataset.task);});
document.addEventListener('toggle',e=>{const key=e.target.dataset?.projectLane;if(key){if(e.target.open)collapsedProjects.delete(key);else collapsedProjects.add(key);}},true);
document.addEventListener('focusin',e=>{if(e.target.id==='label-search'&&pop?.kind!=='labels')openPop('labels',e.target);});
document.addEventListener('pointerdown',e=>{if(pop&&!e.target.closest('#popover')&&!e.target.closest('[data-action="sort"],[data-action="filter"],[data-action="bucket-sort"],[data-action="task-options"],#label-search'))closePop();});
document.addEventListener('submit',e=>{e.preventDefault();const f=e.target,kind=f.dataset.form,p=planner();(async()=>{
  if(kind==='task'){closeTask();return;}
if(kind==='project-modal'){
    const {name,description,start,due,labelId}=Object.fromEntries(new FormData(f));
    if(!name.trim())throw Error('목표 이름을 입력하세요.');
    if(start&&due&&start>due)throw Error('기한은 시작일과 같거나 그 이후여야 합니다.');
    const existing=p.projects.find(x=>x.id===modal.id);
    const boardEdit=modal.boardEdit;
    const statusChanged=!existing&&showClosedProjects;
    const project=existing||newProject();
    Object.assign(project,{name:name.trim(),description:description.trim(),start,due});
    if(labelId!==undefined)project.labelId=labelId||null;
    if(!existing){
      p.projects.push(project);
      showClosedProjects=false;
    }
    closeModal();
    render();
    if(boardEdit)focusBoardProjectEdit(project.id);
    if(statusChanged)focusProjectStatus();
    await persist('목표 저장 완료');
  }
  if(kind==='planner-modal'){const name=f.elements.name.value.trim(),description=f.elements.description.value.trim();if(!name)throw Error('Planner 이름을 입력하세요.');if(modal.id){const p=state.planners.find(p=>p.id===modal.id);p.name=name;p.description=description;}else{const p=newPlanner(name,description);state.planners.push(p);selected=p.id;view='board';}closeModal();render();await persist('Planner 저장 완료');}
  if(kind==='bucket-modal'||kind==='bucket-add'){const name=f.elements.name.value.trim();if(!name)return;p.buckets.push({id:uid(),name,sort:null});if(kind==='bucket-modal')closeModal();render();await persist('버킷 추가 완료');}
  if(kind==='planner-settings'){p.name=f.elements.name.value.trim()||'Kanban Planner';p.description=f.elements.description.value.trim()||'Kanban planner';render();await persist();}
  if(kind==='completion'){const action=f.elements.action.value;if(action==='label'&&!p.labels.length)throw Error('대상 레이블을 먼저 추가하세요.');p.completion={action,bucket:f.elements.bucket?.value||p.completion.bucket,label:f.elements.label?.value||p.completion.label};await persist('완료 액션 저장 완료');}
  if(kind==='label-add'){p.labels.push({id:uid(),name:f.elements.name.value.trim(),color:f.elements.color.value});render();await persist('레이블 추가 완료');}
  if(kind==='label-rename'){const l=p.labels.find(l=>l.id===f.dataset.id);l.name=f.elements.name.value.trim();captureTask();renderTask();renderPopover();await persist('레이블 이름 저장 완료');}
})().catch(err=>notify(err.message,true));});
function projectPopoverTrigger(popover){
  return $(`button[popovertarget="${CSS.escape(popover.id)}"]:not([popovertargetaction="hide"])`);
}
document.addEventListener('beforetoggle',e=>{
  const dropdown=e.target;
  if(e.newState!=='open'||!dropdown.classList.contains('project-inline-popover'))return;
  const anchor=projectPopoverTrigger(dropdown).getBoundingClientRect();
  const unlink=dropdown.classList.contains('project-unlink-popover');
  const width=Math.min(unlink?300:340,innerWidth-24);
  const below=innerHeight-anchor.bottom-12,above=anchor.top-12;
  const placeBelow=below>=(unlink?132:200)||below>=above;
  const left=unlink?anchor.right-width:anchor.left;
  dropdown.style.width=`${width}px`;
  dropdown.style.left=`${Math.max(12,Math.min(left,innerWidth-width-12))}px`;
  dropdown.style.top=placeBelow?`${anchor.bottom+6}px`:'auto';
  dropdown.style.bottom=placeBelow?'auto':`${innerHeight-anchor.top+6}px`;
  dropdown.style.maxHeight=`${Math.min(360,placeBelow?below:above)}px`;
  const search=$('#project-task-search',dropdown);
  if(search){
    search.value='';
    $$('[data-project-link-task]:checked',dropdown).forEach(item=>{item.checked=false;});
    updateProjectTaskResults(dropdown);
  }
},true);
document.addEventListener('input',e=>{
  if(e.target.matches('#project-task-search,[data-project-link-task]'))updateProjectTaskResults($('#project-task-dropdown'));
});
document.addEventListener('input',e=>{const el=e.target,p=planner();if(el.id==='task-due')updateTaskDueHint(p);if(el.matches('#task-notes'))autoGrow(el);if(el.matches('#label-search')){if(!pop||pop.kind!=='labels')openPop('labels',el);else renderPopover();}if(el.matches('[data-width],[data-width-number]')){const n=Math.min(480,Math.max(260,Math.round((+el.value||340)/10)*10));document.documentElement.style.setProperty('--bucket-width',n+'px');if(el.matches('[data-width]'))$('[data-width-number]').value=n;else $('[data-width]').value=n;}if(el.dataset.labelColor){p.labels.find(l=>l.id===el.dataset.labelColor).color=el.value;$(`[data-label-id="${el.dataset.labelColor}"]`).forEach(chip=>chip.style.setProperty('--label',el.value));}if(el.matches('[data-color]'))document.documentElement.style.setProperty(['--site','--sidebar','--bucket','--popup'][+el.dataset.color],el.value);if(el.matches('[data-n],[data-row],[data-message-field],[data-message-section]')){notificationInput(el);hideOutput();}});
function notificationInput(el){
  const p=planner(),n=draft(p),value=el.type==='checkbox'?el.checked:el.value;
  if(el.dataset.messageField){
    editingMessageForm(p)[el.dataset.messageField]=value;
    if(el.dataset.messageField==='name'){
      for(const select of $$('[data-message-form],[data-row][data-key="formId"]')){
        select.innerHTML=opts(messageFormOptions(n),select.value);
      }
    }
  }
  if(el.dataset.messageSection){
    const section=editingMessageForm(p).sections.find(item=>item.id===el.dataset.messageSection);
    section[el.dataset.key]=value;
    $('[data-section-title]',el.closest('.message-section')).textContent=sectionTitle(section);
  }
  if(el.dataset.n){
    const key=el.dataset.n;
    if(n[key]!==value){
      const channel={teamsUrl:'teams',outlookUrl:'outlook',exportFolder:'export'}[key];
      if(channel)$(`[data-destination-result="${channel}"]`).textContent='';
      n[key]=value;
    }
  }
  if(el.dataset.row){
    n.rows.find(row=>row.id===el.dataset.row)[el.dataset.key]=value;
    if(el.dataset.key==='time'){
      const selection=$('[data-preview-row]');
      selection.innerHTML=opts(n.rows.map(row=>[row.id,row.time]),selection.value);
    }
  }
}
document.addEventListener('change',e=>{const el=e.target,p=planner();(async()=>{
  if(el.id==='backup-import-mode')updateBackupMode();
  if(el.id==='task-project'){
    captureTask();
    if(task.completedByProject&&task.completedByProject!==task.projectId){
      task.completed='';
      delete task.completedByProject;
      renderTask();
      $('#task-project').focus();
    }else{
      $('#task-inherited-label').innerHTML=inheritedLabel(p,el.value);
      updateTaskDueHint(p);
    }
  }
  if(el.id==='task-due')updateTaskDueHint(p);
  if(el.matches('[data-date-picker]')){const text=el.closest('.date-control').querySelector('input[type="text"]');text.value=el.value;text.dispatchEvent(new Event('change',{bubbles:true}));}
  if(el.dataset.filter){let value=el.value;if(['from','to'].includes(el.dataset.filter)){try{value=parseDate(value);}catch(err){el.value=p.filters[el.dataset.filter];throw err;}}p.filters[el.dataset.filter]=value;const focused=el.dataset.filter;render();const next=$(`[data-filter="${focused}"]`);if(next)next.value=value;await persist('');}
  if(el.matches('[data-calendar-completed]')){p.calendarCompleted=el.checked;render();await persist('');}
  if(el.matches('[data-board-include-closed]')){
    includeClosedBoardProjects=el.checked;
    render();
    $('[data-board-include-closed]')?.focus({preventScroll:true});
  }
  if(el.matches('[data-completion-action]'))$('#completion-target').innerHTML=completionTarget(p,el.value);
  if(el.matches('[data-width],[data-width-number]')){p.appearance.width=Math.min(480,Math.max(260,Math.round((+el.value||340)/10)*10));render();await persist('');}
  if(el.dataset.color){p.appearance.colors[+el.dataset.color]=el.value;await persist('');}
  if(el.dataset.labelColor){p.labels.find(l=>l.id===el.dataset.labelColor).color=el.value;if(task){captureTask();const anchor=pop?.anchor;renderTask();if(anchor){pop={kind:'labels',id:'',anchor};renderPopover();}}else render();await persist('');}
  if(el.dataset.labelName){p.labels.find(l=>l.id===el.dataset.labelName).name=el.value.trim();await persist('');}
  if(el.matches('[data-n],[data-row],[data-message-field],[data-message-section]')){
    notificationInput(el);hideOutput();
    const {key,row,messageSection}=el.dataset;
    if(row&&key==='formId'){
      redrawNotifications();
      $(`[data-row="${row}"][data-key="formId"]`).focus();
    }
    if(messageSection&&key==='condition'){
      redrawNotifications();
      $(`[data-message-section="${messageSection}"][data-key="condition"]`).focus();
    }
  }
  if(el.matches('[data-message-form]')){formSelection.set(p.id,el.value);redrawNotifications();$('[data-message-form]').focus();}
  if(el.matches('[data-preview-row]')){rowSelection.set(p.id,el.value);hideOutput();}
  if(el.matches('[data-message-preview-channel]')){messagePreviewChannel=el.value;hideOutput();}
  if(el.dataset.taskCheck){captureTask();renderTask();}
})().catch(err=>notify(err.message,true));});
document.addEventListener('focusout',e=>{const el=e.target;if(el.matches('[data-bucket-name],[data-manage-bucket]')){const b=planner().buckets.find(b=>b.id===(el.dataset.bucketName||el.dataset.manageBucket)),name=el.value.trim();if(name&&name!==b.name){b.name=name;persist('').catch(()=>{});}else el.value=b.name;}});
document.addEventListener('keydown',e=>{
  if(e.isComposing)return;
  if(e.key==='Escape'&&!$('#confirm')){
    const dropdown=$('.project-inline-popover:popover-open');
    if(dropdown){
      e.preventDefault();
      dropdown.hidePopover();
      projectPopoverTrigger(dropdown)?.focus({preventScroll:true});
      return;
    }
  }
  if(e.key==='Escape'){if($('#confirm'))return;e.preventDefault();if(e.target.matches('[data-bucket-name],[data-manage-bucket]')){const b=planner().buckets.find(b=>b.id===(e.target.dataset.bucketName||e.target.dataset.manageBucket));e.target.value=b.name;e.target.blur();return;}if(pop){closePop();return;}if(modal)closeModal();else if(projectPreview)closeProjectPreview();}
  if(e.key==='Enter'){
    if(e.target.id==='check-add-input'){e.preventDefault();handleAction('check-add').catch(err=>notify(err.message,true));}
    if(e.target.id==='label-search'){e.preventDefault();const first=$('[data-action="task-label-toggle"]');if(first)first.click();}
    if(e.target.id==='new-label-name'){e.preventDefault();handleAction('task-label-add').catch(err=>notify(err.message,true));}
    if(e.target.matches('[data-bucket-name],[data-manage-bucket]')){e.preventDefault();e.target.blur();}
    if(e.target.matches('[data-task]')){e.preventDefault();openTask(e.target.dataset.task);}
  }
  if(e.key==='Tab'&&(modal||$('#confirm'))){const root=$('#confirm')||$('.dialog'),focusable=$$('button:not(:disabled),input:not(:disabled),select,textarea,a[href],summary',root).filter(el=>el.getClientRects().length&&(!el.closest('details:not([open])')||el.matches('summary')));const first=focusable[0],last=focusable.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}}
});

// One pointer implementation supports mouse, pen and touch. Edits commit only on pointerup.
document.addEventListener('pointerdown',e=>{
  if(e.button!==0)return;const card=e.target.closest('[data-task]'),check=e.target.closest('[data-check-handle]'),bucket=e.target.closest('[data-bucket-handle]');if(!check&&!bucket&&(!card||e.target.closest('button,input,select,textarea')))return;
  drag={kind:check?'check':bucket?'bucket':'task',id:check?.dataset.checkHandle||bucket?.dataset.bucketHandle||card.dataset.task,source:check?.closest('[data-check-row]')||bucket?.closest('[data-bucket-row]')||card,x:e.clientX,y:e.clientY,active:false,pointer:e.pointerId};
});
document.addEventListener('pointermove',e=>{if(!drag)return;const d=drag;if(!d.active&&Math.hypot(e.clientX-d.x,e.clientY-d.y)<7)return;if(!d.active){d.active=true;d.source.classList.add('dragging');const ghost=d.source.cloneNode(true);ghost.id='drag-ghost';ghost.style.width=d.source.getBoundingClientRect().width+'px';document.body.append(ghost);document.body.classList.add('is-dragging');}e.preventDefault();const ghost=$('#drag-ghost');ghost.style.left=e.clientX+14+'px';ghost.style.top=e.clientY+10+'px';$$('.drop-target,.drop-before,.drop-after').forEach(el=>el.classList.remove('drop-target','drop-before','drop-after'));
  const hit=document.elementFromPoint(e.clientX,e.clientY);d.target=null;d.before=null;
  if(d.kind==='task'){const target=hit?.closest('[data-drop-bucket],[data-bucket]');if(target){const column=target.closest('[data-bucket]');if(column.dataset.project!==d.source.closest('[data-bucket]')?.dataset.project)return;d.target=column.dataset.bucket;column.classList.add('drop-target');const c=hit.closest('[data-task]');if(c&&c.dataset.task!==d.id){const after=e.clientY>c.getBoundingClientRect().top+c.offsetHeight/2;c.classList.add(after?'drop-after':'drop-before');if(after){const next=c.nextElementSibling;d.before=next?.dataset.task||null;}else d.before=c.dataset.task;}}}
  else {const row=hit?.closest(d.kind==='check'?'[data-check-row]':'[data-bucket-row]');if(row){d.target=row.dataset.checkRow||row.dataset.bucketRow;d.after=e.clientY>row.getBoundingClientRect().top+row.offsetHeight/2;row.classList.add(d.after?'drop-after':'drop-before');}}
},{passive:false});
function cleanDrag(){if(!drag)return;drag.source?.classList.remove('dragging');$('#drag-ghost')?.remove();$$('.drop-target,.drop-before,.drop-after').forEach(el=>el.classList.remove('drop-target','drop-before','drop-after'));document.body.classList.remove('is-dragging');drag=null;}
document.addEventListener('pointerup',()=>{if(!drag)return;const d=drag,p=planner();cleanDrag();if(!d.active)return;suppressClick=Date.now()+400;
  if(d.target){if(d.kind==='task'){moveTask(p,d.id,d.target,d.before);render();persist('').catch(()=>{});}else{if(d.kind==='check')captureTask();const arr=d.kind==='check'?task.checklist:p.buckets,source=arr.findIndex(x=>x.id===d.id);if(d.id!==d.target){const [item]=arr.splice(source,1),to=arr.findIndex(x=>x.id===d.target);arr.splice(to+(d.after?1:0),0,item);}if(d.kind==='check')renderTask();else{render();persist('').catch(()=>{});}}}
});
document.addEventListener('pointercancel',cleanDrag);
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&drag){cleanDrag();suppressClick=Date.now()+400;}},true);window.addEventListener('blur',cleanDrag);
window.addEventListener('beforeunload',e=>{if(modal?.kind==='task'||modal?.applying||saving||saveError){e.preventDefault();e.returnValue='';}});
window.addEventListener('resize',()=>{if(pop)renderPopover();});
wideProjectView.addEventListener('change',()=>{if(projectPreview)render();});
try{acceptWorkspace(await api('/api/state'));render();}catch(e){$('#app').innerHTML=`<div class="startup-error"><h1>Planner를 불러올 수 없습니다.</h1><p>${esc(e.message)}</p><p>서버가 실행 중인지 확인한 후 새로고침하세요.</p></div>`;}

const canRefresh=()=>state&&!saving&&!modal&&!saveError&&!busyActions&&!$('#confirm');
let refreshing=false;
setInterval(async()=>{
  if(refreshing||!canRefresh())return;
  const requestedRevision=revision;
  refreshing=true;
  try{
    const data=await api('/api/state');
    if(!canRefresh()||revision!==requestedRevision||data.revision<latestKnownRevision)return;
    const capabilityChanged=status.projects!==data.status.projects||status.projectLabels!==data.status.projectLabels;
    status=data.status;
    if(capabilityChanged||data.revision!==revision){
      acceptWorkspace(data);
      if(!planner()){selected=null;view='home';}
      render();
    }else if(view==='settings')redrawScheduleStatus();
  }catch{}finally{refreshing=false;}
},30000);
