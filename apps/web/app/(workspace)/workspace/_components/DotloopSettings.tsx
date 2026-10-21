"use client";
import { useState } from "react";
import { Link2, RefreshCw } from "lucide-react";
import { useData, mutate, date, label } from "./data";
import s from "./workspace.module.css";
import MatterPicker from "./MatterPicker";
type Link = {
  id: string;
  matterId: string;
  profileId: string;
  loopId: string;
  revision: number;
  status: string;
  lastSyncedAt?: string;
  error?: string;
};
export default function DotloopSettings() {
  const integrations = useData<{ provider: string; status: string }[]>(
    "/api/v1/integrations",
  );
  const status = integrations.data?.find(
    (i) => i.provider === "dotloop",
  )?.status;
  const connected = status === "connected",
    available = connected || status === "configured";
  const profiles = useData<{ id: string | number; name: string }[]>(
    connected ? "/api/v1/dotloop/profiles" : null,
  );
  const [profile, setProfile] = useState(""),
    [loop, setLoop] = useState(""),
    [matter, setMatter] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const [loopPage, setLoopPage] = useState(1);
  const loops = useData<{ id: string | number; name: string }[]>(
    profile
      ? `/api/v1/dotloop/profiles/${encodeURIComponent(profile)}/loops?page=${loopPage}`
      : null,
  );
  const links = useData<Link[]>(
    matter
      ? `/api/v1/dotloop/links?matterId=${encodeURIComponent(matter)}`
      : null,
  );
  async function action(task: () => Promise<void>) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await task();
      await integrations.refresh();
      await links.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className={s.section} style={{ marginTop: 25 }}>
      <div className={s.sectionHead}>
        <div>
          <h2>Your Dotloop connection</h2>
          <p>Keep the source loop connected to the correct transaction file.</p>
        </div>
        <Link2 size={18} strokeWidth={1.3} />
      </div>
      <div className={s.sectionBody}>
        {!available && (
          <div className={s.notice}>
            Dotloop requires approved account/API credentials before connecting.
            You can upload the executed contract directly while access is
            unavailable.
          </div>
        )}
        {error && (
          <p className={s.error} role="alert">
            {error}
          </p>
        )}
        {message && (
          <p className={s.notice} role="status">
            {message}
          </p>
        )}
        <div className={s.formRow}>
          {!connected ? (
            <button
              className={s.buttonSecondary}
              disabled={!available || busy}
              onClick={() =>
                void action(async () => {
                  const result = await mutate<{ url: string }>(
                    "/api/v1/dotloop/connect",
                    {},
                  );
                  if (!result.url)
                    throw new Error(
                      "Dotloop authorization URL was not returned.",
                    );
                  window.location.href = result.url;
                })
              }
            >
              Connect approved Dotloop account
            </button>
          ) : (
            <button
              className={s.buttonSecondary}
              disabled={busy}
              onClick={() =>
                void action(async () => {
                  const result = await mutate<{
                    providerRevocationRequired: boolean;
                  }>("/api/v1/dotloop/disconnect", {});
                  setMessage(
                    result.providerRevocationRequired
                      ? "Weatherly access is disconnected. Revoke the application in Dotloop account settings as well."
                      : "Dotloop connection disconnected.",
                  );
                  setProfile("");
                  setLoop("");
                })
              }
            >
              Disconnect Dotloop
            </button>
          )}
        </div>
        {connected && (
          <form
            style={{ marginTop: 25 }}
            onSubmit={(e) => {
              e.preventDefault();
              void action(async () => {
                const existing = links.data?.find((l) => l.matterId === matter);
                await mutate("/api/v1/dotloop/links", {
                  matterId: matter,
                  profileId: profile,
                  loopId: loop,
                  ...(existing ? { expectedRevision: existing.revision } : {}),
                });
                setMessage(
                  "Loop association saved. Review sync status below; this does not claim that a contract was already imported.",
                );
              });
            }}
          >
            <div className={s.formGrid}>
              <MatterPicker value={matter} required onChange={setMatter} />
              <label className={s.field}>
                Dotloop profile
                <select
                  className={s.select}
                  required
                  value={profile}
                  onChange={(e) => {
                    setProfile(e.target.value);
                    setLoop("");
                    setLoopPage(1);
                  }}
                >
                  <option value="">Choose a profile</option>
                  {profiles.data?.map((p) => (
                    <option key={p.id} value={String(p.id)}>
                      {p.name || p.id}
                    </option>
                  ))}
                </select>
              </label>
              <label className={s.field}>
                Source loop
                <select
                  className={s.select}
                  required
                  value={loop}
                  disabled={!profile || loops.loading}
                  onChange={(e) => setLoop(e.target.value)}
                >
                  <option value="">
                    {loops.loading ? "Loading loops…" : "Choose a loop"}
                  </option>
                  {loops.data?.map((l) => (
                    <option key={l.id} value={String(l.id)}>
                      {l.name || l.id}
                    </option>
                  ))}
                </select>
                {profile && (
                  <div className={s.formRow} style={{ marginTop: 8 }}>
                    <button
                      type="button"
                      className={s.buttonSmall}
                      disabled={busy || loops.loading || loopPage === 1}
                      onClick={() => {
                        setLoop("");
                        setLoopPage((p) => p - 1);
                      }}
                    >
                      Previous loops
                    </button>
                    <span className={s.fieldHint}>Page {loopPage}</span>
                    <button
                      type="button"
                      className={s.buttonSmall}
                      disabled={busy || loops.loading || !loops.data?.length}
                      onClick={() => {
                        setLoop("");
                        setLoopPage((p) => p + 1);
                      }}
                    >
                      Next loops
                    </button>
                  </div>
                )}
                {profile &&
                  !loops.loading &&
                  !loops.error &&
                  !loops.data?.length && (
                    <p className={s.fieldHint}>
                      No loops on this page. Return to the previous page or
                      choose another profile.
                    </p>
                  )}
              </label>
            </div>
            {(profiles.error || loops.error || links.error) && (
              <p className={s.error}>
                {profiles.error || loops.error || links.error}
              </p>
            )}
            <button
              className={s.buttonSecondary}
              style={{ marginTop: 15 }}
              disabled={busy || !matter || !profile || !loop}
            >
              Save reviewed loop association
            </button>
          </form>
        )}
        {links.data?.map((l) => (
          <div className={s.taskLine} key={l.id}>
            <div style={{ flex: 1 }}>
              <strong style={{ fontSize: 12, fontWeight: 500 }}>
                Loop {l.loopId}
              </strong>
              <p className={s.fieldHint}>
                {label(l.status)} · Last sync {date(l.lastSyncedAt)}
              </p>
              {l.error && <p className={s.fieldHint}>{l.error}</p>}
            </div>
            <button
              className={s.buttonSmall}
              disabled={busy || !connected}
              onClick={() =>
                void action(async () => {
                  await mutate(`/api/v1/dotloop/links/${l.id}/sync`, {});
                  setMessage(
                    "Sync request queued. Imported metadata and any manual-upload requirements appear in the transaction status.",
                  );
                })
              }
            >
              <RefreshCw size={12} />
              Request sync
            </button>
          </div>
        ))}
        <p className={s.fieldHint} style={{ marginTop: 20 }}>
          Provider document-download capability is verified separately. A linked
          loop or metadata sync never stands in for an executed contract; upload
          it manually when the adapter reports that requirement.
        </p>
      </div>
    </section>
  );
}
