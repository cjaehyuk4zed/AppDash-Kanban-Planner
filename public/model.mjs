export const uid = () => crypto.randomUUID();
export const clone = x => structuredClone(x);
export function day(value = new Date()) {
  const d = value instanceof Date ? value : new Date(value);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
export function addDays(date, n) { const d = new Date(`${date}T12:00:00`); d.setDate(d.getDate()+n); return day(d); }
export function parseDate(text) {
  text = String(text ?? '').trim(); if (!text) return '';
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(text) || /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(text);
  if (!m) throw Error('올바른 날짜를 입력하세요 (YYYY-MM-DD).');
  const y=+m[1], mo=+m[2], d=+m[3];
  const dt = new Date(0); dt.setFullYear(y,mo-1,d); dt.setHours(12,0,0,0);
  if (y<1 || dt.getFullYear()!==y || dt.getMonth()!==mo-1 || dt.getDate()!==d) throw Error('실제 존재하는 날짜를 입력하세요.');
  return `${m[1]}-${String(mo).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
}
export const sorts = [['manual','수동'],['priorityHigh','우선순위 높은순'],['priorityLow','우선순위 낮은순'],['dueAsc','기한 빠른순'],['dueDesc','기한 늦은순'],['startAsc','시작일 빠른순'],['completedAsc','완료 날짜 빠른순'],['completedDesc','완료 날짜 늦은순'],['title','제목순'],['created','최근 생성순'],['incomplete','미완료 먼저']];
export const sectionStatuses=[['all','전체'],['incomplete','미완료'],['complete','완료']];
export const dueConditions=[['all','전체'],['none','기한 없음'],['before','기한 초과'],['today','오늘'],['tomorrow','내일'],['next','2~7일 후'],['week','오늘부터 7일 후'],['yesterday','어제~오늘'],['recent','최근 7일'],['range','기간 지정']];
export const notificationFormats=[['summary','요약'],['detail','상세']];
export const newProject = () => ({id:uid(),name:'',description:'',start:'',due:'',closed:false,completed:'',labelId:null});
export function initProjects(p) {
  p.projects ??= [];
  for(const project of p.projects)project.labelId ??= null;
  p.boardGrouped ??= false;
  p.filters.project ??= 'all';
  for(const t of p.tasks)t.projectId ??= null;
  return p;
}
export const projectName = (p,id) => id ? p.projects?.find(x=>x.id===id)?.name ?? '삭제된 목표' : '목표 없음';
export const projectLabelId = (p,id) => p.projects?.find(x=>x.id===id)?.labelId ?? null;
export function taskLabels(p,t) {
  const inherited=projectLabelId(p,t.projectId);
  return inherited&&!t.labels.includes(inherited)?[...t.labels,inherited]:t.labels;
}
export const matchesProject = (id,choice='all') => choice==='all'||(choice==='none'?!id:id===choice);
const historicalDue=Symbol('historicalDue');
export const projectDue=(p,id)=>p.projects?.find(project=>project.id===id)?.due||'';
export const taskDue=(p,task)=>task[historicalDue]??(task.due||projectDue(p,task.projectId));
export function projectStats(tasks,today=day(),goalDue='') {
  const active=tasks.filter(t=>!t.completed);
  const dueDates=active.map(task=>task.due||goalDue).filter(Boolean);
  return {total:tasks.length,done:tasks.length-active.length,overdue:dueDates.filter(d=>d<today).length,nextDue:dueDates.filter(d=>d>=today).sort()[0]||''};
}
export function toggleProjectCompletion(p,id,today=day()){
  const project=p.projects.find(item=>item.id===id);
  project.closed=!project.closed;
  project.completed=project.closed?today:'';
  const updatedAt=new Date().toISOString();
  for(const task of p.tasks.filter(item=>item.projectId===id)){
    if(project.closed&&!task.completed){
      task.completed=today;
      task.completedByProject=id;
    }else if(!project.closed&&task.completedByProject===id){
      task.completed='';
      delete task.completedByProject;
    }else continue;
    task.updatedAt=updatedAt;
  }
  return project;
}
export function removeProject(p,id) {
  p.projects=p.projects.filter(x=>x.id!==id);
  if(p.filters.project===id)p.filters.project='all';
  for(const t of p.tasks.filter(t=>t.projectId===id)){
    t.projectId=null;
    if(t.completedByProject===id){
      t.completed='';
      delete t.completedByProject;
    }
    t.updatedAt=new Date().toISOString();
  }
}
export const palettes = [
  {name:'기본',colors:['#f5f2eb','#ebe7dc','#ffffff9e','#ffffff']},
  {name:'차분한 녹색',colors:['#eef5f1','#dfece6','#ffffff','#fbfdfb']},
  {name:'맑은 회색',colors:['#f2f4f5','#e5e9e8','#ffffff','#ffffff']},
  {name:'따뜻한 종이',colors:['#f8f1e7','#efe4d3','#fffaf1','#fffdf8']}
];
export const newSection=(status='all',condition='all',from='',to='')=>({id:uid(),status,condition,from,to});
export const newMessageForm=(name='새 양식',sections=[newSection()])=>({
  id:uid(),name,sections,outlookSubject:'',outlookChecklist:false,outlookNotes:false
});
export const deadlineForm=()=>newMessageForm('기한 점검',[
  newSection('incomplete','before'),newSection('incomplete','today'),newSection('incomplete','next')
]);
export function defaultNotifications(){
  const form=deadlineForm();
  return {
    teams:false,outlook:false,export:false,teamsUrl:'',outlookUrl:'',exportFolder:'',
    forms:[form],rows:[{id:uid(),time:'08:00',teams:true,outlook:true,export:true,format:'summary',formId:form.id,reviewRequired:false}]
  };
}
export function newTask(p,bucket,projectId=p.filters.project) { return {id:uid(),title:'',projectId:p.projects?.some(x=>x.id===projectId)?projectId:null,bucket:bucket||p.filters.bucket!=='all'&&p.filters.bucket||p.buckets[0].id,labels:[],priority:'중',start:'',due:'',completed:'',checklist:[],notes:'',showChecklist:false,showNotes:false,order:Math.max(-1,...p.tasks.filter(t=>t.bucket===bucket).map(t=>t.order))+1,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()}; }
export function newPlanner(name='Kanban Planner',description='Kanban planner',examples=false) {
  const p={id:uid(),name,description,createdAt:new Date().toISOString(),deletedAt:null,buckets:['할 일','진행 중','검토','완료'].map(name=>({id:uid(),name,sort:null})),labels:['#6c80c4','#2f8f83','#c75c42','#d29c2f','#a05a9f','#538f9c','#b34d67','#5f7548'].map(color=>({id:uid(),name:'',color})),tasks:[],sort:'manual',filters:{bucket:'all',priority:'all',due:'all',status:'all',from:'',to:'',labels:[]},appearance:{width:340,colors:clone(palettes[0].colors),custom:[]},completion:{action:'none',bucket:'',label:''},calendarCompleted:true,timelineMode:7,notifications:defaultNotifications()};
  p.completion.bucket=p.buckets[0].id; p.completion.label=p.labels[0].id;
  if(examples) {
    const d=day(); const samples=[['요구사항 정리',0,[1],'상',d,addDays(d,3),'',[['Task 필드 정의',true],['완료 액션 정리',false]],'Planner 대체 서비스의 핵심 Task 모델을 정리합니다.'],['Kanban 보드 시안 검토',1,[0,3],'중',d,addDays(d,7),'',[['버킷 추가/삭제',false],['드래그 이동',false]],''],['완료 통계 확인',3,[2],'하','',d,d,[['차트 뷰 확인',true]],'완료 처리된 Task의 회색 상태와 완료 날짜 기록을 확인합니다.']];
    p.tasks=samples.map(([title,b,labels,priority,start,due,completed,checklist,notes])=>({...newTask(p,p.buckets[b].id),title,labels:labels.map(i=>p.labels[i].id),priority,start,due,completed,notes,checklist:checklist.map(([text,done])=>({id:uid(),text,done}))}));
  }
  return initProjects(p);
}
export const labelName=(p,id)=>{const i=p.labels.findIndex(l=>l.id===id);return i<0?'삭제된 레이블':p.labels[i].name||`레이블 ${i+1}`;};
export const bucketName=(p,id)=>p.buckets.find(b=>b.id===id)?.name||'삭제된 버킷';
export const rank = x=>({'상':0,'중':1,'하':2}[x]??1);
const cmp=(a,b)=>a<b?-1:a>b?1:0;
export function sortTasks(p,tasks,mode=p.sort) {
  const stable=(a,b)=>p.buckets.findIndex(x=>x.id===a.bucket)-p.buckets.findIndex(x=>x.id===b.bucket)||a.order-b.order||cmp(a.createdAt,b.createdAt)||cmp(a.id,b.id);
  return [...tasks].sort((a,b)=>{
    let n=0; const dates={dueAsc:['due',1],dueDesc:['due',-1],startAsc:['start',1],completedAsc:['completed',1],completedDesc:['completed',-1]};
    if(mode==='manual') return stable(a,b);
    if(mode==='priorityHigh'||mode==='priorityLow') return (rank(a.priority)-rank(b.priority))*(mode==='priorityHigh'?1:-1)||stable(a,b);
    if(dates[mode]) {
      const [field,sign]=dates[mode];
      const first=field==='due'?taskDue(p,a):a[field],second=field==='due'?taskDue(p,b):b[field];
      n=!first&&!second?0:!first?1:!second?-1:cmp(first,second)*sign;
    }
    if(mode==='title') n=a.title.localeCompare(b.title,'ko');
    if(mode==='created') n=cmp(b.createdAt,a.createdAt);
    if(mode==='incomplete') n=Number(!!a.completed)-Number(!!b.completed);
    return n||rank(a.priority)-rank(b.priority)||stable(a,b);
  });
}
export function filtered(p,today=day()) { const f=p.filters; return p.tasks.filter(t=>{
  const due=taskDue(p,t);
  return (
  (f.bucket==='all'||t.bucket===f.bucket)&&(f.priority==='all'||t.priority===f.priority)&&
  matchesProject(t.projectId,f.project)&&
  (f.status==='all'||(f.status==='complete'?!!t.completed:!t.completed))&&
  (!f.from||t.completed&&t.completed>=f.from)&&(!f.to||t.completed&&t.completed<=f.to)&&
  (!f.labels.length||f.labels.some(id=>taskLabels(p,t).includes(id)))&&
  (f.due==='all'||f.due==='overdue'&&due&&due<today&&!t.completed||f.due==='today'&&due===today||f.due==='week'&&due>=today&&due<=addDays(today,7)||f.due==='none'&&!due)
  );
}); }
export function saveTask(p,input,{copy=false,now=new Date().toISOString()}={}) {
  const old=p.tasks.find(t=>t.id===input.id), t=clone(input);
  t.title=t.title.trim()||old?.title||''; if(!t.title) return null;
  t.checklist=t.checklist.map(c=>({...c,text:c.text.trim()})).filter(c=>c.text);
  t.projectId=p.projects?.some(x=>x.id===t.projectId)?t.projectId:null;
  if(t.completedByProject){
    if(copy||t.completed!==old?.completed||t.completedByProject!==old?.completedByProject)delete t.completedByProject;
    else if(t.completedByProject!==t.projectId){
      t.completed='';
      delete t.completedByProject;
    }
  }
  t.labels=[...new Set(t.labels)].filter(id=>p.labels.some(l=>l.id===id));
  if(!p.buckets.some(b=>b.id===t.bucket)) t.bucket=p.buckets[0].id;
  if(!old||old.bucket!==t.bucket||copy) t.order=Math.max(-1,...p.tasks.filter(x=>x.bucket===t.bucket).map(x=>x.order))+1;
  t.updatedAt=now;
  if(copy) {t.id=uid();t.title+=' 복사';t.createdAt=now;t.checklist=t.checklist.map(c=>({...c,id:uid()}));}
  else if(!old?.completed&&t.completed) {
    const a=p.completion;
    if(a.action==='delete') {p.tasks=p.tasks.filter(x=>x.id!==t.id);return null;}
    if(a.action==='move'&&p.buckets.some(b=>b.id===a.bucket)) {t.bucket=a.bucket;t.order=Math.max(-1,...p.tasks.filter(x=>x.bucket===t.bucket).map(x=>x.order))+1;}
    if(a.action==='label'&&p.labels.some(l=>l.id===a.label)) t.labels=[a.label];
  }
  const i=p.tasks.findIndex(x=>x.id===t.id); if(i<0) p.tasks.push(t);else p.tasks[i]=t;
  return t;
}
export function toggleTask(p,id) {const t=clone(p.tasks.find(t=>t.id===id));t.completed=t.completed?'':day();delete t.completedByProject;return saveTask(p,t);}
export function removeBucket(p,id) {
  if(p.buckets.length===1) throw Error('버킷은 최소 하나가 필요합니다.');
  p.buckets=p.buckets.filter(b=>b.id!==id);const dest=p.buckets[0].id;
  let order=Math.max(-1,...p.tasks.filter(t=>t.bucket===dest).map(t=>t.order));
  p.tasks.filter(t=>t.bucket===id).sort((a,b)=>a.order-b.order).forEach(t=>{t.bucket=dest;t.order=++order;t.updatedAt=new Date().toISOString();});
  if(p.filters.bucket===id)p.filters.bucket='all';if(p.completion.bucket===id)p.completion.bucket=dest;
}
export function removeLabel(p,id) {p.labels=p.labels.filter(l=>l.id!==id);for(const project of p.projects??[])if(project.labelId===id)project.labelId=null;p.tasks.forEach(t=>{t.labels=t.labels.filter(x=>x!==id);});p.filters.labels=p.filters.labels.filter(x=>x!==id);if(p.completion.label===id)p.completion.label=p.labels[0]?.id||'';if(!p.labels.length&&p.completion.action==='label')p.completion.action='none';}
export function moveTask(p,id,bucket,before=null) {
  const t=p.tasks.find(x=>x.id===id); if(!t)return;
  if(t.bucket!==bucket){t.bucket=bucket;t.order=Math.max(-1,...p.tasks.filter(x=>x.bucket===bucket).map(x=>x.order))+1;}
  else {const b=p.buckets.find(b=>b.id===bucket),items=sortTasks(p,p.tasks.filter(x=>x.bucket===bucket),b.sort||p.sort);const old=items.map(x=>x.id).join();const rest=items.filter(x=>x.id!==id);let i=rest.findIndex(x=>x.id===before);if(i<0)i=rest.length;rest.splice(i,0,t);if(old===rest.map(x=>x.id).join())return;rest.forEach((x,i)=>x.order=i);b.sort='manual';}
  t.updatedAt=new Date().toISOString();
}
export function sectionMatches(task,section,today=day(),due=task.due){
  if(section.status==='complete'&&!task.completed)return false;
  if(section.status==='incomplete'&&task.completed)return false;
  if(section.condition==='all')return true;
  if(section.condition==='none')return !due;
  if(!due)return false;
  switch(section.condition){
    case 'before':return due<today;
    case 'today':return due===today;
    case 'tomorrow':return due===addDays(today,1);
    case 'next':return due>=addDays(today,2)&&due<=addDays(today,7);
    case 'week':return due>=today&&due<=addDays(today,7);
    case 'yesterday':return due>=addDays(today,-1)&&due<=today;
    case 'recent':return due>=addDays(today,-6)&&due<=today;
    case 'range':return (!section.from||due>=section.from)&&(!section.to||due<=section.to);
    default:return false;
  }
}
export function sectionTitle(section){
  const status=sectionStatuses.find(([id])=>id===section.status)?.[1]??'전체';
  const due=dueConditions.find(([id])=>id===section.condition)?.[1]??'전체';
  const range=section.from&&section.to?`${section.from} ~ ${section.to}`:
    section.from?`${section.from} 이후`:section.to?`${section.to} 이전`:'기간 지정';
  return `${section.status==='all'?'전체 상태':status} · ${section.condition==='all'?'기한 전체':section.condition==='range'?range:due}`;
}
export function validateConnectionUrl(value) {
  let url;
  try {
    if(typeof value!=='string'||value.length>10000)throw Error();
    url=new URL(value);
  } catch {throw Error('연결 주소가 올바르지 않습니다.');}
  if(url.protocol!=='https:'||url.username||url.password)throw Error('연결 주소는 인증 정보 없는 HTTPS URL이어야 합니다.');
}
export function validateNotifications(n){
  const invalid=()=>{throw Error('알림 설정 형식이 올바르지 않습니다.');};
  if(!n||!Array.isArray(n.rows)||!n.rows.length||n.rows.length>1000||!Array.isArray(n.forms)||!n.forms.length||n.forms.length>1000||
     ['teams','outlook','export'].some(key=>typeof n[key]!=='boolean')||['teamsUrl','outlookUrl'].some(key=>typeof n[key]!=='string'||n[key].length>10000))invalid();
  if(n.exportFolder!==undefined&&(typeof n.exportFolder!=='string'||n.exportFolder.length>4096||n.exportFolder.includes('\0')))throw Error('내보내기 폴더 경로가 올바르지 않습니다.');
  const ids=new Set(),formIds=new Set(),names=new Set(),times=new Set();
  const checkId=id=>{
    if(typeof id!=='string'||!/^[-a-zA-Z0-9_]{1,80}$/.test(id)||ids.has(id))invalid();
    ids.add(id);
  };
  for(const form of n.forms){
    if(!form||typeof form.name!=='string'||!form.name.trim()||form.name.length>80||!Array.isArray(form.sections)||!form.sections.length||form.sections.length>1000||
       typeof form.outlookSubject!=='string'||form.outlookSubject.length>160||/[\r\n]/.test(form.outlookSubject)||
       typeof form.outlookChecklist!=='boolean'||typeof form.outlookNotes!=='boolean')invalid();
    checkId(form.id);
    if(names.has(form.name.trim()))throw Error('메시지 양식 이름은 서로 달라야 합니다.');
    names.add(form.name.trim());formIds.add(form.id);
    for(const section of form.sections){
      if(!section||!sectionStatuses.some(([id])=>id===section.status)||!dueConditions.some(([id])=>id===section.condition)||
         typeof section.from!=='string'||typeof section.to!=='string')throw Error('메시지 섹션 조건이 올바르지 않습니다.');
      checkId(section.id);
      if(section.condition==='range'){
        if(!section.from&&!section.to)throw Error('기한의 기간 시작 또는 끝을 입력하세요.');
        if(parseDate(section.from)!==section.from||parseDate(section.to)!==section.to)throw Error('기한 날짜를 YYYY-MM-DD 형식으로 입력하세요.');
        if(section.from&&section.to&&section.from>section.to)throw Error('기한의 기간 시작이 끝보다 뒤입니다.');
      }
    }
  }
  for(const row of n.rows){
    if(!row||typeof row.reviewRequired!=='boolean'||['teams','outlook','export'].some(key=>typeof row[key]!=='boolean'))invalid();
    checkId(row.id);
    if(typeof row.time!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(row.time))throw Error('시간은 HH:MM 형식으로 입력하세요.');
    if(times.has(row.time))throw Error(`중복 발송 시간: ${row.time}`);
    times.add(row.time);
    if(!formIds.has(row.formId)||!notificationFormats.some(([id])=>id===row.format))throw Error('시간행의 메시지 양식과 출력 수준을 선택하세요.');
  }
  for(const key of ['teamsUrl','outlookUrl'])if(n[key])validateConnectionUrl(n[key]);
  return n;
}
function compareTaskDue(p,a,b){
  const first=taskDue(p,a),second=taskDue(p,b);
  if(Boolean(first)!==Boolean(second))return first?-1:1;
  return cmp(first,second);
}
export function notificationOrder(p,tasks) {
  return [...tasks].sort((a,b)=>compareTaskDue(p,a,b)||rank(a.priority)-rank(b.priority)||a.title.localeCompare(b.title,'ko'));
}
export function formatTask(p,task,format,outlookForm){
  const lines=[`- ${task.title} (기한 ${taskDue(p,task)||'없음'})`];
  if(format==='detail'){
    lines.push(`  목표: ${projectName(p,task.projectId)} · 버킷: ${bucketName(p,task.bucket)} · 우선순위: ${task.priority} · 완료일: ${task.completed||'없음'}`);
    if(outlookForm?.outlookChecklist)for(const item of task.checklist)lines.push(`    [${item.done?'완료':'미완료'}] ${item.text}`);
    if(outlookForm?.outlookNotes&&task.notes.trim())lines.push(`    메모: ${task.notes}`);
  }
  return lines.join('\n');
}
function notificationSelection(n,rowId){
  validateNotifications(n);
  const row=n.rows.find(r=>r.id===rowId)||n.rows[0];
  return {row,form:n.forms.find(f=>f.id===row.formId)};
}
export function notificationMessage(p,n,rowId,channel,today=day()){
  const {row,form}=notificationSelection(n,rowId);
  const teams=channel==='teams';
  const groups=form.sections.map(section=>({
    title:sectionTitle(section),
    tasks:notificationOrder(p,p.tasks.filter(task=>sectionMatches(task,section,today,taskDue(p,task))))
  })).filter(group=>group.tasks.length);
  const defaultSubject=`${p.name} · Task 알림`;
  const subject=teams?defaultSubject:form.outlookSubject.trim()||defaultSubject;
  if(!groups.length)return {subject,text:'해당하는 Task가 없습니다.'};
  const summary=groups.map(({title,tasks})=>`${title} ${tasks.length}건`).join(' · ');
  const blocks=groups.map(({title,tasks})=>{
    const shown=teams?tasks.slice(0,3):tasks;
    const lines=shown.map(task=>formatTask(p,task,row.format,teams?null:form));
    if(shown.length<tasks.length)lines.push(`외 ${tasks.length-shown.length}건`);
    return [`**${title}**`,...lines].join('\n');
  });
  return {subject,text:[summary,...blocks].join('\n\n')};
}
export function taskSnapshot(p,t) {const labelIds=taskLabels(p,t);return {id:t.id,title:t.title,bucket:bucketName(p,t.bucket),...(t.projectId?{projectId:t.projectId,project:projectName(p,t.projectId),projectLabelId:projectLabelId(p,t.projectId)}:{}),labelIds,labels:labelIds.map(id=>labelName(p,id)),priority:t.priority,start:t.start,due:taskDue(p,t),completed:t.completed,checklist:t.checklist.map(c=>({text:c.text,done:c.done})),notes:t.notes};}
export function changesBetween(before,after,at=new Date().toISOString()) {
  const changes=[];for(const p of after.planners.filter(p=>!p.deletedAt)){
    const old=before.planners.find(x=>x.id===p.id);if(!old||old.deletedAt)continue;
    for(const id of new Set([...old.tasks.map(t=>t.id),...p.tasks.map(t=>t.id)])){
      const a=old.tasks.find(t=>t.id===id),b=p.tasks.find(t=>t.id===id),sa=a?taskSnapshot(old,a):null,sb=b?taskSnapshot(p,b):null;
      if(JSON.stringify(sa)!==JSON.stringify(sb))changes.push({planner:p.id,at,type:!a?'생성':!b?'삭제':'수정',before:a?{task:clone(a),snapshot:sa}:null,after:b?{task:clone(b),snapshot:sb}:null});
    }
  }return changes;
}
export function plannerAt(p,journal,at) {
  const snapshot=clone(p);
  for(const c of journal.filter(c=>c.planner===p.id&&c.at>at).toReversed()) {
    snapshot.tasks=snapshot.tasks.filter(t=>t.id!==(c.after?.task.id||c.before?.task.id));
    if(c.before){
      const historicalTask=clone(c.before.task);
      historicalTask[historicalDue]=c.before.snapshot.due??c.before.task.due;
      snapshot.tasks.push(historicalTask);
      const old=c.before,task=old.task,b=snapshot.buckets.find(b=>b.id===task.bucket);
      if(b)b.name=old.snapshot.bucket;else snapshot.buckets.push({id:task.bucket,name:old.snapshot.bucket,sort:null});
      if(task.projectId&&old.snapshot.project){
        const project=snapshot.projects?.find(x=>x.id===task.projectId);
        const fields={name:old.snapshot.project,labelId:old.snapshot.projectLabelId??null};
        if(project)Object.assign(project,fields);
        else (snapshot.projects??=[]).push({...newProject(),id:task.projectId,...fields});
      }
      (old.snapshot.labelIds??task.labels).forEach((id,i)=>{const l=snapshot.labels.find(l=>l.id===id);if(l)l.name=old.snapshot.labels[i];else snapshot.labels.push({id,name:old.snapshot.labels[i],color:'#2f8f83'});});
    }
  }
  return snapshot;
}
function formatSnapshot(s,format){
  const lines=[`제목: ${s.title}`,`기한: ${s.due||'없음'}`];
  if(format==='detail')lines.push(`목표: ${s.project||'목표 없음'}`,`버킷: ${s.bucket}`,`우선순위: ${s.priority}`,`완료일: ${s.completed||'없음'}`);
  return lines.join('\n');
}
export function buildReport(p,n,rowId,scheduledAt,journal,meta={},actualAt=new Date().toISOString()){
  const {row,form}=notificationSelection(n,rowId);
  const date=day(scheduledAt);
  const matches=(task,at,due)=>form.sections.some(section=>sectionMatches(task,section,at,due));
  const items=p.tasks.filter(task=>matches(task,date,taskDue(p,task)))
    .sort((a,b)=>compareTaskDue(p,a,b)||a.title.localeCompare(b.title,'ko'));
  const begin=meta.coveredUntil&&day(meta.coveredUntil)<addDays(date,-1)?day(meta.coveredUntil):addDays(date,-1);
  const lines=[
    'Kanban 예약 내보내기',`Planner: ${p.name}`,`예약 시각: ${new Date(scheduledAt).toLocaleString('ko-KR')}`,
    `실제 생성 시각: ${new Date(actualAt).toLocaleString('ko-KR')}`,`마지막 변경 확인: ${meta.observedAt||'최초 기준'}`,
    `변경 기록 시작: ${meta.startedAt||'최초 기준'}`,`기록 범위: ${begin} ~ ${date} (예약 시각까지 실제 저장된 변경만 포함)`,
    '현재 조건은 예약 날짜, 변경 조건은 변경의 로컬 날짜 기준입니다.',
    '',`메시지 양식: ${form.name}`,...form.sections.map(sectionTitle),
    '','현재 작업 목록',...(items.length?items.map(task=>formatTask(p,task,row.format)):['조건에 맞는 작업 없음'])
  ];
  for(let d=begin;d<=date;d=addDays(d,1)){
    lines.push('',`변경 내역 ${d}`);
    const entries=journal.filter(change=>change.planner===p.id&&day(change.at)===d&&change.at<=scheduledAt&&
      [change.before,change.after].some(state=>state&&matches(state.task,d,state.snapshot.due??state.task.due)));
    if(!entries.length)lines.push('조건에 맞는 변경 기록 없음');
    for(const change of entries){
      lines.push(`[${change.type}] ${new Date(change.at).toLocaleString('ko-KR')}`);
      if(change.before)lines.push('변경 전',formatSnapshot(change.before.snapshot,row.format));
      if(change.after)lines.push('변경 후',formatSnapshot(change.after.snapshot,row.format));
    }
  }
  return lines.join('\n')+'\n';
}
