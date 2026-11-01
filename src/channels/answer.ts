// How an adapter sends the pipeline's answer to a message (#77): the reaction on that message first, when there is
// one and the Channel can react, then the text. A reaction that can't be made (no message id, no react on the
// Channel, the Channel refused it) goes out as its emoji, as text, but only when there's no text to send anyway.
import type { Outgoing } from "./types";

export type AnswerTarget = {
  /** React on the answered message; absent when the Channel or the message can't take one. */
  react?: (emoji: string) => Promise<void>;
  /** Send a message where the answered one came from. */
  send: (out: Outgoing) => Promise<unknown>;
};

export async function sendAnswer(out: Outgoing, to: AnswerTarget): Promise<void> {
  const { react, ...rest } = out;
  let text = rest.text;
  if (react) {
    let reacted = false;
    if (to.react) {
      try {
        await to.react(react);
        reacted = true;
      } catch (err) {
        console.warn(`[channels] couldn't react ${react}; sending it as text instead`, err instanceof Error ? err.message : err);
      }
    }
    if (!reacted && !text.trim()) text = react;
  }
  if (text.trim() || rest.poll || rest.buttons?.length) await to.send({ ...rest, text });
}
