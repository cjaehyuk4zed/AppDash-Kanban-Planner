import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {newPlanner,newProject,newTask,saveTask,toggleProjectCompletion,changesBetween,day} from '../public/model.mjs';
import {runtime} from '../engine.mjs';
import {atomicWrite,installFolderImport,recoverFolderImports} from '../workspace-backup.mjs';
import {releaseFiles} from '../scripts/release.mjs';

const app=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const fixture=async t=>{
  const base=await fs.mkdtemp(path.join(os.tmpdir(),'kanban-workspace-test-'));
  t.after(()=>fs.rm(base,{recursive:true,force:true}));
  return base;
};
const readJSON=async file=>JSON.parse(await fs.readFile(file,'utf8'));
const sourceStore=()=>{
  const planner=newPlanner('Imported Planner');
  const goal={...newProject(),name:'Preserved goal',labelId:planner.labels[0].id,due:'2026-11-24'};
  planner.projects.push(goal);
  const task=saveTask(planner,{...newTask(planner,planner.buckets[0].id,goal.id),title:'Original task',labels:[planner.labels[1].id]});
  const state={ui:{collapsed:false},planners:[planner]};
  const before=structuredClone(state);
  task.title='Imported task';
  toggleProjectCompletion(planner,goal.id,day());
  planner.filters.project=goal.id;
  Object.assign(planner.notifications,{teams:true,outlook:true,export:true,teamsUrl:'https://example.invalid/teams-private',outlookUrl:'https://example.invalid/outlook-private',exportFolder:'Z:/previous-location'});
  const history=runtime();
  history.journal=changesBetween(before,state);
  return {schema:2,revision:5,state,runtime:history};
};

