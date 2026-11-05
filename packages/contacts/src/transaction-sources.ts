/** Existing saved evidence is compared before a directory suggestion can become
 * a coordinator contact. This reads values; it never rewrites intake/extraction. */
export type ContactValues = {
  name: string;
  company: string;
  email: string;
  phone: string;
};
export type PriorContactSource = ContactValues & {
  source: string;
  role: string;
  contactId?: string;
};
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const string = (value: unknown) => (typeof value === "string" ? value : "");
const first = (...values: unknown[]) =>
  values.map(string).find((value) => value.trim()) || "";
export function contactRoleFamily(role: string) {
  if (["title_company", "title_rep", "title"].includes(role)) return "title";
  if (["lender", "loan_officer"].includes(role)) return "lender";
  if (["co_op_agent", "coop_agent", "co_op"].includes(role)) return "coop";
  return "";
}
export function transactionContactSources(
  details: unknown,
  role: string,
  excludeContactId?: string,
): PriorContactSource[] {
  const family = contactRoleFamily(role);
  if (!family) return [];
  const d = record(details),
    fields = record(record(d.referenceIntake).fields),
    facts = record(d.confirmedFacts),
    sources: PriorContactSource[] = [];
  const add = (source: string, values: ContactValues, contactId?: string) => {
    if (Object.values(values).some((value) => value.trim()))
      sources.push({
        source,
        role,
        ...values,
        ...(contactId ? { contactId } : {}),
      });
  };
  const prefix = family === "title" ? "t" : family === "lender" ? "l" : "co";
  add("Saved intake", {
    name: string(
      fields[
        family === "title"
          ? "t_contact"
          : family === "lender"
            ? "l_officer"
            : "co_name"
      ],
    ),
    company: string(
      fields[
        family === "title"
          ? "t_co"
          : family === "lender"
            ? "l_co"
            : "co_brokerage"
      ],
    ),
    email: string(fields[prefix + "_email"]),
    phone: string(fields[prefix + "_phone"]),
  });
  const normalized = record(d[family === "coop" ? "co_op_agent" : family]);
  const sameProjection = sources.some(
    (source) =>
      source.source === "Saved intake" &&
      string(normalized.name) ===
        [source.company, source.name].filter(Boolean).join(" · ") &&
      string(normalized.email) === source.email &&
      string(normalized.phone) === source.phone,
  );
  if (Object.keys(normalized).length && !sameProjection)
    add("Saved transaction details", {
      name: first(normalized.contactName, normalized.name),
      company: first(normalized.company, normalized.companyName),
      email: string(normalized.email),
      phone: string(normalized.phone),
    });
  const nested = record(facts[family === "coop" ? "co_op_agent" : family]);
  const value = (...keys: string[]) => first(...keys.map((k) => facts[k]));
  add(
    "Confirmed source facts",
    family === "title"
      ? {
          name: first(
            nested.contactName,
            nested.name,
            value(
              "title_contact",
              "title_contact_name",
              "title_rep",
              "title_rep_name",
              "title_name",
            ),
          ),
          company: first(
            nested.company,
            value("title_company", "title_company_name"),
          ),
          email: first(
            nested.email,
            value("title_email", "title_contact_email"),
          ),
          phone: first(
            nested.phone,
            value("title_phone", "title_contact_phone"),
          ),
        }
      : family === "lender"
        ? {
            name: first(
              nested.contactName,
              nested.name,
              value(
                "loan_officer",
                "loan_officer_name",
                "lender_contact",
                "lender_contact_name",
              ),
            ),
            company: first(
              nested.company,
              value("lender_company", "lender_name", "lender"),
            ),
            email: first(
              nested.email,
              value("lender_email", "loan_officer_email"),
            ),
            phone: first(
              nested.phone,
              value("lender_phone", "loan_officer_phone"),
            ),
          }
        : {
            name: first(
              nested.name,
              value(
                "co_op_agent_name",
                "coop_agent_name",
                "co_op_agent",
                "coop_agent",
              ),
            ),
            company: first(
              nested.company,
              value("co_op_brokerage", "coop_brokerage", "co_op_company"),
            ),
            email: first(nested.email, value("co_op_email", "coop_email")),
            phone: first(nested.phone, value("co_op_phone", "coop_phone")),
          },
  );
  if (Array.isArray(d.contacts))
    for (const saved of d.contacts) {
      const c = record(saved);
      if (
        c.id === excludeContactId ||
        contactRoleFamily(string(c.role)) !== family
      )
        continue;
      add(
        "Existing coordinator contact",
        {
          name: string(c.name),
          company: string(c.company),
          email: string(c.email),
          phone: string(c.phone),
        },
        string(c.id),
      );
    }
  return sources;
}
export function contactValuesConflict(
  prior: ContactValues,
  next: ContactValues,
) {
  // Conservative exact comparison. A suggestion never decides that similar
  // names, companies or punctuation establish the same representative.
  return (["name", "company", "email", "phone"] as const).some(
    (key) => prior[key].trim() && prior[key].trim() !== next[key].trim(),
  );
}
export function prefillPriorContact(
  sources: PriorContactSource[],
  current: ContactValues,
): ContactValues {
  // Only fill an empty control when sources agree on that particular value.
  // Disagreement stays visible in the source list rather than choosing a winner.
  return Object.fromEntries(
    (["name", "company", "email", "phone"] as const).map((key) => {
      const values = [
        ...new Set(
          sources.map((source) => source[key]).filter((value) => value.trim()),
        ),
      ];
      return [key, current[key] || (values.length === 1 ? values[0] : "")];
    }),
  ) as ContactValues;
}
