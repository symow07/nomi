import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { promisesWhatNothingKeeps } from '../../src/core/safety/unkeptPromise.js';

/** The owner, 2026-11-05: no promise to hand over or check unless the code really does it. A new phrasing goes here first. */
const CAUGHT: readonly (readonly [string, string])[] = [
  // what the live runs wrote
  ['ar', 'نعم، أنا مساعد آلي. يمكن لشخص من فريق Trust Factory الرد عليك، وسأحوّل المحادثة إلى الفريق.'],
  ['ar', 'لا تتوفر لدي معلومات مؤكدة عن تصنيعها أو سعرها، وسيتم تحويل الاستفسار إلى الفريق للتحقق.'],
  ['ar', 'نعم، أنا مساعد آلي. يمكن لشخص من الفريق متابعة المحادثة معك.'],
  ['zh', '是的，我是 AI 助手。团队中的同事可以继续为您回复，我会将对话转交给他们。'],
  ['zh', '目前没有可确认的认证信息，我可以请团队核实。'],
  ['zh', '是的，我是 AI 助手。团队中的同事可以接手并回复您。'],
  ['fr', "Oui, je suis un assistant virtuel. Une personne de l'équipe peut vous répondre ; je lui transmets la conversation."],
  // the same in each language's plainest words
  ['en', "Yes, I'm an AI assistant. Someone from the team can reply, and I'll hand the conversation over."],
  ['en', "I don't have that yet. I'll check and get back to you."],
  ['en', 'Let me check that for you.'],
  ['en', 'Our team will confirm the price.'],
  ['en', "I've passed your details to our team."],
  ['es', 'Voy a consultar y te digo.'],
  ['es', 'Alguien de nuestro equipo puede responderte.'],
  ['pt', 'Vou verificar e retorno.'],
  ['pt', 'Uma pessoa da equipe pode responder.'],
];

const LEFT_ALONE: readonly (readonly [string, string])[] = [
  ['en', "Yes, I'm an automated assistant."],
  ['en', "I don't have that confirmed. Which product do you mean?"],
  ['en', 'Shall I check the larger size for you?'],
  ['en', 'Let me know which colour you prefer.'],
  ['en', 'Your team can share the size when ready.'],
  ['en', 'Our team designed this in Lisbon.'],
  ['en', 'You can check the sizes on the label.'],
  ['zh', '是的，我是 AI 助手。'],
  ['zh', '目前没有确认的认证信息。请问是哪一款？'],
  ['zh', '请问您想确认哪一款？'],
  ['ar', 'نعم، أنا مساعد آلي.'],
  ['ar', 'لا تتوفر لدي معلومات مؤكدة. ما المنتج المقصود؟'],
  ['ar', 'يسعدني اهتمامك بأكياس التسوق.'],
  ['es', 'Sí, soy un asistente automático.'],
  ['es', 'No tengo ese dato confirmado. ¿Qué producto te interesa?'],
  ['fr', 'Oui, je suis un assistant automatisé.'],
  ['fr', "Je n'ai pas cette information. Quel produit vous intéresse ?"],
  ['pt', 'Sim, sou um assistente automático.'],
  ['pt', 'Não tenho essa informação confirmada. Qual produto interessa?'],
];

describe('no promise the code does not keep', () => {
  for (const [lang, reply] of CAUGHT) it(`caught [${lang}] ${reply}`, () => expect(promisesWhatNothingKeeps(reply)).not.toBeNull());
  for (const [lang, reply] of LEFT_ALONE) it(`left alone [${lang}] ${reply}`, () => expect(promisesWhatNothingKeeps(reply)).toBeNull());

  it('the writer is told: first person, no team, what it does not know', () => {
    const prompt = readFileSync(new URL('../../prompts/response.txt', import.meta.url), 'utf8');
    expect(prompt).not.toContain('hand the conversation over');
    expect(prompt).toContain('Never promise to check, ask, pass anything on or come back');
  });
});