test('clean release starts, keeps data in place across code updates, and imports a previous app and JSON',async t=>{
  const root=await fixture(t),base=path.join(root,'새 앱 위치'),source=path.join(root,'이전 앱 위치');
  for(const file of releaseFiles){
    const destination=path.join(base,file);
    await fs.mkdir(path.dirname(destination),{recursive:true});
    await fs.copyFile(path.join(app,file),destination);
  }
  assert.deepEqual(await Promise.all(['data','reports','backups','appdash-gateway-config.json'].map(name=>
    fs.stat(path.join(base,name)).then(()=>true,error=>error.code!=='ENOENT'))),[false,false,false,false]);
  const listener=net.createServer();
  await new Promise(resolve=>listener.listen(0,'127.0.0.1',resolve));
  const port=listener.address().port;
  await new Promise(resolve=>listener.close(resolve));
  const url=`http://127.0.0.1:${port}`,instance='distribution-qa';
  const file=path.join(base,'data',instance,'store.json'),reports=path.join(base,'reports',instance),backups=path.join(base,'backups',instance);
  let child;
  const stop=async()=>{
    if(!child||child.exitCode!==null||child.signalCode)return;
    const done=new Promise(resolve=>child.once('exit',resolve));
    child.kill();
    await done;
  };
  const start=async()=>{
    child=spawn(process.execPath,[path.join(base,'server.mjs')],{cwd:root,env:{...process.env,KANBAN_PORT:String(port),KANBAN_TEST_INSTANCE:instance},stdio:['ignore','pipe','pipe'],windowsHide:true});
    let diagnostics='';
    child.stderr.on('data',chunk=>{diagnostics+=chunk;});
    await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(Error(diagnostics||'Startup timed out')),10000);
      child.once('error',error=>{clearTimeout(timer);reject(error);});
      child.once('exit',code=>{clearTimeout(timer);reject(Error(diagnostics||`Exited ${code}`));});
      child.stdout.on('data',chunk=>{if(chunk.toString().includes(url)){clearTimeout(timer);resolve();}});
    });
  };
  const request=async(route,method='GET',payload,origin=url)=>{
    const response=await fetch(url+route,{method,headers:{Origin:origin,'Content-Type':'application/json'},
      body:payload===undefined?undefined:JSON.stringify(payload)});
    return {status:response.status,data:await response.json(),headers:response.headers};
  };
  const backup=(payload,origin)=>request('/api/backup','POST',payload,origin);
  const state=async()=>(await request('/api/state')).data;
  try{
    await start();
    const first=await state();
    assert.equal(first.state.planners[0].tasks.length,3);
    for(const dir of [reports,backups])assert.ok((await fs.stat(dir)).isDirectory());
    first.state.planners[0].tasks[0].title='Keep across update';
    const saved=await request('/api/state','PUT',first);
    assert.equal(saved.status,200);
    await fs.writeFile(path.join(reports,'keep.txt'),'destination report');
    const original=await fs.readFile(file,'utf8');
    await stop();
    await fs.copyFile(path.join(app,'server.mjs'),path.join(base,'server.mjs'));
    await start();
    assert.equal(await fs.readFile(file,'utf8'),original);
    assert.equal((await state()).state.planners[0].tasks[0].title,'Keep across update');

    const incoming=sourceStore();
    for(const dir of ['data','reports','backups'])await fs.mkdir(path.join(source,dir),{recursive:true});
    const sourceFile=path.join(source,'data','store.json'),sourceRaw=JSON.stringify(incoming);
    await fs.writeFile(sourceFile,sourceRaw);
    await fs.writeFile(path.join(source,'reports','new.txt'),'old app report');
    await fs.writeFile(path.join(source,'backups','old-backup.json'),'old app backup');
    const preview=await backup({action:'preview',kind:'folder',folder:source});
    assert.equal(preview.status,200);
    assert.deepEqual([preview.data.planners,preview.data.tasks,preview.data.reports,preview.data.backups],[1,1,1,1]);
    assert.equal(JSON.stringify(preview.data).includes('teams-private'),false);
    const apply={action:'apply',kind:'folder',folder:source,revision:preview.data.currentRevision,fingerprint:preview.data.fingerprint};
    await fs.writeFile(sourceFile,sourceRaw+'\n');
    assert.equal((await backup(apply)).status,400);
    assert.equal(await fs.readFile(file,'utf8'),original);
    await fs.writeFile(sourceFile,sourceRaw);
    assert.equal((await backup({...apply,revision:apply.revision-1})).status,409);
    assert.equal((await backup(apply,'https://evil.example')).status,403);
    assert.equal((await backup(apply)).status,200);
    assert.equal(await fs.readFile(sourceFile,'utf8'),sourceRaw);
    assert.equal(await fs.readFile(path.join(reports,'new.txt'),'utf8'),'old app report');
    const archive=(await fs.readdir(backups)).find(name=>name.startsWith('before-folder-import-'));
    assert.equal(await fs.readFile(path.join(backups,archive,'store.json'),'utf8'),original);
    assert.equal(await fs.readFile(path.join(backups,archive,'reports','keep.txt'),'utf8'),'destination report');
    assert.equal(await fs.readFile(path.join(backups,archive,'imported-backups','backups','old-backup.json'),'utf8'),'old app backup');

    const live=await state(),oldPlanner=live.state.planners[0];
    const notifications=oldPlanner.notifications;
    assert.deepEqual([notifications.teams,notifications.outlook,notifications.export,notifications.exportFolder],[false,false,false,'']);
    assert.equal(notifications.rows[0].time,incoming.state.planners[0].notifications.rows[0].time);
    const redacted=await backup({action:'download'});
    const complete=await backup({action:'download',includeConnections:true});
    assert.match(redacted.headers.get('content-disposition'),/attachment/);
    assert.doesNotMatch(JSON.stringify(redacted.data),/teams-private|outlook-private/);
    assert.match(JSON.stringify(complete.data),/teams-private/);
    assert.equal((await backup({action:'preview',kind:'file',backup:{...redacted.data,schema:999}})).status,400);
    assert.equal((await backup({action:'preview',kind:'file',backup:{...redacted.data,runtime:{...redacted.data.runtime,journal:[{}]}}})).status,400);
    const filePreview=await backup({action:'preview',kind:'file',backup:redacted.data});
    assert.equal(filePreview.status,200);
    assert.equal((await backup({action:'apply',kind:'file',mode:'append',revision:filePreview.data.currentRevision,backup:redacted.data})).status,200);
    const appended=await state(),[kept,copied]=appended.state.planners;
    assert.deepEqual(kept,oldPlanner);
    assert.notEqual(copied.id,kept.id);
    assert.equal(copied.tasks[0].projectId,copied.projects[0].id);
    assert.equal(copied.tasks[0].completedByProject,copied.projects[0].id);
    assert.equal(copied.tasks[0].labels[0],copied.labels[1].id);
    assert.equal(copied.filters.project,copied.projects[0].id);
    assert.equal(copied.notifications.rows[0].formId,copied.notifications.forms[0].id);
    const history=(await readJSON(file)).runtime.journal.find(entry=>entry.planner===copied.id);
    assert.equal(history.before.task.id,copied.tasks[0].id);
    assert.equal(history.after.snapshot.projectId,copied.projects[0].id);
    assert.equal(history.after.snapshot.projectLabelId,copied.labels[0].id);
    const beforeReplace=await fs.readFile(file,'utf8');
    assert.equal((await backup({action:'apply',kind:'file',mode:'replace',revision:appended.revision,backup:redacted.data})).status,200);
    assert.equal((await state()).state.planners.length,1);
    const replaceArchive=(await fs.readdir(backups)).find(name=>name.startsWith('store.before-import-'));
    assert.equal(await fs.readFile(path.join(backups,replaceArchive),'utf8'),beforeReplace);
    const originalWorkspace=await state();
    const large=newPlanner('Large Planner');
    for(let i=0;i<65;i++)large.tasks.push({...newTask(large,large.buckets[0].id),title:`Large Task ${i}`,notes:'n'.repeat(95_000)});
    const savePlanner=(planner,version)=>request('/api/planner','PUT',{planner,version});
    assert.equal((await savePlanner(large,null)).status,200);
    const oneLarge=await state();
    const plannerBackup=await backup({action:'download',planner:large.id});
    assert.equal(plannerBackup.status,200);
    assert.equal(plannerBackup.data.scope,'planner');
    assert.deepEqual(plannerBackup.data.state.planners.map(p=>p.id),[large.id]);
    assert.ok(plannerBackup.data.runtime.journal.every(entry=>entry.planner===large.id));
    assert.equal((await backup({action:'apply',kind:'file',mode:'replace',revision:oneLarge.revision,backup:plannerBackup.data})).status,400);
    assert.equal((await backup({action:'apply',kind:'file',mode:'append',revision:oneLarge.revision,backup:plannerBackup.data})).status,200);
    const combined=await state();
    assert.ok(Buffer.byteLength(JSON.stringify(combined.state))>12_000_000);
    const otherLarge=combined.state.planners.at(-1);
    large.tasks[0].title='Edited first large Planner';
    otherLarge.tasks[0].title='Edited second large Planner';
    assert.equal((await savePlanner(large,combined.plannerVersions[large.id])).status,200);
    assert.equal((await savePlanner(otherLarge,combined.plannerVersions[otherLarge.id])).status,200);
    assert.equal((await savePlanner(large,combined.plannerVersions[large.id])).status,409);
    const savedPlanners=await state();
    const target=originalWorkspace.state.planners[0].id;
    assert.equal((await backup({action:'apply',kind:'file',mode:'replace-planner',revision:savedPlanners.revision,
      backup:redacted.data,sourcePlanner:redacted.data.state.planners[0].id,targetPlanner:target})).status,200);
    const replaced=await state();
    assert.equal(replaced.state.planners[0].id,target);
    assert.notEqual(replaced.state.planners[0].tasks[0].id,originalWorkspace.state.planners[0].tasks[0].id);
    assert.deepEqual(replaced.state.planners.slice(1).map(p=>p.tasks[0].title),['Edited first large Planner','Edited second large Planner']);
    await stop();
    await start();
    assert.deepEqual((await state()).plannerVersions,replaced.plannerVersions);
    await stop();
    const savedRaw=await fs.readFile(file,'utf8');
    for(const invalid of ['{invalid',JSON.stringify({...JSON.parse(savedRaw),schema:999})]){
      await fs.writeFile(file,invalid);
      await assert.rejects(start(),/원본을 보존/);
      assert.equal(await fs.readFile(file,'utf8'),invalid);
    }
  }finally{await stop();}
});

