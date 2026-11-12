export function personRoleKey(role: string) {
  return role
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
}
