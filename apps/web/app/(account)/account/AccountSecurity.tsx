"use client";

import { useState } from "react";
import Link from "next/link";
import { mutate } from "../../(workspace)/workspace/_components/data";
import s from "./account.module.css";

export function AccountSecurity({
  twoFactorEnabled,
}: {
  twoFactorEnabled?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  return (
    <section
      className={s.section}
      id="security"
      aria-labelledby="security-title"
    >
      <div className={s.sectionHeader}>
        <h2 id="security-title">Account security</h2>
      </div>
      <div className={s.body}>
        <div className={s.actions}>
          {twoFactorEnabled ? (
            <span className={s.badge}>Two-step login on</span>
          ) : (
            <Link className={s.secondary} href="/security">
              Turn on two-step login
            </Link>
          )}
          <Link className={s.secondary} href="/forgot-password">
            Password recovery
          </Link>
        </div>
        <details className={s.passwordDetails}>
          <summary>Change password</summary>
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              const form = event.currentTarget;
              const fields = new FormData(form);
              setNotice("");
              setError("");
              if (fields.get("newPassword") !== fields.get("confirm")) {
                setError("The new passwords do not match.");
                return;
              }
              setBusy(true);
              try {
                await mutate("/api/auth/change-password", {
                  currentPassword: fields.get("currentPassword"),
                  newPassword: fields.get("newPassword"),
                  revokeOtherSessions: true,
                });
                form.reset();
                setNotice(
                  "Password changed. Your other sessions have been signed out.",
                );
              } catch (failure) {
                setError(
                  failure instanceof Error
                    ? failure.message
                    : "Could not change your password.",
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            <fieldset className={s.profileFields} disabled={busy}>
              <label className={s.field}>
                Current password
                <input
                  className={s.input}
                  type="password"
                  name="currentPassword"
                  autoComplete="current-password"
                  required
                />
              </label>
              <label className={s.field}>
                New password
                <input
                  className={s.input}
                  type="password"
                  name="newPassword"
                  autoComplete="new-password"
                  minLength={12}
                  required
                />
              </label>
              <label className={s.field}>
                Confirm new password
                <input
                  className={s.input}
                  type="password"
                  name="confirm"
                  autoComplete="new-password"
                  minLength={12}
                  required
                />
              </label>
              <div className={s.actions}>
                <button className={s.button} type="submit">
                  {busy ? "Saving…" : "Save password"}
                </button>
              </div>
            </fieldset>
            {error && (
              <p className={s.error} role="alert">
                {error}
              </p>
            )}
            {notice && (
              <p className={s.notice} role="status">
                {notice}
              </p>
            )}
          </form>
        </details>
      </div>
    </section>
  );
}
