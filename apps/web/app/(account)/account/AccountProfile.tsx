"use client";

import { useState } from "react";
import { mutate, useData } from "../../(workspace)/workspace/_components/data";
import s from "./account.module.css";

type Profile = {
  name: string;
  email: string;
  brokerage?: string | null;
  phone?: string | null;
};

export function AccountProfile({ agent }: { agent: boolean }) {
  const profile = useData<Profile>("/api/v1/profile");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  return (
    <section className={s.section} id="profile" aria-labelledby="profile-title">
      <div className={s.sectionHeader}>
        <h2 id="profile-title">Your profile</h2>
      </div>
      <form
        className={s.body}
        onSubmit={async (event) => {
          event.preventDefault();
          if (!profile.data || busy) return;
          const fields = new FormData(event.currentTarget);
          setBusy(true);
          setError("");
          setNotice("");
          try {
            await mutate(
              "/api/v1/profile",
              {
                name: String(fields.get("name")),
                brokerage: String(fields.get("brokerage")),
                ...(agent
                  ? { phone: String(fields.get("phone")) || null }
                  : {}),
              },
              "PATCH",
            );
            await profile.refresh();
            setNotice("Profile saved.");
          } catch (failure) {
            setError(
              failure instanceof Error
                ? failure.message
                : "Could not save your profile.",
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        {profile.data ? (
          <fieldset
            key={JSON.stringify(profile.data)}
            className={s.profileFields}
            disabled={busy}
          >
            <label className={s.field}>
              Name
              <input
                name="name"
                className={s.input}
                autoComplete="name"
                defaultValue={profile.data.name}
                maxLength={150}
                required
              />
            </label>
            <label className={s.field}>
              Brokerage
              <input
                name="brokerage"
                className={s.input}
                autoComplete="organization"
                defaultValue={profile.data.brokerage || ""}
                maxLength={250}
              />
            </label>
            {agent && (
              <label className={s.field}>
                Phone
                <input
                  name="phone"
                  type="tel"
                  className={s.input}
                  autoComplete="tel"
                  defaultValue={profile.data.phone || ""}
                  maxLength={60}
                />
              </label>
            )}
            <label className={s.field}>
              Email
              <input
                className={s.input}
                type="email"
                readOnly
                value={profile.data.email}
              />
            </label>
            <div className={s.actions}>
              <button className={s.button} type="submit">
                {busy ? "Saving…" : "Save profile"}
              </button>
            </div>
          </fieldset>
        ) : (
          profile.loading && <p role="status">Opening your profile…</p>
        )}
        {(error || profile.error) && (
          <p className={s.error} role="alert">
            {error || profile.error}
          </p>
        )}
        {profile.error && (
          <button
            className={s.secondary}
            type="button"
            onClick={() => void profile.refresh()}
          >
            Try again
          </button>
        )}
        {notice && (
          <p className={s.notice} role="status">
            {notice}
          </p>
        )}
      </form>
    </section>
  );
}
