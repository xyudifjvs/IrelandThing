"use client";

import { useEffect, useState } from "react";
import { useLiveData } from "../_components/useLiveData";
import { ClientFile, ClientHeader } from "../(portal)/portal/_views/ClientFile";
import { ClientFooter } from "../(portal)/portal/_views/PortalBrand";
import type {
  PortalDocument,
  PortalFile,
  PortalPerson,
  PortalTask,
} from "../(portal)/portal/_views/portal-model";
import s from "../(portal)/portal/_components/portal.module.css";

type SharedChecklist = {
  matter: PortalFile;
  tasks: PortalTask[];
  clientRequests?: { id: string }[];
  deadlines: { id: string; label: string; date: string | null }[];
  documents?: PortalDocument[];
  people?: PortalPerson[];
};

export default function ClientChecklist() {
  const [token, setToken] = useState<string | null>(null);
  useEffect(() => {
    const read = () =>
      setToken(
        /^#[A-Za-z0-9_-]{32,256}$/.test(window.location.hash)
          ? window.location.hash.slice(1)
          : "",
      );
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, []);
  const query = useLiveData<SharedChecklist>(
    token ? "/api/public/checklist" : null,
    token || undefined,
  );
  const data = query.data;
  const requests = new Set(data?.clientRequests?.map(({ id }) => id));
  return (
    <div className={`weatherly-theme ${s.page}`}>
      <ClientHeader side={data?.matter.side} />
      <main id="main-content" tabIndex={-1}>
        {data && token ? (
          <ClientFile
            key={token}
            bearer={token}
            file={{
              ...data.matter,
              tasks: data.tasks.filter(({ id }) => !requests.has(id)),
              deadlines: data.deadlines.map((deadline) => ({
                ...deadline,
                status: "confirmed",
              })),
              documents: data.documents,
              people: data.people,
            }}
          />
        ) : (
          <div className={`${s.clientWidth} ${s.clientFile}`}>
            <section className={s.panel}>
              <h1>
                {token === ""
                  ? "This link is incomplete"
                  : query.loading || token === null
                    ? "Opening your timeline…"
                    : "This link is unavailable"}
              </h1>
              {token === "" && (
                <p>
                  Open the complete link provided by your agent or coordinator.
                </p>
              )}
              {query.error && (
                <>
                  <p>Ask your agent or coordinator for the current link.</p>
                  <button
                    className={s.secondary}
                    type="button"
                    onClick={() => void query.refresh()}
                  >
                    Try again
                  </button>
                </>
              )}
            </section>
            <ClientFooter />
          </div>
        )}
      </main>
    </div>
  );
}
