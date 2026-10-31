// The BlobStore: SigV4 against AWS's published S3 examples, the env choice, the in-memory store.
// No network. Run: npx tsx --test src/integrations/blob-store.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { MemoryBlobStore, signV4, storageConfigFromEnv, storeKindFor } from "./blob-store";

const KEYS = { accessKey: "AKIAIOSFODNN7EXAMPLE", secretKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY", region: "us-east-1" };

test("signV4: AWS's GET Object example (range header, empty payload)", () => {
  const auth = signV4({
    method: "GET",
    url: new URL("https://examplebucket.s3.amazonaws.com/test.txt"),
    headers: {
      host: "examplebucket.s3.amazonaws.com",
      range: "bytes=0-9",
      "x-amz-content-sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      "x-amz-date": "20130524T000000Z",
    },
    ...KEYS,
  });
  assert.equal(
    auth,
    "AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41",
  );
});

test("signV4: AWS's PUT Object example (a $ in the key is encoded once)", () => {
  const body = "Welcome to Amazon S3.";
  const auth = signV4({
    method: "PUT",
    url: new URL("https://examplebucket.s3.amazonaws.com/test$file.text"),
    headers: {
      host: "examplebucket.s3.amazonaws.com",
      date: "Fri, 24 May 2013 00:00:00 GMT",
      "x-amz-date": "20130524T000000Z",
      "x-amz-storage-class": "REDUCED_REDUNDANCY",
      "x-amz-content-sha256": createHash("sha256").update(body).digest("hex"),
    },
    ...KEYS,
  });
  assert.match(auth, /Signature=98ad721746da40c64f1a55b78f14c238d841ea1380cd77a1b5971af0ece108bd$/);
});

test("storage config: NEON_STORAGE_* first, Neon's injected AWS_* names as the fallback, nothing without a bucket", () => {
  assert.equal(storageConfigFromEnv({}), null);
  assert.equal(storageConfigFromEnv({ AWS_ENDPOINT_URL_S3: "https://s3.x", AWS_ACCESS_KEY_ID: "a", AWS_SECRET_ACCESS_KEY: "b" }), null, "no bucket");
  assert.deepEqual(storageConfigFromEnv({ AWS_ENDPOINT_URL_S3: "https://s3.x/", AWS_ACCESS_KEY_ID: "a", AWS_SECRET_ACCESS_KEY: "b", AWS_REGION: "eu-central-1", NEON_STORAGE_BUCKET: "docs" }), {
    endpoint: "https://s3.x",
    bucket: "docs",
    accessKey: "a",
    secretKey: "b",
    region: "eu-central-1",
  });
  assert.equal(storageConfigFromEnv({ NEON_STORAGE_ENDPOINT: "https://n", NEON_STORAGE_BUCKET: "d", NEON_STORAGE_ACCESS_KEY: "k", NEON_STORAGE_SECRET_KEY: "s", AWS_ENDPOINT_URL_S3: "https://aws" })?.endpoint, "https://n");
});

test("which store: memory in dev and tests; production without storage refuses, naming the variables, unless BLOB_FAKE=1", () => {
  const full = { NEON_STORAGE_ENDPOINT: "https://n", NEON_STORAGE_BUCKET: "d", NEON_STORAGE_ACCESS_KEY: "k", NEON_STORAGE_SECRET_KEY: "s" };
  assert.equal(storeKindFor({}).kind, "memory");
  assert.equal(storeKindFor({ NODE_ENV: "development", NEON_STORAGE_BUCKET: "d" }).kind, "memory");
  assert.equal(storeKindFor({ NODE_ENV: "production", ...full }).kind, "neon");
  assert.throws(() => storeKindFor({ NODE_ENV: "production", NEON_STORAGE_BUCKET: "d" }), /NEON_STORAGE_ENDPOINT, NEON_STORAGE_BUCKET, NEON_STORAGE_ACCESS_KEY, NEON_STORAGE_SECRET_KEY.*BLOB_FAKE=1/);
  assert.equal(storeKindFor({ NODE_ENV: "production", BLOB_FAKE: "1" }).kind, "memory", "an operator opting into volatile storage");
  assert.equal(storeKindFor({ NODE_ENV: "production", BLOB_FAKE: "1", ...full }).kind, "memory");
});

test("MemoryBlobStore: put, get, delete; a missing key is null", async () => {
  const store = new MemoryBlobStore();
  await store.put("g/apt-4b/lease", Buffer.from("%PDF lease"), "application/pdf");
  assert.deepEqual(await store.get("g/apt-4b/lease"), { bytes: Buffer.from("%PDF lease"), contentType: "application/pdf" });
  await store.delete("g/apt-4b/lease");
  assert.equal(await store.get("g/apt-4b/lease"), null);
});
