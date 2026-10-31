// Pure helpers only; no network. Run: npx tsx --test src/lib/voice.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTranscriptionRequest, cleanTranscript, DEFAULT_STT_MODEL, formatFromMime, sttModel, TRANSCRIBE_PROMPT } from "./voice";

test("formatFromMime: voice notes (ogg/opus) -> ogg, and the default is ogg", () => {
  assert.equal(formatFromMime("audio/ogg"), "ogg");
  assert.equal(formatFromMime("audio/ogg; codecs=opus"), "ogg");
  assert.equal(formatFromMime("audio/opus"), "ogg");
  assert.equal(formatFromMime(undefined), "ogg");
  assert.equal(formatFromMime(""), "ogg");
  assert.equal(formatFromMime("application/octet-stream"), "ogg");
});

test("formatFromMime: common types", () => {
  assert.equal(formatFromMime("audio/mpeg"), "mp3");
  assert.equal(formatFromMime("audio/mp3"), "mp3");
  assert.equal(formatFromMime("audio/wav"), "wav");
  assert.equal(formatFromMime("audio/x-wav"), "wav");
  assert.equal(formatFromMime("audio/mp4"), "m4a");
  assert.equal(formatFromMime("audio/m4a"), "m4a");
  assert.equal(formatFromMime("audio/x-m4a"), "m4a");
  assert.equal(formatFromMime("AUDIO/WAV"), "wav");
});

test("buildTranscriptionRequest: the Neon AI Gateway's audio_url shape (a data URL), Gemini by default, room to think", () => {
  const req = buildTranscriptionRequest("QUJD", "ogg");
  assert.equal(req.model, DEFAULT_STT_MODEL);
  assert.equal(DEFAULT_STT_MODEL, "gemini-3-5-flash");
  assert.ok(req.max_tokens >= 1000, "Gemini spends tokens reasoning before the transcript");
  assert.equal("temperature" in req, false);
  assert.equal(req.messages.length, 1);
  assert.equal(req.messages[0].role, "user");
  const [text, audio] = req.messages[0].content;
  assert.deepEqual(text, { type: "text", text: TRANSCRIBE_PROMPT });
  assert.deepEqual(audio, { type: "audio_url", audio_url: { url: "data:audio/ogg;base64,QUJD" } });
  assert.match(TRANSCRIBE_PROMPT, /verbatim/i);
});

test("sttModel: an OpenRouter-style id (an old STT_MODEL secret) falls back to the gateway's Gemini", () => {
  assert.equal(sttModel(undefined), "gemini-3-5-flash");
  assert.equal(sttModel("google/gemini-2.5-flash"), "gemini-3-5-flash");
  assert.equal(sttModel("gemini-3-7-flash"), "gemini-3-7-flash");
});

test("buildTranscriptionRequest: explicit model and format are passed through", () => {
  const req = buildTranscriptionRequest("AAAA", "wav", "gemini-3-5-flash-lite");
  assert.equal(req.model, "gemini-3-5-flash-lite");
  assert.equal(req.messages[0].content[1].audio_url?.url, "data:audio/wav;base64,AAAA");
  assert.equal(JSON.parse(JSON.stringify(req)).messages[0].content[1].audio_url.url, "data:audio/wav;base64,AAAA", "serialises cleanly");
});

test("cleanTranscript: trims and strips one layer of wrapping quotes", () => {
  assert.equal(cleanTranscript('  "Roomie, add milk to the cart"  \n'), "Roomie, add milk to the cart");
  assert.equal(cleanTranscript("“check the work order”"), "check the work order");
  assert.equal(cleanTranscript("'hi'"), "hi");
  assert.equal(cleanTranscript('she said "hi" to me'), 'she said "hi" to me', "inner quotes are kept");
  assert.equal(cleanTranscript('"'), '"', "a lone quote is not a wrapped string");
  assert.equal(cleanTranscript(""), "");
  assert.equal(cleanTranscript(undefined), "");
});
