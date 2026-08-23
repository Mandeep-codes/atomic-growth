import { randomBytes, scryptSync, timingSafeEqual } from "crypto";

const SALT_LENGTH = 16;
const KEY_LENGTH = 64;
const VERSION = "v1";

export function hashExternalPassword(password: string) {
  const salt = randomBytes(SALT_LENGTH).toString("hex");
  const derivedKey = scryptSync(password, salt, KEY_LENGTH).toString("hex");
  return `${VERSION}:${salt}:${derivedKey}`;
}

export function verifyExternalPasswordHash(storedHash: string, password: string) {
  if (!storedHash) {
    return false;
  }

  const [version, salt, hashedPassword] = storedHash.split(":");
  if (version !== VERSION || !salt || !hashedPassword) {
    return false;
  }

  const derivedKey = scryptSync(password, salt, KEY_LENGTH).toString("hex");
  try {
    return timingSafeEqual(Buffer.from(hashedPassword, "hex"), Buffer.from(derivedKey, "hex"));
  } catch {
    return false;
  }
}
