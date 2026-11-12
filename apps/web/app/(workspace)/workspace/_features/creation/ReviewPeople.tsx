"use client";

import type { CreationPerson } from "@weatherly/platform/handoff-contracts";
import s from "./creation.module.css";

const roles = {
  client: "Client",
  my_agent: "Assigned agent",
  co_op_agent: "Other agent",
  lender: "Lender",
  title_rep: "Title company",
  other: "Other",
};

export function ReviewPeople({
  people,
  onChange,
}: {
  people: CreationPerson[];
  onChange: (people: CreationPerson[]) => void;
}) {
  function change(index: number, field: keyof CreationPerson, value: string) {
    onChange(
      people.map((person, i) =>
        i === index ? { ...person, [field]: value } : person,
      ),
    );
  }
  return (
    <section className={s.section} aria-labelledby="creation-people">
      <h2 id="creation-people">People</h2>
      {people.map((person, index) => (
        <fieldset key={index} className={s.person}>
          <legend>
            {roles[person.role as keyof typeof roles] || person.role}
          </legend>
          <div className={s.grid}>
            <label>
              Role
              <select
                value={person.role}
                onChange={(event) => change(index, "role", event.target.value)}
              >
                {!Object.hasOwn(roles, person.role) && (
                  <option value={person.role}>{person.role}</option>
                )}
                {Object.entries(roles).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Name
              <input
                value={person.name}
                required
                maxLength={200}
                onChange={(event) => change(index, "name", event.target.value)}
              />
            </label>
            <label>
              Company
              <input
                value={person.company ?? ""}
                maxLength={200}
                onChange={(event) =>
                  change(index, "company", event.target.value)
                }
              />
            </label>
            <label>
              Email
              <input
                type="email"
                value={person.email}
                maxLength={254}
                onChange={(event) => change(index, "email", event.target.value)}
              />
            </label>
            <label>
              Phone
              <input
                type="tel"
                value={person.phone}
                maxLength={60}
                onChange={(event) => change(index, "phone", event.target.value)}
              />
            </label>
          </div>
          <button
            type="button"
            className={s.textButton}
            onClick={() => onChange(people.filter((_, i) => i !== index))}
          >
            Remove person
          </button>
        </fieldset>
      ))}
      <button
        type="button"
        className={s.secondary}
        onClick={() =>
          onChange([
            ...people,
            { role: "other", name: "", email: "", phone: "" },
          ])
        }
      >
        Add person
      </button>
    </section>
  );
}
