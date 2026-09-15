import { describe, it, expect } from 'vitest';
import { mediaPortsFor, type MediaSource } from '../../src/worker/mediaPorts.js';
import { metaAudioFetcher, metaMediaFetcher } from '../../src/channels/whatsapp/meta.js';
import { whatsappAudioFetcher, whatsappMediaFetcher } from '../../src/channels/whatsapp/media.js';
import { whatsappSimulator, SIM_MEDIA_BASE } from '../../src/channels/whatsapp/simulator.js';
import { decideHearing } from '../../src/core/conversation/hearing.js';
import { validateEnv } from '../../src/main.js';

/**
 * G2b — she can hear and see in PRODUCTION, not only in her tests.
 *
 * M34 and M4.5 each built a complete, tested path, and the worker was handed
 * none of what either needed: `startWorker` took four optional strings that
 * neither entrypoint passed. So these tests are about the BUILDING of the
 * ports from the configuration production actually has. The dispatch inside
 * the worker is pinned separately (m34-hearing, m45-image-wired, batching)
 * and was never the part that was broken.
 */

const META: MediaSource = {
  provider: 'meta',
  META_WHATSAPP_ACCESS_TOKEN: 'meta-token-not-real-shape-ok',
  META_WHATSAPP_PHONE_NUMBER_ID: '123456789012345',
  META_APP_SECRET: 'meta-app-secret-not-real',
  META_GRAPH_API_VERSION: 'v23.0',
};

describe('G2b · the ports come from the provider she already configured', () => {
  it('Meta: both fetchers exist, from the same token the adapter sends with', () => {
    const p = mediaPortsFor(META);
    expect(typeof p.audio).toBe('function');
    expect(typeof p.image).toBe('function');
  });

  it('360dialog: both fetchers exist, from the D360 base URL and key', () => {
    const p = mediaPortsFor({
      provider: '360dialog', META_GRAPH_API_VERSION: 'v23.0',
      D360_BASE_URL: 'https://waba.360dialog.io', D360_API_KEY: 'd360-key-not-real',
    });
    expect(typeof p.audio).toBe('function');
    expect(typeof p.image).toBe('function');
  });

  it('disabled: no fetchers — no webhook is mounted, so no media can arrive', () => {
    const p = mediaPortsFor({ provider: 'disabled', META_GRAPH_API_VERSION: 'v23.0' });
    expect(p.audio).toBeUndefined();
    expect(p.image).toBeUndefined();
  });

  it('the transcriber is the ONE separate account: present exactly when its key is', () => {
    expect(mediaPortsFor(META).transcriber).toBeUndefined();
    expect(typeof mediaPortsFor({ ...META, TRANSCRIBE_API_KEY: 'sk-transcribe-not-a-real-key' }).transcriber)
      .toBe('function');
  });
});

describe('G2b · Meta voice notes need an AUDIO fetcher', () => {
  /** A scripted Graph API: the media id resolves to a URL, the URL to bytes. */
  const graph = (mime: string) => {
    const seen: { url: string; auth: string | undefined }[] = [];
    const fetchImpl = async (url: string, init: { headers: Record<string, string> }) => {
      seen.push({ url, auth: init.headers['Authorization'] });
      if (url === 'https://graph.facebook.com/v23.0/media-1') {
        return { status: 200, text: async () => JSON.stringify({ url: 'https://lookaside.example/bytes?id=1', mime_type: mime }) };
      }
      return { status: 200, text: async () => '', arrayBuffer: async () => new TextEncoder().encode('ogg').buffer as ArrayBuffer };
    };
    return { seen, fetchImpl: fetchImpl as never };
  };

  it('fetches a voice note from the Graph root with the Bearer token on both hops', async () => {
    const g = graph('audio/ogg; codecs=opus');
    const r = await metaAudioFetcher({ ...toMeta(), fetchImpl: g.fetchImpl })('media-1');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.mediaType).toBe('audio/ogg');
    expect(g.seen[0]!.url).toBe('https://graph.facebook.com/v23.0/media-1');
    expect(g.seen.every((s) => s.auth === 'Bearer meta-token-not-real-shape-ok')).toBe(true);
  });

  it('and the IMAGE fetcher would have refused it — which is why there are two', async () => {
    const g = graph('audio/ogg; codecs=opus');
    const r = await metaMediaFetcher({ ...toMeta(), fetchImpl: g.fetchImpl })('media-1');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.retryable).toBe(false);
  });
});

