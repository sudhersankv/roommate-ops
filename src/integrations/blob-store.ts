// Where Documents' bytes live (ADR 0018), behind one interface in the Splitwise / Instacart pattern. NeonObjectStorage
// speaks the S3 API of Neon Object Storage (a bucket that branches with the database) with fetch and AWS SigV4,
// path-style, no SDK. MemoryBlobStore stands in for tests, evals and dev without storage env (BLOB_FAKE=1, or the
// endpoint / bucket / keys missing); production without them refuses unless BLOB_FAKE=1. Keys are
// "g/<groupId>/<documentId>" (services/documents.ts).
import { createHash, createHmac } from "node:crypto";

export type StoredBlob = { bytes: Buffer; contentType: string };

export interface BlobStore {
  readonly kind: "neon" | "memory";
  put(key: string, bytes: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<StoredBlob | null>;
  delete(key: string): Promise<void>;
}

export class MemoryBlobStore implements BlobStore {
  readonly kind = "memory";
  readonly blobs = new Map<string, StoredBlob>();
  async put(key: string, bytes: Buffer, contentType: string) {
    this.blobs.set(key, { bytes: Buffer.from(bytes), contentType });
  }
  async get(key: string) {
    return this.blobs.get(key) ?? null;
  }
  async delete(key: string) {
    this.blobs.delete(key);
  }
}

/* ---------- AWS Signature Version 4 (pure; blob-store.test.ts checks it against AWS's own example) ---------- */

const sha256 = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");
const hmac = (key: string | Buffer, data: string) => createHmac("sha256", key).update(data).digest();
const encodeSegment = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

export type SignInput = {
  method: string;
  url: URL;
  /** Every header to sign, lower-case names; must include host, x-amz-date and x-amz-content-sha256. */
  headers: Record<string, string>;
  accessKey: string;
  secretKey: string;
  region: string;
  service?: string;
};

/** The Authorization header for a request (S3 flavour: the path is encoded once, the payload hash is a header). */
export function signV4(input: SignInput): string {
  const service = input.service ?? "s3";
  const amzDate = input.headers["x-amz-date"];
  const day = amzDate.slice(0, 8);
  const names = Object.keys(input.headers).map((h) => h.toLowerCase()).sort();
  const canonicalHeaders = names.map((h) => `${h}:${input.headers[h].trim().replace(/\s+/g, " ")}\n`).join("");
  const signedHeaders = names.join(";");
  const path = input.url.pathname.split("/").map((s) => encodeSegment(decodeURIComponent(s))).join("/") || "/";
  const query = [...input.url.searchParams].map(([k, v]) => `${encodeSegment(k)}=${encodeSegment(v)}`).sort().join("&");
  const canonical = [input.method, path, query, canonicalHeaders, signedHeaders, input.headers["x-amz-content-sha256"]].join("\n");
  const scope = `${day}/${input.region}/${service}/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256(canonical)].join("\n");
  const key = hmac(hmac(hmac(hmac(`AWS4${input.secretKey}`, day), input.region), service), "aws4_request");
  const signature = createHmac("sha256", key).update(toSign).digest("hex");
  return `AWS4-HMAC-SHA256 Credential=${input.accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
}

/** "20261030T120000Z" */
export const amzDate = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

/* ---------- Neon Object Storage ---------- */

export type NeonStorageConfig = { endpoint: string; bucket: string; accessKey: string; secretKey: string; region: string };

/** NEON_STORAGE_* first, then the AWS-standard names Neon injects (AWS_ENDPOINT_URL_S3, AWS_ACCESS_KEY_ID, ...). */
export function storageConfigFromEnv(env: Record<string, string | undefined> = process.env): NeonStorageConfig | null {
  const endpoint = env.NEON_STORAGE_ENDPOINT || env.AWS_ENDPOINT_URL_S3;
  const bucket = env.NEON_STORAGE_BUCKET;
  const accessKey = env.NEON_STORAGE_ACCESS_KEY || env.AWS_ACCESS_KEY_ID;
  const secretKey = env.NEON_STORAGE_SECRET_KEY || env.AWS_SECRET_ACCESS_KEY;
  if (!endpoint || !bucket || !accessKey || !secretKey) return null;
  return { endpoint: endpoint.replace(/\/+$/, ""), bucket, accessKey, secretKey, region: env.NEON_STORAGE_REGION || env.AWS_REGION || "us-east-2" };
}

export class NeonObjectStorage implements BlobStore {
  readonly kind = "neon";
  constructor(private readonly config: NeonStorageConfig) {}

  private async send(method: "PUT" | "GET" | "DELETE", key: string, body?: Buffer, contentType?: string): Promise<Response> {
    const url = new URL(`${this.config.endpoint}/${encodeSegment(this.config.bucket)}/${key.split("/").map(encodeSegment).join("/")}`);
    const headers: Record<string, string> = {
      host: url.host,
      "x-amz-date": amzDate(new Date()),
      "x-amz-content-sha256": sha256(body ?? ""),
      ...(contentType ? { "content-type": contentType } : {}),
    };
    const authorization = signV4({ method, url, headers, accessKey: this.config.accessKey, secretKey: this.config.secretKey, region: this.config.region });
    const { host: _host, ...sent } = headers;
    return fetch(url, { method, headers: { ...sent, authorization }, body: body ? new Uint8Array(body) : undefined, signal: AbortSignal.timeout(30_000) });
  }

  async put(key: string, bytes: Buffer, contentType: string) {
    const res = await this.send("PUT", key, bytes, contentType);
    if (!res.ok) throw new Error(`Couldn't store the file (storage ${res.status}): ${(await res.text().catch(() => "")).slice(0, 200)}`);
  }

  async get(key: string) {
    const res = await this.send("GET", key);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Couldn't read the file (storage ${res.status}).`);
    return { bytes: Buffer.from(await res.arrayBuffer()), contentType: res.headers.get("content-type") ?? "application/octet-stream" };
  }

  async delete(key: string) {
    const res = await this.send("DELETE", key);
    if (!res.ok && res.status !== 404) throw new Error(`Couldn't delete the file (storage ${res.status}).`);
  }
}

/* ---------- which one ---------- */

let override: BlobStore | null = null;
/** Tests inject one (null = back to the env's choice). */
export function setBlobStore(store: BlobStore | null) {
  override = store;
}

export const STORAGE_ENV = ["NEON_STORAGE_ENDPOINT", "NEON_STORAGE_BUCKET", "NEON_STORAGE_ACCESS_KEY", "NEON_STORAGE_SECRET_KEY"] as const;

/**
 * Which store this env gets: Neon Object Storage when it's configured and BLOB_FAKE isn't 1; otherwise memory, except
 * in production, where files must survive a restart: there it throws unless BLOB_FAKE=1 says volatile is meant.
 */
export function storeKindFor(env: Record<string, string | undefined> = process.env): { kind: "neon"; config: NeonStorageConfig } | { kind: "memory" } {
  if (env.BLOB_FAKE === "1") return { kind: "memory" };
  const config = storageConfigFromEnv(env);
  if (config) return { kind: "neon", config };
  if (env.NODE_ENV === "production") {
    throw new Error(`No object storage for Documents: set ${STORAGE_ENV.join(", ")} (or Neon's AWS_* names), or BLOB_FAKE=1 to accept that Documents don't survive a restart.`);
  }
  return { kind: "memory" };
}

/** One per process (storeKindFor). */
export function blobStore(): BlobStore {
  if (override) return override;
  const g = globalThis as { __roomieBlobStore?: BlobStore };
  if (!g.__roomieBlobStore) {
    const choice = storeKindFor();
    if (choice.kind === "memory") console.warn("[documents] no object storage (NEON_STORAGE_* unset or BLOB_FAKE=1): files are kept in memory and lost on restart");
    g.__roomieBlobStore = choice.kind === "neon" ? new NeonObjectStorage(choice.config) : new MemoryBlobStore();
  }
  return g.__roomieBlobStore;
}
