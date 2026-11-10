import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const base=path.dirname(fileURLToPath(new URL('../server.mjs',import.meta.url)));
const file=path.join(base,'appdash-gateway-config.json');
const config={
  name:'Kanban Planner (Beta)',
  description:'한국어 Kanban Planner · 보드, 일정, 타임라인, 통계, 알림과 예약 보고서',
  type:'service',
  group:'Productivity',
  gateway:{
    adapter:'process',workingDirectory:base,start:{executable:'node',args:['server.mjs']},
    stop:{executable:'',args:[]},healthUrl:'http://127.0.0.1:4197/api/ready',openUrl:'http://127.0.0.1:4197/',
    timeoutSeconds:300,readinessSeconds:20
  }
};
try{await fs.writeFile(file,JSON.stringify(config,null,2)+'\n',{flag:'wx'});}
catch(error){
  if(error.code!=='EEXIST')throw error;
  const existing=JSON.parse(await fs.readFile(file,'utf8'));
  if(existing.gateway?.workingDirectory!==base)throw Error('기존 AppDash 설정의 작업 폴더가 다릅니다. 기존 파일을 옮긴 뒤 다시 생성하세요.');
}
console.log(file);
