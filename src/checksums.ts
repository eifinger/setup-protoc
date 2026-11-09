import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";

export function parseChecksum(value: string): string {
  const checksum = value.replace(/^sha256:/i, "").toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(checksum))
    throw new Error(
      "Expected a SHA-256 checksum: 64 hexadecimal characters, optionally prefixed by sha256:.",
    );
  return checksum;
}

export async function hashFile(filename: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filename)) hash.update(chunk);
  return hash.digest("hex");
}

export async function verifyChecksum(
  filename: string,
  expected: string,
): Promise<void> {
  const actual = await hashFile(filename);
  if (actual !== parseChecksum(expected))
    throw new Error(
      `SHA-256 mismatch: expected ${expected}, received ${actual}. Refusing to install protoc.`,
    );
}
