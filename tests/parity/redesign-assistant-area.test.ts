import { describe, it, expect } from 'vitest';
import { assistantSection, assistantArea } from '../../src/api/web/assistantArea.js';
import { renderAssistantOverview } from '../../src/api/web/assistantOverview.js';
import type { EmployeeProfile } from '../../src/api/web/employee.js';
const employee:EmployeeProfile={hireDate:null,knows:0,stage:'probation',canDo:[],needConfirm:[],capabilities:[],growth:[],promoted:false,conditions:[],spotChecks:[],assistantNamed:false};
describe('Assistant daily work has a distinct home',()=>{
 it('selects the canonical and command-response sections without taking Settings',()=>{
  for(const [path,section] of [['/app/assistant','overview'],['/app/assistant/ask/history','ask'],['/app/advisor','ask'],['/app/knowledge/from-page/a','knowledge'],['/app/sandbox/message','practice'],['/app/assistant/review','review'],['/app/assistant/activity?page=2','activity']])expect(assistantSection(path!)).toBe(section);
  expect(assistantSection('/app/settings/assistant')).toBe(null);
  const html=assistantArea('<h1>Daily work</h1>','en','/app/assistant/practice');
  expect(html).toContain('href="/app/assistant/practice" aria-current="page"');expect(html).toContain('href="/app/settings/assistant"');
 });
 it('says stopped before configured authority and keeps Stop owner-only',()=>{
  const owner={id:'owner',name:'Owner',isOwner:true};
  const stopped=renderAssistantOverview({...employee,stopped:true,answering:true},'en',owner,null);
  expect(stopped).toContain('stopped');expect(stopped).not.toContain('action="/app/business/stop-assistant"');
  const answering=renderAssistantOverview({...employee,answering:true},'en',owner,null);
  expect(answering).toContain('action="/app/business/stop-assistant"');expect(answering).toContain('value="assistant"');
  expect(renderAssistantOverview({...employee,answering:true},'en',{...owner,isOwner:false},null)).not.toContain('action="/app/business/stop-assistant"');
  expect(answering).not.toContain('action="/app/settings/assistant/autonomy"');
 });
});
