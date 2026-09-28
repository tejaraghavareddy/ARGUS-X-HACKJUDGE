/**
 * Password hashing for Convex Auth's `Password` provider.
 *
 * RaptureJudge ships demo accounts that reviewers can actually sign into, so we
 * need a hash function we can also call directly from the seeder. The default
 * Lucia scrypt implementation is not exported by the auth package, so we supply
 * our own `crypto` pair and reuse the exact same `hashSecret` when seeding.
 *
 * Using one shared implementation is what guarantees a seeded password verifies
 * against a real sign-in: the provider and the seeder can never drift.
 *
 * Format: `sha256$<saltHex>$<hashHex>`
 */

const ITERATIONS = 1000;
const KEY_BYTES = 32;

function toHex(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let out = "";
  for (const byte of view) out += byte.toString(16).padStart(2, "0");
  return out;
}

function fromHex(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

async function derive(
  password: string,
  salt: Uint8Array,
): Promise<Uint8Array> {
  const baseKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: salt as unknown as BufferSource,
      iterations: ITERATIONS,
      hash: "SHA-256",
    },
    baseKey,
    KEY_BYTES * 8,
  );
  return new Uint8Array(bits);
}

/** Hash a password with a fresh random salt. */
export async function hashSecret(secret: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derive(secret, salt);
  return `sha256$${toHex(salt)}$${toHex(hash)}`;
}

/** Check a plaintext secret against a stored hash. */
export async function verifySecret(
  secret: string,
  stored: string,
): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== "sha256") return false;

  const salt = fromHex(parts[1]);
  const expected = fromHex(parts[2]);
  const actual = await derive(secret, salt);

  if (actual.length !== expected.length) return false;

  // Constant-time compare so verification does not leak match position.
  let diff = 0;
  for (let i = 0; i < actual.length; i++) diff |= actual[i] ^ expected[i];
  return diff === 0;
}
