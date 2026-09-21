import { describe, it, expect } from 'vitest';
import { guardIdentity, findDenial } from '../../src/core/safety/identity.js';

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
