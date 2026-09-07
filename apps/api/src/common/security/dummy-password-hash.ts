import * as bcrypt from 'bcryptjs';

/**
 * A bcrypt hash of an arbitrary fixed placeholder value — never a real credential — computed
 * once and cached. Login flows call bcrypt.compare() against this whenever there's no real
 * password hash to check (unknown email, inactive user, locked account), so a wasted comparison
 * costs the same as a real one. Without this, "unknown email" responses return measurably
 * faster than "wrong password" responses (no bcrypt call vs. one), which lets an attacker
 * enumerate valid emails purely from response timing.
 */
let dummyHashPromise: Promise<string> | null = null;

function getDummyHash(): Promise<string> {
  if (!dummyHashPromise) {
    dummyHashPromise = bcrypt.hash('timing-safety-placeholder-value', 12);
  }
  return dummyHashPromise;
}

export async function compareAgainstDummyHash(password: string): Promise<void> {
  const hash = await getDummyHash();
  await bcrypt.compare(password, hash);
}
