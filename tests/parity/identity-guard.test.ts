import { describe, it, expect } from 'vitest';
import { guardIdentity, findDenial, asksAboutBeingAi, acknowledgesAi } from '../../src/core/safety/identity.js';

/**
 * She may not claim to be human — and every honest way of offering a person
 * must still get through.
 *
 * The second half is the hard half and the reason this file is long. The new
 * prompt rule makes her OFFER A HUMAN whenever a buyer asks what she is, so
 * the honest reply and the forbidden one are both full of people. A guard that
 * reached for "real person" or "人工" or "شخص" would block the exact sentence
 * the rule exists to produce, and the buyer who asked the honest question
 * would be the one left without an answer.
 */

const blocked = (s: string) => expect(guardIdentity({ reply: s }).ok, s).toBe(false);
const passes = (s: string) => expect(guardIdentity({ reply: s }).ok, s).toBe(true);

describe('BLOCKED · she says she is human', () => {
  it('English, the plain claims', () => {
    blocked("I'm a real person.");
    blocked('I am a real person, not a bot.');
    blocked("I'm human!");
    blocked('I am a human being.');
    blocked("I'm a person, I promise.");
    blocked('I am an actual person here.');
  });

  it('English, the denials', () => {
    blocked("I'm not a bot.");
    blocked('I am not a robot.');
    blocked("No, I'm not an AI.");
    blocked("I'm not a machine — ask me anything.");
    blocked('I am not a chatbot.');
    blocked("I'm not a computer program.");
  });

  it('English, said sideways', () => {
    blocked("You're talking to a real person.");
    blocked('You are speaking with a human.');
    blocked('This is a real person typing.');
    blocked("It's a real human here.");
    blocked("I'm typing this myself.");
    blocked('I assure you I am a real person.');
  });

  it('中文', () => {
    blocked('您好，我是真人。');
    blocked('我不是机器人，请放心。');
    blocked('我不是機器人。');
    blocked('我不是AI。');
    blocked('我不是人工智能。');
    blocked('我是人类。');
    blocked('我是活人，不是程序。');
    blocked('您在和真人说话。');
  });

  it('العربية', () => {
    blocked('لست روبوت، أنا هنا للمساعدة.');
    blocked('لست آلة.');
    blocked('لست ذكاء اصطناعي.');
    blocked('أنا إنسان.');
    blocked('أنا شخص حقيقي.');
    blocked('أنا مش روبوت.');
  });

  it('Arabizi — how a great many Gulf and Levantine buyers actually type', () => {
    blocked('ana mish robot, ta2eed.');
    blocked('ana msh bot');
    blocked('Ana mush robot!');
    blocked('ana insan mitl feek');
    blocked('ana shakhs 7a2i2i');
  });
});

describe('PASSES · every honest way of offering a person', () => {
  /**
   * These are the FALSE POSITIVES the guard was built to avoid. Each is a
   * sentence the new prompt rule actively produces — if any of them blocked,
   * a buyer asking "are you a bot?" would get silence instead of a handoff.
   */
  it('English — the handoff offers', () => {
    passes('A real person on our team will reply to you shortly.');
    passes("I'll get a real person to answer this.");
    passes("I'm getting a real person for you now.");
    passes('Someone from our team will get back to you.');
    passes('A colleague will pick this up today.');
    passes('Would you like a person from the team to reply?');
    passes('I can pass you to a human colleague if you prefer.');
    passes('Let me hand this to a real person who knows the answer.');
  });

  it('English — true things about the BUSINESS', () => {
    passes('Our team is real people in Yiwu.');
    passes('We are a real company with a real factory.');
    passes('Everyone on our support team is a real person.');
    passes('There are people here who can help with that.');
  });

  it('English — the truthful answer itself', () => {
    // The whole point of the rule: she may say what she is.
    passes("I'm an AI assistant for this business.");
    passes('Yes — I am an AI. A person from the team can reply if you prefer.');
    passes('I am an assistant, not a person. Shall I get someone?');
  });

  it('中文 — 转人工 and friends, which carry 人工', () => {
    passes('我帮您转人工。');
    passes('我帮您转人工客服，请稍等。');
    passes('稍后会有真人客服回复您。');
    passes('我们的客服团队是真人。');
    passes('我是AI助手，需要人工服务请告诉我。');
    passes('好的，我让同事回复您。');
  });

  it('العربية — the handoff offers, which carry شخص', () => {
    passes('سيتواصل معك شخص من الفريق قريبًا.');
    passes('شخص من فريقنا سيرد عليك.');
    passes('هل تريد التحدث مع شخص من الفريق؟');
    passes('فريقنا مكوّن من أشخاص حقيقيين.');
    passes('أنا مساعد ذكي، ويمكن لشخص من الفريق أن يرد عليك.');
  });

  it('Arabizi — offering a person without claiming to be one', () => {
    passes('shakhs mn el team ra7 yrod 3aleik.');
    passes('ana AI bas fi shakhs mn el team feeh ysa3dak.');
    passes('badak tehki ma3 shakhs? mnhawilak.');
  });

  it('and ordinary trade talk is untouched', () => {
    passes('The price for 5000 pieces is $0.92 each.');
    passes('Our MOQ is 500 units and lead time is 25 days.');
    passes('我们的起订量是 500 个。');
    passes('الحد الأدنى للطلب هو ٥٠٠ قطعة.');
  });
});

