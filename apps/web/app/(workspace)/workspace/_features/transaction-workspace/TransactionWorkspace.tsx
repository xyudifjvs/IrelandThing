"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, LockKeyhole } from "lucide-react";
import InitialFileReview from "../../_components/InitialFileReview";
import { useData, type Session } from "../../_components/data";
import type { TransactionAction } from "../../_components/transaction-controls";
import s from "../../_components/workspace.module.css";
import { useLiveData } from "../../../../_components/useLiveData";
import {
  useTransactionDocumentUploads,
  type TransactionDocumentUploads,
} from "../../../../_components/useTransactionDocumentUploads";
import { TransactionIntake } from "../creation/TransactionIntake";
import type { Review } from "../creation/review-model";
import { FileDocumentsPanel } from "../documents/FileDocumentsPanel";
import { FileEmailWorkspace } from "../emails/FileEmailWorkspace";
import { FileChecklist } from "./FileChecklist";
import { FileHeader } from "./FileHeader";
import { FileSidebar } from "./FileSidebar";
import {
  fileTabs,
  isActiveFile,
  isPendingFile,
  selectedFileTab,
  type FileTab,
  type TransactionFile,
} from "./file-model";
import styles from "./file-workspace.module.css";

function PendingFile({
  file,
  actorId,
  refresh,
  uploads,
}: {
  file: TransactionFile;
  actorId: string;
  refresh: () => Promise<void>;
  uploads: TransactionDocumentUploads;
}) {
  const receipt = useData<Review["intake"]>(
    `/api/v1/creation-reviews/matter/${encodeURIComponent(file.id)}/intake`,
  );
  if (receipt.loading)
    return <p role="status">Opening the submitted intake…</p>;
  if (receipt.error)
    return (
      <div role="alert" className={s.error}>
        Could not open the submitted intake.{" "}
        <button type="button" onClick={() => void receipt.refresh()}>
          Try again
        </button>
      </div>
    );
  if (receipt.data)
    return (
      <section className={styles.fileActions} aria-label="Pending intake">
        <p>This intake is waiting for confirmation.</p>
        <Link
          className={s.button}
          href={`/workspace/new?intakeId=${encodeURIComponent(receipt.data.id)}`}
        >
          Review intake
        </Link>
      </section>
    );
  // An older, already-started file can have a pending review without an intake receipt.
  return (
    <InitialFileReview
      matter={file}
      actorId={actorId}
      refresh={refresh}
      uploads={uploads}
    />
  );
}

function FileNavigation({
  tab,
  select,
}: {
  tab: FileTab;
  select: (next: FileTab) => void;
}) {
  return (
    <div
      className={styles.tabs}
      role="tablist"
      aria-label="Transaction sections"
    >
      {fileTabs.map(({ id, label }, index) => (
        <button
          key={id}
          type="button"
          role="tab"
          id={`file-tab-${id}`}
          aria-selected={id === tab}
          aria-controls={`file-panel-${id}`}
          tabIndex={id === tab ? 0 : -1}
          onClick={() => select(id)}
          onKeyDown={(event) => {
            let next = index;
            if (event.key === "ArrowRight")
              next = (index + 1) % fileTabs.length;
            else if (event.key === "ArrowLeft")
              next = (index + fileTabs.length - 1) % fileTabs.length;
            else if (event.key === "Home") next = 0;
            else if (event.key === "End") next = fileTabs.length - 1;
            else return;
            event.preventDefault();
            const target = fileTabs[next].id;
            select(target);
            document.getElementById(`file-tab-${target}`)?.focus();
          }}
        >
          {id === "emails" && <LockKeyhole size={13} aria-hidden="true" />}
          {label}
        </button>
      ))}
    </div>
  );
}

