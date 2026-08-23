import { env } from "./env";

const API_BASE = "https://api.forwardemail.net/v1";
const REQUEST_TIMEOUT_MS = 10_000;

// Registrar-controlled domains verified on the ForwardEmail account. Both
// clipper credentials and mod-generated forwarders pick one at random.
export const ALIAS_DOMAINS = [
  "acthemepage.com",
  "themepagemedia.com",
  "themepagestudio.com",
  "themepagelabs.com",
  "themepagedaily.com",
  "themepagepost.com",
  "dailythemepages.com",
  "viralthemepage.com",
  "acthemehub.com",
  "acthemestudio.com",
  "acmediapages.com",
];

export const randomAliasDomain = () =>
  ALIAS_DOMAINS[Math.floor(Math.random() * ALIAS_DOMAINS.length)] as string;

// Even spread for a batch of `count` aliases: every domain is used either
// floor(count/N) or ceil(count/N) times — never more than one apart. A single
// random pick per alias (randomAliasDomain) clumps by chance over small
// batches, so mass generation assigns domains up front instead. The pool is
// shuffled first so which domains absorb the remainder is random, and the
// final assignment order is shuffled so aliases aren't created domain-by-domain.
export const balancedAliasDomains = (count: number): string[] => {
  const shuffle = <T>(arr: T[]): T[] => {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]] as [T, T];
    }
    return arr;
  };
  const pool = shuffle([...ALIAS_DOMAINS]);
  const assignment = Array.from(
    { length: Math.max(0, count) },
    (_, i) => pool[i % pool.length] as string
  );
  return shuffle(assignment);
};

// Sentinel written to verified_login_credentials.platform for mod-generated
// forwarders, so they are distinguishable from real clipper accounts and can
// be excluded from clipper tooling / the backfill sync.
export const MOD_ALIAS_PLATFORM = "mod-forwarder";

const authHeader = () =>
  `Basic ${Buffer.from(`${env.FORWARDEMAIL_API_KEY}:`).toString("base64")}`;

// ForwardEmail doesn't publish exact API limits, only that it 429s. Two
// defenses: space all calls out (bulk generate + concurrent clipper
// verifications share one process-wide queue), and back off + retry when a
// 429 slips through anyway.
const MIN_REQUEST_SPACING_MS = 250;
const MAX_ATTEMPTS = 4;
const MAX_RETRY_WAIT_MS = 30_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let lastRequestAt = 0;
let spacingQueue: Promise<void> = Promise.resolve();

const reserveSlot = () => {
  const reservation = spacingQueue.then(async () => {
    const wait = lastRequestAt + MIN_REQUEST_SPACING_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastRequestAt = Date.now();
  });
  spacingQueue = reservation.catch(() => {});
  return reservation;
};

const retryDelayMs = (res: Response, attempt: number) => {
  const retryAfter = Number(res.headers.get("retry-after"));
  if (Number.isFinite(retryAfter) && retryAfter > 0) {
    return Math.min(retryAfter * 1000, MAX_RETRY_WAIT_MS);
  }
  return Math.min(1000 * 2 ** (attempt - 1), 8000) + Math.random() * 250;
};

const request = async (
  method: "GET" | "POST" | "PUT" | "DELETE",
  path: string,
  body?: object
): Promise<Response> => {
  for (let attempt = 1; ; attempt++) {
    await reserveSlot();
    const res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: {
        Authorization: authHeader(),
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (res.status !== 429 || attempt >= MAX_ATTEMPTS) return res;
    console.warn(
      `ForwardEmail 429 on ${method} ${path} (attempt ${attempt}/${MAX_ATTEMPTS}), backing off`
    );
    await sleep(retryDelayMs(res, attempt));
  }
};

/**
 * Ensures a ForwardEmail alias exists so mail to `email` forwards to
 * `recipients`. Never throws — on failure the domain's catch-all still
 * routes the mail to the admin inbox, so credential creation must not block.
 */
export const ensureForwardEmailAlias = async (
  email: string,
  recipients: string[]
): Promise<boolean> => {
  if (!env.FORWARDEMAIL_API_KEY) {
    console.warn(
      `FORWARDEMAIL_API_KEY not set — skipping alias sync for ${email}`
    );
    return false;
  }

  const [name, domain] = email.trim().toLowerCase().split("@");
  if (!name || !domain) {
    console.error(`ensureForwardEmailAlias: invalid email ${email}`);
    return false;
  }

  try {
    const created = await request("POST", `/domains/${domain}/aliases`, {
      name,
      recipients,
      is_enabled: true,
      // Store a copy in encrypted IMAP mailbox in addition to forwarding, so
      // the account's mail is reachable via webmail without routing to a person.
      has_imap: true,
    });
    if (created.ok) return true;

    // Alias may already exist (e.g. handle re-verified) — update it instead
    const listed = await request(
      "GET",
      `/domains/${domain}/aliases?name=${encodeURIComponent(name)}`
    );
    if (listed.ok) {
      const aliases = (await listed.json()) as { id: string; name: string }[];
      const existing = aliases.find((a) => a.name === name);
      if (existing) {
        const updated = await request(
          "PUT",
          `/domains/${domain}/aliases/${existing.id}`,
          { recipients }
        );
        if (updated.ok) return true;
      }
    }

    console.error(
      `ensureForwardEmailAlias failed for ${email}: HTTP ${created.status} ${(await created.text().catch(() => "")).slice(0, 200)}`
    );
    return false;
  } catch (error) {
    console.error(`ensureForwardEmailAlias failed for ${email}`, error);
    return false;
  }
};

/**
 * Deletes the ForwardEmail alias for `email`. Returns true if the alias is
 * gone afterward (including if it never existed). Never throws.
 */
export const deleteForwardEmailAlias = async (
  email: string
): Promise<boolean> => {
  if (!env.FORWARDEMAIL_API_KEY) return false;

  const [name, domain] = email.trim().toLowerCase().split("@");
  if (!name || !domain) return false;

  try {
    const listed = await request(
      "GET",
      `/domains/${domain}/aliases?name=${encodeURIComponent(name)}`
    );
    if (!listed.ok) return false;

    const aliases = (await listed.json()) as { id: string; name: string }[];
    const existing = aliases.find((a) => a.name === name);
    if (!existing) return true; // already gone

    const deleted = await request(
      "DELETE",
      `/domains/${domain}/aliases/${existing.id}`
    );
    return deleted.ok;
  } catch (error) {
    console.error(`deleteForwardEmailAlias failed for ${email}`, error);
    return false;
  }
};
