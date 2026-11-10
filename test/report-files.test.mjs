import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {writeScheduledReport} from '../report-files.mjs';
const base=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
test('scheduled report files are immutable, newer latest wins, retries use original history and recover from write failure',async()=>{
 const folder=path.join(base,'reports','test-'+crypto.randomUUID());await fs.mkdir(folder,{recursive:true});
 const job={date:'2026-11-06',time:'08:00',id:'synthetic-planner',at:'2026-11-06T08:00:00.000Z',text:'Kanban 예약 내보내기\n실제 생성 시각: pending\noriginal'};
 try{
  await writeScheduledReport(folder,job);const name=path.join(folder,'2026-11-06_08-00-synthetic-planner.txt'),first=await fs.readFile(name,'utf8');assert.ok(first.includes('original'));assert.ok(!first.includes('pending'));
  await writeScheduledReport(folder,{...job,text:'should not overwrite'});assert.equal(await fs.readFile(name,'utf8'),first);
  const newer={...job,time:'09:00',at:'2026-11-06T09:00:00.000Z',text:'newer report'};await writeScheduledReport(folder,newer,{at:job.at});assert.equal(await fs.readFile(path.join(folder,'latest-synthetic-planner.txt'),'utf8'),'newer report');
  await writeScheduledReport(folder,job,{at:newer.at});assert.equal(await fs.readFile(path.join(folder,'latest-synthetic-planner.txt'),'utf8'),'newer report');
  const missing=path.join(folder,'missing');await assert.rejects(()=>writeScheduledReport(missing,job));await fs.mkdir(missing);await writeScheduledReport(missing,job);assert.ok((await fs.readFile(path.join(missing,'latest-synthetic-planner.txt'),'utf8')).includes('original'));
  await assert.rejects(()=>writeScheduledReport(folder,{...job,id:'../escape'}));
 }finally{assert.ok(path.resolve(folder).startsWith(base+path.sep));await fs.rm(folder,{recursive:true,force:true});}
});
