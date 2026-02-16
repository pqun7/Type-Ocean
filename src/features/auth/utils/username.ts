const USERNAME_ALLOWED = /^[a-z0-9_]+$/;

export function normalizeUsernameForStorage(input: string): string {
  return input.trim().toLowerCase();
}

export function sanitizeUsernameFromProvider(input: string): string {
  // 1) lowercase + trim
  let username = normalizeUsernameForStorage(input);

  // 2) remove all whitespace (spaces, tabs, etc.)
  username = username.replace(/\s+/g, "");

  // 3) keep only allowed characters; replace others with underscore
  username = username.replace(/[^a-z0-9_]+/g, "_");

  // 4) collapse underscores and trim them from ends
  username = username.replace(/_+/g, "_").replace(/^_+|_+$/g, "");

  // 5) enforce length (3..20). If too short, pad with "user" prefix.
  if (username.length === 0) username = "user";
  if (username.length < 3) username = (username + "user").slice(0, 3);
  if (username.length > 20) username = username.slice(0, 20);

  // Final safety: ensure it matches the same policy used elsewhere.
  if (!USERNAME_ALLOWED.test(username)) {
    // If something unexpected slipped through, fall back to a safe placeholder.
    return "user";
  }

  return username;
}

export function normalizeUsernameForDisplay(input: string | null | undefined): string | null {
  if (!input) return null;
  // Display rule requested: always lowercase; also strip whitespace defensively.
  return input.toLowerCase().replace(/\s+/g, "");
}
