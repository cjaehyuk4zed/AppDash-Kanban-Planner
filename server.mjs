import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {isDeepStrictEqual,promisify} from 'node:util';
import {newPlanner,changesBetween,clone,validateNotifications,notificationMessage,buildReport,day,parseDate,sorts} from './public/model.mjs';
import {runtime,tick,deliver,testConnection,pendingReports,createNotificationQueue} from './engine.mjs';
import {resolveReportFolder,testReportFolder,writeScheduledReport} from './report-files.mjs';
import {BACKUP_LIMIT,STORE_SCHEMA,decodeWorkspace,createBackup,backupSummary,prepareImport,atomicWrite,readFolderSource,
  archiveStore,installFolderImport,recoverFolderImports} from './workspace-backup.mjs';

const BASE=path.dirname(fileURLToPath(import.meta.url));
const PORT=Number(process.env.KANBAN_PORT||4197);
// Test instances stay inside this base, never in another data repository.
const testName=process.env.KANBAN_TEST_INSTANCE;
if(testName&&!/^[a-z0-9-]+$/.test(testName))throw Error('Invalid test instance name');
if(!Number.isInteger(PORT)||PORT<1||PORT>65535||PORT!==4197&&!testName)throw Error('다른 포트는 별도의 테스트 인스턴스에서만 사용할 수 있습니다.');
const DATA=path.join(BASE,'data',testName||''),REPORTS=path.join(BASE,'reports',testName||'');
const BACKUPS=path.join(BASE,'backups',testName||'');
const FILE=path.join(DATA,'store.json');
const STATE_REQUEST_LIMIT=12_000_000;
const runFile=promisify(execFile);
let folderPickerOpen=false;
async function pickNativeFolder(folder,signal,forImport=false){
  if(process.platform!=='win32')throw Error('이 환경에서는 폴더 선택 창을 열 수 없습니다. 절대 경로를 입력하세요.');
  if(folderPickerOpen)throw Error('이미 폴더 선택 창이 열려 있습니다.');
  folderPickerOpen=true;
  try{
    const executable=path.join(process.env.SystemRoot||'C:/Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
    const command="$ErrorActionPreference='Stop'; [Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); Add-Type -Path $env:KANBAN_PICKER_SOURCE; $selected=[WindowsFolderPicker]::Pick($env:KANBAN_PICKER_START); ConvertTo-Json -Compress -InputObject @{folder=$selected}";
    const {stdout}=await runFile(executable,['-NoProfile','-STA','-WindowStyle','Hidden','-Command',command],{
      signal,timeout:300000,
      env:{...process.env,KANBAN_PICKER_SOURCE:path.join(BASE,'WindowsFolderPicker.cs'),KANBAN_PICKER_START:folder}
    });
    const {folder:picked}=JSON.parse(stdout);
    return {folder:picked?(forImport?path.normalize(picked):resolveReportFolder(picked,REPORTS)):null};
  }catch{
    if(signal.aborted)return {folder:null};
    throw Error('Windows 폴더 선택 창을 열 수 없습니다. 절대 경로를 입력하세요.');
  }finally{
    folderPickerOpen=false;
  }
}
let store;
async function persist(value){try{await atomicWrite(FILE,JSON.stringify(value,null,2));}catch{throw Error('저장 실패: 앱 폴더 안의 data 권한과 여유 공간을 확인하세요. 입력 내용은 화면에 유지됩니다.');}}
let queue=Promise.resolve();
function exclusive(fn){const job=queue.then(fn);queue=job.catch(()=>{});return job;}
const isString=(s,n=100000)=>typeof s==='string'&&s.length<=n;
function validateState(s){
  const fail=()=>{throw Error('저장 데이터 형식이 올바르지 않습니다.');};
  if(!s||!Array.isArray(s.planners)||s.planners.length>500||typeof s.ui?.collapsed!=='boolean')fail();
  const ids=new Set();const id=x=>{if(!isString(x,80)||!/^[-a-zA-Z0-9_]+$/.test(x)||ids.has(x))fail();ids.add(x);};
  for(const p of s.planners){id(p.id);if(!isString(p.name,160)||!p.name.trim()||!isString(p.description,300)||!isString(p.createdAt)||isNaN(Date.parse(p.createdAt))||p.deletedAt!==null&&(!isString(p.deletedAt)||isNaN(Date.parse(p.deletedAt))))fail();
    if(!Array.isArray(p.buckets)||!p.buckets.length||!Array.isArray(p.labels)||!Array.isArray(p.tasks)||p.tasks.length>50000)fail();
    if(!Array.isArray(p.projects)||typeof p.boardGrouped!=='boolean')throw Error('목표 기능을 사용하려면 앱 화면을 새로고침하세요.');
    const projectIds=new Set(),completedProjects=new Map();
    for(const project of p.projects){
      id(project.id);
      if(['all','none'].includes(project.id)||!isString(project.name,160)||!project.name.trim()||!isString(project.description,300)||typeof project.closed!=='boolean')fail();
      for(const d of ['start','due'])if(!isString(project[d],10)||parseDate(project[d])!==project[d])fail();
      if(project.start&&project.due&&project.start>project.due)fail();
      if(project.completed!==undefined){
        if(!isString(project.completed,10)||parseDate(project.completed)!==project.completed||project.completed&&!project.closed)fail();
        if(project.completed)completedProjects.set(project.id,project.completed);
      }
      if(project.labelId!=null&&!p.labels.some(l=>l.id===project.labelId))fail();
      projectIds.add(project.id);
    }
    if(!sorts.some(([mode])=>mode===p.sort))fail();
    for(const b of p.buckets){id(b.id);if(!isString(b.name,160)||!b.name.trim()||b.sort!==null&&!sorts.some(([mode])=>mode===b.sort))fail();}
    for(const l of p.labels){id(l.id);if(!isString(l.name,160)||!/^#[a-f0-9]{6}$/i.test(l.color))fail();}
    for(const t of p.tasks){id(t.id);if(t.projectId!==null&&!projectIds.has(t.projectId))fail();if(t.completedByProject!==undefined&&(t.completedByProject!==t.projectId||completedProjects.get(t.projectId)!==t.completed))fail();if(!isString(t.title,10000)||!t.title.trim()||!p.buckets.some(b=>b.id===t.bucket)||!['상','중','하'].includes(t.priority)||!Array.isArray(t.labels)||t.labels.some(id=>!p.labels.some(l=>l.id===id))||!isString(t.notes)||!Array.isArray(t.checklist)||!Number.isFinite(t.order)||typeof t.showChecklist!=='boolean'||typeof t.showNotes!=='boolean')fail();for(const d of ['start','due','completed']){if(!isString(t[d],10)||parseDate(t[d])!==t[d])fail();}for(const c of t.checklist){id(c.id);if(!isString(c.text)||typeof c.done!=='boolean')fail();}for(const d of ['createdAt','updatedAt'])if(!isString(t[d])||isNaN(Date.parse(t[d])))fail();}
    if(!p.filters||!Array.isArray(p.filters.labels)||!p.appearance||!Array.isArray(p.appearance.colors)||p.appearance.colors.length!==4||p.appearance.colors.some(c=>!/^#[a-f0-9]{6}([a-f0-9]{2})?$/i.test(c))||!Array.isArray(p.appearance.custom)||p.appearance.custom.length>12||!Number.isFinite(p.appearance.width)||p.appearance.width<260||p.appearance.width>480||!p.completion||!p.notifications)fail();
    validateNotifications(p.notifications);
    const f=p.filters;if(!['all','none'].includes(f.project)&&!projectIds.has(f.project))fail();if(!['all',...p.buckets.map(b=>b.id)].includes(f.bucket)||!['all','상','중','하'].includes(f.priority)||!['all','overdue','today','week','none'].includes(f.due)||!['all','complete','incomplete'].includes(f.status)||!isString(f.from,10)||!isString(f.to,10)||parseDate(f.from)!==f.from||parseDate(f.to)!==f.to||f.labels.some(id=>!p.labels.some(l=>l.id===id)))fail();
    const colorSet=c=>Array.isArray(c)&&c.length===4&&c.every(c=>typeof c==='string'&&/^#[a-f0-9]{6}([a-f0-9]{2})?$/i.test(c));
    if(p.appearance.custom.some(c=>!isString(c.name,80)||!colorSet(c.colors))||!['none','move','label','delete'].includes(p.completion.action)||typeof p.calendarCompleted!=='boolean'||![7,14,28].includes(p.timelineMode))fail();
    if(p.timelineCompleted!==undefined&&typeof p.timelineCompleted!=='boolean')fail();
  }
  return s;
}
async function loadStore(){
  const raw=await fs.readFile(FILE,'utf8').catch(error=>{
    if(error.code==='ENOENT')return null;
    throw Error('저장 파일을 읽을 수 없습니다. 원본을 보존하고 종료합니다.');
  });
  if(raw===null){
    const initial={schema:STORE_SCHEMA,revision:0,state:{ui:{collapsed:false},planners:[newPlanner(undefined,undefined,true)]},runtime:runtime()};
    await persist(initial);
    return initial;
  }
  let saved,previousSchema;
  try{
    const parsed=JSON.parse(raw);
    previousSchema=parsed?.schema;
    saved=decodeWorkspace(parsed,validateState);
  }catch{throw Error('저장 파일이 손상됐거나 지원하지 않는 버전입니다. 원본을 보존하고 종료합니다.');}
  if(saved.schema!==previousSchema){
    const backup=path.join(BACKUPS,`store.before-message-forms-${crypto.randomUUID()}.json`);
    await atomicWrite(backup,raw);
    await persist(saved);
  }
  return saved;
}
function purge(s,now=Date.now()){s.planners=s.planners.filter(p=>!p.deletedAt||now-Date.parse(p.deletedAt)<30*86400000);}
function saveConflict(){
  return Object.assign(Error('다른 화면에서 데이터가 변경되었습니다. 현재 입력은 유지됩니다. 새로고침 전에 필요한 내용을 보관하세요.'),{status:409});
}
function requireRevision(revision){if(revision!==store.revision)throw saveConflict();}
function plannerVersion(id){
  return store.state.planners.some(p=>p.id===id)?(Object.hasOwn(store.plannerVersions??{},id)?store.plannerVersions[id]:store.revision):null;
}
function updateVersions(next){
  const before=new Map(store.state.planners.map(p=>[p.id,p]));
  next.plannerVersions=Object.fromEntries(next.state.planners.map(p=>[
    p.id,isDeepStrictEqual(before.get(p.id),p)?plannerVersion(p.id):next.revision
  ]));
  next.uiVersion=isDeepStrictEqual(store.state.ui,next.state.ui)?store.uiVersion??store.revision:next.revision;
}
function checkPlannerSize(planner,version){
  if(Buffer.byteLength(JSON.stringify({planner,version}))<=STATE_REQUEST_LIMIT)return;
  const error=Error('Planner 저장 데이터가 12 MB를 초과합니다.');
  error.status=413;
  throw error;
}
async function saveState(state,revision){
  requireRevision(revision);
  validateState(state);
  const next=clone(store);
  purge(state);
  next.runtime.journal.push(...changesBetween(store.state,state));
  next.runtime.observedAt=new Date().toISOString();
  next.state=state;
  next.revision++;
  updateVersions(next);
  await persist(next);
  store=next;
  return {state:store.state,revision:store.revision};
}
async function saveWorkspacePart(input){
  const previousRevision=store.revision;
  const state=clone(store.state);
  const id=input.planner?.id;
  if(input.ui&&input.planner===undefined){
    if(input.version!==(store.uiVersion??store.revision))throw saveConflict();
    state.ui=input.ui;
  }else if(typeof id==='string'&&input.ui===undefined){
    if(input.version!==plannerVersion(id))throw saveConflict();
    checkPlannerSize(input.planner,previousRevision+1);
    const index=state.planners.findIndex(p=>p.id===id);
    if(index<0)state.planners.push(input.planner);
    else state.planners[index]=input.planner;
  }else throw Error('저장할 Planner 또는 화면 설정을 선택하세요.');
  await saveState(state,previousRevision);
  return {previousRevision,revision:store.revision,version:id?plannerVersion(id):store.uiVersion};
}
const notificationTests=new Map();
async function saveNotifications(input){
  const planner=store.state.planners.find(item=>item.id===input.planner&&!item.deletedAt);
  if(!planner)throw Error('Planner를 찾을 수 없습니다.');
  if(!isDeepStrictEqual(input.baseline,planner.notifications)){
    const error=Error('다른 화면에서 알림 설정이 변경되었습니다. 최신 설정을 확인하세요.');
    error.status=409;
    error.notifications=planner.notifications;
    throw error;
  }
  const notifications=validateNotifications(input.notifications);
  const test=input.test;
  if(test){
    const row=notifications.rows.find(item=>item.id===test.row);
    if(!['teams','outlook'].includes(test.channel)||!row)throw Error('테스트할 채널과 예약 시간을 선택하세요.');
    if(row.reviewRequired)throw Error('양식을 검토하고 저장한 뒤 테스트 전송하세요.');
    if(!notifications[test.channel+'Url'])throw Error('연결 주소를 입력하세요.');
  }
  const previousRevision=store.revision;
  const previousVersion=plannerVersion(planner.id);
  if(!isDeepStrictEqual(notifications,planner.notifications)){
    const next=clone(store.state);
    next.planners.find(item=>item.id===planner.id).notifications=notifications;
    checkPlannerSize(next.planners.find(item=>item.id===planner.id),previousRevision+1);
    await saveState(next,previousRevision);
  }
  const result={previousRevision,previousVersion,revision:store.revision,version:plannerVersion(planner.id),savedAt:store.runtime.observedAt,pendingReports:pendingReports(store)};
  if(test){
    const ticket=crypto.randomUUID();
    notificationTests.set(ticket,{planner:clone(planner),notifications,row:test.row,channel:test.channel});
    setTimeout(()=>notificationTests.delete(ticket),60_000).unref();
    result.ticket=ticket;
  }
  return result;
}
async function writeReport(job,previous,planner){
  await writeScheduledReport(resolveReportFolder(planner.notifications.exportFolder,REPORTS),job,previous);
}
async function body(req,limit=STATE_REQUEST_LIMIT){
  const chunks=[];
  let bytes=0;
  for await(const chunk of req){
    bytes+=chunk.length;
    if(bytes<=limit)chunks.push(chunk);
  }
  if(bytes>limit){const e=Error('저장 데이터가 너무 큽니다.');e.status=413;throw e;}
  try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw Error('JSON 요청이 올바르지 않습니다.');}
}
async function backupAction(input,json,res){
  if(input?.action==='folder-pick'){
    const controller=new AbortController();
    res.once('close',()=>controller.abort());
    const result=await pickNativeFolder(path.dirname(BASE),controller.signal,true);
    if(!res.destroyed)return json(result);
    return;
  }
  return exclusive(async()=>{
    if(input?.action==='download'){
      const text=JSON.stringify(createBackup(store,input.includeConnections===true,input.planner),null,2);
      if(Buffer.byteLength(text)>BACKUP_LIMIT)throw Error('백업이 64 MiB를 초과합니다. 앱 폴더 전체를 복사해 보관하세요.');
      res.setHeader('Content-Disposition',`attachment; filename="kanban-${input.planner?'planner':'backup'}-${day()}.json"`);
      res.writeHead(200,{'Content-Type':'application/json; charset=utf-8'});
      res.end(text);
      return;
    }
    if(!['preview','apply'].includes(input?.action)||!['file','folder'].includes(input.kind))throw Error('지원하지 않는 백업 작업입니다.');
    if(input.action==='apply')requireRevision(input.revision);
    const folder=input.kind==='folder'?await readFolderSource(input.folder,BASE,validateState):null;
    const incoming=folder?.decoded??decodeWorkspace(input.backup,validateState,{allowBackup:true});
    if(input.action==='preview'){
      return json({...backupSummary(incoming),currentRevision:store.revision,...(folder&&{
        reports:folder.reports.length,backups:folder.backups.length+folder.legacy.length,fingerprint:folder.fingerprint
      })});
    }
    if(folder&&folder.fingerprint!==input.fingerprint)throw Error('이전 앱의 파일이 변경되었습니다. 이전 앱을 종료하고 다시 확인하세요.');
    const next=prepareImport(store,incoming,folder?'replace':input.mode,input.sourcePlanner,input.targetPlanner);
    validateState(next.state);
    const existing=new Map(store.state.planners.map(p=>[p.id,p]));
    for(const planner of next.state.planners){
      if(!isDeepStrictEqual(existing.get(planner.id),planner))checkPlannerSize(planner,next.revision);
    }
    updateVersions(next);
    const raw=await fs.readFile(FILE,'utf8');
    if(folder)await installFolderImport(folder,{backups:BACKUPS,reports:REPORTS,raw,next,persist});
    else{
      if(['replace','replace-planner'].includes(input.mode))await archiveStore(BACKUPS,raw);
      await persist(next);
    }
    store=next;
    if(folder||input.mode==='replace')scheduledNotifications.cancel();
    if(input.mode==='replace-planner')scheduledNotifications.cancel(input.targetPlanner);
    return json({revision:store.revision});
  });
}
const mime={'.html':'text/html; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.txt':'text/plain; charset=utf-8'};
const server=http.createServer(async(req,res)=>{
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Cache-Control','no-store');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  const json=(value,status=200)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(value));};
  try{
    if(!['127.0.0.1:'+PORT,'localhost:'+PORT].includes(req.headers.host))return json({error:'허용되지 않은 호스트'},403);
    const url=new URL(req.url,`http://127.0.0.1:${PORT}`),route=url.pathname;
    if(req.method!=='GET'&&(!['http://127.0.0.1:'+PORT,'http://localhost:'+PORT].includes(req.headers.origin)||!req.headers['content-type']?.startsWith('application/json')))return json({error:'같은 앱 화면에서 JSON 요청을 사용하세요.'},403);
    if(!store)return json({ready:false,error:'저장소를 준비하고 있습니다.'},503);
    if(route==='/api/ready'&&req.method==='GET')return json({ready:true,name:'Kanban Planner (Beta)'});
    if(route==='/api/state'&&req.method==='GET')return await exclusive(async()=>{const next=clone(store);purge(next.state);if(next.state.planners.length!==store.state.planners.length){next.revision++;updateVersions(next);await persist(next);store=next;}json({state:store.state,revision:store.revision,plannerVersions:Object.fromEntries(store.state.planners.map(p=>[p.id,plannerVersion(p.id)])),uiVersion:store.uiVersion??store.revision,status:{projects:true,projectLabels:true,backups:true,savedAt:store.runtime.observedAt,pending:store.runtime.pending.length,pendingReports:pendingReports(store),delivery:Object.entries(store.runtime.delivery).slice(-30).map(([key,v])=>({key,...v})),reportPath:REPORTS,nativeFolderPicker:process.platform==='win32'}});});
    if(route==='/api/planner'&&req.method==='PUT'){const b=await body(req);return await exclusive(async()=>json(await saveWorkspacePart(b)));}
    if(route==='/api/backup'&&req.method==='POST')return await backupAction(await body(req,BACKUP_LIMIT+1024),json,res);
    if(route==='/api/state'&&req.method==='PUT'){const b=await body(req);return await exclusive(async()=>json(await saveState(b.state,b.revision)));}
    if(route==='/api/action'&&req.method==='POST'){
      const b=await body(req);
      if(b.action==='notification-save')return await exclusive(async()=>json(await saveNotifications(b)));
      if(b.action==='notification-test'){
        const test=notificationTests.get(b.ticket);
        if(!test)throw Error('테스트 요청이 만료되었습니다. 다시 시도하세요.');
        notificationTests.delete(b.ticket);
        try{await deliver(test.planner,test.notifications,test.row,test.channel);}
        catch(error){return json({error:`설정 저장 완료 · 테스트 전송 실패. ${error.message}`},502);}
        return json({text:'설정 저장 및 테스트 전송 완료'});
      }
      if(['connection-test','folder-test','folder-pick'].includes(b.action)){
        if(!store.state.planners.some(p=>p.id===b.planner&&!p.deletedAt))throw Error('Planner를 찾을 수 없습니다.');
        if(b.action==='connection-test'){
          if(!['teams','outlook'].includes(b.channel))throw Error('지원하지 않는 연결입니다.');
          return json({text:await testConnection(b.channel,b.url)});
        }
        if(b.action==='folder-pick'){
          let folder=REPORTS;
          try{
            const requested=resolveReportFolder(b.folder,REPORTS);
            if((await fs.stat(requested)).isDirectory())folder=requested;
          }catch{}
          const controller=new AbortController();
          res.once('close',()=>controller.abort());
          const result=await pickNativeFolder(folder,controller.signal);
          if(!res.destroyed)return json(result);
          return;
        }
        const folder=resolveReportFolder(b.folder,REPORTS);
        await testReportFolder(folder);
        return json({text:`폴더 테스트 성공 · ${folder}`});
      }
      return await exclusive(async()=>{
        const p=store.state.planners.find(p=>p.id===b.planner&&!p.deletedAt);if(!p)throw Error('Planner를 찾을 수 없습니다.');
        const n=validateNotifications(b.notifications),row=n.rows.find(r=>r.id===b.row)||n.rows[0];
        if(b.action==='preview')return json(notificationMessage(p,n,row.id,b.channel==='outlook'?'outlook':'teams'));
        if(b.action==='export'){
          const now=new Date(),text=buildReport(p,n,row.id,now.toISOString(),store.runtime.journal,{...store.runtime,...store.runtime.reports[p.id]});
          const name=`${day(now)}_${row.time.replace(':','-')}-${p.id}-${now.getTime()}-test.txt`;
          const folder=resolveReportFolder(n.exportFolder,REPORTS),destination=path.join(folder,name);
          try{await fs.writeFile(destination,text,{flag:'wx'});}catch{throw Error('테스트 내보내기 실패. 폴더 위치, 권한과 여유 공간을 확인하세요.');}
          const download=folder===REPORTS?{file:`/reports/${name}`}:{download:{name,text}};
          return json({text:`테스트 보고서 생성: ${destination}`,...download});
        }
        throw Error('지원하지 않는 실행입니다.');
      });
    }
    if(req.method!=='GET')return json({error:'지원하지 않는 요청'},405);
    let file;
    if(route.startsWith('/reports/')){const name=decodeURIComponent(route.slice(9));if(!/^[a-zA-Z0-9_-]+\.txt$/.test(name))return json({error:'잘못된 파일 이름'},400);file=path.join(REPORTS,name);res.setHeader('Content-Disposition',`attachment; filename="${name}"`);}
    else{const files={'/':'index.html','/app.mjs':'app.mjs','/model.mjs':'model.mjs','/styles.css':'styles.css','/icon.svg':'icon.svg'};if(!files[route])return json({error:'찾을 수 없습니다.'},404);file=path.join(BASE,'public',files[route]);}
    try{const data=await fs.readFile(file);res.writeHead(200,{'Content-Type':mime[path.extname(file)]});res.end(data);}catch(e){if(e.code==='ENOENT')return json({error:'파일을 찾을 수 없습니다.'},404);throw e;}
  }catch(e){if(!res.headersSent)json({error:e.message?.startsWith('ENOENT')?'파일 작업에 실패했습니다.':e.message||'처리에 실패했습니다.',...(e.notifications&&{notifications:e.notifications})},e.status||400);else res.end();}
});
try{
  await new Promise((resolve,reject)=>{
    server.once('error',reject);
    server.listen(PORT,'127.0.0.1',()=>{server.removeListener('error',reject);resolve();});
  });
  await fs.mkdir(DATA,{recursive:true,mode:0o700});
  await fs.mkdir(BACKUPS,{recursive:true,mode:0o700});
  await recoverFolderImports(BACKUPS,REPORTS,FILE);
  await fs.mkdir(REPORTS,{recursive:true,mode:0o700});
  store=await loadStore();
}catch(error){
  server.close();
  console.error(error.code==='EADDRINUSE'?`포트 ${PORT}가 사용 중입니다. 기존 앱을 종료하세요.`:error.message);
  process.exit(1);
}
const scheduledNotifications=createNotificationQueue({
  readStore:()=>store,exclusive,checkpoint:persist,
  send:(planner,row,channel,today)=>deliver(planner,planner.notifications,row,channel,fetch,today)
});
const timer=setInterval(()=>{
  const observedAt=new Date();
  exclusive(async()=>{
    const next=clone(store);
    purge(next.state);
    if(next.state.planners.length!==store.state.planners.length){
      next.revision++;
      updateVersions(next);
      await persist(next);
      store=next;
    }
    await tick(store,{now:observedAt,writeReport,enqueueNotification:scheduledNotifications.enqueue,checkpoint:()=>persist(store)});
  }).catch(()=>console.error('예약 상태 저장 실패. data/reports 권한을 확인하세요.'));
},30000);
console.log(`Kanban Planner (Beta) http://127.0.0.1:${PORT}\n저장: ${DATA}\n보고서: ${REPORTS}\n종료: Ctrl+C 또는 AppDash 중지`);
async function stop(){clearInterval(timer);server.close();server.closeIdleConnections();await scheduledNotifications.close();await queue;process.exit(0);}
process.on('SIGINT',stop);process.on('SIGTERM',stop);
