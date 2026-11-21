"use client";
import { useId, useState } from "react";
import Link from "next/link";
import s from "./auth.module.css";

export function PasswordField({
  value,
  onChange,
  creating = false,
}: {
  value: string;
  onChange: (value: string) => void;
  creating?: boolean;
}) {
  const [visible, setVisible] = useState(false);
  const id = useId();
  const remaining = Math.max(0, 12 - value.length);
  return (
    <div className={s.field}>
      <div className={s.labelRow}>
        <label htmlFor={id}>
          {creating ? "Choose a password" : "Password"}
        </label>
        {!creating && <Link href="/forgot-password">Forgot password?</Link>}
      </div>
      <div className={s.password}>
        <input
          id={id}
          name="password"
          type={visible ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          required
          minLength={creating ? 12 : undefined}
          maxLength={128}
          autoComplete={creating ? "new-password" : "current-password"}
          aria-describedby={creating ? `${id}-hint` : undefined}
        />
        <button
          type="button"
          aria-label={visible ? "Hide password" : "Show password"}
          aria-pressed={visible}
          onClick={() => setVisible(!visible)}
        >
          {visible ? "Hide" : "Show"}
        </button>
      </div>
      {creating && (
        <small id={`${id}-hint`} aria-live="polite">
          {value.length === 0
            ? "At least 12 characters."
            : remaining
              ? `${remaining} more character${remaining === 1 ? "" : "s"} needed`
              : "12-character minimum met."}
        </small>
      )}
    </div>
  );
}
