"use client";

import Link from "next/link";
import { useAllMatters } from "../../../(workspace)/workspace/_components/data";
import { AgentWorkspace } from "./AgentWorkspace";
import { usePortalSession } from "./portal-session";
import { fileAddress, fileStatus, type PortalFile } from "./portal-model";
import s from "../_components/portal.module.css";
import { ClientPreview } from "./PortalFile";

export function PortalHome() {
  const session = usePortalSession();
  return session.role === "agent" ? <AgentWorkspace /> : <ClientHome />;
}

function ClientHome() {
  const query = useAllMatters();
  const files: PortalFile[] = query.data;
  if (files.length === 1 && !query.error)
    return <ClientPreview id={files[0].id} />;
  return (
    <div className={`${s.clientWidth} ${s.clientFile}`}>
      <h1>Your transactions</h1>
      {query.error ? (
        <>
          <p role="alert">Could not open your transactions.</p>
          <button
            type="button"
            className={s.secondary}
            onClick={() => void query.refresh()}
          >
            Try again
          </button>
        </>
      ) : query.loading ? (
        <p role="status">Opening your transactions…</p>
      ) : files.length ? (
        <ul className={s.list}>
          {files.map((file) => (
            <li className={`${s.panel} ${s.listRow}`} key={file.id}>
              <div>
                <strong>{fileAddress(file)}</strong>
                <p>{fileStatus(file.stage)}</p>
              </div>
              <Link
                className={s.secondary}
                href={`/portal/transactions/${encodeURIComponent(file.id)}`}
              >
                View timeline
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p>No transactions have been shared with you.</p>
      )}
    </div>
  );
}
