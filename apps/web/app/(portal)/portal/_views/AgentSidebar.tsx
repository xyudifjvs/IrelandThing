"use client";

import { useState } from "react";
import { api } from "@weatherly/ui";
import { useLiveData } from "../../../_components/useLiveData";
import { PortalPeople } from "./PortalPeople";
import {
  feeStatus,
  money,
  type FeeSummary,
  type FileSummary,
  type PortalFile,
} from "./portal-model";
import s from "../_components/portal.module.css";

function ClientLink({ matterId }: { matterId: string }) {
  const path = `/api/v1/matters/${encodeURIComponent(matterId)}/checklist-share`;
  const link = useLiveData<{ active: boolean; canCopy?: boolean }>(path);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const copy = async () => {
    setBusy(true);
    setMessage("");
    try {
      const result = await api<{ url: string }>(`${path}/copy`, {
        method: "POST",
        cache: "no-store",
        body: "{}",
      });
      const url = new URL(result.url);
      const safe =
        url.protocol === "https:" ||
        (url.protocol === "http:" &&
          ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname));
      if (
        !safe ||
        url.pathname !== "/checklist" ||
        !/^#[A-Za-z0-9_-]{32,256}$/.test(url.hash)
      )
        throw new Error("The current client link is unavailable.");
      await navigator.clipboard.writeText(url.href);
      setMessage("Client link copied.");
    } catch {
      setMessage(
        "Could not copy the client link. Ask Ireland for the current link.",
      );
      await link.refresh();
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className={s.panel} aria-label="Client link">
      <h2>Client link</h2>
      {link.data?.canCopy ? (
        <button
          type="button"
          className={s.secondary}
          onClick={() => void copy()}
          disabled={busy}
        >
          Copy client link
        </button>
      ) : (
        <p className={s.muted}>
          {link.loading
            ? "Checking link availability…"
            : "Ask Ireland for a current client link."}
        </p>
      )}
      {message && <p role="status">{message}</p>}
    </section>
  );
}

export function AgentSidebar({ file }: { file: PortalFile }) {
  const bill = useLiveData<FileSummary>(
    `/api/v1/billing/account/file-summary?matterId=${encodeURIComponent(file.id)}`,
    undefined,
    true,
  );
  const service =
    file.business === "hto"
      ? null
      : (bill.data?.service ??
        (file.service
          ? { ...file.service, status: "due_at_closing", paidAt: null }
          : null));
  const gift = bill.data?.gift;
  const visibleGift = gift && gift.status !== "cancelled" ? gift : null;
  return (
    <aside className={s.sidebar} aria-label="File information">
      {(service || visibleGift) && (
        <section className={s.panel} aria-label="Your service">
          <h2>Your service</h2>
          {service && (
            <FeeLine
              fee={service}
              status={
                file.stage === "terminated" &&
                service.status === "due_at_closing"
                  ? "No service fee is due."
                  : service.status === "due_at_closing"
                    ? "Due at closing. Ireland will send a payment link."
                    : feeStatus(service)
              }
            />
          )}
          {visibleGift && (
            <FeeLine
              fee={visibleGift}
              name={`Closing gift · ${visibleGift.name}`}
              status={
                ["awaiting_quote", "quoted"].includes(visibleGift.status)
                  ? "Ireland will send a payment link."
                  : feeStatus(visibleGift)
              }
            />
          )}
        </section>
      )}
      {file.stage !== "terminated" && <ClientLink matterId={file.id} />}
      <section className={s.panel} aria-label="Your TC">
        <h2>Your TC</h2>
        <strong>Ireland Weatherly</strong>
        <p>Weatherly Transaction Co.</p>
        <a className={s.secondary} href="mailto:ireland@weatherlytc.com">
          Email Ireland
        </a>
      </section>
      <PortalPeople people={file.people || []} />
    </aside>
  );
}

function FeeLine({
  fee,
  name = fee.name,
  status,
}: {
  fee: FeeSummary;
  name?: string;
  status: string;
}) {
  return (
    <div className={s.serviceLine}>
      <strong>{name}</strong>
      {fee.amountCents !== null && fee.currency && (
        <span>{money(fee.amountCents, fee.currency)}</span>
      )}
      <p>{status}</p>
    </div>
  );
}
