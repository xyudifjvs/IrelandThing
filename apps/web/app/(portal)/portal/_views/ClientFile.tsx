import type { ReactNode } from "react";
import { PortalBrand, ClientFooter } from "./PortalBrand";
import { PortalDocuments } from "./PortalDocuments";
import { PortalTimeline } from "./PortalTimeline";
import { PortalPeople } from "./PortalPeople";
import {
  closingTask,
  completed,
  fileAddress,
  fileGroup,
  fileStatus,
  nextDatedSteps,
  clientTimelineTasks,
  clientStepDate,
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
        <PortalBrand variant="client" />
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
  const visibleTasks = clientTimelineTasks(file.tasks || [], file.side);
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
  const tasks = clientTimelineTasks(
    [...visibleTasks, ...historicDates],
    file.side,
  );
  const closing = closingTask(tasks);
  const finished = fileGroup(file.stage) !== "active";
  const next = !finished ? nextDatedSteps(tasks) : [];
  const done = tasks.filter(completed).length;
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
                max={tasks.length}
              />
              <small>
                {done} of {tasks.length} steps complete
              </small>
            </>
          )}
        </section>
      )}
      {next.length > 0 && (
        <section
          className={`${s.panel} ${s.nextPanel}`}
          aria-label="What’s next"
        >
          <p className={s.eyebrow}>What’s next</p>
          {next.length === 1 ? (
            <>
              <h2>{next[0].title}</h2>
              <p>{clientStepDate(next[0])}</p>
            </>
          ) : (
            <ul className={s.nextSteps}>
              {next.map((task) => (
                <li key={task.id}>
                  <strong>{task.title}</strong> · {clientStepDate(task)}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
      <section className={s.panel} aria-label="Your timeline">
        <h2>Your timeline</h2>
        <PortalTimeline
          tasks={tasks}
          client
          side={file.side}
          showNext={!finished}
        />
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
