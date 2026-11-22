import { Check } from "lucide-react";
import {
  appointment,
  clientTimelineTasks,
  nextClientStep,
  clientStepDetail,
  clientScheduledStep,
  clientAppointment,
  completed,
  notNeeded,
  shortDate,
  type PortalTask,
} from "./portal-model";
import s from "../_components/portal.module.css";

export function PortalTimeline({
  tasks,
  client = false,
  side,
  showNext = true,
}: {
  tasks: readonly PortalTask[];
  client?: boolean;
  side?: string;
  showNext?: boolean;
}) {
  const rows = client
    ? clientTimelineTasks(tasks, side)
    : tasks.filter((task) => !notNeeded(task));
  const skippedRows = client ? [] : tasks.filter(notNeeded);
  if (!rows.length && !skippedRows.length)
    return (
      <p className={s.muted}>
        Timeline details will appear here when they’re available.
      </p>
    );
  const next = client && showNext ? nextClientStep(rows) : null;
  return (
    <>
      {rows.length > 0 && (
        <ol className={`${s.timeline} ${client ? s.clientTimeline : ""}`}>
          {rows.map((task) => {
            const done = completed(task);
            const skipped = notNeeded(task);
            const upcoming = client && task.id === next?.id;
            const day = shortDate(task.dueDate);
            const detail = [task.dateLabel, appointment(task)]
              .filter(Boolean)
              .join(" · ");
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
                  {client ? (
                    <>
                      {done ? (
                        <p>Done</p>
                      ) : (
                        clientStepDetail(task, side) && (
                          <p>{clientStepDetail(task, side)}</p>
                        )
                      )}
                      {(!done ||
                        (side === "seller" &&
                          task.stepKey === "appraisal_ordered")) &&
                        clientScheduledStep(task, side) && (
                          <p
                            className={
                              task.appointmentAt
                                ? s.bookedAppointment
                                : undefined
                            }
                          >
                            {clientAppointment(task)}
                          </p>
                        )}
                    </>
                  ) : (
                    detail && <p>{detail}</p>
                  )}
                  {!client && task.note && <p>{task.note}</p>}
                </div>
                <span
                  className={`${s.timelineStatus} ${client && upcoming ? s.upNext : ""}`}
                >
                  {skipped
                    ? "Not needed"
                    : client
                      ? upcoming
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
