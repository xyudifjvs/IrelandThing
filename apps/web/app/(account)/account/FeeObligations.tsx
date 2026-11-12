import Link from "next/link";
import {
  feeStatus,
  money,
  type FeeSummary,
  type FileSummary,
} from "../../(portal)/portal/_views/portal-model";
import s from "./account.module.css";

export function FeeObligations({
  data,
  loading,
  error,
  retry,
}: {
  data: readonly FileSummary[];
  loading: boolean;
  error: boolean;
  retry: () => void;
}) {
  if (!loading && !error && !data.length) return null;
  return (
    <section
      className={s.section}
      id="upcoming-payments"
      aria-labelledby="obligations-title"
    >
      <div className={s.sectionHeader}>
        <h2 id="obligations-title">Upcoming payments</h2>
      </div>
      <div className={s.body}>
        {loading && <p role="status">Opening upcoming payments…</p>}
        {error && (
          <>
            <p role="alert">Could not open upcoming payments.</p>
            <button className={s.secondary} type="button" onClick={retry}>
              Try again
            </button>
          </>
        )}
        {data.length > 0 && (
          <ul className={s.obligations}>
            {data.map((file) => (
              <li key={file.matterId}>
                <Link
                  href={`/portal/transactions/${encodeURIComponent(file.matterId)}`}
                >
                  {file.propertyAddress || "Transaction"}
                </Link>
                {file.service && <FeeRow fee={file.service} />}
                {file.gift && <FeeRow fee={file.gift} gift />}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function FeeRow({ fee, gift = false }: { fee: FeeSummary; gift?: boolean }) {
  return (
    <div className={s.obligation}>
      <span>
        {gift ? "Closing gift · " : ""}
        {fee.name}
      </span>
      <span>{feeStatus(fee)}</span>
      {fee.amountCents !== null && fee.currency && (
        <strong>{money(fee.amountCents, fee.currency)}</strong>
      )}
    </div>
  );
}