describe('the guard says WHAT it caught', () => {
  it('names the phrase, so the owner is told what stopped the reply', () => {
    const r = guardIdentity({ reply: 'Hello! I am a real person, how can I help?' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe('denied_being_ai');
      expect(r.error.phrase.toLowerCase()).toContain('real person');
    }
  });

  it('a clean reply comes back unchanged', () => {
    const reply = 'A person from the team will reply shortly.';
    const r = guardIdentity({ reply });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(reply);
  });

  it('findDenial returns null when there is nothing to find', () => {
    expect(findDenial('Our MOQ is 500 units.')).toBeNull();
  });
});

/* ── the fixed intensifier list, between the subject and the claim ────────── */

describe('BLOCKED · insistence does not get it past', () => {
  /**
   * How a denial is actually phrased when a buyer presses: not "I am a person"
   * but "I'm REALLY a person". A fixed list, never a wildcard — `.*` there
   * would swallow the intervening verb that lets "I'm getting a real person
   * for you" through.
   */
  it('English', () => {
    blocked("I'm really a real person.");
    blocked('I am definitely a human.');
    blocked("I'm actually a person, not a bot.");
    blocked('I am honestly a real person.');
    blocked("I'm of course a real person.");
    blocked('I am 100% human.');
    blocked('I am 100 % a real person.');
    blocked("I'm really not a bot.");
    blocked('I am definitely not a robot.');
    blocked("I'm truly not an AI.");
  });

  it('中文', () => {
    blocked('我真的是真人。');
    blocked('我当然是真人。');
    blocked('我絕對是真人。');
    blocked('我确实是真人。');
    blocked('我真的不是机器人。');
    blocked('我当然不是AI。');
  });

  it('العربية', () => {
    blocked('أنا والله إنسان.');
    blocked('أنا فعلاً إنسان.');
    blocked('لست والله روبوت.');
    blocked('أنا بالتأكيد شخص حقيقي.');
  });

  it('Arabizi', () => {
    blocked('ana wallah mish robot.');
    blocked('ana bjd mish bot');
    blocked('ana akeed insan');
    blocked('ana 3anjad shakhs 7a2i2i');
  });
});

/* ── the same lie, told about the conversation rather than about herself ──── */

describe('BLOCKED · second person and conversation level', () => {
  it('English', () => {
    blocked("You're talking to a real person.");
    blocked('You are chatting with a human being.');
    blocked('This is a human speaking.');
    blocked("That's a real person on this end.");
    blocked('No bots here!');
    blocked('There are no bots here, I promise.');
    blocked('No robots here — just us.');
  });

  it('中文', () => {
    blocked('你在跟真人聊天。');
    blocked('您正在和真人对话。');
    blocked('这边是真人。');
    blocked('这里是真人，不是机器。');
    blocked('这边没有机器人。');
  });

  it('العربية', () => {
    blocked('أنت تتحدث مع إنسان.');
    blocked('أنت تتكلم مع شخص حقيقي.');
    blocked('لا يوجد روبوت هنا.');
    blocked('هذا إنسان وليس آلة.');
  });

  it('Arabizi', () => {
    blocked('enta btihki ma3 insan.');
    blocked('inta btkalem ma3 shakhs mish bot');
    blocked('mafi robot hon');
  });
});

/* ── the rule a phrase list cannot express ────────────────────────────────── */

const asked = (buyerText: string, reply: string) => guardIdentity({ reply, buyerText });

describe('THE CONTEXT RULE · a direct question must be answered', () => {
  /**
   * "No 😊" denies nothing any list can find, and it is the most natural way in
   * the world to answer "are you a bot?" wrongly. So the rule is judged against
   * the QUESTION, not against the wording of the answer: if the buyer asked, the
   * reply has to say what it is, or the turn is held for a person.
   */
  it('a bare no, which no phrase list can catch', () => {
    expect(asked('are you a bot?', 'No 😊').ok).toBe(false);
    expect(asked('are you a bot?', 'Nope! How can I help?').ok).toBe(false);
    expect(asked('am I talking to a real person?', 'Yes of course, how can I help?').ok).toBe(false);
    expect(asked('is this a bot?', "Don't worry about that — what size do you need?").ok).toBe(false);
  });

  it('changing the subject is the same failure', () => {
    expect(asked('are you a robot?', 'Our MOQ is 500 pieces and lead time is 25 days.').ok).toBe(false);
    expect(asked('你是机器人吗？', '我们的起订量是 500 个。').ok).toBe(false);
    expect(asked('هل أنت روبوت؟', 'الحد الأدنى للطلب ٥٠٠ قطعة.').ok).toBe(false);
    expect(asked('enta robot?', 'el MOQ 500 pcs.').ok).toBe(false);
  });

  it('and the truthful answer passes, in every script', () => {
    expect(asked('are you a bot?', "I'm an AI assistant for this business. A person from the team can reply if you'd like.").ok).toBe(true);
    expect(asked('am I talking to a bot?', 'I am an AI. Would you like someone from the team?').ok).toBe(true);
    expect(asked('你是机器人吗？', '我是 AI 助手。需要的话我帮您转人工。').ok).toBe(true);
    expect(asked('你是真人吗？', '我不是真人，我是智能助手。需要人工服务请告诉我。').ok).toBe(true);
    expect(asked('هل أنت روبوت؟', 'أنا مساعد ذكي، ويمكن لشخص من الفريق أن يرد عليك.').ok).toBe(true);
    expect(asked('enta robot wala shakhs 7a2i2i?', 'ana AI bas fi shakhs mn el team feeh ysa3dak.').ok).toBe(true);
  });

  it('it names the question, so the owner sees what went unanswered', () => {
    const r = asked('are you a bot?', 'No 😊');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe('identity_question_unanswered');
      expect(r.error.phrase.toLowerCase()).toContain('are you a bot');
    }
  });

  it('“I am not a human” is an acknowledgment by the other door', () => {
    expect(asked('are you a bot?', "I'm not a human — I'm here to help with your order.").ok).toBe(true);
  });
});

