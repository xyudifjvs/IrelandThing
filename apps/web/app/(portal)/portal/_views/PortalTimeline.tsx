import { Check } from "lucide-react";
import {
  appointment,
  clientStepDate,
  completed,
  nextDatedStep,
  notNeeded,
  shortDate,
  type PortalTask,
} from "./portal-model";
import s from "../_components/portal.module.css";

export function PortalTimeline({
  tasks,
  client = false,
}: {
  tasks: readonly PortalTask[];
  client?: boolean;
}) {
  const rows = client
    ? tasks.filter((task) => !notNeeded(task) && task.kind !== "client_request")
    : tasks.filter((task) => !notNeeded(task));
  const skippedRows = client ? [] : tasks.filter(notNeeded);
  if (!rows.length && !skippedRows.length)
    return (
      <p className={s.muted}>
        Timeline details will appear here when they’re available.
      </p>
    );
  const next = client
    ? (nextDatedStep(rows) ?? rows.find((task) => !completed(task)))
    : null;
  return (
    <>
      {rows.length > 0 && (
        <ol className={s.timeline}>
          {rows.map((task) => {
            const done = completed(task);
            const skipped = notNeeded(task);
            const upcoming = client && task.id === next?.id;
            const day = shortDate(task.dueDate);
            const detail =
              client || task.dateLabel
                ? clientStepDate(task)
                : appointment(task);
            return (
              <li key={task.id} className={s.timelineRow}>
                <span
                  aria-hidden="true"
                  className={`${s.tick} ${done ? s.tickDone : upcoming ? s.tickNext : ""}`}
                >
                  {done && <Check size={13} />}
                </span>
                <div>
                  <h3>{task.title}</h3>
                  {detail && <p>{detail}</p>}
                  {!client && task.note && <p>{task.note}</p>}
                </div>
                <span className={s.timelineStatus}>
                  {skipped
                    ? "Not needed"
                    : client
                      ? done
                        ? "Done"
                        : upcoming
                          ? "Up next"
                          : ""
                      : task.dateLabel
                        ? done
                          ? "Done"
                          : ""
                        : day}
                  {!client && done && !task.dateLabel && (
                    <span className={s.visuallyHidden}>Done</span>
                  )}
                </span>
              </li>
            );
          })}
        </ol>
      )}
      {skippedRows.length > 0 && (
        <details className={s.notNeeded}>
          <summary>{skippedRows.length} not needed</summary>
          <ul className={s.list}>
            {skippedRows.map((task) => (
              <li key={task.id} className={s.notNeededRow}>
                <span>{task.title}</span>
                <span className={s.notNeededTag}>Not needed</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
}
