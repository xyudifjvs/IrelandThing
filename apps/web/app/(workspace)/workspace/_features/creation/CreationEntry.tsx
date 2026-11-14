"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { mutate, useData, type Session } from "../../_components/data";
import { CreationReview } from "./CreationReview";
import {
  forgetRequestKey,
  requestKey,
  reviewEndpoint,
  type Review,
} from "./review-model";
import s from "./creation.module.css";

export default function CreationEntry() {
  const router = useRouter();
  const query = useSearchParams();
  const intakeId = query.get("intakeId") ?? undefined;
  const reviewId = query.get("reviewId");
  const session = useData<Session>("/api/v1/session");
  const actor = session.data?.user;
  const authorized = actor?.role === "coordinator";
  const review = useData<Review>(
    authorized && reviewId ? reviewEndpoint(reviewId) : null,
  );
  const [startError, setStartError] = useState("");
  const [starting, setStarting] = useState(false);
  const startPending = useRef(false);
  const autoStarted = useRef("");
  const startScope = `start.${actor?.id}.${intakeId ?? "manual"}`;

  const start = useCallback(async () => {
    if (!authorized || startPending.current) return;
    startPending.current = true;
    setStarting(true);
    setStartError("");
    try {
      const opened = await mutate<Review>("/api/v1/creation-reviews", {
        requestId: requestKey(startScope),
        ...(intakeId ? { intakeId } : {}),
      });
      if (opened.confirmedMatterId) {
        forgetRequestKey(startScope);
        router.replace(
          `/workspace/transactions/${encodeURIComponent(opened.confirmedMatterId)}`,
        );
      } else {
        router.replace(
          `/workspace/new?reviewId=${encodeURIComponent(opened.id)}${intakeId ? `&intakeId=${encodeURIComponent(intakeId)}` : ""}`,
        );
      }
    } catch (error) {
      setStartError(
        error instanceof Error ? error.message : "Unable to open the review.",
      );
    } finally {
      startPending.current = false;
      setStarting(false);
    }
  }, [authorized, intakeId, router, startScope]);
  useEffect(() => {
    if (!authorized || reviewId || autoStarted.current === startScope) return;
    autoStarted.current = startScope;
    void start();
  }, [authorized, reviewId, start, startScope]);

  if (session.loading) return <p role="status">Checking your session…</p>;
  if (!authorized)
    return (
      <p role="alert">
        {session.error || "Only the coordinator can create transactions."}
      </p>
    );
  if (reviewId && review.loading && !review.data)
    return <p role="status">Opening the review…</p>;
  if (reviewId && review.error)
    return (
      <section className={s.section}>
        <p role="alert">{review.error}</p>
        <button type="button" onClick={() => void review.refresh()}>
          Try again
        </button>
      </section>
    );
  if (review.data)
    return (
      <CreationReview
        key={review.data.id}
        initial={review.data}
        onConfirmed={(matterId) => {
          forgetRequestKey(startScope);
          router.replace(
            `/workspace/transactions/${encodeURIComponent(matterId)}`,
          );
        }}
      />
    );
  return (
    <main className={s.page}>
      <Link className={s.back} href="/workspace">
        Back to overview
      </Link>
      <header className={s.header}>
        <h1>Create transaction</h1>
      </header>
      <section className={s.section}>
        {startError ? (
          <>
            <p role="alert">{startError}</p>
            <button
              className={s.primary}
              type="button"
              disabled={starting}
              onClick={() => void start()}
            >
              Try again
            </button>
          </>
        ) : (
          <p role="status">Opening the review…</p>
        )}
      </section>
    </main>
  );
}
