import crypto from 'node:crypto';

const SCRYPT_N = 32768;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LEN = 64;
const SALT_LEN = 16;

export async function hashPassword(
  password: string,
): Promise<{ hash: string; salt: string }> {
  const salt = crypto.randomBytes(SALT_LEN).toString('hex');
  const hash = await new Promise<string>((resolve, reject) => {
    crypto.scrypt(
      password,
      salt,
      KEY_LEN,
      { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P },
      (err, derived) => {
        if (err) reject(err);
        else resolve(derived.toString('hex'));
      },
    );
  });
  return { hash, salt };
}

export async function verifyPassword(
  password: string,
  storedHash: string,
  salt: string,
): Promise<boolean> {
  const derived = await new Promise<Buffer>((resolve, reject) => {
    crypto.scrypt(
      password,
      salt,
      KEY_LEN,
      { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P },
      (err, buf) => {
        if (err) reject(err);
        else resolve(buf);
      },
    );
  });

  const storedBuf = Buffer.from(storedHash, 'hex');
  if (derived.length !== storedBuf.length) {
    return false;
  }
  return crypto.timingSafeEqual(derived, storedBuf);
}