function FileWorkspace({ id, actorId }: { id: string; actorId: string }) {
  const router = useRouter();
  const search = useSearchParams();
  const tab = selectedFileTab(search.get("tab"));
  const query = useLiveData<TransactionFile>(
    `/api/v1/matters/${encodeURIComponent(id)}`,
    undefined,
    true,
  );
  const file = query.data;
  const pending = !!file && isPendingFile(file);
  const loaded = !!file && !pending;
  const active = loaded && isActiveFile(file);
  const documentUploads = useTransactionDocumentUploads({
    matterId: id,
    coordinator: true,
    actorId,
    authorized: active || pending,
  });
  const [template, setTemplate] = useState<string>();
  const [busy, setBusy] = useState("");
  const [error, setError] = useState<{ key: string; message: string } | null>(
    null,
  );
  const writeLock = useRef(false);

  useEffect(() => {
    if (loaded && tab === "checklist" && window.location.hash === "#dates")
      document.getElementById("dates")?.scrollIntoView();
  }, [loaded, tab]);

  const refresh = useCallback(async () => {
    // A polling read already in flight may have started before the write.
    await query.refresh();
    await query.refresh();
  }, [query.refresh]);

  const act: TransactionAction = async (key, mutation) => {
    if (writeLock.current) return;
    writeLock.current = true;
    setBusy(key);
    setError(null);
    try {
      await mutation();
      if (key === "lifecycle:delete") return;
      await refresh();
    } catch (failure) {
      setError({
        key,
        message:
          failure instanceof Error
            ? failure.message
            : "Could not save the file change.",
      });
      await refresh();
    } finally {
      writeLock.current = false;
      setBusy("");
    }
  };

  function select(next: FileTab) {
    if (next === tab) return;
    if (next !== "emails") setTemplate(undefined);
    const url = new URL(window.location.href);
    if (next === "checklist") url.searchParams.delete("tab");
    else url.searchParams.set("tab", next);
    if (url.hash === "#dates") url.hash = "";
    window.history.pushState(null, "", url.pathname + url.search + url.hash);
    if (next === "documents") void query.refresh();
  }

  if (query.loading && !file)
    return (
      <p className={s.loading} role="status">
        Opening your transaction…
      </p>
    );
  if (!file)
    return (
      <div className={s.error} role="alert">
        This transaction is unavailable.{" "}
        <button type="button" onClick={() => void query.refresh()}>
          Try again
        </button>
        <p>
          <Link href="/workspace/transactions">Back to transactions</Link>
        </p>
      </div>
    );
  const lifecycleError = error?.key.startsWith("lifecycle:");
  return (
    <div className={styles.workspace}>
      <Link className={s.backLink} href="/workspace/transactions">
        <ArrowLeft aria-hidden="true" />
        All transactions
      </Link>
      <FileHeader
        file={file}
        canEdit={active && !!file.revision}
        busy={!!busy}
        act={act}
      />
      {error && !lifecycleError && (
        <p role="alert" className={s.error}>
          {error.message}
        </p>
      )}
      {pending ? (
        <PendingFile
          file={file}
          actorId={actorId}
          refresh={refresh}
          uploads={documentUploads}
        />
      ) : (
        <>
          <FileNavigation tab={tab} select={select} />
          <div className={styles.columns}>
            <div className={styles.content}>
              {fileTabs.map(({ id: panel }) => (
                <div
                  key={panel}
                  role="tabpanel"
                  id={`file-panel-${panel}`}
                  aria-labelledby={`file-tab-${panel}`}
                  tabIndex={0}
                  hidden={tab !== panel}
                >
                  {tab === panel && (
                    <>
                      {panel === "checklist" && (
                        <div id="dates">
                          <FileChecklist
                            file={file}
                            readOnly={!active}
                            busy={busy}
                            act={act}
                            actionError={
                              lifecycleError ? error?.message : undefined
                            }
                            openTemplate={(templateId) => {
                              setTemplate(templateId);
                              select("emails");
                            }}
                            onDeleted={() =>
                              router.replace("/workspace/transactions")
                            }
                          />
                        </div>
                      )}
                      {panel === "emails" && (
                        <FileEmailWorkspace
                          matterId={id}
                          side={file.side ?? ""}
                          packageCode={file.packageCode ?? ""}
                          contacts={file.contacts}
                          directContact={file.details?.directContact}
                          readOnly={!active}
                          initialTemplateId={template}
                        />
                      )}
                      {panel === "documents" && (
                        <FileDocumentsPanel
                          matterId={id}
                          documents={file.documents ?? []}
                          role="coordinator"
                          stage={file.stage ?? ""}
                          uploads={documentUploads}
                          refresh={refresh}
                        />
                      )}
                      {panel === "intake" && (
                        <TransactionIntake matterId={id} />
                      )}
                    </>
                  )}
                </div>
              ))}
            </div>
            <FileSidebar file={file} readOnly={!active} refresh={refresh} />
          </div>
        </>
      )}
    </div>
  );
}

export function TransactionDetail({ id }: { id: string }) {
  const session = useLiveData<Session>("/api/v1/session", undefined, true);
  const actor = session.data?.user;
  if (session.loading && !actor)
    return (
      <p className={s.loading} role="status">
        Checking your session…
      </p>
    );
  if (!actor || actor.role !== "coordinator")
    return (
      <p className={s.error} role="alert">
        Confirm your coordinator session to open this file.{" "}
        <button type="button" onClick={() => void session.refresh()}>
          Try again
        </button>
      </p>
    );
  return <FileWorkspace key={`${actor.id}:${id}`} id={id} actorId={actor.id} />;
}
