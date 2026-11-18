import type { ReactNode } from "react";
import { PortalBrand, ClientFooter } from "./PortalBrand";
import { PortalDocuments } from "./PortalDocuments";
import { PortalTimeline } from "./PortalTimeline";
import { PortalPeople } from "./PortalPeople";
import {
  clientStepDate,
  closingTask,
  completed,
  fileAddress,
  fileGroup,
  fileStatus,
  nextDatedStep,
  notNeeded,
  shortDate,
  type PortalFile,
  type PortalTask,
} from "./portal-model";
import s from "../_components/portal.module.css";

export function ClientHeader({
  side,
  children,
}: {
  side?: string;
  children?: ReactNode;
}) {
  return (
    <header className={s.header}>
      <div className={`${s.headerInner} ${s.clientWidth}`}>
        <PortalBrand />
        {children || (
          <span className={s.headerLabel}>
            {side === "seller"
              ? "Your home sale"
              : side === "buyer"
                ? "Your home purchase"
                : "Client portal"}
          </span>
        )}
      </div>
    </header>
  );
}

export function ClientFile({
  file,
  bearer,
}: {
  file: PortalFile;
  bearer?: string;
}) {
  const visibleTasks = (file.tasks || []).filter(
    (task) => !notNeeded(task) && task.kind !== "client_request",
  );
  // Legacy files can still carry separate confirmed dates. Include only the
  // existing role-approved dates that don't duplicate a shared task.
  const historicDates: PortalTask[] = (file.deadlines || [])
    .filter(
      (deadline) =>
        deadline.status === "confirmed" &&
        deadline.date &&
        !visibleTasks.some(
          (task) =>
            task.title.trim().toLowerCase() ===
            deadline.label.trim().toLowerCase(),
        ),
    )
    .map((deadline) => ({
      id: `date:${deadline.id}`,
      title: deadline.label,
      status: "pending",
      dueDate: deadline.date,
    }));
  const tasks = [...visibleTasks, ...historicDates];
  const closing = closingTask(tasks);
  const finished = fileGroup(file.stage) !== "active";
  const next = !finished ? nextDatedStep(tasks) : null;
  const done = visibleTasks.filter(completed).length;
  const closingDate = finished
    ? shortDate(file.closedOn || closing?.dueDate)
    : closing?.dateLabel || shortDate(closing?.dueDate);
  return (
    <div className={`${s.clientWidth} ${s.clientFile}`}>
      <h1>{fileAddress(file)}</h1>
      {(closingDate || finished || visibleTasks.length > 0) && (
        <section className={s.closingSummary} aria-label="Transaction status">
          <span>{finished ? fileStatus(file.stage) : "Closing"}</span>
          {file.stage !== "terminated" && (
            <strong>{closingDate || (!finished ? "Date to come" : "")}</strong>
          )}
          {!finished && visibleTasks.length > 0 && (
            <>
              <progress
                aria-label="Timeline progress"
                value={done}
                max={visibleTasks.length}
              />
              <small>
                {done} of {visibleTasks.length} steps complete
              </small>
            </>
          )}
        </section>
      )}
      {next && (
        <section
          className={`${s.panel} ${s.nextPanel}`}
          aria-label="What’s next"
        >
          <p className={s.eyebrow}>What’s next</p>
          <h2>{next.title}</h2>
          <p>{clientStepDate(next)}</p>
        </section>
      )}
      <section className={s.panel} aria-label="Your timeline">
        <h2>Your timeline</h2>
        <PortalTimeline tasks={tasks} client />
      </section>
      <PortalDocuments
        documents={file.documents || []}
        client
        bearer={bearer}
      />
      <PortalPeople people={file.people || []} client />
      <ClientFooter />
    </div>
  );
}
