import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';

const base=fileURLToPath(new URL('../',import.meta.url));
export const releaseFiles=[
  '.gitignore','.github/workflows/test.yml','README.md','package.json','Start-Kanban.bat','WindowsFolderPicker.cs',
  'server.mjs','engine.mjs','notification-migration.mjs','report-files.mjs','workspace-backup.mjs',
  'public/index.html','public/app.mjs','public/model.mjs','public/styles.css','public/icon.svg',
  'scripts/setup-appdash.mjs','scripts/release.mjs','test/model.test.mjs','test/report-files.test.mjs',
  'test/server.test.mjs','test/workspace-backup.test.mjs'
];
async function stage(destination){
  for(const file of releaseFiles){
    const source=path.join(base,file),target=path.join(destination,file);
    if(!(await fs.lstat(source)).isFile())throw Error(`배포 파일이 일반 파일이 아닙니다: ${file}`);
    await fs.mkdir(path.dirname(target),{recursive:true});
    await fs.copyFile(source,target);
  }
}
async function release(){
  const stageOnly=process.argv[2]==='--stage';
  if(stageOnly&&!process.argv[3])throw Error('새 공개용 폴더의 경로를 지정하세요.');
  const directory=stageOnly?path.resolve(process.argv[3]):await fs.mkdtemp(path.join(os.tmpdir(),'kanban-release-'));
  if(stageOnly){
    await fs.mkdir(directory);
    await stage(directory);
    console.log(directory);
    return;
  }
  try{
    await stage(directory);
    const git=(...args)=>execFileSync('git',['-C',directory,...args],{encoding:'utf8'});
    git('init','--quiet');
    git('add','--',...releaseFiles);
    const tree=git('write-tree').trim();
    const actual=git('ls-tree','-r','--name-only',tree).trim().split(/\r?\n/).sort();
    if(JSON.stringify(actual)!==JSON.stringify([...releaseFiles].sort()))throw Error('배포 파일 목록이 허용 목록과 일치하지 않습니다.');
    const {version}=JSON.parse(await fs.readFile(path.join(base,'package.json'),'utf8'));
    if(!/^\d+\.\d+\.\d+$/.test(version))throw Error('배포 버전 형식이 올바르지 않습니다.');
    const output=path.join(base,'dist',`kanban-planner-v${version}.zip`);
    await fs.mkdir(path.dirname(output),{recursive:true});
    git('archive','--format=zip',`--prefix=kanban-planner-v${version}/`,'-o',output,tree);
    console.log(output);
  }finally{await fs.rm(directory,{recursive:true,force:true});}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await release();
