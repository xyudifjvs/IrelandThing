"use client";

import type { ComponentProps } from "react";

export type TransactionAction = (
  key: string,
  fn: () => Promise<unknown>,
) => Promise<void>;

/** Keep the visible inputs equal to the snapshot being saved. */
export function BusyForm({
  busy,
  children,
  ...props
}: ComponentProps<"form"> & { busy: boolean }) {
  return (
    <form {...props}>
      <fieldset disabled={busy} style={{ display: "contents" }}>
        {children}
      </fieldset>
    </form>
  );
}
