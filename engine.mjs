import { day, buildReport, notificationMessage, plannerAt, validateConnectionUrl, validateNotifications } from './public/model.mjs';
export function runtime(now=new Date().toISOString()) {return {startedAt:now,observedAt:now,journal:[],delivery:{},pending:[],reports:{}};}
export const scheduleKey=(p,date,time,channel)=>`${p.id}/${date}/${time}/${channel}`;
const channelName=channel=>channel==='teams'?'Teams':'Outlook';
export async function deliver(p,n,rowId,channel,fetcher=fetch) {
  const url=n[channel+'Url'];if(!url)throw Error(`${channelName(channel)} 연결 주소를 입력하세요.`);
  const {text,subject}=notificationMessage(p,n,rowId,channel);
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
export async function tick(store,{now=new Date(),writeReport,send=deliver,checkpoint=async()=>{}}) {
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
      } else {
        try{await send(p,n,row.id,channel);m.delivery[key]={success:true,at:now.toISOString()};}
        catch(e){m.delivery[key]={success:false,at:now.toISOString(),error:e.message};}
        await checkpoint();
      }
    }
  }
  for(const job of [...m.pending]) {
    const p=store.state.planners.find(p=>p.id===job.planner&&!p.deletedAt);if(!p){m.pending=m.pending.filter(j=>j.key!==job.key);continue;}
    if(p.notifications.rows.some(row=>row.reviewRequired&&(job.rowId?row.id===job.rowId:row.time===job.time)))continue;
    try {
      await writeReport(job,m.reports[job.planner],p);
      const prev=m.reports[job.planner];if(!prev||prev.at<job.at)m.reports[job.planner]={at:job.at,coveredUntil:job.at};
      m.delivery[job.key]={success:true,at:now.toISOString()};m.pending=m.pending.filter(j=>j.key!==job.key);
    } catch {m.delivery[job.key]={success:false,at:now.toISOString(),error:'보고서 저장 실패: 내보내기 폴더의 위치, 권한과 여유 공간을 확인하세요.'};}
    await checkpoint();
  }
}
