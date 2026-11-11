"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import {
  useData,
  mutate,
  address,
  label,
  serviceName,
  progress,
  type Matter,
  type Session,
} from "../../_components/data";
import InitialFileReview from "../../_components/InitialFileReview";
import DocumentFiles from "../../_components/DocumentFiles";
import SavedIntakeDetails from "../../../../_components/SavedIntakeDetails";
import { LiveStatus, useLiveData } from "../../../../_components/useLiveData";
import { useTransactionDocumentUploads } from "../../../../_components/useTransactionDocumentUploads";
import {
  TransactionChecklistPanel,
  useChecklistDraft,
} from "../checklist/TransactionChecklistPanel";
import { LegacyDatesPanel } from "../checklist/LegacyDatesPanel";
import { LegacyTransactionEmailPanel } from "../emails/LegacyTransactionEmailPanel";
import { LegacyFileNotesPanel } from "../private-notes/LegacyFileNotesPanel";
import { LegacyFilePeoplePanel } from "../people/LegacyFilePeoplePanel";
import { LegacyBrokerPanel } from "./LegacyBrokerPanel";
import s from "../../_components/workspace.module.css";

export function TransactionDetail({ id }: { id: string }) {
  const q = useLiveData<Matter>(`/api/v1/matters/${id}`, undefined, true);
  const session = useData<Session>("/api/v1/session");
  const documentUploads = useTransactionDocumentUploads({
    matterId: id,
    coordinator: true,
    actorId: session.data?.user?.id,
    authorized: !!q.data && session.data?.user?.role === "coordinator",
  });
  const [tab, setTab] = useState("Checklist");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [note, setNote] = useState("");
  const checklistDraft = useChecklistDraft();
  const [person, setPerson] = useState({ userId: "", role: "client" });
  const [notice, setNotice] = useState("");
  async function act(key: string, fn: () => Promise<unknown>) {
    setBusy(key);
    setError("");
    setNotice("");
    try {
      await fn();
      await q.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  if (q.loading && !q.data)
    return <div className={s.loading}>Opening your transaction…</div>;
  if (!q.data)
    return (
      <div className={s.error}>
        {q.error || "Transaction not found."}
        <LiveStatus query={q} />
        <p>
          <Link href="/workspace">Return to workspace</Link>
        </p>
      </div>
    );
  const m = q.data;
  return (
    <>
      <Link className={s.backLink} href="/workspace/transactions">
        <ArrowLeft />
        All transactions
      </Link>
      {m.stage === "terminated" && (
        <p>
          <Link
            href={`/workspace/new?replaces=${m.id}&side=${m.side}&package=${m.packageCode === "complete" ? "complete" : "essentials"}`}
          >
            Start a linked replacement transaction
          </Link>
        </p>
      )}
      <div className={s.detailHeader}>
        <div className={s.split}>
          <div>
            <p className={s.eyebrow}>Your transaction file</p>
            <h1>{m.title || address(m)}</h1>
            <p>{address(m)}</p>
          </div>
          <span
            className={`${s.pill} ${m.stage === "closed" ? s.pillGreen : ""}`}
          >
            {label(m.stage)}
          </span>
        </div>
        <div className={s.chips}>
          <label className={s.fieldHint}>
            Stage{" "}
            <select
              className={s.select}
              value={m.stage}
              disabled={!!busy || m.stage === "pending_review"}
              onChange={(e) =>
                void act("stage", () =>
                  mutate(
                    `/api/v1/matters/${id}`,
                    { expectedRevision: m.revision, stage: e.target.value },
                    "PATCH",
                  ),
                )
              }
            >
              {[
                "pending_review",
                "listing",
                "under_contract",
                "closing",
                "closed",
                "terminated",
                "archived",
              ].map((v) => (
                <option value={v} key={v}>
                  {label(v)}
                </option>
              ))}
            </select>
          </label>
          <span className={s.pill}>{label(m.side)} side</span>
          <span className={s.pill}>{serviceName(m)}</span>
          {m.details?.cash === true && (
            <span className={s.pill}>Cash purchase</span>
          )}
          <span className={s.pill}>{progress(m)}% of checklist complete</span>
        </div>
        <div className={s.progress} style={{ marginTop: 23 }}>
          <span style={{ width: `${progress(m)}%` }} />
        </div>
      </div>
      {error && (
        <div className={s.error} role="alert">
          {error}
        </div>
      )}
      {notice && <div className={s.notice}>{notice}</div>}
      <LiveStatus query={q} />
      {m.stage === "pending_review" && (
        <InitialFileReview
          matter={m}
          refresh={q.refresh}
          uploads={documentUploads}
          actorId={session.data?.user?.id}
        />
      )}
      {m.stage !== "pending_review" && (
        <SavedIntakeDetails value={m.details?.referenceIntake} />
      )}
      {Array.isArray(
        (m.details?.fileReview as { unresolvedDates?: unknown[] } | undefined)
          ?.unresolvedDates,
      ) && (
        <div className={s.notice}>
          {(
            m.details!.fileReview as {
              unresolvedDates: {
                deadlineId: string;
                label: string;
                reason: string;
              }[];
            }
          ).unresolvedDates
            .filter((item) =>
              m.deadlines?.some(
                (d) => d.id === item.deadlineId && d.status !== "confirmed",
              ),
            )
            .map((item) => (
              <p key={item.deadlineId}>
                <strong>Unresolved: {item.label}</strong> · {item.reason}
              </p>
            ))}
        </div>
      )}
      <div className={s.tabs} role="tablist" aria-label="Transaction sections">
        {[
          "Checklist",
          "Documents",
          "Emails",
          "Broker file",
          "My notes & to-do",
        ].map((t, index, tabs) => (
          <button
            key={t}
            role="tab"
            id={`transaction-tab-${index}`}
            aria-selected={tab === t}
            aria-controls="transaction-panel"
            tabIndex={tab === t ? 0 : -1}
            onKeyDown={(event) => {
              let next = index;
              if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
              else if (event.key === "ArrowLeft")
                next = (index - 1 + tabs.length) % tabs.length;
              else if (event.key === "Home") next = 0;
              else if (event.key === "End") next = tabs.length - 1;
              else return;
              event.preventDefault();
              setTab(tabs[next]);
              document.getElementById(`transaction-tab-${next}`)?.focus();
            }}
            onClick={() => setTab(t)}
            className={tab === t ? s.tabActive : ""}
          >
            {t}
          </button>
        ))}
      </div>
      <div
        className={s.twoCol}
        role="tabpanel"
        id="transaction-panel"
        tabIndex={0}
        aria-labelledby={`transaction-tab-${["Checklist", "Documents", "Emails", "Broker file", "My notes & to-do"].indexOf(tab)}`}
      >
        <div>
          {tab === "Checklist" && (
            <>
              <TransactionChecklistPanel
                matter={m}
                id={id}
                busy={busy}
                act={act}
                draft={checklistDraft}
              />
              <LegacyDatesPanel
                matter={m}
                id={id}
                busy={busy}
                act={act}
                setNotice={setNotice}
              />
            </>
          )}
          {tab === "Documents" && (
            <DocumentFiles
              matterId={id}
              coordinator
              uploads={documentUploads}
            />
          )}
          {tab === "Emails" && <LegacyTransactionEmailPanel id={id} />}
          {tab === "Broker file" && (
            <LegacyBrokerPanel matter={m} id={id} busy={busy} act={act} />
          )}
          {tab === "My notes & to-do" && (
            <LegacyFileNotesPanel
              matter={m}
              id={id}
              busy={busy}
              act={act}
              note={note}
              setNote={setNote}
            />
          )}
        </div>
        <LegacyFilePeoplePanel
          matter={m}
          id={id}
          busy={busy}
          act={act}
          person={person}
          setPerson={setPerson}
          refresh={q.refresh}
        />
      </div>
    </>
  );
}
