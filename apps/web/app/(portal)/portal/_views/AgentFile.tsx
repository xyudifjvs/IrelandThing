"use client";

import { useEffect, useId, useState, type KeyboardEvent } from "react";
import Link from "next/link";
import { useLiveData } from "../../../_components/useLiveData";
import { DocumentUploadQueue } from "../../../_components/DocumentUploadQueue";
import { useTransactionDocumentUploads } from "../../../_components/useTransactionDocumentUploads";
import { PortalDocuments } from "./PortalDocuments";
import { PortalTimeline } from "./PortalTimeline";
import { AgentSidebar } from "./AgentSidebar";
import { usePortalSession } from "./portal-session";
import {
  activeStage,
  closingTask,
  displayLabel,
  fileAddress,
  fileStatus,
  shortDate,
  type PortalFile,
} from "./portal-model";
import s from "../_components/portal.module.css";

const tabs = ["Timeline", "Documents"] as const;
type Tab = (typeof tabs)[number];

export function AgentFile({ id }: { id: string }) {
  const { id: actorId } = usePortalSession();
  const query = useLiveData<PortalFile>(
    `/api/v1/matters/${encodeURIComponent(id)}`,
    undefined,
    true,
  );
  const [tab, setTab] = useState<Tab>("Timeline");
  const tabId = useId();
  const file = query.data;
  const active = activeStage(file?.stage);
  const uploads = useTransactionDocumentUploads({
    matterId: id,
    actorId,
    authorized: !!file && active,
  });
  useEffect(
    () => uploads.registerRefresh(query.refresh),
    [uploads.registerRefresh, query.refresh],
  );

  function navigateTabs(
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? tabs.length - 1
          : (index + 1) % tabs.length;
    window.document.getElementById(`${tabId}-${tabs[next]}`)?.focus();
    setTab(tabs[next]);
  }

  if (!file)
    return (
      <section className={s.panel} aria-label="Transaction file">
        {query.loading ? (
          <p role="status">Opening your file…</p>
        ) : (
          <>
            <p role="alert">This file is unavailable.</p>
            <button
              type="button"
              className={s.secondary}
              onClick={() => void query.refresh()}
            >
              Try again
            </button>
          </>
        )}
      </section>
    );

  if (file.stage === "pending_review")
    return (
      <section className={s.panel} aria-label="Intake receipt">
        <h1 className={s.fileTitle}>{fileAddress(file)}</h1>
        <p>
          <span className={`${s.badge} ${s.received}`}>
            {fileStatus(file.stage)}
          </span>
        </p>
        <p>
          Ireland is reviewing your intake
          {file.createdAt ? ` (sent ${shortDate(file.createdAt)})` : ""}. The
          timeline appears once she creates the file.
        </p>
        {!!file.documents?.length && (
          <PortalDocuments documents={file.documents} />
        )}
      </section>
    );

  const closingStep = closingTask(file.tasks);
  const closing = active
    ? closingStep?.dateLabel || shortDate(closingStep?.dueDate)
    : shortDate(file.closedOn || closingStep?.dueDate);
  const archive =
    file.stage === "closed"
      ? `/api/v1/documents/archive/${encodeURIComponent(file.id)}`
      : undefined;
  const clientNames = file.people
    ?.filter(({ role }) =>
      ["client", "buyer", "seller"].includes(role.toLowerCase()),
    )
    .map(({ name }) => name);
  return (
    <div className={s.columns}>
      <section className={s.panel} aria-label="Transaction file">
        <div className={s.fileHeading}>
          <div>
            <h1 className={s.fileTitle}>{fileAddress(file)}</h1>
            <p>
              {[
                file.side ? displayLabel(file.side) + " side" : "",
                clientNames?.join(", "),
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>
          <div className={s.fileClosing}>
            <span className={s.eyebrow}>
              {active ? "Closing" : fileStatus(file.stage)}
            </span>
            {closing && file.stage !== "terminated" && (
              <strong>{closing}</strong>
            )}
          </div>
        </div>
        {file.stage === "terminated" && (
          <p className={s.replacement}>
            <Link
              href={`/portal/intake?${new URLSearchParams({
                replaces: file.id,
                side: file.side || "buyer",
                package:
                  file.packageCode === "complete" ? "complete" : "essentials",
              })}`}
            >
              Start a linked replacement intake
            </Link>
          </p>
        )}
        <div className={s.tabs} role="tablist" aria-label="File views">
          {tabs.map((item, index) => (
            <button
              key={item}
              type="button"
              role="tab"
              id={`${tabId}-${item}`}
              aria-controls={`${tabId}-panel`}
              aria-selected={item === tab}
              tabIndex={item === tab ? 0 : -1}
              onClick={() => setTab(item)}
              onKeyDown={(event) => navigateTabs(event, index)}
            >
              {item}
            </button>
          ))}
        </div>
        <div
          id={`${tabId}-panel`}
          role="tabpanel"
          aria-labelledby={`${tabId}-${tab}`}
          tabIndex={0}
        >
          {tab === "Timeline" ? (
            <PortalTimeline tasks={file.tasks || []} />
          ) : (
            <>
              <PortalDocuments
                documents={file.documents || []}
                archiveHref={archive}
              />
              {active && (
                <DocumentUploadQueue
                  queue={uploads.queue}
                  label="Add documents"
                  disabled={!uploads.enabled}
                />
              )}
            </>
          )}
        </div>
      </section>
      <AgentSidebar file={file} />
    </div>
  );
}
