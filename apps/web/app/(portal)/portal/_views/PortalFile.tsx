"use client";

import Link from "next/link";
import { useLiveData } from "../../../_components/useLiveData";
import { AgentFile } from "./AgentFile";
import { ClientFile } from "./ClientFile";
import { usePortalSession } from "./portal-session";
import type { PortalFile as File } from "./portal-model";
import s from "../_components/portal.module.css";

export function PortalFile({ id }: { id: string }) {
  const session = usePortalSession();
  return session.role === "agent" ? (
    <div className={s.main}>
      <p className={s.agentBack}>
        <Link href="/portal">← Back to all files</Link>
      </p>
      <AgentFile key={id} id={id} />
    </div>
  ) : (
    <ClientPreview key={id} id={id} back />
  );
}

export function ClientPreview({
  id,
  back = false,
}: {
  id: string;
  back?: boolean;
}) {
  const query = useLiveData<File>(`/api/v1/matters/${encodeURIComponent(id)}`);
  return (
    <>
      {back && (
        <p className={`${s.clientWidth} ${s.back}`}>
          <Link href="/portal">Your transactions</Link>
        </p>
      )}
      {query.data ? (
        <ClientFile file={query.data} />
      ) : (
        <div className={`${s.clientWidth} ${s.clientFile}`}>
          {query.loading ? (
            <p role="status">Opening your timeline…</p>
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
        </div>
      )}
    </>
  );
}
