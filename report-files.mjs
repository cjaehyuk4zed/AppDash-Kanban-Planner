import fs from 'node:fs/promises';
import path from 'node:path';
export const REPORT_CONTENT_MISMATCH='KANBAN_REPORT_MISMATCH';
export function resolveReportFolder(value,defaultFolder) {
  if(value===undefined||value==='')return defaultFolder;
  if(typeof value!=='string'||value.length>4096||value.includes('\0'))throw Error('내보내기 폴더 경로가 올바르지 않습니다.');
  const folder=value.trim();
  if(!folder)return defaultFolder;
  const absolute=process.platform==='win32'?/^[a-z]:[\\/]/i.test(folder):path.isAbsolute(folder);
  if(!absolute)throw Error('내보내기 폴더의 절대 경로를 입력하세요.');
  return path.normalize(folder);
}
export async function testReportFolder(folder) {
  const file=path.join(folder,`.kanban-write-test-${crypto.randomUUID()}.tmp`);
  try {
    const handle=await fs.open(file,'wx');
    try {await handle.writeFile('Kanban Planner export folder test\n');}
    finally {
      try {await handle.close();}
      finally {await fs.unlink(file);}
    }
  } catch {throw Error('폴더 테스트 실패. 위치와 파일 생성·삭제 권한을 확인하세요.');}
}
async function publishReport(file,text,publish){
  const temporary=`${file}.${crypto.randomUUID()}.tmp`;
  const handle=await fs.open(temporary,'wx');
  try{
    try{
      await handle.writeFile(text);
      await handle.sync();
    }finally{await handle.close();}
    await publish(temporary,file);
  }finally{
    await fs.rm(temporary,{force:true});
  }
}
async function publishHistory(temporary,file){
  try{await fs.link(temporary,file);}
  catch(error){
    if(!['ENOTSUP','EOPNOTSUPP','ENOSYS','EPERM','EXDEV'].includes(error.code))throw error;
    // The scheduler is the sole writer when the destination has no hard-link support.
    const existing=await fs.lstat(file).catch(failure=>{if(failure.code!=='ENOENT')throw failure;});
    if(existing)throw Object.assign(Error('예약 보고서가 이미 존재합니다.'),{code:'EEXIST'});
    await fs.rename(temporary,file);
  }
}
const generatedAtLine=/^실제 생성 시각: [^\r\n]+/m;
function reportMismatch(){
  return Object.assign(Error('기존 예약 보고서 내용이 일치하지 않습니다. 내보내기 폴더의 파일을 확인하세요.'),{code:REPORT_CONTENT_MISMATCH});
}
export async function writeScheduledReport(folder,job,previous,now=new Date()) {
  if(!/^[-a-zA-Z0-9_]+$/.test(job.id)||!/^\d{4}-\d{2}-\d{2}$/.test(job.date)||!/^\d{2}:\d{2}$/.test(job.time))throw Error('보고서 식별자가 올바르지 않습니다.');
  const name=`${job.date}_${job.time.replace(':','-')}-${job.id}.txt`,file=path.join(folder,name);
  let text=job.text.replace(generatedAtLine,`실제 생성 시각: ${now.toLocaleString('ko-KR')}`);
  try{await publishReport(file,text,publishHistory);}
  catch(error){
    if(error.code!=='EEXIST')throw error;
    if(!(await fs.lstat(file)).isFile())throw reportMismatch();
    const existing=await fs.readFile(file,'utf8');
    if(existing.replace(generatedAtLine,'실제 생성 시각:')!==text.replace(generatedAtLine,'실제 생성 시각:'))throw reportMismatch();
    text=existing;
  }
  if(!previous||previous.at<job.at){
    const latest=path.join(folder,`latest-${job.id}.txt`);
    await publishReport(latest,text,fs.rename);
  }
}
