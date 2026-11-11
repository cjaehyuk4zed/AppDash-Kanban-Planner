import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as m from '../public/model.mjs';
test('project labels are inherited in one direction and keep manual labels separate',()=>{
 const p=m.newPlanner(),[a,b]=p.labels.map(l=>l.id);
 const first={...m.newProject(),name:'First'},second={...m.newProject(),name:'Second',labelId:b};p.projects.push(first,second);
 const member=m.saveTask(p,{...m.newTask(p,undefined,first.id),title:'Member'});
 const manual=m.saveTask(p,{...m.newTask(p),title:'Manual',labels:[a]});
 assert.deepEqual(m.taskLabels(p,member),[]);
 first.labelId=a;
 assert.deepEqual(m.taskLabels(p,member),[a]);
 assert.deepEqual(member.labels,[]);
 assert.equal(manual.projectId,null);
 p.filters.labels=[a];assert.deepEqual(m.filtered(p).map(t=>t.id),[member.id,manual.id]);
 member.labels.push(a);assert.deepEqual(m.taskLabels(p,member),[a]);
 const moved=m.saveTask(p,{...member,projectId:second.id});
 assert.deepEqual(m.taskLabels(p,moved),[a,b]);
 second.labelId=null;assert.deepEqual(m.taskLabels(p,moved),[a]);
 second.labelId=b;m.removeLabel(p,b);
 assert.equal(second.labelId,null);
 assert.equal(moved.projectId,second.id);
 assert.deepEqual(m.taskLabels(p,moved),[a]);
});

