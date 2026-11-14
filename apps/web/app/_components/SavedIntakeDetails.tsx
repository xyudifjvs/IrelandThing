import {
  answerLabel,
  answerText,
  type ReferenceIntake,
} from "../(portal)/portal/_components/reference-model";
import s from "./saved-intake-details.module.css";

type Submitter = {
  name: string;
  email: string;
  brokerage: string | null;
  phone: string | null;
};

function asRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function fieldLabel(key: string) {
  const label = key.replace(/([a-z\d])([A-Z])/g, "$1 $2").replaceAll("_", " ");
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function Answer({ value }: { value: unknown }) {
  if (Array.isArray(value))
    return value.length ? (
      <ul>
        {value.map((entry, index) => (
          <li key={index}>
            <Answer value={entry} />
          </li>
        ))}
      </ul>
    ) : (
      "None"
    );
  const nested = asRecord(value);
  if (nested) return <Answers entries={Object.entries(nested)} />;
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return typeof value === "number" || (typeof value === "string" && value)
    ? String(value)
    : "Not provided";
}

function Answers({ entries }: { entries: [string, unknown][] }) {
  return (
    <dl className={s.answers}>
      {entries.map(([key, value]) => (
        <div key={key}>
          <dt>{fieldLabel(key)}</dt>
          <dd>
            <Answer value={value} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

function readReference(value: unknown) {
  const record = asRecord(value);
  const uploads = asRecord(record?.uploads);
  return record?.version === 1 &&
    typeof record.variant === "string" &&
    asRecord(record.fields) &&
    uploads &&
    Object.values(uploads).every(Array.isArray) &&
    asRecord(record.fileNames)
    ? (record as unknown as ReferenceIntake)
    : null;
}

function ReferenceAnswers({ value }: { value: ReferenceIntake }) {
  const side = String(value.fields.side || value.variant.split("-")[0]);
  return (
    <dl className={s.answers}>
      {Object.entries(value.fields).map(([key, answer]) => (
        <div key={key}>
          <dt>{answerLabel(key, side)}</dt>
          <dd>{answer === "" ? "Not provided" : answerText(key, answer)}</dd>
        </div>
      ))}
      {Object.entries(value.uploads)
        .filter(([, ids]) => ids.length > 0)
        .map(([key, ids]) => (
          <div key={key}>
            <dt>
              {{
                contractDocs: "Contract documents",
                hoaFiles: "HOA documents",
                utilFiles: "Utilities / previous title policy",
                policyFiles: "Previous title policy",
              }[key] || fieldLabel(key)}
            </dt>
            <dd>
              <ul>
                {ids.map((id) => (
                  <li key={id}>
                    {value.fileNames[id] || "Saved private document"}
                  </li>
                ))}
              </ul>
            </dd>
          </div>
        ))}
    </dl>
  );
}

export default function SavedIntakeDetails({
  value,
  agent,
  agentSource,
  documents,
}: {
  value: unknown;
  agent?: Submitter | null;
  agentSource?: "submitted" | "current_profile" | null;
  documents?: { id: string; name: string }[];
}) {
  const snapshot = asRecord(value);
  if (!snapshot) return null;
  const legacyReference = readReference(snapshot);
  const reference = legacyReference ?? readReference(snapshot.referenceIntake);
  const entries = legacyReference
    ? []
    : Object.entries(snapshot).filter(
        ([key]) =>
          !["fileReview", "serviceSnapshot", "submitter"].includes(key) &&
          (!reference || key !== "referenceIntake") &&
          (!(reference || documents) || key !== "documentIds"),
      );
  const namedDocuments = documents?.filter(
    ({ id }) =>
      !reference || !Object.values(reference.uploads).flat().includes(id),
  );
  const submitter = agent && (
    <Answers
      entries={[
        ["agent", agent.name],
        ["brokerage", agent.brokerage],
        ["email", agent.email],
        ["phone", agent.phone],
      ]}
    />
  );
  return (
    <section className={s.intake}>
      <h2>What the agent submitted</h2>
      <details>
        <summary>
          <span className={s.open}>Show all details</span>
          <span className={s.close}>Hide details</span>
        </summary>
        {agentSource === "submitted" && submitter}
        {entries.length > 0 && <Answers entries={entries} />}
        {namedDocuments && namedDocuments.length > 0 && (
          <Answers
            entries={[
              ["Uploaded documents", namedDocuments.map(({ name }) => name)],
            ]}
          />
        )}
        {reference && <ReferenceAnswers value={reference} />}
        {submitter && agentSource !== "submitted" && (
          <aside aria-label="Current agent profile for this historical intake">
            <h3>Current agent profile for this historical intake</h3>
            {submitter}
          </aside>
        )}
      </details>
    </section>
  );
}