test('folder copy or commit failures preserve the current store and report folder, and interrupted copies recover',async t=>{
  const base=await fixture(t);
  const reports=path.join(base,'reports'),backups=path.join(base,'backups'),source=path.join(base,'source');
  const file=path.join(base,'store.json'),raw=JSON.stringify({revision:8}),next={revision:9};
  for(const dir of [reports,backups,path.join(source,'reports')])await fs.mkdir(dir,{recursive:true});
  await fs.writeFile(file,raw);
  await fs.writeFile(path.join(reports,'current.txt'),'current');
  const input={source,reports:['new.txt'],backups:[],legacy:[]};
  const rejectCommit=async()=>{throw Error('write failed');};
  const options={backups,reports,raw,next,persist:rejectCommit};
  await assert.rejects(installFolderImport(input,options),/복사할 파일/);
  await fs.writeFile(path.join(source,'reports','new.txt'),'new');
  await assert.rejects(installFolderImport(input,options),/write failed/);
  assert.deepEqual(await fs.readdir(reports),['current.txt']);
  assert.equal(await fs.readFile(file,'utf8'),raw);
  const interrupted=path.join(backups,'before-folder-import-interrupted');
  await fs.mkdir(interrupted);
  await atomicWrite(path.join(interrupted,'pending-folder-import.json'),JSON.stringify({revision:next.revision}));
  await fs.rename(reports,path.join(interrupted,'reports'));
  await fs.mkdir(reports);
  await fs.writeFile(path.join(reports,'new.txt'),'new');
  await recoverFolderImports(backups,reports,file);
  assert.deepEqual(await fs.readdir(reports),['current.txt']);
  assert.equal(await fs.readFile(file,'utf8'),raw);
});
