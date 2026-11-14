import { displayLabel, emailLink, type PortalPerson } from "./portal-model";
import s from "../_components/portal.module.css";

export function PortalPeople({
  people,
  client = false,
}: {
  people: readonly PortalPerson[];
  client?: boolean;
}) {
  if (!people.length) return null;
  return (
    <section
      className={s.panel}
      aria-label={client ? "Your team" : "People on this deal"}
    >
      <h2>{client ? "Your team" : "People on this deal"}</h2>
      <ul className={s.list}>
        {people.map((person) => {
          const mail = emailLink(person.email);
          return (
            <li className={s.listRow} key={person.id}>
              <div>
                <strong>{person.name}</strong>
                <p>{displayLabel(person.role)}</p>
                {person.phone && <p>{person.phone}</p>}
                {!client && mail && <a href={mail}>{person.email}</a>}
              </div>
              {client && mail && (
                <a
                  className={s.secondary}
                  href={mail}
                  aria-label={`Email ${person.name}`}
                >
                  Email
                </a>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