test('inherited labels remain in Task history and scheduled snapshots',()=>{
 const p=m.newPlanner(),[a,b]=p.labels;
 a.name='Inherited A';b.name='Inherited B';
 const project={...m.newProject(),name:'Website',labelId:a.id};p.projects.push(project);
 const task=m.saveTask(p,{...m.newTask(p,undefined,project.id),title:'Member'});
 const before=m.clone(p),cutoff=new Date('2026-11-07T08:00:00').toISOString(),changed=new Date('2026-11-07T09:00:00').toISOString();
 project.labelId=b.id;
 const journal=m.changesBetween({planners:[before]},{planners:[p]},changed);
 assert.equal(journal.length,1);
 assert.deepEqual(journal[0].before.snapshot.labels,['Inherited A']);
 assert.deepEqual(journal[0].after.snapshot.labels,['Inherited B']);
 assert.deepEqual(m.taskLabels(m.plannerAt(p,journal,cutoff),task),[a.id]);
});
test('project membership filters Tasks without changing their workflow or checklist completion',()=>{
 const p=m.newPlanner(),a={...m.newProject(),name:'Website'},b={...m.newProject(),name:'Office'};p.projects.push(a,b);
 const first=m.saveTask(p,{...m.newTask(p,undefined,a.id),title:'Design',due:'2026-11-01',checklist:[{id:m.uid(),text:'Sketch',done:true}]});
 const other=m.saveTask(p,{...m.newTask(p,undefined,b.id),title:'Order desk'});
 const loose=m.saveTask(p,{...m.newTask(p),title:'Inbox'});
 p.filters.project=a.id;
 assert.deepEqual(m.filtered(p).map(t=>t.id),[first.id]);
 assert.equal(m.newTask(p).projectId,a.id);
 assert.equal(m.newTask(p,undefined,'none').projectId,null);
 m.moveTask(p,first.id,p.buckets[1].id);
 assert.equal(first.projectId,a.id);
 assert.deepEqual(m.projectStats([first],'2026-11-07'),{total:1,done:0,overdue:1,nextDue:''});
 m.toggleTask(p,first.id);
 assert.equal(a.closed,false);
 assert.equal(m.projectStats([p.tasks.find(t=>t.id===first.id)]).done,1);
 a.closed=true;
 assert.equal(m.filtered(p).length,1);
 p.filters.project='none';
 assert.deepEqual(m.filtered(p).map(t=>t.id),[loose.id]);
 m.removeProject(p,a.id);
 assert.equal(p.tasks.find(t=>t.id===first.id).projectId,null);
 assert.equal(p.tasks.find(t=>t.id===other.id).projectId,b.id);
 assert.equal(p.tasks.length,3);
});
test('goal due dates are inherited in Task queries, messages, reports, and historical snapshots',()=>{
 const {p,make}=fixture(),goal={...m.newProject(),name:'Release'};
 p.projects.push(goal);
 const inherited=make('Inherited',{projectId:goal.id}),explicit=make('Explicit',{projectId:goal.id,due:m.addDays(D,2)});
 const before=m.clone(p),changedAt=new Date(`${D}T09:00:00`).toISOString();
 goal.due=D;
 assert.equal(inherited.due,'');
 assert.equal(m.taskDue(p,inherited),D);
 assert.equal(m.taskDue(p,explicit),m.addDays(D,2));
 p.filters.due='today';
 assert.deepEqual(m.filtered(p,D).map(task=>task.id),[inherited.id]);
 assert.deepEqual(m.sortTasks(p,[explicit,inherited],'dueAsc').map(task=>task.id),[inherited.id,explicit.id]);
 const n=p.notifications;
 n.forms[0].sections=[m.newSection('all','today')];
 assert.match(m.notificationMessage(p,n,n.rows[0].id,'outlook',D).text,/Inherited/);
 const journal=m.changesBetween({planners:[before]},{planners:[p]},changedAt);
 assert.equal(journal.length,1);
 assert.equal(journal[0].before.snapshot.due,'');
 assert.equal(journal[0].after.snapshot.due,D);
 const cutoff=new Date(`${D}T08:00:00`).toISOString(),historical=m.plannerAt(p,journal,cutoff);
 assert.equal(m.taskDue(historical,historical.tasks.find(task=>task.id===inherited.id)),'');
 assert.doesNotMatch(m.buildReport(historical,n,n.rows[0].id,cutoff,journal),/Inherited/);
 assert.match(m.buildReport(p,n,n.rows[0].id,changedAt,journal),/Inherited/);
 const edited=m.saveTask(p,{...inherited,due:m.addDays(D,1)});
 assert.equal(m.taskDue(p,edited),m.addDays(D,1));
 assert.equal(m.taskDue(p,m.saveTask(p,{...edited,due:''})),D);
});
test('reopening a goal restores only Tasks it completed without running Task completion actions',()=>{
 const {p,make}=fixture(),goal=m.newProject();
 p.projects.push(goal);
 const originalDate=m.addDays(D,-1);
 const manual=make('Already complete',{projectId:goal.id,completed:originalDate});
 const inherited=make('Auto complete',{projectId:goal.id});
 const moved=make('Moved later',{projectId:goal.id});
 const outside=make('Outside');
 p.completion.action='delete';
 m.toggleProjectCompletion(p,goal.id,D);
 assert.equal(goal.completed,D);
 assert.equal(inherited.completed,D);
 assert.equal(inherited.completedByProject,goal.id);
 assert.equal(manual.completed,originalDate);
 assert.equal(outside.completed,'');
 assert.equal(p.tasks.length,4);
 const renamed=m.saveTask(p,{...inherited,title:'Edited'});
 assert.equal(renamed.completedByProject,goal.id);
 const detached=m.saveTask(p,{...moved,projectId:null});
 assert.equal(detached.completed,'');
 m.toggleProjectCompletion(p,goal.id,m.addDays(D,1));
 assert.equal(goal.completed,'');
 assert.equal(renamed.completed,'');
 assert.equal(renamed.completedByProject,undefined);
 assert.equal(manual.completed,originalDate);
});

