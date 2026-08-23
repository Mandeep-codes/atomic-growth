// ── Sanctioned shared social accounts ──
//
// "One social account, one owner" (verification.ts →
// assertHandleNotOwnedByAnother) is the right default: without it two clippers
// can verify the same handle and both earn on the same content. But a small
// number of accounts are shared DELIBERATELY — a brand account two team members
// both post from, agreed with the client. This is the carve-out for those.
//
// Scoped as tightly as it can be: an entry names the handle AND the exact set of
// discord ids allowed to hold it. Two people on that list may both link the
// account; anyone else still gets the CONFLICT. So the allowlist can never be
// used by an outsider to hijack a handle — the worst it can do is let the named
// owners keep the arrangement they already have.
//
// Deliberately NOT platform-scoped. The sanction is on the brand account, not on
// one network, and the owners re-linking it on youtube after instagram is the
// same agreed arrangement. Owner-id scoping is what keeps that safe.
//
// To add an entry: name the handle, list every owner's discord id with their
// username in a comment, and say who approved it and when. To revoke: delete the
// entry — existing links are untouched (this only gates NEW links), but the
// account can then only be re-linked by one clipper.

type SharedAccount = {
  /** Handle as typed, without "@". Matched case-insensitively. */
  handle: string;
  /** Discord ids permitted to share it. Anyone not listed is still blocked. */
  ownerDiscordIds: string[];
  note: string;
};

export const SHARED_SOCIAL_ACCOUNTS: SharedAccount[] = [
  {
    handle: "growasentrepreneurs",
    ownerDiscordIds: [
      "755628278298968075", // hannaan.kirmani
      "296884557972504577", // channelprnv
    ],
    note: "Growa brand account, dual-login agreed with the client. Both instagram links exist in production (soft-deleted 2026-07-25); this keeps them re-linkable.",
  },
];

const normalize = (handle: string) =>
  handle.trim().replace(/^@+/, "").toLowerCase();

/**
 * True when `handle` is a sanctioned shared account AND both the clipper trying
 * to link it and the clipper who already holds it are named owners of it.
 *
 * Both sides matter: an entry lets its listed owners share the account with each
 * other, it does not open the handle up to the world.
 */
export const isSanctionedSharedAccount = (
  handle: string,
  claimantDiscordId: string,
  existingOwnerDiscordId: string
): boolean => {
  const wanted = normalize(handle);
  return SHARED_SOCIAL_ACCOUNTS.some(
    (entry) =>
      normalize(entry.handle) === wanted &&
      entry.ownerDiscordIds.includes(claimantDiscordId) &&
      entry.ownerDiscordIds.includes(existingOwnerDiscordId)
  );
};
