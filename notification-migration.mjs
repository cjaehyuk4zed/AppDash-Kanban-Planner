import {deadlineForm,dueConditions,newMessageForm,newSection,parseDate,sectionStatuses} from './public/model.mjs';

const legacyBody='- 기한 초과 Task\n{overdueTasks}\n\n- 기한 당일 Task\n{todayTasks}\n\n- 기한 임박 Task\n{upcomingTasks}\n\n- 다음 7일 이내 Task\n{nextWeekTasks}';
const legacyEmpty='기한 초과/당일/임박 Task 없음 ~~';
const signature=({status,condition,from,to})=>JSON.stringify([status,condition,from,to]);

function convertParameter(parameter){
  if(!parameter||parameter.field!=='due'||['project','priority','label','bucket'].some(key=>(parameter[key]??'all')!=='all'))return null;
  const {status,condition}=parameter;
  if(!sectionStatuses.some(([key])=>key===status)||!dueConditions.some(([key])=>key===condition))return null;
  if(condition!=='range')return newSection(status,condition);
  try{
    const from=parseDate(parameter.from),to=parseDate(parameter.to);
    if((from||to)&&(!from||!to||from<=to))return newSection(status,condition,from,to);
  }catch{}
  return null;
}

function convertSection(section){
  if((section.project??'all')!=='all'||(section.priority??'all')!=='all')return [];
  const kinds={overdue:['before'],today:['today'],upcoming:['tomorrow','next']};
  return (kinds[section.kind]??[]).map(condition=>newSection('incomplete',condition));
}

export function migrateNotifications(old){
  const {templates=[],parameters=[],include=[],empty,rows,...settings}=old;
  const forms=[],bySignature=new Map();
  const exportSections=parameters.filter(parameter=>parameter.export).map(convertParameter);
  const exportKeys=new Set(exportSections.filter(Boolean).map(signature));
  const migratedRows=rows.map(row=>{
    const {template:templateId,message,format,...timeRow}=row;
    const template=templates.find(item=>item.id===templateId);
    let sections,reviewRequired=false;
    if(message){
      const converted=message.sections.map(convertSection);
      reviewRequired=converted.some(parts=>!parts.length);
      sections=converted.flat();
    }else{
      const body=template?.body??'';
      const tokens=[...body.matchAll(/\{([^{}]+)\}/g)].map(match=>match[1]).filter(token=>!['today','tomorrow'].includes(token));
      const converted=tokens.map(token=>convertParameter(parameters.find(parameter=>parameter.name===token)));
      reviewRequired=body!==legacyBody||empty!==legacyEmpty||converted.some(section=>!section);
      sections=converted.filter(Boolean);
    }
    if(!sections.length){
      sections=deadlineForm().sections;
      reviewRequired=true;
    }
    const keys=new Set(sections.map(signature));
    if(row.export&&(exportSections.some(section=>!section)||keys.size!==exportKeys.size||[...keys].some(key=>!exportKeys.has(key))))reviewRequired=true;
    if(!message&&format==='custom'||message&&format==='summary'&&(message.outlookChecklist||message.outlookNotes))reviewRequired=true;

    const outlookSubject=message?.outlookSubject??'';
    const outlookChecklist=message?.outlookChecklist??(format==='basic'||format==='custom'&&include.includes('checklist'));
    const outlookNotes=message?.outlookNotes??(format==='custom'&&include.includes('notes'));
    const key=JSON.stringify([sections.map(signature),outlookSubject,outlookChecklist,outlookNotes]);
    let form=bySignature.get(key);
    if(!form){
      const base=(message?'기존 메시지 양식':template?.name==='기본 템플릿'?'기한 점검':template?.name?.trim()||'기존 메시지 양식').slice(0,72);
      let name=base;
      for(let i=2;forms.some(item=>item.name===name);i++)name=`${base} ${i}`;
      form={...newMessageForm(name,sections),outlookSubject,outlookChecklist,outlookNotes};
      bySignature.set(key,form);
      forms.push(form);
    }
    return {...timeRow,formId:form.id,format:format==='summary'?'summary':'detail',reviewRequired};
  });
  return {...settings,forms,rows:migratedRows};
}