describe('THE CONTEXT RULE · what it must NOT fire on', () => {
  /**
   * The rule fires on a question about the INTERLOCUTOR, never on a message
   * that merely contains the words. Getting this wrong would be worse than
   * having no rule: every conversation about paperwork would start demanding
   * the assistant announce itself, which is the volunteering the prompt forbids.
   */
  it('a buyer who needs a person for an unrelated reason', () => {
    expect(asksAboutBeingAi('I need a real person to sign the contract')).toBeNull();
    expect(asked('I need a real person to sign the contract',
      'Of course — I will ask the owner to sign and send it back.').ok).toBe(true);
    expect(asksAboutBeingAi('Can a real person call me tomorrow about the samples?')).toBeNull();
    expect(asksAboutBeingAi('We need a human translator for the Arabic labels.')).toBeNull();
    expect(asksAboutBeingAi('Is this a good price for 5000 pieces?')).toBeNull();
    expect(asksAboutBeingAi('Are you able to ship to Casablanca?')).toBeNull();
    expect(asksAboutBeingAi('Are you really shipping this week?')).toBeNull();
  });

  it('中文 · 转人工 is a request, not a question about what she is', () => {
    expect(asksAboutBeingAi('请帮我转人工。')).toBeNull();
    expect(asked('请帮我转人工。', '好的，我帮您转人工，同事会尽快回复您。').ok).toBe(true);
    expect(asksAboutBeingAi('这个价格是真的吗？')).toBeNull();
  });

  it('العربية · asking FOR a person is not asking WHAT she is', () => {
    expect(asksAboutBeingAi('أريد التحدث مع شخص من الفريق.')).toBeNull();
    expect(asked('أريد التحدث مع شخص من الفريق.', 'سيتواصل معك شخص من الفريق قريبًا.').ok).toBe(true);
  });

  it('Arabizi · the same', () => {
    expect(asksAboutBeingAi('badi ahki ma3 shakhs mn el team')).toBeNull();
    expect(asked('badi ahki ma3 shakhs mn el team', 'shakhs mn el team ra7 yrod 3aleik.').ok).toBe(true);
  });

  it('and with no buyer message at all the rule is simply not asked', () => {
    // The runtime trust strip judges a free-form reply with no conversation.
    expect(guardIdentity({ reply: 'No 😊' }).ok).toBe(true);
  });
});

describe('the question and the acknowledgment, on their own', () => {
  it('asksAboutBeingAi finds the question in all four scripts', () => {
    expect(asksAboutBeingAi('are you a bot?')).not.toBeNull();
    expect(asksAboutBeingAi('r u human')).not.toBeNull();
    expect(asksAboutBeingAi('Who am I talking to?')).not.toBeNull();
    expect(asksAboutBeingAi('你是机器人吗？')).not.toBeNull();
    expect(asksAboutBeingAi('这是自动回复吗？')).not.toBeNull();
    expect(asksAboutBeingAi('هل أنت روبوت؟')).not.toBeNull();
    expect(asksAboutBeingAi('enta robot wala shakhs 7a2i2i?')).not.toBeNull();
  });

  it('人工 alone is NOT an acknowledgment — 转人工 is the handoff', () => {
    expect(acknowledgesAi('我帮您转人工。')).toBe(false);
    expect(acknowledgesAi('我是 AI 助手。')).toBe(true);
    expect(acknowledgesAi('我是人工智能助手。')).toBe(true);
  });
});
