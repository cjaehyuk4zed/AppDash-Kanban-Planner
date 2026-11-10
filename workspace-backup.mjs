import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {clone,initProjects,uid} from './public/model.mjs';
import {runtime} from './engine.mjs';
import {migrateNotifications} from './notification-migration.mjs';

export const BACKUP_LIMIT=64*1024*1024;
export const STORE_SCHEMA=2;
const BACKUP_FORMAT='kanban-planner-backup';
const IMPORT_MARKER='pending-folder-import.json';
const object=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const id=value=>typeof value==='string'&&/^[-a-zA-Z0-9_]{1,80}$/.test(value);
const date=value=>typeof value==='string'&&!Number.isNaN(Date.parse(value));
const strings=value=>Array.isArray(value)&&value.every(item=>typeof item==='string');
const validSide=value=>object(value?.task)&&object(value.snapshot)&&id(value.task.id)&&id(value.task.bucket)&&
  value.snapshot.id===value.task.id&&strings(value.task.labels)&&strings(value.snapshot.labels)&&
  (value.snapshot.labelIds===undefined||strings(value.snapshot.labelIds))&&Array.isArray(value.task.checklist);

function validateRuntime(value){
  if(!object(value)||!date(value.startedAt)||!date(value.observedAt)||
    !Array.isArray(value.journal)||!value.journal.every(change=>object(change)&&id(change.planner)&&date(change.at)&&
      ['생성','수정','삭제'].includes(change.type)&&(change.before===null||validSide(change.before))&&
      (change.after===null||validSide(change.after))&&(change.before||change.after))||
    !object(value.delivery)||!object(value.reports)||!Array.isArray(value.pending)||!value.pending.every(job=>
      object(job)&&id(job.planner)&&id(job.id)&&typeof job.key==='string'&&
      /^\d{4}-\d{2}-\d{2}$/.test(job.date)&&/^\d{2}:\d{2}$/.test(job.time)&&date(job.at)&&typeof job.text==='string')){
    throw Error('저장 파일의 변경 기록 또는 예약 상태가 올바르지 않습니다.');
  }
}

const migrations=new Map([[1,value=>{
  for(const planner of value.state.planners)planner.notifications=migrateNotifications(planner.notifications);
  for(const job of value.runtime.pending){
    const row=value.state.planners.find(planner=>planner.id===job.planner)?.notifications.rows.find(row=>row.time===job.time);
    if(row)job.rowId=row.id;
  }
}]]);

export function decodeWorkspace(value,validateState,{allowBackup=false}={}){
  if(!object(value))throw Error('저장 파일 형식이 올바르지 않습니다.');
  if(allowBackup&&value.format===BACKUP_FORMAT){
    if(value.version!==1)throw Error('지원하지 않는 백업 버전입니다.');
  }else if(value.format!==undefined||!Number.isSafeInteger(value.revision)||value.revision<0){
    throw Error('저장 파일 형식이 올바르지 않습니다.');
  }
  if(!Number.isInteger(value.schema)||value.schema<1||value.schema>STORE_SCHEMA)throw Error('지원하지 않는 저장 버전입니다.');
  if(!Array.isArray(value.state?.planners))throw Error('저장 파일 형식이 올바르지 않습니다.');
  validateRuntime(value.runtime);
  for(const planner of value.state.planners) initProjects(planner);
  while(value.schema<STORE_SCHEMA){
    const migrate=migrations.get(value.schema);
    if(!migrate)throw Error('지원하지 않는 저장 버전입니다.');
    migrate(value);
    value.schema++;
    value.revision=(value.revision??0)+1;
  }
  validateState(value.state);
  return value;
}

export function createBackup(store,includeConnections){
  const {state,runtime:history}=clone(store);
  for(const planner of state.planners){
    if(!includeConnections)Object.assign(planner.notifications,{teamsUrl:'',outlookUrl:''});
  }
  return {format:BACKUP_FORMAT,version:1,schema:STORE_SCHEMA,state,runtime:{...history,pending:[]}};
}

export function backupSummary({state}){
  const active=state.planners.filter(planner=>!planner.deletedAt);
  return {planners:state.planners.length,activePlanners:active.length,tasks:state.planners.reduce((count,p)=>count+p.tasks.length,0),
    activeTasks:active.reduce((count,p)=>count+p.tasks.length,0)};
}

