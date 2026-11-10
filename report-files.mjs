import fs from 'node:fs/promises';
import path from 'node:path';
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
export async function writeScheduledReport(folder,job,previous,now=new Date()) {
  if(!/^[-a-zA-Z0-9_]+$/.test(job.id)||!/^\d{4}-\d{2}-\d{2}$/.test(job.date)||!/^\d{2}:\d{2}$/.test(job.time))throw Error('보고서 식별자가 올바르지 않습니다.');
  const name=`${job.date}_${job.time.replace(':','-')}-${job.id}.txt`,file=path.join(folder,name);
  let text=job.text.replace(/^실제 생성 시각:.*$/m,`실제 생성 시각: ${now.toLocaleString('ko-KR')}`);
  try{await fs.writeFile(file,text,{flag:'wx'});}catch(e){if(e.code!=='EEXIST'||!(await fs.lstat(file)).isFile())throw e;text=await fs.readFile(file,'utf8');}
  if(!previous||previous.at<job.at){
    const latest=path.join(folder,`latest-${job.id}.txt`);
    const temp=latest+`.${crypto.randomUUID()}.tmp`;
    const handle=await fs.open(temp,'wx');
    try {
      try {await handle.writeFile(text);}
      finally {await handle.close();}
      await fs.rename(temp,latest);
    }
    finally {await fs.rm(temp,{force:true});}
  }
}