test('notification forms are independent of board filters and reports retain historical goals',()=>{
 const p=m.newPlanner(),a={...m.newProject(),name:'Website'},b={...m.newProject(),name:'Office'};p.projects.push(a,b);
 const task=m.saveTask(p,{...m.newTask(p,undefined,a.id),title:'Design'});
 p.filters.project=b.id;
 const n=p.notifications,row=n.rows[0];
 n.forms[0].sections=[m.newSection()];
 row.format='detail';
 assert.match(m.notificationMessage(p,n,row.id,'outlook').text,/목표: Website/);
 const before=m.clone(p);
 a.name='Renamed website';task.projectId=b.id;
 const cutoff=new Date('2026-11-07T12:00:00').toISOString(),changed=new Date('2026-11-07T13:00:00').toISOString();
 const changes=m.changesBetween({planners:[before]},{planners:[p]},changed);
 assert.equal(changes[0].before.snapshot.project,'Website');
 assert.equal(changes[0].after.snapshot.project,'Office');
 assert.match(m.buildReport(m.plannerAt(p,changes,cutoff),n,row.id,cutoff,changes),/목표: Website/);
 assert.match(m.buildReport(p,n,row.id,changed,changes),/목표: Office/);
 m.removeProject(p,a.id);
});
import {runtime,tick,deliver,testConnection,pendingReports,createNotificationQueue} from '../engine.mjs';
import {migrateNotifications} from '../notification-migration.mjs';
const D='2026-11-06',stamp='2026-11-06T08:00:00.000Z';
function fixture(){const p=m.newPlanner();const make=(title,extra={})=>{const t={...m.newTask(p,p.buckets[0].id),title,...extra};m.saveTask(p,t);return p.tasks.find(x=>x.id===t.id);};return {p,make};}
test('first Planner examples, empty new Planner and independent catalog/settings',()=>{
 const a=m.newPlanner(undefined,undefined,true),b=m.newPlanner();assert.equal(a.tasks.length,3);assert.equal(b.tasks.length,0);assert.equal(a.tasks[2].completed,m.day());assert.deepEqual(a.labels.map(l=>l.color),['#6c80c4','#2f8f83','#c75c42','#d29c2f','#a05a9f','#538f9c','#b34d67','#5f7548']);a.appearance.colors[0]='#000000';assert.notEqual(a.appearance.colors[0],b.appearance.colors[0]);assert.equal(a.notifications.teams,false);assert.equal(a.notifications.rows[0].time,'08:00');assert.notEqual(a.buckets[0].id,b.buckets[0].id);
});
test('date parsing accepts compact and separator variants, leap dates; rejects impossible dates',()=>{
 for(const s of ['20261106','2026-11-6','2026/11/6','2026.11.6'])assert.equal(m.parseDate(s),D);assert.equal(m.parseDate('20240229'),'2024-02-29');assert.equal(m.parseDate(''),'');for(const s of ['2026-2-29','2026-13-01','26-1-2','20261131','x'])assert.throws(()=>m.parseDate(s));
});
test('Task title, checklist trimming, copy isolation, completion and checklist independence',()=>{
 const {p,make}=fixture(),t=make(' Task ',{checklist:[{id:m.uid(),text:' item ',done:true},{id:m.uid(),text:' ',done:false}]});assert.equal(t.title,'Task');assert.equal(t.checklist.length,1);assert.equal(t.completed,'');const input=m.clone(t);input.title='';m.saveTask(p,input);assert.equal(p.tasks[0].title,'Task');assert.equal(m.saveTask(p,{...m.newTask(p),title:' '}),null);
 const done={...m.clone(t),completed:D};m.saveTask(p,done);const copy=m.saveTask(p,done,{copy:true});assert.equal(copy.title,'Task 복사');assert.equal(copy.completed,D);assert.equal(copy.checklist[0].done,true);copy.checklist[0].text='other';assert.equal(p.tasks.find(x=>x.id===t.id).checklist[0].text,'item');
});
for(const action of ['none','move','label','delete'])test(`completion action ${action}, no repeated action on edit, no reversal on incomplete`,()=>{
 const {p,make}=fixture(),t=make('Task',{labels:[p.labels[0].id]});p.completion={action,bucket:p.buckets[2].id,label:p.labels[3].id};m.toggleTask(p,t.id);
 const result=p.tasks.find(x=>x.id===t.id);if(action==='delete'){assert.equal(result,undefined);return;}assert.equal(result.completed,m.day());if(action==='move')assert.equal(result.bucket,p.buckets[2].id);if(action==='label')assert.deepEqual(result.labels,[p.labels[3].id]);p.completion.action='delete';m.saveTask(p,result);assert.equal(p.tasks.length,1);m.toggleTask(p,t.id);assert.equal(p.tasks[0].completed,'');if(action==='move')assert.equal(p.tasks[0].bucket,p.buckets[2].id);
});
test('copy completed draft bypasses completion deletion and uses current draft',()=>{const {p,make}=fixture(),t=make('Original');p.completion.action='delete';const c=m.saveTask(p,{...t,title:'Draft',completed:D},{copy:true});assert.equal(c.title,'Draft 복사');assert.equal(c.completed,D);assert.equal(p.tasks.length,2);});
test('filters AND fields / OR labels, completion inclusive ranges and due boundaries',()=>{
 const {p,make}=fixture();const a=make('a',{due:D,labels:[p.labels[0].id]}),b=make('b',{due:m.addDays(D,7),labels:[p.labels[1].id]}),c=make('c',{due:m.addDays(D,8)}),d=make('d',{due:m.addDays(D,-1)});make('none');p.filters.due='week';assert.deepEqual(m.filtered(p,D).map(t=>t.id),[a.id,b.id]);p.filters.labels=[p.labels[0].id,p.labels[1].id];assert.equal(m.filtered(p,D).length,2);p.filters.priority='상';assert.equal(m.filtered(p,D).length,0);p.filters.priority='all';p.filters.labels=[];p.filters.due='overdue';assert.deepEqual(m.filtered(p,D).map(t=>t.id),[d.id]);d.completed=D;assert.equal(m.filtered(p,D).length,0);p.filters.due='all';p.filters.from=D;p.filters.to=D;assert.deepEqual(m.filtered(p,D).map(t=>t.id),[d.id]);p.filters.from=m.addDays(D,1);assert.equal(m.filtered(p,D).length,0);assert.ok(c);
});
test('all eleven sorts, missing dates last in either direction and deterministic tie breaks',()=>{
 const {p,make}=fixture();make('z',{priority:'하',due:'',completed:''});make('a',{priority:'상',due:D});make('b',{priority:'중',due:D});for(const [mode]of m.sorts)assert.equal(m.sortTasks(p,p.tasks,mode).length,3);for(const mode of ['dueAsc','dueDesc'])assert.equal(m.sortTasks(p,p.tasks,mode).at(-1).title,'z');assert.deepEqual(m.sortTasks(p,p.tasks,'dueAsc').map(t=>t.title),['a','b','z']);assert.equal(m.sortTasks(p,p.tasks,'priorityLow')[0].title,'z');
});
test('same bucket reorder preserves hidden tasks; cross-bucket append preserves target sort',()=>{
 const {p,make}=fixture(),a=make('a'),b=make('b'),c=make('hidden');p.sort='dueAsc';m.moveTask(p,b.id,a.bucket,a.id);assert.equal(p.buckets[0].sort,'manual');assert.deepEqual(m.sortTasks(p,p.tasks,'manual').map(t=>t.title),['b','a','hidden']);const dest=p.buckets[1];dest.sort='priorityHigh';m.moveTask(p,a.id,dest.id,b.id);assert.equal(dest.sort,'priorityHigh');assert.equal(a.bucket,dest.id);assert.ok(p.tasks.includes(c));
});
test('bucket deletion moves tasks, fixes references, protects last bucket; label deletion fixes references',()=>{
 const {p,make}=fixture(),id=p.buckets[0].id,t=make('a',{labels:[p.labels[0].id]});p.filters.bucket=id;p.completion.bucket=id;m.removeBucket(p,id);assert.equal(t.bucket,p.buckets[0].id);assert.equal(p.filters.bucket,'all');assert.equal(p.completion.bucket,p.buckets[0].id);const label=p.labels[0].id;p.filters.labels=[label];p.completion={action:'label',label};m.removeLabel(p,label);assert.deepEqual(t.labels,[]);assert.deepEqual(p.filters.labels,[]);assert.equal(p.completion.label,p.labels[0].id);while(p.labels.length)m.removeLabel(p,p.labels[0].id);assert.equal(p.completion.action,'none');while(p.buckets.length>1)m.removeBucket(p,p.buckets[0].id);assert.throws(()=>m.removeBucket(p,p.buckets[0].id));
});
for(const [condition,offsets]of [['before',[-6,-1]],['today',[0]],['tomorrow',[1]],['next',[2,7]],['week',[0,1,2,7]],['yesterday',[-1,0]],['recent',[-6,-1,0]],['all',[-6,-1,0,1,2,7,8]]])test(`section ${condition} due date boundaries`,()=>{
 const section=m.newSection('all',condition);
 for(const offset of [-6,-1,0,1,2,7,8])assert.equal(m.sectionMatches({due:m.addDays(D,offset)},section,D),offsets.includes(offset));
 assert.equal(m.sectionMatches({due:''},section,D),condition==='all');
});
test('completed status and due date are evaluated independently',()=>{
 const section=m.newSection('complete','range',D);
 assert.equal(m.sectionMatches({due:D,completed:m.addDays(D,-1)},section,D),true);
 assert.equal(m.sectionMatches({due:m.addDays(D,-1),completed:D},section,D),false);
 assert.equal(m.sectionMatches({due:D,completed:''},section,D),false);
 assert.equal(m.sectionMatches({due:'',completed:D},m.newSection('complete','none'),D),true);
});
test('notification validation rejects duplicate times, bad form references and invalid ranges',()=>{
 const n=m.newPlanner().notifications;
 assert.doesNotThrow(()=>m.validateNotifications(n));
 const check=change=>{const copy=m.clone(n);change(copy);assert.throws(()=>m.validateNotifications(copy));};
 check(copy=>copy.rows.push({...copy.rows[0],id:m.uid()}));
 check(copy=>copy.rows[0].time='25:00');
 check(copy=>copy.rows[0].formId='missing');
 check(copy=>copy.forms.push(m.newMessageForm(copy.forms[0].name)));
 check(copy=>copy.forms[0].sections=[m.newSection('all','range',D,m.addDays(D,-1))]);
 check(copy=>copy.forms[0].sections=[m.newSection('all','range')]);
 check(copy=>copy.teamsUrl='http://example.com/');
});
test('report deduplicates tasks that appear in multiple message sections',()=>{
 const {p,make}=fixture(),n=p.notifications,row=n.rows[0];
 make('selected',{due:D});make('excluded',{due:m.addDays(D,1)});
 n.forms[0].sections=[m.newSection('all','today'),m.newSection('incomplete','today')];
 assert.equal(m.notificationMessage(p,n,row.id,'outlook',D).text.split('- selected').length-1,2);
 const report=m.buildReport(p,n,row.id,stamp,[]);
 assert.equal(report.split('- selected').length-1,1);
 assert.doesNotMatch(report,/excluded/);
 n.forms[0].sections=[m.newSection('complete','today')];
 assert.equal(m.notificationMessage(p,n,row.id,'outlook',D).text,'해당하는 Task가 없습니다.');
 assert.match(m.buildReport(p,n,row.id,stamp,[]),/조건에 맞는 작업 없음/);
});
test('journal ignores updatedAt, manual order and preview flags, records semantic changes including catalog names',()=>{
 const {p,make}=fixture();make('Task');const a={planners:[p]},b=m.clone(a);Object.assign(b.planners[0].tasks[0],{order:50,showNotes:true,updatedAt:stamp});assert.equal(m.changesBetween(a,b).length,0);b.planners[0].buckets[0].name='renamed';assert.equal(m.changesBetween(a,b).length,1);b.planners[0].tasks=[];assert.equal(m.changesBetween(a,b)[0].type,'삭제');const empty=m.clone(a);empty.planners[0].tasks=[];assert.equal(m.changesBetween(empty,a)[0].type,'생성');
});
test('report changes match before OR after, use change-day relative dates, include gaps, respect cutoff',()=>{
 const {p,make}=fixture();const t=make('Changed',{due:'2026-11-02'}),before={planners:[m.clone(p)]};
 t.completed='2026-11-03';
 const at=new Date('2026-11-03T12:00:00').toISOString(),journal=m.changesBetween(before,{planners:[p]},at);
 p.notifications.forms[0].sections=[m.newSection('incomplete','before')];
 const report=m.buildReport(p,p.notifications,p.notifications.rows[0].id,new Date('2026-11-06T08:00:00').toISOString(),journal,{coveredUntil:new Date('2026-11-01T08:00:00').toISOString()});
 assert.match(report,/변경 내역 2026-11-03[\s\S]*변경 전[\s\S]*변경 후/);
 const earlier=m.buildReport(p,p.notifications,p.notifications.rows[0].id,new Date('2026-11-03T08:00:00').toISOString(),journal);
 assert.doesNotMatch(earlier,/변경 전/);
});
test('delivery payloads: adaptive card, HTML escaping and emphasis, no remote error URL leakage',async()=>{
 const {p,make}=fixture();make('<b>& **bold**',{due:m.day()});const n=p.notifications;n.teamsUrl=n.outlookUrl='https://example.com/secret';const payloads=[];const fetcher=async(url,options)=>{payloads.push(JSON.parse(options.body));return {ok:true};};await deliver(p,n,n.rows[0].id,'teams',fetcher);await deliver(p,n,n.rows[0].id,'outlook',fetcher);assert.equal(payloads[0].attachments[0].content.type,'AdaptiveCard');assert.ok(payloads[1].body.includes('&lt;b&gt;&amp;'));assert.ok(payloads[1].body.includes('<strong>bold</strong>'));await assert.rejects(()=>deliver(p,n,n.rows[0].id,'teams',async()=>{throw Error(n.teamsUrl);}),e=>!e.message.includes('secret'));
});
test('connection tests send only a channel-specific sample with the delivery payload shape',async()=>{
 const url='https://example.com/secret', payloads=[];
 const fetcher=async(destination,{body,method,redirect})=>{
  assert.equal(destination,url);assert.equal(method,'POST');assert.equal(redirect,'error');
  payloads.push(JSON.parse(body));return {ok:true};
 };
 await testConnection('teams',url,fetcher);
 await testConnection('outlook',url,fetcher);
 assert.match(payloads[0].attachments[0].content.body[0].text,/Teams 연결 테스트/);
 assert.match(payloads[1].subject,/연결 테스트/);
 assert.match(payloads[1].body,/Outlook 연결 테스트/);
 await assert.rejects(()=>testConnection('teams','http://example.com/'),/HTTPS/);
 await assert.rejects(()=>testConnection('outlook',url,async()=>({ok:false})),e=>e.message.includes('Outlook')&&!e.message.includes('secret'));
});
test('one form can be reused in summary and detail schedules with channel-specific output',()=>{
 const {p,make}=fixture(),n=p.notifications,summary=n.rows[0],form=n.forms[0];
 const detail={...summary,id:m.uid(),time:'09:00',format:'detail'};
 n.rows.push(detail);
 Object.assign(form,{outlookSubject:'업무 브리핑',outlookChecklist:true,outlookNotes:true,
  sections:[m.newSection('incomplete','week'),m.newSection('complete','recent')]});
 for(let i=1;i<=4;i++)make(`Release ${i}`,{due:m.addDays(D,i),notes:'QA notes',checklist:[{id:m.uid(),text:'Review',done:false}]});
 make('Recently due',{due:m.addDays(D,-6),completed:D});
 make('Older due',{due:m.addDays(D,-7),completed:D});
 const teams=m.notificationMessage(p,n,summary.id,'teams',D);
 const outlook=m.notificationMessage(p,n,detail.id,'outlook',D);
 assert.match(teams.text,/오늘부터 7일 후 4건 · 완료 · 최근 7일 1건/);
 assert.match(teams.text,/외 1건/);
 assert.doesNotMatch(teams.text,/Release 4|QA notes|Review|우선순위:|Older/);
 assert.equal(outlook.subject,'업무 브리핑');
 assert.match(outlook.text,/Release 4/);
 assert.match(outlook.text,/QA notes/);
 assert.match(outlook.text,/Review/);
 assert.match(outlook.text,/우선순위:/);
 assert.doesNotMatch(outlook.text,/외 1건|Older/);
 assert.doesNotMatch(m.notificationMessage(p,n,summary.id,'outlook',D).text,/QA notes|Review|우선순위:/);
});
function scheduledFixture(date='2026-11-06T08:00:10'){const p=m.newPlanner();p.notifications.teams=p.notifications.outlook=p.notifications.export=true;p.notifications.teamsUrl=p.notifications.outlookUrl='https://example.com/secret';return {p,store:{state:{planners:[p]},runtime:runtime()},now:new Date(date)};}
test('migration reuses matching old forms and holds rows with unsupported sections',()=>{
 const {forms,rows,...settings}=m.defaultNotifications();
 const {formId,reviewRequired,...timeRow}=rows[0];
 const message={outlookSubject:'업무',outlookChecklist:false,outlookNotes:false,sections:[{kind:'upcoming',project:'all',priority:'all'}]};
 const old={...settings,rows:[
  {...timeRow,message,export:false},
  {...timeRow,id:m.uid(),time:'09:00',message,export:false},
  {...timeRow,id:m.uid(),time:'10:00',export:false,message:{...message,sections:[...message.sections,{kind:'completed',project:'all',priority:'all'}]}}
 ]};
 const migrated=migrateNotifications(old);
 m.validateNotifications(migrated);
 assert.equal(migrated.forms.length,1);
 assert.equal(migrated.forms[0].outlookSubject,'업무');
 assert.deepEqual(migrated.forms[0].sections.map(section=>section.condition),['tomorrow','next']);
 assert.deepEqual(migrated.rows.map(row=>row.reviewRequired),[false,false,true]);
});
test('review holds scheduled delivery and previously queued exports until the row is approved',async()=>{
 const {p,store,now}=scheduledFixture();
 const row=p.notifications.rows[0];
 row.reviewRequired=true;
 store.runtime.pending.push({key:'old-report',rowId:row.id,planner:p.id,time:'07:00',at:'2026-11-06T07:00:00',text:'original report'});
 const sends=[],writes=[];
 const actions={now,send:async(...args)=>sends.push(args[3]),writeReport:async job=>writes.push(job.text)};
 await tick(store,actions);
 assert.deepEqual(sends,[]);assert.deepEqual(writes,[]);
 assert.equal(store.runtime.pending.length,1);
 row.reviewRequired=false;
 await tick(store,actions);
 assert.deepEqual(sends,['teams','outlook']);
 assert.equal(writes[0],'original report');assert.equal(writes.length,2);
 assert.equal(store.runtime.pending.length,0);
});
test('scheduler weekdays, exact minute, successful channels independent; failures retry within minute',async()=>{
 const {p,store,now}=scheduledFixture();let teams=0,outlook=0,exports=0;const send=async(p,n,r,ch)=>{if(ch==='teams')teams++;else{outlook++;if(outlook===1)throw Error('test failure');}};const writeReport=async()=>{exports++;};await tick(store,{now,send,writeReport});await tick(store,{now,send,writeReport});assert.equal(teams,1);assert.equal(outlook,2);assert.equal(exports,1);await tick(store,{now:new Date('2026-11-06T09:00:00'),send,writeReport});assert.equal(outlook,2);await tick(store,{now:new Date('2026-11-07T08:00:00'),send,writeReport});assert.equal(exports,1);p.deletedAt=now.toISOString();await tick(store,{now:new Date('2026-11-09T08:00:00'),send,writeReport});assert.equal(teams,1);
});
test('slow scheduled delivery leaves saves free and delivers the next observed minute once',async()=>{
 const p=m.newPlanner();
 const n=p.notifications;
 n.teams=true;
 n.teamsUrl='https://example.invalid/scheduled';
 const first=n.rows[0],second={...first,id:m.uid(),time:'08:01'};
 n.rows.push(second);
 const store={state:{planners:[p]},runtime:runtime()};
 let now=new Date('2026-11-06T08:00:30'),tail=Promise.resolve(),releaseFirst,startFirst,finishBoth;
 const gate=new Promise(resolve=>{releaseFirst=resolve;});
 const started=new Promise(resolve=>{startFirst=resolve;});
 const finished=new Promise(resolve=>{finishBoth=resolve;});
 const sent=[];
 const exclusive=callback=>{
  const work=tail.then(callback);
  tail=work.catch(()=>{});
  return work;
 };
 const scheduler=createNotificationQueue({
  readStore:()=>store,exclusive,concurrency:1,clock:()=>now,
  checkpoint:async()=>{if(Object.keys(store.runtime.delivery).length===2)finishBoth();},
  send:async(planner,row)=>{
   sent.push([row,planner.name]);
   if(row===first.id){startFirst();await gate;}
  }
 });
 const observe=observedAt=>exclusive(()=>tick(store,{now:observedAt,enqueueNotification:scheduler.enqueue}));
 await observe(now);
 await started;
 await observe(now);
 now=new Date('2026-11-06T08:01:30');
 await exclusive(()=>{p.name='Saved during delivery';});
 await observe(now);
 await observe(now);
 assert.deepEqual(sent,[[first.id,'Kanban Planner']]);
 now=new Date('2026-11-06T08:02:00');
 releaseFirst();
 await finished;
 await observe(now);
 await scheduler.close();
 assert.deepEqual(sent,[[first.id,'Kanban Planner'],[second.id,'Saved during delivery']]);
 assert.ok(Object.values(store.runtime.delivery).every(result=>result.success));
});
test('failed export retains original snapshot and retries after minute, with no duplicate successful history',async()=>{
 const {p,store,now}=scheduledFixture();p.notifications.teams=p.notifications.outlook=false;let n=0,first;
 const writeReport=async(job,previous,planner)=>{
  n++;if(n===1){first=m.clone(job);throw Error('disk');}
  assert.equal(job.text,first.text);
  assert.equal(planner.notifications.exportFolder,'updated destination');
 };
 await tick(store,{now,writeReport});assert.equal(store.runtime.pending.length,1);
 p.name='later edit';p.notifications.exportFolder='updated destination';
 await tick(store,{now:new Date('2026-11-09T10:22:00'),writeReport});assert.equal(n,2);assert.equal(store.runtime.pending.length,0);
 await tick(store,{now:new Date('2026-11-09T10:22:30'),writeReport});assert.equal(n,2);
});
test('pending reports pause while disabled and are cancelled when the original row is removed',async()=>{
 const {p,store,now}=scheduledFixture();
 p.notifications.teams=p.notifications.outlook=false;
 const row=p.notifications.rows[0];
 await tick(store,{now,writeReport:async()=>{throw Error('disk');}});
 const original=m.clone(store.runtime.pending[0]);
 const writes=[];
 const later=new Date('2026-11-09T10:22:00');
 const run=()=>tick(store,{now:later,writeReport:async job=>writes.push(job)});
 p.notifications.export=false;
 assert.deepEqual(pendingReports(store)[p.id],{paused:1,retry:0});
 await run();
 p.notifications.export=true;
 row.export=false;
 await run();
 assert.equal(writes.length,0);
 assert.deepEqual(store.runtime.pending,[original]);
 row.export=true;
 await run();
 await run();
 assert.deepEqual(writes,[original]);
 store.runtime.pending.push({...original,key:'another-failed-report'});
 p.notifications.rows[0]={...row,id:m.uid()};
 assert.equal(pendingReports(store)[p.id],undefined);
 let checkpoints=0;
 await tick(store,{now:later,writeReport:async job=>writes.push(job),checkpoint:async()=>checkpoints++});
 assert.equal(checkpoints,1);
 assert.equal(store.runtime.pending.length,0);
 assert.deepEqual(writes,[original]);
});
test('scheduled report reconstructs current tasks at scheduled time and excludes later in-minute changes',async()=>{
 const {p,store,now}=scheduledFixture();p.notifications.teams=p.notifications.outlook=false;
 const before={planners:[m.clone(p)]},task={...m.newTask(p),title:'after cutoff',due:m.day(now)};m.saveTask(p,task);store.runtime.journal=m.changesBetween(before,{planners:[p]},new Date('2026-11-06T08:00:05').toISOString());
 let text;await tick(store,{now,writeReport:async job=>text=job.text});assert.ok(!text.includes('after cutoff'));
});
