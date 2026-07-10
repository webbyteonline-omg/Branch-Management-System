// Staff log in with a simple ID (e.g. "seppa"), not an email address.
// Behind the scenes we map the ID to a fixed internal email domain that
// Supabase Auth uses. Users never see or type the domain.
export const ID_DOMAIN = "branch.local";

/** "seppa" -> "seppa@branch.local"; leaves a full email untouched. */
export function idToEmail(input: string): string {
  const v = input.trim().toLowerCase();
  if (!v) return "";
  return v.includes("@") ? v : `${v}@${ID_DOMAIN}`;
}
