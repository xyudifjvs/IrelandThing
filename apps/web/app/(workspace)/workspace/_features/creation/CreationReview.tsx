"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type {
  ChecklistDateInput,
  CreationConfirm,
  CreationPerson,
  SourceVersion,
  TransactionBusiness,
} from "@weatherly/platform/handoff-contracts";
import SavedIntakeDetails from "../../../../_components/SavedIntakeDetails";
import { api, mutate } from "../../_components/data";
import { ReviewFields } from "./ReviewFields";
import { ReviewPeople } from "./ReviewPeople";
import { ReviewSources } from "./ReviewSources";
import {
  assembleDates,
  forgetRequestKey,
  isExtracting,
  requestKey,
  reviewEndpoint,
  suggestFacts,
  suggestPeople,
  type Review,
  type ReviewFacts,
} from "./review-model";
import s from "./creation.module.css";

export function CreationReview({
  initial,
  onConfirmed,
}: {
  initial: Review;
  onConfirmed: (matterId: string) => void;
}) {
  const [review, setReview] = useState(initial);
  const [factEdits, setFactEdits] = useState<ReviewFacts>({});
  const [dateEdits, setDateEdits] = useState<
    Record<string, ChecklistDateInput>
  >({});
  const [peopleEdits, setPeopleEdits] = useState<CreationPerson[]>();
  const [business, setBusiness] = useState<TransactionBusiness | undefined>(
    initial.business,
  );
  const [priceEdit, setPriceEdit] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [stale, setStale] = useState(false);
  const activeMutation = useRef(false);
  const path = reviewEndpoint(review.id);
  const revision = review.revision;
  const extracting = isExtracting(review);
  const confirmedMatter = review.confirmedMatterId;
  const proposal = review.extraction.proposal;
  const facts = suggestFacts({ ...review.facts, ...factEdits }, proposal);
  const people =
    peopleEdits ??
    (review.peopleEdited
      ? review.people
      : suggestPeople(review.people, facts.side, proposal));
  const dateOverrides = new Map(review.dates.map((item) => [item.key, item]));
  for (const item of Object.values(dateEdits))
    dateOverrides.set(item.key, item);
  const dates = assembleDates(facts, [...dateOverrides.values()], proposal);
  const price =
    priceEdit ??
    (facts.purchasePriceCents == null
      ? ""
      : String(facts.purchasePriceCents / 100));

  useEffect(() => {
    if (!extracting || stale) return;
    let active = true;
    let polling = false;
    const timer = window.setInterval(async () => {
      if (activeMutation.current || polling) return;
      polling = true;
      try {
        const latest = await api<Review>(path);
        if (!active || activeMutation.current) return;
        if (latest.confirmedMatterId || latest.revision === revision)
          setReview(latest);
        else setStale(true);
      } catch {
        // The next poll or an explicit refresh can recover a transient error.
      } finally {
        polling = false;
      }
    }, 1_500);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [extracting, path, revision, stale]);

  async function run(action: () => Promise<void>) {
    if (activeMutation.current) return;
    activeMutation.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await action();
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "The review could not be saved.",
      );
    } finally {
      activeMutation.current = false;
      setBusy(false);
    }
  }

  function updateDraft(next: Review) {
    setReview(next);
    setFactEdits({});
    setDateEdits({});
    setPeopleEdits(undefined);
    setBusiness(next.business);
    setPriceEdit(undefined);
    setStale(false);
  }

  function priceCents() {
    const value = price.trim();
    if (!value) return null;
    if (!/^\d+(\.\d{1,2})?$/.test(value))
      throw Error(
        "Enter a purchase price in dollars with up to two decimal places.",
      );
    const [dollars, fraction = ""] = value.split(".");
    const cents = Number(dollars) * 100 + Number(fraction.padEnd(2, "0"));
    if (!Number.isSafeInteger(cents))
      throw Error("Enter a smaller purchase price.");
    return cents;
  }

  async function save() {
    const saved = await mutate<Review>(
      path,
      {
        expectedRevision: review.revision,
        facts: {
          ...facts,
          ...(priceEdit !== undefined || facts.purchasePriceCents !== undefined
            ? { purchasePriceCents: priceCents() }
            : {}),
        },
        ...(business ? { business } : {}),
        dates: proposal ? dates : [...dateOverrides.values()],
        ...(peopleEdits || (proposal && !review.peopleEdited)
          ? { people }
          : {}),
      },
      "PATCH",
    );
    updateDraft(saved);
    setMessage("Review saved.");
  }

  async function pin(sources: SourceVersion[]) {
    const saved = await mutate<Review>(
      path,
      { expectedRevision: review.revision, sources },
      "PATCH",
    );
    setReview(saved);
    return saved;
  }

  async function extract(action: "start" | "skip", current = review) {
    const next = await mutate<Review>(`${path}/extraction`, {
      expectedRevision: current.revision,
      action,
    });
    setReview(next);
  }

  async function upload(source: () => Promise<SourceVersion>) {
    const version = await source();
    const pinned = await pin([version]);
    await extract("start", pinned);
  }

  async function confirm() {
    const address = facts.propertyAddress?.trim();
    if (!business || !address)
      throw Error("Choose a business and enter the property address.");
    const key = `confirm.${review.id}`;
    const body: CreationConfirm = {
      expectedRevision: review.revision,
      requestId: requestKey(key),
      business,
      facts: {
        ...facts,
        title: address.slice(0, 200),
        propertyAddress: address,
        side: facts.side ?? "buyer",
        agentId: facts.agentId ?? null,
        agentRosterId: facts.agentRosterId ?? null,
        purchaseType: facts.purchaseType ?? null,
        purchasePriceCents: priceCents(),
        acceptance: facts.acceptance ?? null,
      },
      people,
      dates,
    };
    let result: { matterId: string };
    try {
      result = await mutate<{ matterId: string }>(`${path}/confirm`, body);
    } catch (reason) {
      const current = await api<Review>(path).catch(() => null);
      if (!current?.confirmedMatterId) throw reason;
      result = { matterId: current.confirmedMatterId };
    }
    forgetRequestKey(key);
    onConfirmed(result.matterId);
  }

  if (confirmedMatter)
    return (
      <main className={s.page}>
        <h1>Transaction created</h1>
        <Link
          className={s.primary}
          href={`/workspace/transactions/${encodeURIComponent(confirmedMatter)}`}
        >
          Open transaction
        </Link>
      </main>
    );

  return (
    <main className={s.page}>
      <header className={s.header}>
        <Link className={s.back} href="/workspace">
          Back to overview
        </Link>
        <h1>Create transaction</h1>
      </header>
      {review.intake && (
        <SavedIntakeDetails
          value={review.intake.snapshot}
          agent={review.intake.agent}
          documents={review.intake.documents}
        />
      )}
      <ReviewSources
        review={review}
        busy={busy || stale}
        onPin={(sources) =>
          void run(async () => {
            await pin(sources);
          })
        }
        onUpload={(source) => void run(() => upload(source))}
        onExtraction={(action) => void run(() => extract(action))}
      />
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void run(confirm);
        }}
      >
        <fieldset disabled={busy || stale} className={s.editor}>
          <ReviewFields
            facts={facts}
            business={business}
            price={price}
            dates={dates}
            onFacts={(edit) =>
              setFactEdits((current) => ({ ...current, ...edit }))
            }
            onBusiness={setBusiness}
            onPrice={setPriceEdit}
            onDate={(item) =>
              setDateEdits((current) => ({ ...current, [item.key]: item }))
            }
          />
          <ReviewPeople people={people} onChange={setPeopleEdits} />
        </fieldset>
        {stale && (
          <p role="alert" className={s.error}>
            This review changed in another tab. Reload the saved review to
            continue.
          </p>
        )}
        {error && (
          <p role="alert" className={s.error}>
            {error}
          </p>
        )}
        {message && <p role="status">{message}</p>}
        <div className={s.actions}>
          <button
            type="button"
            className={s.secondary}
            disabled={busy || stale}
            onClick={() => void run(save)}
          >
            Save review
          </button>
          {(stale || error) && (
            <button
              type="button"
              className={s.secondary}
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  if (
                    window.confirm(
                      "Replace unsaved edits with the saved review?",
                    )
                  )
                    updateDraft(await api<Review>(path));
                })
              }
            >
              Reload saved review
            </button>
          )}
          <button
            type="submit"
            className={s.primary}
            disabled={busy || stale || extracting}
          >
            Confirm &amp; create transaction
          </button>
        </div>
      </form>
    </main>
  );
}
