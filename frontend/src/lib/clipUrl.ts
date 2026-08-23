// Pull the platform's own video/post id out of a clip URL.
//
// Searching submissions by pasting a full link used to fail: the filter did a
// plain substring match on the stored URL, and the link a moderator copies from
// the app rarely matches the one the clipper submitted, character for character.
// Instagram serves both /reel/ and /reels/, share sheets append ?utm_source and
// ?igsh, YouTube adds ?si, and www. comes and goes. So a moderator had to know
// to strip the link down to `DbUYJUgKqA0` by hand.
//
// The id is the one part that is stable across all of those, so we compare on
// it. Deliberately synchronous and network-free — this runs on every keystroke
// of the search box. That is why it does not resolve vt./vm.tiktok.com short
// links (which need a redirect lookup); those still fall back to raw substring
// matching, which is what happens today.
const PATTERNS: RegExp[] = [
  // YouTube: youtu.be/ID, /shorts/ID, /embed/ID, watch?v=ID
  /(?:youtu\.be\/|youtube\.com\/(?:shorts\/|embed\/|live\/|watch\?(?:[^#]*&)?v=))([\w-]{6,})/i,
  // Instagram: /reel/, /reels/, /p/, /tv/ — with or without a username segment
  /instagram\.com\/(?:[\w.-]+\/)?(?:reels?|p|tv)\/([\w-]{5,})/i,
  // TikTok full URL
  /tiktok\.com\/(?:@[\w.-]+\/)?video\/(\d+)/i,
  // X / Twitter
  /(?:x|twitter)\.com\/[\w]+\/status\/(\d+)/i,
  // LinkedIn activity id
  /linkedin\.com\/posts\/[\w%.-]+_.+?activity-(\d+)-/i,
];

/**
 * The video/post id inside `input`, or null when it doesn't look like a clip
 * URL (in which case the caller should fall back to matching the text as-is —
 * a moderator may well be pasting a bare id already).
 */
export function extractClipId(input: string): string | null {
  const value = input.trim();
  if (!value) return null;

  for (const pattern of PATTERNS) {
    const match = value.match(pattern);
    if (match?.[1]) return match[1];
  }
  return null;
}

/**
 * Does `url` refer to the same clip the moderator searched for?
 *
 * Matches when the ids agree — so a link with tracking params, a different
 * reel/reels spelling, or a missing www still finds the row — and otherwise
 * falls back to today's substring behaviour so partial text and bare ids keep
 * working.
 *
 * Ids are compared case-SENSITIVELY: YouTube ids are case-sensitive, and
 * `dQw4w9WgXcQ` and `dqw4w9wgxcq` are two different videos. Everything else
 * stays case-insensitive, as it was.
 */
export function clipUrlMatchesSearch(url: string, search: string): boolean {
  const term = search.trim();
  if (!term) return true;

  const searchId = extractClipId(term);
  if (searchId) {
    const urlId = extractClipId(url);
    if (urlId && urlId === searchId) return true;
    // The stored URL may be in a shape none of the patterns cover; still let a
    // direct hit on the id count.
    if (url.includes(searchId)) return true;
    return false;
  }

  // Not a recognisable clip URL — behave exactly as before, minus the protocol.
  const plain = term.toLowerCase().replace(/^https?:\/\//, "");
  return url.toLowerCase().includes(plain);
}
