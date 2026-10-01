import { ok, err, type Result } from '../types/result.js';

/**
 * SHE MAY NOT CLAIM TO BE HUMAN.
 *
 * `prompts/response.txt` tells the writer never to deny being an AI, to answer
 * truthfully when a buyer sincerely asks, and to offer a person. That is a
 * prompt, and a prompt is a hope: the model that follows it on Monday is the
 * model that is one token unlucky on Tuesday. This is the same rule expressed
 * where it cannot be talked out of — beside the numeral, claims and
 * forbidden-word guards, in the same retry loop, failing closed.
 *
 * It is the one claim where the product cannot afford to be probabilistic.
 * Everything else a guard catches is a commercial mistake — a price below the
 * floor, a certification nobody authorised. This one is a lie told to a person
 * who asked a direct question, and in several places a lie a regulator has
 * opinions about.
 *
 * ── TWO RULES, AND THE SECOND IS THE ONE THAT MATTERS ───────────────────────
 *
 * 1. A DENIAL IS REFUSED. A list of phrases, below. Lists of phrases are worth
 *    having and are never finished.
 *
 * 2. A QUESTION IS ANSWERED. If the buyer's own last message asked what they
 *    are talking to, the reply must SAY that it is an AI. This is the rule the
 *    first one cannot express: "No 😊" denies nothing a pattern can find, and
 *    is the most natural way in the world to answer "are you a bot?" wrongly.
 *    Judged against the QUESTION, not the wording of the answer, so it holds
 *    for every phrasing nobody thought of — including silence on the subject.
 *
 * Either failure spends a retry, and two failures hold the turn for a person.
 *
 * ── SELF-DENIAL ONLY. THIS IS THE WHOLE DIFFICULTY. ─────────────────────────
 *
 * The prompt makes her OFFER A HUMAN, so honest replies are full of people:
 * "a real person on our team will reply", "我帮您转人工", "سيتواصل معك شخص من
 * الفريق". A guard that reached for "real person" or "人工" or "شخص" would
 * block exactly the sentence the new rule exists to produce, the reply would be
 * regenerated twice, and the turn would end up held — the buyer who asked the
 * honest question being the one who gets no answer.
 *
 * So every pattern below is anchored to a subject asserting humanity, now:
 *
 *    blocked   I am a real person   ·  我是真人     ·  لست روبوت    ·  ana mish robot
 *    passes    a real person will reply  ·  我帮您转人工  ·  شخص من الفريق سيرد
 *
 * and nothing matches across an intervening verb: "I'm getting a real person
 * for you" has a subject, but what follows it is an action, not a claim.
 *
 * Between the subject and the claim, a FIXED list of intensifiers is allowed —
 * "I'm really a real person", "我真的是真人", "ana wallah mish robot" — because
 * insistence is exactly how a denial is phrased when a buyer presses. A fixed
 * list, never `.*`: a wildcard there would swallow the intervening verb this
 * guard's precision depends on.
 *
 * Saying the BUSINESS is run by real people is true and passes. Saying that
 * SHE is one does not.
 */

export type IdentityViolation =
  | {
      readonly kind: 'denied_being_ai';
      /** The exact text that matched, so the owner is told what stopped it. */
      readonly phrase: string;
    }
  | {
      readonly kind: 'identity_question_unanswered';
      /** What the buyer asked, so the owner sees the question that went unanswered. */
      readonly phrase: string;
    };

/* ── the fixed intensifier lists ─────────────────────────────────────────────
 * Each is a bounded alternation. They appear between the subject and the claim
 * and nowhere else; an intensifier BEFORE the subject ("Of course I'm a real
 * person") already matches, because none of these patterns is anchored to the
 * start of the reply.
 */
const EN_INTENS = '(?:really|definitely|absolutely|actually|honestly|truly|genuinely|certainly|of\\s+course|indeed|100\\s*%|a\\s+hundred\\s+percent)';
/** Up to two, so "I am really honestly a person" is caught and nothing unbounded is. */
const EN_GAP = `(?:${EN_INTENS}\\s+){0,2}`;
const ZH_INTENS = '(?:真的|真係|當然|当然|絕對|绝对|確實|确实|肯定|保證|保证)';
const ZH_GAP = `(?:${ZH_INTENS}){0,2}`;
const AR_INTENS = '(?:والله|و\\s*الله|فعلا|فعلاً|حقا|حقًا|بالتأكيد|طبعا|طبعًا|أكيد|اكيد)';
const AR_GAP = `(?:${AR_INTENS}\\s+){0,2}`;
const ARZ_INTENS = '(?:wallah|walla|wallahi|w\\s*allah|bjd|bjad|bejad|fe3lan|fe3len|akeed|akid|3anjad|anjad)';
const ARZ_GAP = `(?:${ARZ_INTENS}\\s+){0,2}`;

