import s from "../../_components/workspace.module.css";
import p from "./portfolio.module.css";
import type { ListPage } from "./model";

export function Pagination({
  data,
  change,
  disabled,
}: {
  data: ListPage<unknown> | null;
  change: (page: number) => void;
  disabled: boolean;
}) {
  if (!data || (data.total <= data.limit && data.page === 1)) return null;
  const pages = Math.max(1, Math.ceil(data.total / data.limit));
  return (
    <div className={p.pagination}>
      <button
        type="button"
        className={s.buttonSmall}
        disabled={disabled || data.page === 1}
        onClick={() => change(data.page - 1)}
      >
        Previous
      </button>
      <span>
        Page {data.page} of {pages}
      </span>
      <button
        type="button"
        className={s.buttonSmall}
        disabled={disabled || data.page >= pages}
        onClick={() => change(data.page + 1)}
      >
        Next
      </button>
    </div>
  );
}
