import { Check } from "lucide-react";
import {
  appointment,
  completed,
  nextDatedStep,
  notNeeded,
  scheduledStep,
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
    : tasks;
  if (!rows.length)
    return (
      <p className={s.muted}>
        Timeline details will appear here when they’re available.
      </p>
    );
  const next = client
    ? (nextDatedStep(rows) ?? rows.find((task) => !completed(task)))
    : null;
  return (
    <ol className={s.timeline}>
      {rows.map((task) => {
        const done = completed(task);
        const skipped = notNeeded(task);
        const upcoming = client && task.id === next?.id;
        const time = appointment(task);
        const day = shortDate(task.dueDate);
        const detail =
          client && scheduledStep(task)
            ? time || (day ? day + " · Details to come" : "Details to come")
            : client
              ? day
              : time;
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
                  : day}
              {!client && done && (
                <span className={s.visuallyHidden}>Done</span>
              )}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
