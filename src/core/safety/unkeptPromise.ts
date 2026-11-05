import { normalizeForDeletion } from './deletion.js';

/**
 * NO PROMISE THE CODE DOES NOT KEEP (the owner, 2026-11-05). A written reply said "I'll hand this conversation over"
 * or "the team will check" and nothing did: the customer waited on a check nobody was asked to make. The assistant
 * speaks in the first person, and says what it does not know. A real hand-off has its own fixed sentence and never
 * passes here (`HANDOFF_REPLIES`), and neither does the disclosure, which is added after the writer.
 *
 * `prompts/response.txt` tells the writer; this is the same rule where it cannot be talked out of. A reply it catches
 * is written again, and a second miss is held for the owner, like the other guards. The writer cannot know whether its
 * words will wait for the owner or go alone, so the rule is the same for both.
 *
 * WHAT IS CAUGHT — in six languages: the assistant promising to check, ask, pass on or come back ("I'll check", 我会核实,
 * «سأتحقق»), and the team named as the one who will or can act ("someone from the team", 同事可以接手, «شخص من الفريق»).
 * WHAT IS NOT: the customer's own team, "let me know", a question ("Shall I check?"), what the business's team made.
 * A new phrasing goes into tests/parity/unkept-promise.test.ts with its reason, never into the patterns alone.
 */
const PATTERNS: readonly RegExp[] = [
  // en
  /\b(?:i'?ll|i will|i'?m going to|i can|i could|let me|we'?ll|we will|we can)\s+(?:just\s+|also\s+|quickly\s+|then\s+)?(?:check|verify|find out|look into|ask|hand|pass|transfer|forward|escalate|get back|come back|follow up)\b/,
  /\b(?:handing|passing|transferring|forwarding|escalating)\s+(?:this|it|you|your|the\s+(?:conversation|chat|question|request))\b/,
  /\bi'?ve\s+(?:passed|handed|forwarded|escalated)\b/,
  /\b(?:someone|somebody|a person|a member|a colleague|one)\s+(?:from|of|on)\s+(?:our|the|my)\s+team\b/,
  /\b(?:our|the|my)\s+team\s+(?:will|can|could|would|is going to|is able to|may)\b/,
  /\b(?:a|my)\s+colleague\s+(?:will|can|could|would|may)\b/,
  // zh
  /我(?:会|来|去|可以|将|先|再)?(?:帮您|为您|替您|给您)?(?:请|让)?(?:团队|同事)?(?:核实|查询|查一下|查看一下|确认一下|询问|问问|问一下|转交|转接|转给|反馈|回复您)/,
  /(?:团队|同事|工作人员|业务员|客服)[^。！？]{0,12}(?:可以|会|能|将)[^。！？]{0,8}(?:接手|回复|联系|核实|确认|跟进|处理|为您)/,
  /(?:转交|转接)给/,
  // ar (normalised: no hamza on alef, no harakat)
  /(?:^|\s)و?سا(?:تحقق|تاكد|حول|سال|راجع|عود|رد عليك|تواصل)/,
  /سيتم\s+(?:تحويل|التحقق|مراجعه|الرد|التواصل)/,
  /(?:شخص|احد|موظف|زميل)\s+من\s+(?:ال)?فريق/,
  /(?:الفريق|فريقنا|فريق\s+\S+)\s+(?:سي|يمكنه|يستطيع)/,
  // es
  /\b(?:voy a|puedo|podría)\s+(?:consultar|verificar|comprobar|revisar|averiguar|preguntar|pasar|transferir|derivar)\b/,
  /\b(?:consultaré|verificaré|comprobaré|revisaré|averiguaré|preguntaré|transferiré|derivaré|te responderé|le responderé|te contactaré|le contactaré)\b/,
  /\b(?:alguien|una persona|un miembro|un compañero|una compañera)\s+de(?:l)?\s+(?:nuestro\s+)?equipo\b/,
  /\b(?:nuestro|el)\s+equipo\s+(?:puede|podrá|podría|va a|te|le|responderá|revisará|confirmará|se pondrá)\b/,
  // fr
  /\bje\s+(?:vais|peux|pourrais)\s+(?:vérifier|demander|regarder|me renseigner|transmettre|transférer)\b/,
  /\bje\s+(?:vérifierai|demanderai|transmettrai|transfère|transmets|lui transmets|reviendrai|vous recontacterai)\b/,
  /\b(?:quelqu'un|une personne|un membre|un collègue|une collègue)\s+de\s+(?:notre\s+|l')\s*équipe\b/,
  /\b(?:notre|l')\s*équipe\s+(?:peut|pourra|pourrait|va|vous|répondra|vérifiera|confirmera)\b/,
  // pt
  /\b(?:vou|posso|poderia)\s+(?:verificar|consultar|checar|perguntar|passar|transferir|encaminhar)\b/,
  /\b(?:verificarei|consultarei|perguntarei|transferirei|encaminharei|retornarei)\b/,
  /\b(?:alguém|uma pessoa|um membro|um colega|uma colega)\s+da\s+(?:nossa\s+)?equipe\b/,
  /\b(?:nossa|a)\s+equipe\s+(?:pode|poderá|poderia|vai|irá|responderá|confirmará|entrará)\b/,
];

/** The words of a promise nothing keeps, or null. A sentence that asks is no promise. */
export function promisesWhatNothingKeeps(reply: string): string | null {
  const sentences = normalizeForDeletion(reply).split(/(?<=[.!?。！？؟\n])\s*/u);
  for (const sentence of sentences) {
    if (/[?？؟]\s*$/u.test(sentence)) continue;
    for (const p of PATTERNS) {
      const m = p.exec(sentence);
      if (m) return m[0].trim().slice(0, 60);
    }
  }
  return null;
}
