import { day, buildReport, notificationMessage, plannerAt, validateConnectionUrl, validateNotifications } from './public/model.mjs';
import {REPORT_CONTENT_MISMATCH} from './report-files.mjs';
export function runtime(now=new Date().toISOString()) {return {startedAt:now,observedAt:now,journal:[],delivery:{},pending:[],reports:{}};}
export const scheduleKey=(p,date,time,channel)=>`${p.id}/${date}/${time}/${channel}`;
function reportJobStatus(planner,job){
  if(!planner||planner.deletedAt)return 'cancelled';
  const row=planner.notifications.rows.find(item=>job.rowId===undefined?item.time===job.time:item.id===job.rowId);
  if(!row)return 'cancelled';
  return planner.notifications.export&&row.export&&!row.reviewRequired?'retry':'paused';
}
export function pendingReports(store){
  const planners=new Map(store.state.planners.map(planner=>[planner.id,planner]));
  const counts=Object.create(null);
  for(const job of store.runtime.pending){
    const status=reportJobStatus(planners.get(job.planner),job);
    if(status==='cancelled')continue;
    const count=counts[job.planner]??={retry:0,paused:0};
    count[status]++;
  }
  return counts;
}
const channelName=channel=>channel==='teams'?'Teams':'Outlook';
export async function deliver(p,n,rowId,channel,fetcher=fetch,today=day()) {
  const url=n[channel+'Url'];if(!url)throw Error(`${channelName(channel)} 연결 주소를 입력하세요.`);
  const {text,subject}=notificationMessage(p,n,rowId,channel,today);
  return postNotification(channel,url,text,subject,fetcher);
}
export async function testConnection(channel,url,fetcher=fetch) {
  const name=channelName(channel);
  if(typeof url!=='string'||!url.trim())throw Error(`${name} 연결 주소를 입력하세요.`);
  validateConnectionUrl(url);
  await postNotification(channel,url,`Kanban Planner의 ${name} 연결 테스트 메시지입니다.`,'Kanban Planner · 연결 테스트',fetcher);
  return `${name} 연결 테스트 성공. 워크플로가 요청을 수신했습니다.`;
}
async function postNotification(channel,url,text,subject,fetcher) {
  const escape=s=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
  const html='<div style="white-space:pre-wrap;font-family:sans-serif">'+escape(text).replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>')+'</div>';
  const payload=channel==='teams'?{type:'message',attachments:[{contentType:'application/vnd.microsoft.card.adaptive',contentUrl:null,content:{$schema:'http://adaptivecards.io/schemas/adaptive-card.json',type:'AdaptiveCard',version:'1.4',body:[{type:'TextBlock',text,wrap:true}]}}]}:{subject,body:html,isHtml:true,text};
  try {const res=await fetcher(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),redirect:'error',signal:AbortSignal.timeout(15000)});if(!res.ok)throw Error('remote');await res.body?.cancel();}
  catch {throw Error(`${channelName(channel)} 전송 실패. 연결 주소·네트워크·워크플로를 확인하세요.`);}
}
export function createNotificationQueue({readStore,exclusive,checkpoint,send,clock=()=>new Date(),concurrency=2}){
  const jobs=new Map();
  const running=new Set();
  let stopped=false;
  async function run(job){
    const eligible=await exclusive(()=>{
      const store=readStore();
      const planner=store.state.planners.find(p=>p.id===job.planner.id&&!p.deletedAt);
      const notifications=planner?.notifications;
      const row=notifications?.rows.find(item=>item.id===job.row.id);
      return !job.cancelled&&!store.runtime.delivery[job.key]?.success&&notifications?.[job.channel]&&
        row?.[job.channel]&&!row.reviewRequired&&row.time===job.row.time&&
        notifications[job.channel+'Url']===job.planner.notifications[job.channel+'Url']&&
        (!store.runtime.delivery[job.key]||clock()<job.deadline);
    });
    if(!eligible||job.cancelled)return;
    let result;
    try{
      await send(job.planner,job.row.id,job.channel,job.today);
      result={success:true};
    }catch(error){result={success:false,error:error.message};}
    await exclusive(async()=>{
      if(job.cancelled)return;
      const store=readStore();
      if(!store.state.planners.some(p=>p.id===job.planner.id))return;
      store.runtime.delivery[job.key]={...result,at:clock().toISOString()};
      await checkpoint(store);
    });
  }
  function drain(){
    for(const job of jobs.values()){
      if(stopped||running.size>=concurrency)break;
      if(job.promise||job.cancelled)continue;
      const promise=run(job).catch(()=>console.error('예약 알림 상태 저장 실패.')).finally(()=>{
        if(jobs.get(job.key)===job)jobs.delete(job.key);
        running.delete(promise);
        drain();
      });
      job.promise=promise;
      running.add(promise);
    }
  }
  function cancel(plannerId){
    for(const job of jobs.values()){
      if(plannerId!==undefined&&job.planner.id!==plannerId)continue;
      job.cancelled=true;
      jobs.delete(job.key);
    }
  }
  return {
    enqueue(planner,row,channel,key,now){
      if(stopped||jobs.has(key))return;
      const deadline=new Date(now);
      deadline.setSeconds(0,0);
      deadline.setMinutes(deadline.getMinutes()+1);
      jobs.set(key,{key,planner:structuredClone(planner),row,channel,today:day(now),deadline});
      drain();
    },
    cancel,
    async close(){
      stopped=true;
      for(const job of jobs.values())if(!job.promise)jobs.delete(job.key);
      await Promise.all(running);
    }
  };
}
export async function tick(store,{now=new Date(),writeReport,send=deliver,enqueueNotification,checkpoint=async()=>{}}) {
  const date=day(now),time=`${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
  const m=store.runtime;
  // Only exports which were actually observed at their scheduled minute enter the retry queue.
  if(now.getDay()>0&&now.getDay()<6)for(const p of store.state.planners.filter(x=>!x.deletedAt)) {
    const n=p.notifications;try{validateNotifications(n);}catch{continue;}
    for(const row of n.rows.filter(r=>r.time===time&&!r.reviewRequired))for(const channel of ['teams','outlook','export']) {
      if(!n[channel]||!row[channel])continue;
      const key=scheduleKey(p,date,time,channel);if(m.delivery[key]?.success)continue;
      if(channel==='export') {
        if(!m.pending.some(j=>j.key===key)){
          const scheduled=new Date(now);scheduled.setSeconds(0,0);
          const at=scheduled.toISOString(),snapshot=plannerAt(p,m.journal,at);
          m.pending.push({key,planner:p.id,rowId:row.id,date,time,at,text:buildReport(snapshot,n,row.id,at,m.journal,{...m,...m.reports[p.id]}),id:p.id});
          await checkpoint();
        }
      }else if(enqueueNotification){
        enqueueNotification(p,row,channel,key,now);
      }else{
        try{await send(p,n,row.id,channel);m.delivery[key]={success:true,at:now.toISOString()};}
        catch(e){m.delivery[key]={success:false,at:now.toISOString(),error:e.message};}
        await checkpoint();
      }
    }
  }
  for(const job of [...m.pending]) {
    const p=store.state.planners.find(p=>p.id===job.planner);
    const status=reportJobStatus(p,job);
    if(status==='cancelled'){
      m.pending=m.pending.filter(item=>item.key!==job.key);
      await checkpoint();
      continue;
    }
    if(status==='paused')continue;
    try {
      await writeReport(job,m.reports[job.planner],p);
      const prev=m.reports[job.planner];if(!prev||prev.at<job.at)m.reports[job.planner]={at:job.at,coveredUntil:job.at};
      m.delivery[job.key]={success:true,at:now.toISOString()};m.pending=m.pending.filter(j=>j.key!==job.key);
    }catch(error){
      const message=error.code===REPORT_CONTENT_MISMATCH?error.message:'보고서 저장 실패: 내보내기 폴더의 위치, 권한과 여유 공간을 확인하세요.';
      m.delivery[job.key]={success:false,at:now.toISOString(),error:message};
    }
    await checkpoint();
  }
}
