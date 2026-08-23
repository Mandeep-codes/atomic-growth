import { and, isNotNull, ne } from "drizzle-orm";
import { db } from "../lib/db";
import { verified_login_credentials } from "../lib/schema";
import { MOD_ALIAS_PLATFORM } from "../lib/forwardEmail";

// Backfills ForwardEmail aliases from verified_login_credentials.
//
// Usage:
//   pnpm tsx src/scripts/backfillForwardEmailAliases.ts --domain atmgrwthclip.com --dry-run
//   pnpm tsx src/scripts/backfillForwardEmailAliases.ts --domain atmgrwthclip.com
//   pnpm tsx src/scripts/backfillForwardEmailAliases.ts --all
//
// Requires FORWARDEMAIL_API_KEY in backend/.env. The domain must already be
// added + verified in the ForwardEmail account or the API returns 404.

const API_BASE = "https://api.forwardemail.net/v1";

const KNOWN_DOMAINS = [
  "emaildxb.com",
  "mailslaps.com",
  "nochillmail.com",
  "pingmailr.com",
  "postmailo.com",
  "sendmaila.com",
  "smashtok.com",
  "xmailor.com",
  "getrichmail.com",
  "choppedemail.com",
  "atomikmail.com",
  "atmgrwthclip.com",
];

const apiKey = process.env.FORWARDEMAIL_API_KEY;
const authHeader = `Basic ${Buffer.from(`${apiKey}:`).toString("base64")}`;

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const allDomains = args.includes("--all");
const domainFlagIndex = args.indexOf("--domain");
const singleDomain =
  domainFlagIndex !== -1 ? args[domainFlagIndex + 1] : undefined;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function apiRequest(
  method: "GET" | "POST" | "PUT",
  path: string,
  body?: Record<string, unknown>,
  attempt = 1
): Promise<{ status: number; data: any }> {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      Authorization: authHeader,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (res.status === 429 && attempt <= 5) {
    const backoffMs = attempt * 5000;
    console.log(`  rate limited, waiting ${backoffMs / 1000}s...`);
    await sleep(backoffMs);
    return apiRequest(method, path, body, attempt + 1);
  }

  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

async function fetchExistingAliases(domain: string) {
  const existing = new Map<string, { id: string; recipients: string[] }>();
  let page = 1;

  for (;;) {
    const { status, data } = await apiRequest(
      "GET",
      `/domains/${domain}/aliases?page=${page}&limit=100&sort=name`
    );
    if (status === 404) {
      throw new Error(
        `Domain ${domain} not found in ForwardEmail account — add + verify it first`
      );
    }
    if (status !== 200 || !Array.isArray(data)) {
      throw new Error(
        `Failed listing aliases for ${domain}: HTTP ${status} ${JSON.stringify(data)?.slice(0, 200)}`
      );
    }
    for (const alias of data) {
      existing.set(String(alias.name).toLowerCase(), {
        id: alias.id,
        recipients: (alias.recipients ?? []).map((r: string) =>
          r.toLowerCase()
        ),
      });
    }
    if (data.length < 100) break;
    page += 1;
  }

  return existing;
}

async function run() {
  if (!apiKey && !dryRun) {
    throw new Error("FORWARDEMAIL_API_KEY is not set in backend/.env");
  }
  if (!allDomains && !singleDomain) {
    throw new Error("Pass --domain <domain> or --all");
  }

  const targetDomains = allDomains ? KNOWN_DOMAINS : [singleDomain!];

  const rows = await db
    .select({
      email: verified_login_credentials.email,
      forwarding_email: verified_login_credentials.forwarding_email,
    })
    .from(verified_login_credentials)
    .where(
      and(
        isNotNull(verified_login_credentials.email),
        isNotNull(verified_login_credentials.forwarding_email),
        // Mod-generated forwarders manage their own recipients (and store them
        // comma-joined); never re-sync them through the clipper backfill.
        ne(verified_login_credentials.platform, MOD_ALIAS_PLATFORM)
      )
    );

  // Same credential email can exist across platforms with different
  // forwarding addresses — union all destinations onto one alias.
  const byDomain = new Map<string, Map<string, Set<string>>>();
  for (const row of rows) {
    const email = row.email!.trim().toLowerCase();
    const forwarding = row.forwarding_email!.trim().toLowerCase();
    const [localPart, domain] = email.split("@");
    if (!localPart || !domain || !targetDomains.includes(domain)) continue;

    let domainMap = byDomain.get(domain);
    if (!domainMap) {
      domainMap = new Map();
      byDomain.set(domain, domainMap);
    }
    let recipients = domainMap.get(localPart);
    if (!recipients) {
      recipients = new Set();
      domainMap.set(localPart, recipients);
    }
    recipients.add(forwarding);
  }

  const totals = { created: 0, updated: 0, unchanged: 0, failed: 0 };

  for (const domain of targetDomains) {
    const wanted = byDomain.get(domain);
    if (!wanted?.size) {
      console.log(`\n${domain}: no credentials in DB, skipping`);
      continue;
    }

    console.log(`\n${domain}: ${wanted.size} aliases to ensure`);
    const existing = dryRun
      ? new Map<string, { id: string; recipients: string[] }>()
      : await fetchExistingAliases(domain);

    let processed = 0;
    for (const [name, recipientSet] of wanted) {
      processed += 1;
      const recipients = [...recipientSet].sort();
      const current = existing.get(name);

      if (
        current &&
        current.recipients.length === recipients.length &&
        recipients.every((r) => current.recipients.includes(r))
      ) {
        totals.unchanged += 1;
        continue;
      }

      if (dryRun) {
        console.log(
          `  [dry-run] ${current ? "UPDATE" : "CREATE"} ${name}@${domain} -> ${recipients.join(", ")}`
        );
        totals[current ? "updated" : "created"] += 1;
        continue;
      }

      const { status, data } = current
        ? await apiRequest("PUT", `/domains/${domain}/aliases/${current.id}`, {
            recipients,
          })
        : await apiRequest("POST", `/domains/${domain}/aliases`, {
            name,
            recipients,
            is_enabled: true,
            has_imap: true,
          });

      if (status === 200 || status === 201) {
        totals[current ? "updated" : "created"] += 1;
      } else {
        totals.failed += 1;
        console.error(
          `  FAILED ${name}@${domain}: HTTP ${status} ${JSON.stringify(data)?.slice(0, 200)}`
        );
      }

      if (processed % 100 === 0) {
        console.log(`  ...${processed}/${wanted.size}`);
      }
      await sleep(150);
    }
  }

  console.log(
    `\nDone. created=${totals.created} updated=${totals.updated} unchanged=${totals.unchanged} failed=${totals.failed}${dryRun ? " (dry-run)" : ""}`
  );
  if (totals.failed > 0) process.exitCode = 1;
}

void run()
  .catch((error) => {
    console.error("Backfill failed:", error);
    process.exitCode = 1;
  })
  .finally(() => process.exit());
