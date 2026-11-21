"use client";

import { useEffect, useId, useRef, useState } from "react";
import s from "../../_components/workspace.module.css";
import styles from "./roster.module.css";

type Prompt = { title: string; body: string; confirmLabel: string };
export function useRosterConfirmation() {
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const pending = useRef<((confirmed: boolean) => void) | null>(null);
  const element = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => {
    if (prompt) element.current?.showModal();
  }, [prompt]);
  useEffect(
    () => () => {
      pending.current?.(false);
      pending.current = null;
    },
    [],
  );
  function finish(confirmed: boolean) {
    element.current?.close();
    pending.current?.(confirmed);
    pending.current = null;
    setPrompt(null);
  }
  function request(next: Prompt) {
    if (pending.current) return Promise.resolve(false);
    return new Promise<boolean>((resolve) => {
      pending.current = resolve;
      setPrompt(next);
    });
  }
  const dialog = prompt && (
    <dialog
      ref={element}
      className={styles.confirmDialog}
      aria-labelledby={id}
      onCancel={(event) => {
        event.preventDefault();
        finish(false);
      }}
    >
      <h2 id={id}>{prompt.title}</h2>
      <p>{prompt.body}</p>
      <div className={styles.actions}>
        <button
          className={s.buttonSmall}
          type="button"
          onClick={() => finish(false)}
        >
          Cancel
        </button>
        <button className={s.button} type="button" onClick={() => finish(true)}>
          {prompt.confirmLabel}
        </button>
      </div>
    </dialog>
  );
  return { request, dialog };
}
