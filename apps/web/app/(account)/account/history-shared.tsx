import s from "./account.module.css";

export type Page<T, S> = {
  items: T[];
  nextCursor: string | null;
  total: number;
  summary: S;
};

const limit = 20;
export function badgeClass(value: string) {
  if (["paid", "closed"].includes(value)) return `${s.badge} ${s.positive}`;
  if (["failed", "disputed", "terminated"].includes(value))
    return `${s.badge} ${s.negative}`;
  return s.badge;
}
export function pathWithQuery(
  endpoint: string,
  filters: Record<string, string>,
  cursor: string | null,
) {
  const params = new URLSearchParams({ ...filters, limit: String(limit) });
  if (cursor) params.set("cursor", cursor);
  return `${endpoint}?${params}`;
}
export function ErrorState({
  title,
  error,
  refresh,
  reset,
}: {
  title: string;
  error: string;
  refresh: () => Promise<void>;
  reset?: () => void;
}) {
  return (
    <div className={s.error} role="alert">
      <p>
        <strong>{title}</strong>
      </p>
      <p>{error}</p>
      <button className={s.secondary} onClick={() => void refresh()}>
        Try again
      </button>
      {reset && (
        <button className={s.secondary} onClick={reset}>
          Return to first page
        </button>
      )}
    </div>
  );
}
export function Pagination({
  name,
  page,
  count,
  total,
  nextCursor,
  previous,
  next,
}: {
  name: string;
  page: number;
  count: number;
  total: number;
  nextCursor: string | null;
  previous: () => void;
  next: () => void;
}) {
  return (
    <nav className={s.pagination} aria-label={`${name} pagination`}>
      <span>
        {count
          ? `${page * limit + 1}–${page * limit + count} of ${total}`
          : `0 of ${total}`}{" "}
        · Page {page + 1}
      </span>
      <div className={s.actions}>
        <button
          className={s.secondary}
          disabled={page === 0}
          onClick={previous}
        >
          Previous
        </button>
        <button className={s.secondary} disabled={!nextCursor} onClick={next}>
          Next
        </button>
      </div>
    </nav>
  );
}
