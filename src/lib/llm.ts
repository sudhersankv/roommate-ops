// Neon AI Gateway via Mastra's model router: "neon/<id>" reads NEON_AI_GATEWAY_BASE_URL + NEON_AI_GATEWAY_TOKEN.
// Model ids must be in the branch catalog: curl "$NEON_AI_GATEWAY_BASE_URL/v1/models" -H "Authorization: Bearer $NEON_AI_GATEWAY_TOKEN"
import "./env";
import { ModelRouterEmbeddingModel } from "@mastra/core/llm";

/** The agent (and recipes later). */
export const model = `neon/${process.env.LLM_MODEL ?? "claude-sonnet-5-5"}` as const;
/** Background jobs and judges: Group style, scorers. */
export const smallModel = `neon/${process.env.SMALL_MODEL ?? "claude-haiku-5-5"}` as const;

export const EMBED_MODEL = process.env.EMBED_MODEL ?? "qwen3-embedding-0-6b";
/** qwen3-embedding-0-6b returns 1024 dims. Change together with EMBED_MODEL (the vector index name depends on it). */
export const EMBED_DIM = Number(process.env.EMBED_DIM ?? 1024);

/**
 * Semantic-recall embedder on the gateway's OpenAI-compatible /v1/embeddings. The router has no built-in "neon"
 * embedding entry, so the URL and token are passed explicitly.
 */
export function gatewayEmbedder() {
  const base = (process.env.NEON_AI_GATEWAY_BASE_URL ?? "").replace(/\/+$/, "");
  return new ModelRouterEmbeddingModel({ providerId: "neon", modelId: EMBED_MODEL, url: `${base}/v1`, apiKey: process.env.NEON_AI_GATEWAY_TOKEN ?? "" });
}
