import { config } from "../config";

// Encrypts credentials stored in the database (photo source accounts) with
// AES-256-GCM. The key is derived from SECRET_KEY, so a database dump alone
// doesn't reveal them; rotating SECRET_KEY means reconnecting those accounts.

const VERSION = "v1";
let keyPromise: Promise<CryptoKey> | null = null;

function key(): Promise<CryptoKey> {
  keyPromise ??= (async () => {
    const material = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(config.SECRET_KEY),
      "HKDF",
      false,
      ["deriveKey"],
    );
    return crypto.subtle.deriveKey(
      {
        name: "HKDF",
        hash: "SHA-256",
        salt: new TextEncoder().encode("sammelband"),
        info: new TextEncoder().encode("source-credentials"),
      },
      material,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );
  })();
  return keyPromise;
}

export async function seal(value: unknown): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plain = new TextEncoder().encode(JSON.stringify(value));
  const cipher = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await key(), plain),
  );
  return `${VERSION}:${Buffer.from(iv).toString("base64")}:${Buffer.from(cipher).toString("base64")}`;
}

/** The sealed value, or null when it can't be opened (other SECRET_KEY, damaged). */
export async function open<T>(sealed: string): Promise<T | null> {
  const [version, iv, cipher] = sealed.split(":");
  if (version !== VERSION || !iv || !cipher) return null;
  try {
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: Buffer.from(iv, "base64") },
      await key(),
      Buffer.from(cipher, "base64"),
    );
    return JSON.parse(new TextDecoder().decode(plain)) as T;
  } catch {
    return null;
  }
}
