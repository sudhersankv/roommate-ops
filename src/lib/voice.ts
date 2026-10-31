// Voice note -> transcript, through the Neon AI Gateway (no Whisper endpoint there, so an audio-capable chat model,
// Gemini, transcribes it). The audio goes as an `audio_url` data URL, the part type the gateway accepts. Feed the
// result through the normal text path. No third party besides the gateway.

export const DEFAULT_STT_MODEL = "gemini-3-5-flash";

/** The gateway model to use: STT_MODEL, unless it's an old OpenRouter-style id ("google/gemini-2.5-flash"). */
export function sttModel(env = process.env.STT_MODEL): string {
  return env && !env.includes("/") ? env : DEFAULT_STT_MODEL;
}

/** Voice notes can be heard when the gateway is configured. */
export const voiceAvailable = () => !!process.env.NEON_AI_GATEWAY_BASE_URL && !!process.env.NEON_AI_GATEWAY_TOKEN;

export const TRANSCRIBE_PROMPT =
  "Transcribe this voice note verbatim. Reply with only the transcript, no quotes, no commentary. If it's empty or unintelligible reply with an empty string.";

export type AudioFormat = "ogg" | "mp3" | "wav" | "m4a" | "aac" | "flac";

const MIME: Record<AudioFormat, string> = { ogg: "audio/ogg", mp3: "audio/mpeg", wav: "audio/wav", m4a: "audio/mp4", aac: "audio/aac", flac: "audio/flac" };

/** Map a MIME type (or file extension-ish string) to an audio format. Chat-app voice notes are usually ogg/opus. */
export function formatFromMime(mime?: string | null): AudioFormat {
  const m = (mime ?? "").toLowerCase().split(";")[0].trim();
  if (!m) return "ogg";
  if (m.includes("ogg") || m.includes("opus")) return "ogg";
  if (m.includes("mpeg") || m.includes("mp3")) return "mp3";
  if (m.includes("wav")) return "wav";
  if (m.includes("mp4") || m.includes("m4a")) return "m4a";
  if (m.includes("aac")) return "aac";
  if (m.includes("flac")) return "flac";
  return "ogg";
}

type ContentPart = { type: "text" | "audio_url"; text?: string; audio_url?: { url: string } };

/** The chat-completions body for a transcription request. Pure; tested in voice.test.ts. No temperature (some gateway models reject it). */
export function buildTranscriptionRequest(base64: string, format: AudioFormat, model = DEFAULT_STT_MODEL) {
  return {
    model,
    // Gemini reasons before it answers; leave room for the transcript after that.
    max_tokens: 2000,
    messages: [
      {
        role: "user" as const,
        content: [
          { type: "text", text: TRANSCRIBE_PROMPT },
          { type: "audio_url", audio_url: { url: `data:${MIME[format]};base64,${base64}` } },
        ] as ContentPart[],
      },
    ],
  };
}

/** Trim and strip one layer of wrapping quotes (models love to quote transcripts). */
export function cleanTranscript(raw: string | null | undefined): string {
  let t = (raw ?? "").trim();
  const pairs: [string, string][] = [
    ['"', '"'],
    ["'", "'"],
    ["“", "”"],
    ["‘", "’"],
    ["«", "»"],
  ];
  for (const [open, close] of pairs) {
    if (t.length >= 2 && t.startsWith(open) && t.endsWith(close)) {
      t = t.slice(open.length, t.length - close.length).trim();
      break;
    }
  }
  return t;
}

type ChatResponse = { choices?: { message?: { content?: string | { type?: string; text?: string }[] } }[] };

function contentText(c: ChatResponse["choices"]): string {
  const content = c?.[0]?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((p) => p?.text ?? "").join("");
  return "";
}

export async function transcribe(audio: ArrayBuffer, opts: { mime?: string; filename?: string } = {}): Promise<string> {
  const base = (process.env.NEON_AI_GATEWAY_BASE_URL ?? "").replace(/\/+$/, "");
  const token = process.env.NEON_AI_GATEWAY_TOKEN;
  if (!base || !token) throw new Error("The AI Gateway isn't configured, so voice notes can't be transcribed.");
  const format = formatFromMime(opts.mime ?? (opts.filename?.match(/\.(\w+)$/)?.[1] ?? null));
  const body = buildTranscriptionRequest(Buffer.from(audio).toString("base64"), format, sttModel());
  const res = await fetch(`${base}/v1/chat/completions`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) {
    const snippet = (await res.text().catch(() => "")).slice(0, 300);
    throw new Error(`transcription failed: gateway ${res.status} ${snippet}`);
  }
  const json = (await res.json()) as ChatResponse & { error?: { message?: string } };
  if (json.error) throw new Error(`transcription failed: gateway error ${json.error.message ?? JSON.stringify(json.error)}`);
  return cleanTranscript(contentText(json.choices));
}