describe('G2b · the simulator is a provider media endpoint', () => {
  it('serves the voice notes and photos it sent, through the real fetchers', async () => {
    const sim = whatsappSimulator([], { tag: 'g2b' });
    const note = sim.inboundAudio();
    const photo = sim.inboundImage({ caption: null });
    const idOf = (w: { payload: unknown }, kind: 'audio' | 'image') =>
      String(((w.payload as { entry: { changes: { value: { messages: Record<string, { id: string }>[] } }[] }[] })
        .entry[0]!.changes[0]!.value.messages[0]![kind]!).id);

    const cfg = { baseUrl: SIM_MEDIA_BASE, apiKey: 'sim', fetchImpl: sim.mediaFetch };
    const heard = await whatsappAudioFetcher(cfg)(idOf(note, 'audio'));
    expect(heard.ok).toBe(true);
    const seen = await whatsappMediaFetcher(cfg)(idOf(photo, 'image'));
    expect(seen.ok).toBe(true);
  });

  it('an id it never issued is gone, the way an expired WhatsApp media id is', async () => {
    const sim = whatsappSimulator([], { tag: 'g2b-gone' });
    const r = await whatsappAudioFetcher({ baseUrl: SIM_MEDIA_BASE, apiKey: 'sim', fetchImpl: sim.mediaFetch })('never-issued');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.retryable).toBe(false);
  });
});

describe('G2b · the language she heard, in the code the product reads', () => {
  const heard = (language: string | null) => decideHearing({
    transcriberConfigured: true, mediaId: 'm1', fetch: { ok: true, retryable: false, error: '' },
    transcript: { ok: true, text: 'hello', language },
  });

  it('a language NAME from the provider becomes its code', () => {
    // Whisper reports "arabic", "chinese". The proof page took the first two
    // letters, so every Chinese buyer was shown English ("ch").
    expect(heard('arabic')).toMatchObject({ language: 'ar' });
    expect(heard('Chinese')).toMatchObject({ language: 'zh' });
    expect(heard('english')).toMatchObject({ language: 'en' });
  });

  it('a code passes through; an unknown name is kept rather than guessed; none stays none', () => {
    expect(heard('en')).toMatchObject({ language: 'en' });
    expect(heard('klingon')).toMatchObject({ language: 'klingon' });
    expect(heard(null)).toMatchObject({ language: null });
  });
});

describe('G2b · the transcription key is checked at boot when it is set', () => {
  const base = {
    WHATSAPP_PROVIDER: 'disabled',
    DATABASE_URL: 'postgres://u:p@h/db',
    ANTHROPIC_API_KEY: 'sk-ant-not-a-real-key-but-long-enough',
    WEBHOOK_VERIFY_TOKEN: 'verify-token-of-length',
    CREDENTIAL_KEY: 'a'.repeat(64),
  };

  it('absent is a real state: boot succeeds and she refuses voice notes honestly', () => {
    const v = validateEnv(base);
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.cfg.TRANSCRIBE_API_KEY).toBeUndefined();
  });

  it('present and well-formed, it reaches the config the worker is built from', () => {
    const v = validateEnv({ ...base, TRANSCRIBE_API_KEY: 'sk-transcribe-not-a-real-key', TRANSCRIBE_BASE_URL: 'https://api.example.com/v1' });
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.cfg.TRANSCRIBE_API_KEY).toBe('sk-transcribe-not-a-real-key');
      expect(v.cfg.TRANSCRIBE_BASE_URL).toBe('https://api.example.com/v1');
    }
  });

  it('malformed fails at boot, naming the variable and never its value', () => {
    const v = validateEnv({ ...base, TRANSCRIBE_API_KEY: 'short', TRANSCRIBE_BASE_URL: 'http://plain.example' });
    expect(v.ok).toBe(false);
    if (!v.ok) {
      expect(v.problems).toContain('TRANSCRIBE_API_KEY: invalid shape');
      expect(v.problems).toContain('TRANSCRIBE_BASE_URL: invalid shape');
      expect(v.problems.join(' ')).not.toContain('short');
    }
  });
});

function toMeta() {
  return {
    accessToken: META.META_WHATSAPP_ACCESS_TOKEN!,
    phoneNumberId: META.META_WHATSAPP_PHONE_NUMBER_ID!,
    appSecret: META.META_APP_SECRET!,
    graphVersion: META.META_GRAPH_API_VERSION,
  };
}