function copiedPlanner(planner,journal){
  const ids=new Map();
  const copyId=value=>{
    if(!value)return value;
    if(!ids.has(value))ids.set(value,uid());
    return ids.get(value);
  };
  const filterId=value=>['all','none'].includes(value)?value:copyId(value);
  const entities=items=>items.forEach(item=>{item.id=copyId(item.id);});
  const taskIds=task=>{
    task.id=copyId(task.id);task.bucket=copyId(task.bucket);task.projectId=copyId(task.projectId);
    if(task.completedByProject)task.completedByProject=copyId(task.completedByProject);
    task.labels=task.labels.map(copyId);
    entities(task.checklist);
  };
  const sourceId=planner.id;
  planner.id=copyId(sourceId);
  entities(planner.buckets);
  entities(planner.labels);
  entities(planner.projects);
  for(const project of planner.projects)project.labelId=copyId(project.labelId);
  planner.tasks.forEach(taskIds);
  planner.filters.project=filterId(planner.filters.project);
  planner.filters.bucket=filterId(planner.filters.bucket);
  planner.filters.labels=planner.filters.labels.map(copyId);
  planner.completion.bucket=copyId(planner.completion.bucket);
  planner.completion.label=copyId(planner.completion.label);
  entities(planner.notifications.forms);
  for(const form of planner.notifications.forms)entities(form.sections);
  entities(planner.notifications.rows);
  for(const row of planner.notifications.rows)row.formId=copyId(row.formId);
  for(const change of journal){
    change.planner=planner.id;
    for(const side of [change.before,change.after]){
      if(!side)continue;
      taskIds(side.task);
      const snapshot=side.snapshot;
      snapshot.id=copyId(snapshot.id);
      if(snapshot.projectId)snapshot.projectId=copyId(snapshot.projectId);
      if(snapshot.projectLabelId)snapshot.projectLabelId=copyId(snapshot.projectLabelId);
      if(snapshot.labelIds)snapshot.labelIds=snapshot.labelIds.map(copyId);
    }
  }
}

export function prepareImport(current,source,mode){
  const incoming=clone(source);
  for(const planner of incoming.state.planners){
    Object.assign(planner.notifications,{teams:false,outlook:false,export:false,exportFolder:''});
  }
  const now=new Date().toISOString();
  if(mode==='replace'){
    const history={...runtime(now),...incoming.runtime,observedAt:now,pending:[]};
    return {schema:STORE_SCHEMA,revision:current.revision+1,state:incoming.state,runtime:history};
  }
  if(mode!=='append')throw Error('가져오기 방식을 선택하세요.');
  const next=clone(current);
  const changes=new Map();
  for(const entry of incoming.runtime.journal){
    if(!changes.has(entry.planner))changes.set(entry.planner,[]);
    changes.get(entry.planner).push(entry);
  }
  for(const planner of incoming.state.planners.filter(planner=>!planner.deletedAt)){
    const entries=changes.get(planner.id)??[];
    copiedPlanner(planner,entries);
    next.state.planners.push(planner);
    for(const entry of entries)next.runtime.journal.push(entry);
  }
  next.revision++;
  next.runtime.observedAt=now;
  return next;
}

export async function atomicWrite(file,text){
  const temporary=path.join(path.dirname(file),`.${path.basename(file)}.${uid()}.tmp`);
  try{
    await fs.writeFile(temporary,text,{flag:'wx',mode:0o600});
    await fs.rename(temporary,file);
  }catch(error){
    await fs.rm(temporary,{force:true}).catch(()=>{});
    throw error;
  }
}

