import {
  answerLabel,
  answerText,
  type ReferenceIntake,
} from "../(portal)/portal/_components/reference-model";
export default function SavedIntakeDetails({ value }: { value: unknown }) {
  const ref = value as ReferenceIntake | undefined;
  if (!ref || ref.version !== 1 || !ref.fields) return null;
  return (
    <section
      style={{
        padding: 22,
        marginBottom: 20,
        border: "1px solid #e2d6c3",
        borderRadius: 12,
        background: "#faf6ef",
      }}
    >
      <h2>Submitted intake</h2>
      <p>
        {ref.variant.startsWith("seller") ? "Seller" : "Buyer"} ·{" "}
        {ref.variant.endsWith("compliance")
          ? "Contract to Close + Compliance"
          : "Contract to Close"}
      </p>
      <details>
        <summary>All saved answers and documents</summary>
        <dl
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(110px,1fr) minmax(0,2fr)",
            gap: "8px 16px",
            fontSize: 13,
            overflowWrap: "anywhere",
          }}
        >
          {Object.entries(ref.fields)
            .filter(([, v]) => v !== "" && v !== false)
            .map(([key, value]) => (
              <div key={key} style={{ display: "contents" }}>
                <dt>{answerLabel(key, String(ref.fields.side))}</dt>
                <dd style={{ margin: 0, whiteSpace: "pre-wrap" }}>
                  {answerText(key, value)}
                </dd>
              </div>
            ))}
          {Object.entries(ref.uploads)
            .filter(([, ids]) => ids.length)
            .map(([key, ids]) => (
              <div key={key} style={{ display: "contents" }}>
                <dt>
                  {{
                    contractDocs: "Contract documents",
                    hoaFiles: "HOA documents",
                    utilFiles: "Utilities / previous title policy",
                    policyFiles: "Previous title policy",
                  }[key] || key}
                </dt>
                <dd style={{ margin: 0 }}>
                  {ids.map((id) => (
                    <p key={id}>
                      {ref.fileNames[id] || "Saved private document"}
                    </p>
                  ))}
                </dd>
              </div>
            ))}
        </dl>
      </details>
    </section>
  );
}
