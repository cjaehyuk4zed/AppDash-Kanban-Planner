import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import net from 'node:net';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {clone,newPlanner,newProject,newSection} from '../public/model.mjs';
import {runtime} from '../engine.mjs';
const base=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
test('real HTTP lifecycle, readiness, persistence/restart, revision conflict, preview/export isolation and security',async()=>{
 const listener=net.createServer();await new Promise(r=>listener.listen(0,'127.0.0.1',r));const port=listener.address().port;await new Promise(r=>listener.close(r));const instance='test-'+crypto.randomUUID();let child;
 const dataDir=path.join(base,'data',instance);
 const sentFile=path.join(dataDir,'mock-notification.json'),releaseFile=path.join(dataDir,'mock-notification-release');
 const mockFetch=`import fs from 'node:fs/promises';
   const original=globalThis.fetch;
   globalThis.fetch=async(url,options)=>{
     if(url==='https://example.invalid/mock-outlook')return {ok:false};
     if(url!=='https://example.invalid/mock-teams')return original(url,options);
     await fs.writeFile(${JSON.stringify(sentFile)},options.body);
     for(let attempt=0;attempt<300;attempt++){
       if(await fs.stat(${JSON.stringify(releaseFile)}).then(()=>true,()=>false))return {ok:true};
       await new Promise(resolve=>setTimeout(resolve,20));
     }
     throw Error('mock notification was not released');
   };`;
 const start=async()=>{child=spawn(process.execPath,['--import','data:text/javascript,'+encodeURIComponent(mockFetch),'server.mjs'],{cwd:base,env:{...process.env,KANBAN_PORT:String(port),KANBAN_TEST_INSTANCE:instance},stdio:['ignore','pipe','pipe'],windowsHide:true});let output='';child.stderr.on('data',b=>output+=b);await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('startup timeout '+output)),10000);child.stdout.on('data',b=>{output+=b;if(output.includes('http://')){clearTimeout(timer);resolve();}});child.on('error',reject);child.on('exit',code=>{if(code){clearTimeout(timer);reject(Error('exit '+code+' '+output));}});});};
 const stop=async()=>{if(!child||child.exitCode!==null)return;const done=new Promise(r=>child.once('exit',r));child.kill();await done;};
 const url=`http://127.0.0.1:${port}`,req=async(route,method='GET',data,origin=url)=>{const r=await fetch(url+route,{method,headers:{Origin:origin,'Content-Type':'application/json'},body:data?JSON.stringify(data):undefined});return {status:r.status,data:await r.json()};};
 try{
  const legacy=newPlanner(undefined,undefined,true);
  delete legacy.projects;delete legacy.boardGrouped;delete legacy.filters.project;
  for(const t of legacy.tasks)delete t.projectId;
  const {forms,rows,...notifications}=legacy.notifications;
  legacy.notifications={
    ...notifications,rows:rows.map(({formId,reviewRequired,...row})=>({...row,template:'legacy-template'})),
    templates:[{id:'legacy-template',name:'이전 양식',body:'사용자 문구 {dueToday} {completedToday}'}],
    parameters:[
      {name:'dueToday',status:'incomplete',field:'due',condition:'today',priority:'all',label:'all',bucket:'all',export:true},
      {name:'completedToday',status:'complete',field:'completed',condition:'today',priority:'all',label:'all',bucket:'all',export:true}
    ],include:['due'],empty:'기한 초과/당일/임박 Task 없음 ~~'
  };
  const backupDir=path.join(base,'backups',instance);
  await fs.mkdir(dataDir,{recursive:true});
  const legacyRaw=JSON.stringify({schema:1,revision:0,state:{ui:{collapsed:false},planners:[legacy]},runtime:runtime()});
  await fs.writeFile(path.join(dataDir,'store.json'),legacyRaw);
  await start();assert.equal((await req('/api/ready')).data.ready,true);const first=(await req('/api/state')).data;assert.equal(first.state.planners[0].tasks.length,3);
  assert.equal(first.status.projects,true);assert.equal(first.status.projectLabels,true);
  assert.deepEqual(first.state.planners[0].projects,[]);
  assert.equal(first.state.planners[0].filters.project,'all');
  assert.ok(first.state.planners[0].tasks.every(t=>t.projectId===null));
  const migrated=first.state.planners[0].notifications;
  assert.equal(first.revision,1);
  assert.equal(migrated.rows[0].reviewRequired,true);
  assert.equal(migrated.rows[0].formId,migrated.forms[0].id);
  assert.deepEqual(migrated.forms[0].sections.map(({status,condition})=>[status,condition]),[['incomplete','today']]);
  assert.equal(migrated.parameters,undefined);
  const backup=(await fs.readdir(backupDir)).find(name=>name.startsWith('store.before-message-forms-'));
  assert.equal(await fs.readFile(path.join(backupDir,backup),'utf8'),legacyRaw);
  assert.equal((await req('/api/state','PUT',{state:{ui:{collapsed:false},planners:[legacy]},revision:first.revision})).status,400);
  const changed=clone(first.state);changed.planners[0].tasks[0].title='Saved through API';const saved=await req('/api/state','PUT',{state:changed,revision:first.revision});assert.equal(saved.status,200);assert.equal((await req('/api/state','PUT',{state:first.state,revision:first.revision})).status,409);
  assert.equal((await req('/api/state','PUT',{state:changed,revision:saved.data.revision},'https://evil.example')).status,403);
  const invalid=clone(changed);invalid.planners[0].tasks[0].labels=['missing'];assert.equal((await req('/api/state','PUT',{state:invalid,revision:saved.data.revision})).status,400);
  const p=changed.planners[0],n=clone(p.notifications);
  n.forms[0].outlookSubject='UNSAVED';
  const payload={planner:p.id,notifications:n,row:n.rows[0].id,revision:saved.data.revision};
  const preview=await req('/api/action','POST',{...payload,action:'preview',channel:'outlook'});
  assert.equal(preview.status,200);assert.equal(preview.data.subject,'UNSAVED');
  assert.equal((await req('/api/state')).data.state.planners[0].notifications.forms[0].outlookSubject,'');
  const exp=await req('/api/action','POST',{...payload,action:'export'});assert.equal(exp.status,200);assert.ok(exp.data.file.endsWith('-test.txt'));const text=await (await fetch(url+exp.data.file)).text();assert.ok(text.includes('Kanban 예약 내보내기'));const files=await fs.readdir(path.join(base,'reports',instance));assert.equal(files.length,1);assert.ok(!files.some(f=>f.startsWith('latest-')));
  const custom=path.join(base,'reports',instance,'선택 폴더');
  await fs.mkdir(custom);
  const folderTest=folder=>req('/api/action','POST',{action:'folder-test',planner:p.id,folder});
  assert.equal((await folderTest('relative')).status,400);
  assert.equal((await folderTest(path.join(custom,'missing'))).status,400);
  assert.equal((await folderTest(custom)).status,200);assert.deepEqual(await fs.readdir(custom),[]);
  const customExport=await req('/api/action','POST',{...payload,action:'export',notifications:{...n,exportFolder:custom}});
  assert.equal(customExport.status,200);
  const download=customExport.data.download;
  assert.ok(download.name.endsWith('-test.txt'));assert.equal(await fs.readFile(path.join(custom,download.name),'utf8'),download.text);
  assert.equal((await req('/api/action','POST',{action:'connection-test',planner:p.id,channel:'teams',url:'http://example.com/secret'})).status,400);
  const afterTests=(await req('/api/state')).data;
  assert.equal(afterTests.revision,saved.data.revision);
  assert.equal(afterTests.state.planners[0].notifications.exportFolder,p.notifications.exportFolder);
  const bad=clone(n);bad.rows.push({...bad.rows[0],id:'another'});assert.equal((await req('/api/action','POST',{...payload,notifications:bad,action:'preview'})).status,400);assert.equal((await req('/api/action','POST',{...payload,action:'teams'})).status,400);
  const raw=JSON.parse(await fs.readFile(path.join(base,'data',instance,'store.json'),'utf8'));assert.equal(Object.keys(raw.runtime.delivery).length,0);assert.equal(raw.runtime.pending.length,0);assert.equal(raw.runtime.journal.length,1);assert.equal(raw.runtime.reports[p.id],undefined);
  const storePath=path.resolve(base,'data',instance,'store.json');assert.ok(storePath.startsWith(base+path.sep));
  await fs.rename(storePath,storePath+'.preserved');await fs.mkdir(storePath);
  try{const failed=await req('/api/state','PUT',{state:changed,revision:saved.data.revision});assert.equal(failed.status,400);assert.ok(failed.data.error.includes('저장 실패'));assert.equal((await req('/api/state')).data.revision,saved.data.revision);}finally{await fs.rmdir(storePath);await fs.rename(storePath+'.preserved',storePath);}
  const fresh=(await req('/api/state')).data;const oldTrash=clone(fresh.state);oldTrash.planners.push({...clone(p),id:crypto.randomUUID(),deletedAt:new Date(Date.now()-31*86400000).toISOString(),buckets:p.buckets.map(b=>({...b,id:crypto.randomUUID()})),labels:[],tasks:[]});assert.equal((await req('/api/state','PUT',{state:oldTrash,revision:fresh.revision})).status,200);assert.equal((await req('/api/state')).data.state.planners.length,1);
  const projectState=(await req('/api/state')).data;
  const project={...newProject(),labelId:projectState.state.planners[0].labels[1].id,name:'Website',start:'2026-11-06',due:'2026-11-10'};
  projectState.state.planners[0].projects.push(project);
  projectState.state.planners[0].tasks[0].projectId=project.id;
  projectState.state.planners[0].filters.project=project.id;
  projectState.state.planners[0].boardGrouped=true;
  projectState.state.planners[0].notifications.exportFolder=custom;
  const invalidProject=clone(projectState);invalidProject.state.planners[0].tasks[0].projectId='another-planner-project';
  assert.equal((await req('/api/state','PUT',invalidProject)).status,400);
  const invalidLabel=clone(projectState);invalidLabel.state.planners[0].projects[0].labelId='missing-label';
  assert.equal((await req('/api/state','PUT',invalidLabel)).status,400);
  assert.equal((await req('/api/state','PUT',projectState)).status,200);
  await stop();await start();const again=(await req('/api/state')).data;assert.equal(again.state.planners[0].tasks[0].title,'Saved through API');assert.equal(again.state.planners[0].tasks[0].projectId,project.id);assert.deepEqual(again.state.planners[0].projects,[project]);assert.equal(again.state.planners[0].boardGrouped,true);assert.deepEqual(again.state.planners[0].notifications.forms,p.notifications.forms);assert.equal((await fetch(url+'/data/store.json')).status,404);assert.equal((await fetch(url+'/reports/%2e%2e%2fdata%2fstore.json')).status,400);
  assert.equal((await fs.readdir(backupDir)).filter(name=>name.startsWith('store.before-message-forms-')).length,1);
  assert.equal(again.state.planners[0].notifications.exportFolder,custom);

  const current=again.state.planners[0],baseline=clone(current.notifications),edited=clone(baseline);
  edited.teamsUrl='https://example.invalid/mock-teams';
  edited.outlookUrl='https://example.invalid/mock-outlook';
  edited.export=true;
  edited.rows[0].reviewRequired=false;
  edited.forms[0].sections=[newSection()];
  const action=data=>req('/api/action','POST',{planner:current.id,...data});
  const settingsSaved=await action({action:'notification-save',baseline,notifications:edited,test:{channel:'teams',row:edited.rows[0].id}});
  assert.equal(settingsSaved.status,200);
  assert.equal(settingsSaved.data.previousRevision,again.revision);
  assert.ok(settingsSaved.data.ticket);
  assert.equal(settingsSaved.data.state,undefined);
  const sending=action({action:'notification-test',ticket:settingsSaved.data.ticket});
  sending.catch(()=>{});
  for(let attempt=0;attempt<100&&!await fs.stat(sentFile).then(()=>true,()=>false);attempt++)await new Promise(resolve=>setTimeout(resolve,20));
  assert.ok((await fs.stat(sentFile)).isFile());
  const duringSend=(await req('/api/state')).data;
  assert.equal(duringSend.state.planners[0].notifications.teamsUrl,edited.teamsUrl);
  duringSend.state.planners[0].tasks[0].title='Task edit while notification waits';
  assert.equal((await req('/api/state','PUT',duringSend)).status,200);
  await fs.writeFile(releaseFile,'');
  const sent=await sending;
  assert.equal(sent.status,200);
  assert.equal(sent.data.state,undefined);
  assert.equal(sent.data.revision,undefined);
  const sentPayload=await fs.readFile(sentFile,'utf8');
  assert.match(sentPayload,/Saved through API/);
  assert.doesNotMatch(sentPayload,/Task edit while notification waits/);
  assert.equal((await action({action:'notification-test',ticket:settingsSaved.data.ticket})).status,400);
  const newSettings={...edited,export:false};
  const second=await action({action:'notification-save',baseline:edited,notifications:newSettings,test:{channel:'outlook',row:edited.rows[0].id}});
  assert.equal(second.status,200);
  const deliveryFailure=await action({action:'notification-test',ticket:second.data.ticket});
  assert.equal(deliveryFailure.status,502);
  assert.match(deliveryFailure.data.error,/설정 저장 완료 · 테스트 전송 실패/);
  assert.equal(deliveryFailure.data.state,undefined);
  const conflict=await action({action:'notification-save',baseline:edited,notifications:{...edited,export:true}});
  assert.equal(conflict.status,409);
  assert.deepEqual(conflict.data.notifications,newSettings);
  const final=(await req('/api/state')).data;
  assert.equal(final.state.planners[0].tasks[0].title,'Task edit while notification waits');
  assert.equal(final.state.planners[0].notifications.export,false);
 }finally{await stop();for(const dir of ['data','reports','backups']){const target=path.resolve(base,dir,instance);assert.ok(target.startsWith(base+path.sep)&&target.includes(instance));await fs.rm(target,{recursive:true,force:true});}}
});