const EN_I = "\\bi(?:'m|’m|\\s+am)\\s+";
// Spanish and French (2026-09-29): the same claims, in the customers' words.
const ES_INTENS = '(?:realmente|de\\s+verdad|en\\s+serio|claro\\s+que|sin\\s+duda|totalmente|100\\s*%)';
const ES_GAP = `(?:${ES_INTENS}\\s+){0,2}`;
const FR_INTENS = '(?:vraiment|bien|r[ée]ellement|s[ûu]rement|certainement|[àa]\\s+100\\s*%)';
const FR_GAP = `(?:${FR_INTENS}\\s+){0,2}`;
/** pt — "sou realmente uma pessoa", "não sou mesmo um robô": up to two of these between the verb and the noun. */
const PT_GAP = `(?:(?:realmente|mesmo|mesma|de\\s+fato|com\\s+certeza|sim)\\s+){0,2}`;

/**
 * Written out rather than generated, because each one is a sentence somebody
 * could actually send and the list is meant to be read by a person deciding
 * whether it is right.
 */
const DENIALS: readonly RegExp[] = [
  // ── English · first person ────────────────────────────────────────────────
  // "I am a real person", "I'm really human", "I am 100% a person". Adjacent
  // by design apart from the fixed intensifier list: an intervening word that
  // is not on it means an action, not a claim about the speaker.
  new RegExp(`${EN_I}${EN_GAP}(?:a\\s+|an\\s+)?(?:real\\s+|actual\\s+|live\\s+)?(?:person|human(?:\\s+being)?|lady|woman|man|guy)\\b`, 'i'),
  // "I am not a bot" and every machine word a buyer would use.
  new RegExp(`${EN_I}${EN_GAP}not\\s+${EN_GAP}(?:a\\s+|an\\s+)?(?:bot|robot|ai|a\\.i\\.|chatbot|machine|computer|program|software|algorithm)\\b`, 'i'),
  // "I'm typing this myself", "I am really writing this personally".
  new RegExp(`${EN_I}${EN_GAP}(?:typing|writing)\\s+(?:this|these)\\b`, 'i'),
  // "I assure you I am human" — the claim is the second clause; the first is
  // what makes it worse.
  new RegExp(`\\b(?:assure|promise|swear)\\s+you\\b[^.!?]{0,20}${EN_I}${EN_GAP}(?:a\\s+)?(?:real\\s+)?(?:person|human)\\b`, 'i'),

  // ── English · second person and conversation level ────────────────────────
  // The same lie told about the conversation rather than about herself, which
  // is how it is most often phrased: the subject moves, the claim does not.
  /\byou(?:'re|’re|\s+are)\s+(?:talking|speaking|chatting|texting|dealing|writing)\s+(?:to|with)\s+(?:a\s+|an\s+)?(?:real\s+|actual\s+|live\s+)?(?:person|human(?:\s+being)?)\b/i,
  // "this is a real person", "it's a human speaking", "that's a live person here".
  /\b(?:this|that|it)(?:'s|’s|\s+is)\s+(?:a\s+|an\s+)?(?:real\s+|actual\s+|live\s+)?(?:person|human(?:\s+being)?)\b(?:\s+(?:speaking|typing|writing|here|talking))?/i,
  // "there are no bots here", "no bots here", "nobody automated on this end".
  /\b(?:there(?:'s|’s|\s+are|\s+is)\s+)?no\s+(?:bots?|robots?|ai|chatbots?|machines?)\s+(?:here|on\s+this\s+(?:end|side)|involved|in\s+this\s+chat)\b/i,
  /\bno\s+(?:bots?|robots?|chatbots?)\s+here\b/i,
  // "you're speaking with one of our team members, not a bot" — the denial is
  // the tail, and it is a denial however the head is phrased.
  /\bnot\s+(?:a\s+)?(?:bot|robot|chatbot|machine)\b[^.!?]{0,24}\b(?:here|speaking|talking|promise|really)\b/i,

  // ── Español ───────────────────────────────────────────────────────────────
  // "soy una persona real", "soy humana", "no soy un bot". The subject is in the
  // verb: «soy» is always the speaker, so "una persona de nuestro equipo te
  // responderá" (a handoff offer) carries no «soy» and passes.
  new RegExp(`\\bsoy\\s+${ES_GAP}(?:una?\\s+)?(?:persona|humano|humana|ser\\s+humano|mujer|hombre|chica|chico)(?:\\s+(?:real|de\\s+verdad))?\\b`, 'i'),
  new RegExp(`\\bno\\s+soy\\s+${ES_GAP}(?:una?\\s+)?(?:bot|robot|ia|i\\.a\\.|chatbot|m[aá]quina|programa|computadora|ordenador|inteligencia\\s+artificial)\\b`, 'i'),
  /\b(?:lo\s+)?(?:escribo|estoy\s+escribiendo)\s+(?:esto\s+|este\s+mensaje\s+)?yo\s+mism[oa]\b/i,
  /\b(?:te|le)\s+(?:aseguro|prometo|juro)\s+que\s+soy\s+(?:una?\s+)?(?:persona|humano|humana)\b/i,
  // Said about the conversation: "estás hablando con una persona real".
  /\b(?:est[aá]s|est[aá]|usted\s+est[aá])\s+(?:hablando|chateando|escribiendo)\s+con\s+(?:una?\s+)?(?:persona|humano|ser\s+humano)(?:\s+(?:real|de\s+verdad))?\b/i,
  // "no hay bots aquí" — never "no hay robots en stock": a robot vacuum is a product.
  /\bno\s+hay\s+(?:ning[uú]na?\s+)?(?:bots?|robots?|ia|m[aá]quinas?)\s+(?:aqu[ií]|en\s+este\s+chat|de\s+por\s+medio)\b|\baqu[ií]\s+no\s+hay\s+(?:bots?|robots?|ia|m[aá]quinas?)\b/i,

  // ── Français ──────────────────────────────────────────────────────────────
  // "je suis une vraie personne", "je ne suis pas un robot", "j'suis pas un bot".
  new RegExp(`\\bje\\s+suis\\s+${FR_GAP}(?:une?\\s+)?(?:vraie\\s+)?(?:personne|humaine?|[êe]tre\\s+humain|femme|homme)(?:\\s+(?:r[ée]elle?|en\\s+chair\\s+et\\s+en\\s+os))?\\b`, 'i'),
  new RegExp(`\\bje\\s+ne\\s+suis\\s+${FR_GAP}pas\\s+(?:un\\s+|une\\s+)?(?:bot|robot|ia|i\\.a\\.|chatbot|machine|programme|ordinateur|intelligence\\s+artificielle)\\b`, 'i'),
  /\bj(?:e\s+|['’]\s*)suis\s+pas\s+(?:un\s+|une\s+)?(?:bot|robot|ia|machine|programme)\b/i,
  /\b(?:je\s+vous|je\s+te)\s+(?:assure|promets|jure)\s+que\s+je\s+suis\s+(?:une?\s+)?(?:vraie\s+)?(?:personne|humaine?)\b/i,
  // Said about the conversation: "vous parlez à une vraie personne", "tu parles avec un humain".
  /\b(?:vous\s+(?:parlez|discutez|[ée]changez|[ée]crivez)|tu\s+(?:parles|discutes|[ée]cris))\s+(?:bien\s+)?(?:avec|[àa])\s+(?:une?\s+)?(?:vraie\s+)?(?:personne|humain|[êe]tre\s+humain)(?:\s+r[ée]elle?)?\b/i,
  // "c'est une vraie personne", "c'est un humain qui vous répond" — never
  // "c'est une personne de l'équipe qui vous répondra" (an offer, in the future).
  /\bc['’]est\s+(?:une\s+)?vraie\s+personne\b|\bc['’]est\s+un\s+(?:vrai\s+)?humain\s+qui\s+(?:vous\s+|te\s+)?(?:r[ée]pond|[ée]crit|parle)\b/i,
  /\bil\s+n['’]y\s+a\s+(?:pas|aucun)\s+(?:de\s+)?(?:bots?|robots?|ia)\s+ici\b|\bpas\s+de\s+(?:bots?|robots?)\s+ici\b/i,

  // ── Português (the pt pack, 2026-10-01) ───────────────────────────────────
  // "sou uma pessoa real", "não sou um robô", "você está falando com uma
  // pessoa". «sou» is always the speaker, so "uma pessoa da nossa equipe vai
  // responder" (a hand-off offer) carries none and passes.
  new RegExp(`(?<![a-zçãõáéíóúâêô])sou\\s+${PT_GAP}(?:uma?\\s+)?(?:pessoa|humano|humana|ser\\s+humano|mulher|homem|menina|menino|mo[cç]a|rapaz)(?:\\s+(?:real|de\\s+verdade))?(?![a-zçãõáéíóúâêô])`, 'i'),
  new RegExp(`(?<![a-zçãõáéíóúâêô])n[aã]o\\s+sou\\s+${PT_GAP}(?:uma?\\s+)?(?:bot|rob[oô]|ia|i\\.a\\.|chatbot|m[aá]quina|programa|computador|intelig[eê]ncia\\s+artificial)(?![a-zçãõáéíóúâêô])`, 'i'),
  /(?<![a-zçãõáéíóúâêô])sou\s+eu\s+(?:mesm[oa]\s+)?quem\s+(?:escreve|est[aá]\s+escrevendo|responde)(?![a-zçãõáéíóúâêô])/i,
  /(?<![a-zçãõáéíóúâêô])(?:te|lhe)\s+(?:garanto|prometo|juro)\s+que\s+sou\s+(?:uma?\s+)?(?:pessoa|humano|humana)(?![a-zçãõáéíóúâêô])/i,
  // Said about the conversation: "você está falando com uma pessoa real".
  /(?<![a-zçãõáéíóúâêô])(?:voc[eê]\s+est[aá]|tu\s+est[aá]s)\s+(?:falando|conversando|teclando)\s+com\s+(?:uma?\s+)?(?:pessoa|humano|ser\s+humano)(?:\s+(?:real|de\s+verdade))?(?![a-zçãõáéíóúâêô])/i,
  // "aqui não tem robô" — never "não temos robôs aspiradores em estoque": a robot vacuum is a product.
  /(?<![a-zçãõáéíóúâêô])n[aã]o\s+(?:h[aá]|tem)\s+(?:nenhum[a]?\s+)?(?:bots?|rob[oô]s?|ia|m[aá]quinas?)\s+(?:aqui|neste\s+chat|nesta\s+conversa)(?![a-zçãõáéíóúâêô])|(?<![a-zçãõáéíóúâêô])aqui\s+n[aã]o\s+(?:h[aá]|tem)\s+(?:bots?|rob[oô]s?|ia)(?![a-zçãõáéíóúâêô])/i,

  // ── 中文 ──────────────────────────────────────────────────────────────────
  // No spaces, so these are exact phrases rather than anchored patterns. Each
  // begins with its subject — "我帮您转人工" and "人工客服" carry 人工 and pass.
  new RegExp(`我${ZH_GAP}是${ZH_GAP}真人`),
  new RegExp(`我${ZH_GAP}是(?:真實的人|真实的人)`),
  new RegExp(`我${ZH_GAP}不是${ZH_GAP}(?:机器人|機器人)`),
  new RegExp(`我${ZH_GAP}不是${ZH_GAP}(?:机器|機器)`),
  new RegExp(`我${ZH_GAP}不是${ZH_GAP}(?:AI|人工智能|人工智慧)`, 'i'),
  new RegExp(`我${ZH_GAP}是(?:人类|人類)`),
  new RegExp(`我${ZH_GAP}是活人`),
  // Said about the conversation: "您在和真人说话", "你在跟真人聊天".
  /(?:您|你)(?:正)?在(?:和|跟|与|與)真人(?:说话|說話|對話|对话|聊天|交流)/,
  // "这边是真人", "这里是真人不是机器人", "那是真人".
  /(?:这边|這邊|这里|這裡|这|這|那)(?:是|就是)(?:真人|真實的人|真实的人|人类|人類)/,
  // "没有机器人", "不是机器人在回复" — the conversation-level denial.
  /(?:没有|沒有)(?:机器人|機器人|AI|人工智能)/i,
  /(?:不是|非)(?:机器人|機器人)(?:在)?(?:回复|回覆|聊天|说话|說話)/,

  // ── العربية ───────────────────────────────────────────────────────────────
  // لست = "I am not"; أنا = "I". "شخص من الفريق" (a person from the team)
  // carries شخص and must pass, so every pattern keeps its subject marker.
  new RegExp(`لست\\s+${AR_GAP}(?:روبوت|روبوتا|روبوتًا|آلة|آلي|ذكاء\\s+اصطناعي|برنامج|بوت)`),
  new RegExp(`أنا\\s+${AR_GAP}(?:لست|مش|مو|مب)\\s+(?:روبوت|آلة|ذكاء\\s+اصطناعي|بوت)`),
  new RegExp(`(?:أنا|انا)\\s+${AR_GAP}(?:إنسان|انسان|بشر|شخص\\s+حقيقي|شخص\\s+حقيقى)`),
  // Second person: "أنت تتحدث مع إنسان" — you are speaking with a human.
  /(?:أنت|انت|إنك|انك)\s+(?:تتحدث|تتكلم|تتكلّم|تكلم|تحكي|تراسل)\s+(?:مع|الى|إلى)\s+(?:إنسان|انسان|شخص\s+حقيقي|بشر)/,
  // Conversation level: "لا يوجد روبوت هنا", "ليس روبوتا".
  /(?:لا\s+يوجد|ما\s+في|مافي|ليس\s+هناك)\s+(?:روبوت|بوت|ذكاء\s+اصطناعي)/,
  // "هذا إنسان" — this is a human. NOT `هنا`: "هنا شخص حقيقي سيساعدك" ("there
  // is a real person here who will help you") is a handoff OFFER, and blocking
  // it would be the exact false positive this guard is built around.
  /(?:هذا|هذه)\s+(?:إنسان|انسان|شخص\s+حقيقي)/,

  // ── Arabizi ───────────────────────────────────────────────────────────────
  // Arabic written in Latin script with digits, which is how a great many Gulf
  // and Levantine buyers actually type. "mish/mush/msh/mesh" = not.
  new RegExp(`\\bana\\s+${ARZ_GAP}(?:mish|mush|msh|mesh|mo|mu|mub)\\s+(?:a\\s+)?(?:robot|rob0t|bot|b0t|ai)\\b`, 'i'),
  new RegExp(`\\bana\\s+${ARZ_GAP}(?:insan|insaan|inssan|bashar|bani\\s*adam)\\b`, 'i'),
  new RegExp(`\\bana\\s+${ARZ_GAP}shakh?s\\s+(?:7a2i2i|ha2i2i|hakiki|haqiqi)\\b`, 'i'),
  /\bmo?sh\s+(?:robot|bot)\b.{0,12}\bana\b/i,
  // Second person / conversation level.
  /\b(?:enta|inta|inte|enti|ente|entaa)\s+(?:3am\s+)?(?:btihki|btehki|bthki|btkalem|btetkalam|tihki)\s+ma3\s+(?:insan|insaan|shakhs|bashar)\b/i,
  /\b(?:mafi|ma\s+fi|mafish|ma\s+fish|mako)\s+(?:robot|bot|ai)\b/i,
];

/**
 * DOES THE BUYER'S OWN MESSAGE ASK WHAT THEY ARE TALKING TO?
 *
 * Deliberately narrow, and narrow in one specific way: it requires the buyer to
 * be asking about the INTERLOCUTOR — "are you…", "am I talking to…", "is
 * this…", "你是…吗", "هل أنت…". A message that merely CONTAINS the words is not
 * a question about what is answering it, and this is the exact case the rule
 * must not fire on:
 *
 *     "I need a real person to sign the contract"   → not a question. Passes.
 *     "are you a real person?"                      → a question. Must be answered.
 *
 * Getting that wrong would be worse than having no rule: every conversation
 * about paperwork would start demanding the assistant announce itself, which is
 * precisely the volunteering `prompts/response.txt` forbids.
 */
const IDENTITY_QUESTIONS: readonly RegExp[] = [
  // ── English ───────────────────────────────────────────────────────────────
  // "are you a bot?", "r u human", "are you real?"
  /\b(?:are|r)\s+(?:you|u)\s+(?:a\s+|an\s+)?(?:real\s+|actual\s+|live\s+)?(?:bot|robot|ai|a\.i\.|chatbot|human(?:\s+being)?|person|machine|computer|real)\b/i,
  // "am I talking to a bot / a real person / a human?"
  /\bam\s+i\s+(?:talking|speaking|chatting|texting|dealing|writing)\s+(?:to|with)\s+(?:a\s+|an\s+)?(?:real\s+|actual\s+)?(?:bot|robot|ai|chatbot|human(?:\s+being)?|person|machine)\b/i,
  // "is this a bot?", "is this automated?", "is this a real person?"
  /\bis\s+(?:this|that|it)\s+(?:a\s+|an\s+)?(?:real\s+|actual\s+)?(?:bot|robot|ai|chatbot|human(?:\s+being)?|person|machine|automated|automatic)\b/i,
  // "who am I talking to?" — the same question, asked open.
  /\bwho\s+am\s+i\s+(?:talking|speaking|chatting|dealing)\s+(?:to|with)\b/i,
  // "are you an actual employee", "is there a human there?"
  /\bis\s+there\s+(?:a\s+|an\s+)?(?:real\s+)?(?:human|person)\s+(?:there|here|on\s+the\s+other\s+(?:end|side))\b/i,

  // ── Español ───────────────────────────────────────────────────────────────
  // "¿eres un bot?", "¿es usted humano?", "¿eres real?", "¿estoy hablando con una persona?"
  // Spanish asks without inverting, so "eres una persona muy amable" (a
  // compliment) reads like the question: a question mark says which it is.
  /(?:¿\s*|\b)(?:eres|es\s+usted|sois|son\s+ustedes)\s+(?:una?\s+)?(?:bot|robot|ia|chatbot|humano|humana|persona(?:\s+real)?|m[aá]quina|real|de\s+verdad)\b(?=[^.!\n]{0,24}\?)/i,
  /¿\s*(?:eres|es\s+usted)\s+(?:una?\s+)?(?:bot|robot|ia|chatbot|humano|humana|persona|m[aá]quina|real)\b/i,
  /\bestoy\s+(?:hablando|chateando|escribiendo)\s+con\s+(?:una?\s+)?(?:bot|robot|ia|chatbot|humano|humana|persona|m[aá]quina)\b/i,
  /\b(?:esto|este\s+chat)\s+es\s+(?:una?\s+)?(?:bot|robot|ia|contestador)\b|\b(?:esto|este\s+chat)\s+es\s+autom[aá]tico\s*\?/i,
  /\bcon\s+qui[eé]n\s+(?:hablo|estoy\s+hablando)\b/i,

  // ── Français ──────────────────────────────────────────────────────────────
  // "tu es un bot ?", "êtes-vous humain ?", "je parle à un robot ?", "à qui je parle ?"
  // Inverted ("es-tu", "êtes-vous") is a question; plain ("tu es") only with its question mark.
  // `\b` knows only ASCII letters, so a sentence that starts with «Ê» or «À» needs its own edge.
  /(?<![A-Za-zÀ-ÿ])(?:es[-\s]tu|[êe]tes[-\s]vous)\s+(?:une?\s+)?(?:bot|robot|ia|chatbot|humaine?|vraie\s+personne|personne\s+r[ée]elle|machine|r[ée]el(?:le)?)\b/i,
  /\b(?:tu\s+es|vous\s+[êe]tes)\s+(?:une?\s+)?(?:bot|robot|ia|chatbot|humaine?|vraie\s+personne|personne\s+r[ée]elle|machine|r[ée]el(?:le)?)\b(?=[^.!\n]{0,24}\?)/i,
  /\b(?:je\s+parle|je\s+discute|je\s+suis\s+en\s+train\s+de\s+parler)\s+(?:[àa]|avec)\s+(?:une?\s+)?(?:bot|robot|ia|chatbot|humain|vraie\s+personne|machine)\b/i,
  /\best[-\s]ce\s+(?:que\s+c['’]est\s+)?(?:un\s+)?(?:bot|robot|une\s+ia|un\s+humain|une\s+vraie\s+personne|automatique)\b/i,
  /(?<![A-Za-zÀ-ÿ])[àa]\s+qui\s+(?:je\s+parle|est[-\s]ce\s+que\s+je\s+parle|ai[-\s]je\s+affaire)\b/i,

  // ── Português ─────────────────────────────────────────────────────────────
  // "você é um robô?", "é uma pessoa real?", "estou falando com um bot?", "com quem eu falo?"
  // Portuguese asks without inverting, so "você é muito simpática" (a
  // compliment) reads like the question: the question mark says which it is.
  /(?<![a-zçãõáéíóúâêô])(?:voc[eê]\s+[eé]|vc\s+[eé]|tu\s+[eé]s|[eé]\s+voc[eê]|voc[eê]s\s+s[aã]o)\s+(?:uma?\s+)?(?:bot|rob[oô]|ia|chatbot|humano|humana|pessoa(?:\s+real)?|m[aá]quina|real|de\s+verdade)(?![a-zçãõáéíóúâêô])(?=[^.!\n]{0,24}\?)/i,
  /(?<![a-zçãõáéíóúâêô])estou\s+(?:falando|conversando|teclando)\s+com\s+(?:uma?\s+)?(?:bot|rob[oô]|ia|chatbot|humano|humana|pessoa|m[aá]quina)(?![a-zçãõáéíóúâêô])/i,
  // With the subject dropped, as Brazil asks: "é uma pessoa real?", "é um robô?" — never "é real?" (the leather).
  /(?:^|[.!?]\s*)[eé]\s+(?:uma?\s+)?(?:bot|rob[oô]|ia|chatbot|humano|humana|pessoa(?:\s+real)?|m[aá]quina)(?![a-zçãõáéíóúâêô])(?=[^.!\n]{0,24}\?)/i,
  /(?<![a-zçãõáéíóúâêô])(?:isto|isso|este\s+chat|esse\s+chat)\s+[eé]\s+(?:uma?\s+)?(?:bot|rob[oô]|ia|resposta\s+autom[aá]tica)(?![a-zçãõáéíóúâêô])|(?<![a-zçãõáéíóúâêô])(?:isto|isso|este\s+chat)\s+[eé]\s+autom[aá]tico\s*\?/i,
  /(?<![a-zçãõáéíóúâêô])com\s+quem\s+(?:eu\s+)?(?:falo|estou\s+falando)(?![a-zçãõáéíóúâêô])/i,

  // ── 中文 ──────────────────────────────────────────────────────────────────
  // "你是机器人吗？", "您是不是真人", "你是AI吗"
  /(?:你|您)(?:是|係)(?:不是)?(?:机器人|機器人|真人|人工智能|人工智慧|AI|机器|機器|真的人|人类|人類)/i,
  // "这是机器人吗", "这边是真人吗" — never "这是真人秀同款" (a reality show's
  // line) or 真人模特 / 真人照片 (real models, real photos): a product, not a question
  // about who is answering (2026-09-28).
  /(?:这|這|那)(?:边|邊|里|裡)?(?:是|係)(?:不是)?(?:机器人|機器人|真人(?!秀|模特|照|版|款|尺寸)|AI|人工智能|自动回复|自動回覆)/i,
  // "我在跟机器人说话吗"
  /我(?:是不是|在)(?:和|跟|与|與)(?:机器人|機器人|AI|真人|人工智能)(?:说话|說話|聊天|对话|對話)/i,

  // ── العربية ───────────────────────────────────────────────────────────────
  // "هل أنت روبوت؟", "أنت روبوت؟", "هل أتحدث مع إنسان؟"
  /(?:هل\s+)?(?:أنت|انت|إنت)\s+(?:روبوت|بوت|إنسان|انسان|بشر|ذكاء\s+اصطناعي|آلة|حقيقي|حقيقية)\s*[؟?]?/,
  /هل\s+(?:أتحدث|اتحدث|أتكلم|اتكلم|أراسل|اراسل)\s+(?:مع|الى|إلى)\s+(?:إنسان|انسان|روبوت|بوت|شخص\s+حقيقي|آلة)/,
  /هل\s+(?:هذا|هذه)\s+(?:رد\s+)?(?:آلي|تلقائي|روبوت|بوت)/,

  // ── Arabizi ───────────────────────────────────────────────────────────────
  // "enta robot wala shakhs 7a2i2i?", "inta bot?"
  /\b(?:hal\s+|hl\s+)?(?:enta|inta|inte|enti|ente|entaa)\s+(?:robot|rob0t|bot|b0t|ai|insan|insaan|bashar|shakhs)\b/i,
  // "ana bahki ma3 robot?"
  /\b(?:ana\s+)?(?:bahki|bihki|bahke|batkalam|btkalem|btihki|atkalam)\s+ma3\s+(?:robot|bot|ai|insan|insaan|shakhs|bashar)\b/i,
];

/**
 * DOES THE REPLY SAY WHAT IT IS?
 *
 * Only reached when the buyer asked, and only after the denial list has run —
 * so "I'm not a bot" is never here to be mistaken for an acknowledgment.
 *
 * 人工 IS NOT ON THIS LIST AND MUST NOT BE. "转人工" is how Chinese says
 * "put me through to a human agent"; it is the handoff this whole rule exists
 * to produce. Only 人工智能 / 人工智慧 — the full word for the machine — counts.
 */
const ACKNOWLEDGMENTS: readonly RegExp[] = [
  // "a.i." with its dots only: bare "ai" is French «j'ai»; "AI" is its own line below.
  /\b(?:a\.\s?i\.?|artificial\s+intelligence|chat\s?bot|bot|robot|automated|virtual\s+assistant|digital\s+assistant|computer\s+program|software|machine)\b/i,
  // "I am not a human" — an acknowledgment by the other door.
  /\bi(?:'m|’m|\s+am)\s+not\s+(?:a\s+)?(?:human(?:\s+being)?|person|real\s+person)\b/i,
  // T2 — "AI" as the word, in capitals: it was matched case-blind anywhere,
  // so "details", "email", "available" (and French "j'ai", "taille") read as
  // an admission, and a reply that dodged "are you a bot?" went out.
  /\bAI\b/,
  /(?:人工智能|人工智慧|智能助手|机器人|機器人|自动回复|自動回覆)/,
  /我不是(?:真人|人类|人類)/,
  /(?:ذكاء\s+اصطناعي|مساعد\s+ذكي|مساعدة\s+ذكية|روبوت|بوت|آلي)/,
  /لست\s+(?:إنسان|انسان|بشر)/,
  // Spanish and French: "asistente de IA", "l'IA de …", "no soy una persona".
  /\bIA\b/,
  /\b(?:inteligencia\s+artificial|intelligence\s+artificielle|asistente\s+virtual|assistant\s+virtuel|autom[aá]tic[oa]|automatique)\b/i,
  /\bno\s+soy\s+(?:una?\s+)?(?:persona|humano|humana)\b|\bje\s+ne\s+suis\s+pas\s+(?:une?\s+)?(?:personne|humaine?)\b/i,
  // Portuguese: "assistente de IA" (the \bIA\b above), "inteligência artificial", "não sou uma pessoa".
  /(?<![a-zçãõáéíóúâêô])(?:intelig[eê]ncia\s+artificial|resposta\s+autom[aá]tica)(?![a-zçãõáéíóúâêô])|(?<![a-zçãõáéíóúâêô])n[aã]o\s+sou\s+(?:uma?\s+)?(?:pessoa|humano|humana)(?![a-zçãõáéíóúâêô])/i,
];

/** The first denial in this reply, or null. */
export function findDenial(reply: string): string | null {
  for (const re of DENIALS) {
    const m = re.exec(reply);
    if (m) return m[0];
  }
  return null;
}

/** Whether this buyer message asks what they are talking to. */
export function asksAboutBeingAi(buyerText: string): string | null {
  for (const re of IDENTITY_QUESTIONS) {
    const m = re.exec(buyerText);
    if (m) return m[0];
  }
  return null;
}

/** Whether this reply says, in any language or phrasing on the list, that it is one. */
export function acknowledgesAi(reply: string): boolean {
  return ACKNOWLEDGMENTS.some((re) => re.test(reply));
}

/**
 * The guard, shaped exactly like `guardForbidden`: Result, never a side effect.
 *
 * `buyerText` is the buyer's latest inbound message. It is optional only so
 * that callers with no conversation in hand — a unit test of the phrase list,
 * the runtime trust strip on a free-form reply — can ask the first question
 * without inventing an answer to the second.
 */
export function guardIdentity(input: { reply: string; buyerText?: string | undefined }): Result<string, IdentityViolation> {
  const hit = findDenial(input.reply);
  if (hit !== null) return err({ kind: 'denied_being_ai', phrase: hit });

  const asked = input.buyerText === undefined ? null : asksAboutBeingAi(input.buyerText);
  if (asked !== null && !acknowledgesAi(input.reply)) {
    return err({ kind: 'identity_question_unanswered', phrase: asked });
  }
  return ok(input.reply);
}
