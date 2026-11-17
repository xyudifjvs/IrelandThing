import { contactRoleFamily } from "../../../../../../../packages/contacts/src/transaction-sources";

export type EmailRecipient = { name: string; email: string; role: string };

export function emailRoleFamily(role: string, side?: string) {
  const key = role
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_");
  if (
    ["client", "buyer", "seller", "buyer_client", "seller_client"].includes(key)
  )
    return "client";
  if (["agent", "my_agent", "your_agent", "serving_agent"].includes(key))
    return "agent";
  if (
    (["listing_agent", "listing_side_agent"].includes(key) &&
      side === "seller") ||
    (["buyers_agent", "buyer_s_agent"].includes(key) && side === "buyer")
  )
    return "agent";
  if (
    [
      "listing_agent",
      "buyers_agent",
      "buyer_s_agent",
      "listing_side_agent",
    ].includes(key)
  )
    return "coop";
  return contactRoleFamily(key) || key;
}

export function defaultEmailRecipients(
  people: readonly EmailRecipient[],
  roles: readonly string[],
  directContact: unknown,
  side?: string,
) {
  const families = new Set(roles.map((role) => emailRoleFamily(role, side)));
  const recipients = new Map<string, EmailRecipient>();
  for (const person of people) {
    const email = person.email.trim().toLowerCase();
    const family = emailRoleFamily(person.role, side);
    if (
      email &&
      families.has(family) &&
      (family !== "client" || directContact === "copy_agent") &&
      !recipients.has(email)
    )
      recipients.set(email, { ...person, email });
  }
  return [...recipients.values()];
}

export function recipientGreeting(people: readonly EmailRecipient[]) {
  if (people.some(({ name }) => !name.trim())) return "";
  return new Intl.ListFormat("en", { type: "conjunction" }).format(
    people.map(({ name }) => name.trim()),
  );
}
