import { describe, it, expect } from 'vitest';
import { sectionSidebar } from '../../src/api/web/sections.js';
import { assistantSection, assistantArea } from '../../src/api/web/assistantArea.js';
import { renderAssistantOverview } from '../../src/api/web/assistantOverview.js';
import type { EmployeeProfile } from '../../src/api/web/employee.js';
const employee:EmployeeProfile={hireDate:null,knows:0,stage:'probation',canDo:[],needConfirm:[],capabilities:[],growth:[],promoted:false,conditions:[],spotChecks:[],assistantNamed:false};
describe('Assistant daily work has a distinct home',()=>{
 it('selects the canonical and command-response sections without taking Settings',()=>{
  for(const [path,section] of [['/app/assistant','overview'],['/app/assistant/ask/history','ask'],['/app/advisor','ask'],['/app/knowledge/from-page/a','knowledge'],['/app/sandbox/message','practice'],['/app/assistant/review','review'],['/app/assistant/activity?page=2','activity']])expect(assistantSection(path!)).toBe(section);
  expect(assistantSection('/app/settings/assistant')).toBe(null);
  // The navigation block (2026-11-25): the area's sections are the shell's sidebar; the frame is only the frame.
  expect(assistantArea('<h1>Daily work</h1>','en','/app/assistant/practice')).toBe('<div class="assistant-area"><div class="aa-content"><h1>Daily work</h1></div></div>');
  const html=sectionSidebar('en','assistant','/app/assistant/practice');
  expect(html).toContain('href="/app/assistant/practice" aria-current="page"');expect(html).toContain('href="/app/settings/assistant"');
  expect(html.match(/aria-current/g)).toHaveLength(1);
 });
 it('says stopped before configured authority and keeps Stop owner-only',()=>{
  const owner={id:'owner',name:'Owner',isOwner:true};
  const stopped=renderAssistantOverview({...employee,stopped:true,answering:true},'en',owner,null);
  expect(stopped).toContain('stopped');expect(stopped).not.toContain('action="/app/business/stop-assistant"');
  const answering=renderAssistantOverview({...employee,answering:true},'en',owner,null);
  // The text cleanup (2026-11-26, the owner's approval): the Stop is drawn once, on Going live; the overview is one press from it.
  expect(answering).toContain('<p class="stop-here"><a class="aa-go" href="/app/settings/assistant/ready#stop">');expect(answering).not.toContain('action="/app/business/stop-assistant"');
  expect(renderAssistantOverview({...employee,answering:true},'en',{...owner,isOwner:false},null)).not.toContain('ready#stop');
  expect(answering).not.toContain('action="/app/settings/assistant/autonomy"');
 });
});