const info=file=>fs.lstat(file).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
const entries=async dir=>{
  const stat=await info(dir);
  if(!stat)return [];
  if(!stat.isDirectory())throw Error('보고서 또는 백업 폴더 형식이 올바르지 않습니다.');
  return fs.readdir(dir,{withFileTypes:true});
};
async function listFiles(dir,relative=''){
  const files=[];
  for(const entry of await entries(path.join(dir,relative))){
    const name=path.join(relative,entry.name);
    if(entry.isDirectory()){
      for(const item of await listFiles(dir,name))files.push(item);
    }else if(entry.isFile()){
      files.push(name);
    }else throw Error('보고서 또는 백업 폴더에 지원하지 않는 링크나 파일이 있습니다.');
  }
  return files;
}
const within=(parent,child)=>{
  const relative=path.relative(parent,child);
  return !relative||(!path.isAbsolute(relative)&&relative!=='..'&&!relative.startsWith('..'+path.sep));
};
export async function readFolderSource(folder,base,validateState){
  if(typeof folder!=='string'||folder.length>4096||!path.isAbsolute(folder.trim())||folder.includes('\0')){
    throw Error('이전 앱 폴더의 절대 경로를 입력하세요.');
  }
  const source=await fs.realpath(folder.trim());
  const current=await fs.realpath(base);
  if(within(source,current)||within(current,source))throw Error('현재 앱과 분리된 이전 앱 폴더를 선택하세요.');
  const data=path.join(source,'data');
  const file=path.join(data,'store.json');
  if(!(await info(data))?.isDirectory()||!(await info(file))?.isFile())throw Error('이전 앱 폴더에서 data/store.json을 찾을 수 없습니다.');
  const raw=await fs.readFile(file,'utf8');
  let parsed;
  try{parsed=JSON.parse(raw);}catch{throw Error('이전 앱의 저장 파일을 읽을 수 없습니다.');}
  const decoded=decodeWorkspace(parsed,validateState);
  const reports=await listFiles(path.join(source,'reports'));
  const backups=await listFiles(path.join(source,'backups'));
  const legacy=(await entries(data)).filter(entry=>entry.isFile()&&/^store\.before-.*\.json$/.test(entry.name)).map(entry=>entry.name);
  if(backups.some(name=>/^before-folder-import-/.test(name)&&name.split(path.sep).length===2&&path.basename(name)===IMPORT_MARKER)){
    throw Error('이전 앱에 중단된 폴더 가져오기가 있습니다. 이전 앱을 한 번 실행해 복구한 뒤 다시 종료하세요.');
  }
  const fingerprint=createHash('sha256').update(raw).update(JSON.stringify([reports.sort(),backups.sort(),legacy.sort()])).digest('hex');
  return {source,decoded,reports,backups,legacy,fingerprint};
}

async function copyFiles(source,destination,files){
  await fs.mkdir(destination,{recursive:true});
  for(const name of files){
    const from=path.join(source,name),to=path.join(destination,name);
    if(!(await info(from))?.isFile())throw Error('복사할 파일이 바뀌었습니다. 이전 앱을 종료하고 다시 시도하세요.');
    await fs.mkdir(path.dirname(to),{recursive:true});
    await fs.copyFile(from,to,constants.COPYFILE_EXCL);
  }
}

export async function archiveStore(backups,raw){
  const file=path.join(backups,`store.before-import-${uid()}.json`);
  await atomicWrite(file,raw);
}

async function settleFolderImport(entry,reports,committed){
  const previous=path.join(entry,'reports');
  const staged=path.join(entry,'incoming-reports');
  if(!committed&&await info(previous)){
    if(await info(reports))await fs.rename(reports,staged);
    await fs.rename(previous,reports);
  }
  await fs.unlink(path.join(entry,IMPORT_MARKER));
}

export async function recoverFolderImports(backups,reports,storeFile){
  for(const item of await entries(backups)){
    if(!item.isDirectory()||!item.name.startsWith('before-folder-import-'))continue;
    const entry=path.join(backups,item.name);
    const marker=path.join(entry,IMPORT_MARKER);
    if(!await info(marker))continue;
    const {revision}=JSON.parse(await fs.readFile(marker,'utf8'));
    const saved=JSON.parse(await fs.readFile(storeFile,'utf8'));
    if(!Number.isSafeInteger(revision)||!Number.isSafeInteger(saved.revision)||saved.revision<revision-1)throw Error('이전 폴더 가져오기 작업을 확인할 수 없습니다. 백업을 보존하고 종료합니다.');
    await settleFolderImport(entry,reports,saved.revision>=revision);
  }
}

export async function installFolderImport(source,{backups,reports,raw,next,persist}){
  const entry=path.join(backups,`before-folder-import-${uid()}`);
  await fs.mkdir(entry);
  const staged=path.join(entry,'incoming-reports');
  const marker=path.join(entry,IMPORT_MARKER);
  await atomicWrite(path.join(entry,'store.json'),raw);
  await copyFiles(path.join(source.source,'reports'),staged,source.reports);
  const imported=path.join(entry,'imported-backups');
  if(source.backups.length)await copyFiles(path.join(source.source,'backups'),path.join(imported,'backups'),source.backups);
  if(source.legacy.length)await copyFiles(path.join(source.source,'data'),path.join(imported,'legacy'),source.legacy);
  if(!(await info(reports))?.isDirectory())throw Error('현재 보고서 폴더를 확인할 수 없습니다.');
  await atomicWrite(marker,JSON.stringify({revision:next.revision}));
  try{
    await fs.rename(reports,path.join(entry,'reports'));
    await fs.rename(staged,reports);
    await persist(next);
  }catch(error){
    await settleFolderImport(entry,reports,false);
    throw error;
  }
  await settleFolderImport(entry,reports,true).catch(()=>{});
}
