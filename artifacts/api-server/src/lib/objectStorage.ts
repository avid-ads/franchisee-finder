import { randomUUID } from "node:crypto";
import { Storage, type File } from "@google-cloud/storage";

const SIDECAR_ENDPOINT = "http://127.0.0.1:1106";

const storage = new Storage({
  credentials: {
    audience: "replit",
    subject_token_type: "access_token",
    token_url: `${SIDECAR_ENDPOINT}/token`,
    type: "external_account",
    credential_source: {
      url: `${SIDECAR_ENDPOINT}/credential`,
      format: { type: "json", subject_token_field_name: "access_token" },
    },
    universe_domain: "googleapis.com",
  },
  projectId: "",
});

function parsePath(path: string) {
  const parts = `/${path.replace(/^\/+/, "")}`.split("/");
  if (parts.length < 3) throw new Error("Invalid object storage path");
  return { bucketName: parts[1], objectName: parts.slice(2).join("/") };
}

async function signObjectUrl(
  bucketName: string,
  objectName: string,
  method: "PUT" | "GET",
  ttlSec = 900,
) {
  const response = await fetch(`${SIDECAR_ENDPOINT}/object-storage/signed-object-url`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      bucket_name: bucketName,
      object_name: objectName,
      method,
      expires_at: new Date(Date.now() + ttlSec * 1000).toISOString(),
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Object storage signing failed (${response.status})`);
  const body = (await response.json()) as { signed_url: string };
  return body.signed_url;
}

export function getObjectFile(objectPath: string): File {
  if (!objectPath.startsWith("/objects/")) throw new Error("Invalid private object path");
  const privateDir = process.env.PRIVATE_OBJECT_DIR;
  if (!privateDir) throw new Error("PRIVATE_OBJECT_DIR is not configured");
  const relative = objectPath.slice("/objects/".length);
  const { bucketName, objectName } = parsePath(`${privateDir.replace(/\/$/, "")}/${relative}`);
  return storage.bucket(bucketName).file(objectName);
}

export async function createPdfUploadDestination() {
  const privateDir = process.env.PRIVATE_OBJECT_DIR;
  if (!privateDir) throw new Error("PRIVATE_OBJECT_DIR is not configured");
  const relative = `uploads/${randomUUID()}`;
  const { bucketName, objectName } = parsePath(`${privateDir.replace(/\/$/, "")}/${relative}`);
  return {
    uploadUrl: await signObjectUrl(bucketName, objectName, "PUT"),
    objectPath: `/objects/${relative}`,
  };
}