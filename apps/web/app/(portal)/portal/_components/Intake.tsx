"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  ArrowLeft,
  Check,
  CheckCircle2,
  Plus,
  ShieldCheck,
} from "lucide-react";
import {
  DocumentUploadQueue,
  useDocumentUploadQueue,
} from "../../../_components/DocumentUploadQueue";
import {
  api,
  mutate,
  useData,
  type Session,
  type Matter,
} from "../../../(workspace)/workspace/_components/data";
import s from "./intake.module.css";
type Handling = {
  choice: string;
  name?: string;
  email?: string;
  phone?: string;
};
type Client = {
  name: string;
  email?: string;
  phone?: string;
  relationship?: string;
};
type Payload = {
  packageCode: string;
  side: string;
  propertyAddress: string;
  purchaseType: string;
  contractSource: string;
  documentIds: string[];
  dotloopLoopId?: string;
  clients: Client[];
  directContact: string;
  title: Handling;
  lender?: Handling;
  hoa: string;
  priorPolicy?: string;
  broker: {
    name: string;
    email: string;
    pre1978: boolean;
    ownChecklist: boolean;
    checklistDocumentId?: string;
    checklistDocumentIds?: string[];
  };
  notes: string;
  gift: {
    requested: boolean;
    tier?: string;
    choice?: string;
    personalization?: string;
    deliveryAddress?: string;
  };
};
type Draft = { id: string; revision: number; payload: Payload; status: string };
const fresh: Payload = {
  packageCode: "essentials",
  side: "buyer",
  propertyAddress: "",
  purchaseType: "financed",
  contractSource: "upload",
  documentIds: [],
  clients: [{ name: "" }],
  directContact: "copy_agent",
  title: { choice: "have" },
  lender: { choice: "have" },
  hoa: "none",
  priorPolicy: "not_applicable",
  broker: { name: "", email: "", pre1978: false, ownChecklist: false },
  notes: "",
  gift: { requested: false },
};
export default function Intake() {
  const session = useData<Session>("/api/v1/session");
  const [d, setD] = useState<Payload>(fresh);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const [submission, setSubmission] = useState<Matter | null>(null);
  const resumeQuery = useData<Draft[]>("/api/v1/intake/drafts");
  const resume = (resumeQuery.data || []).filter((x) => x.status === "draft");
  const [allowSeparateIntake, setAllowSeparateIntake] = useState(false);
  const loadBlocked =
    !draft &&
    !allowSeparateIntake &&
    (resumeQuery.loading || !!resumeQuery.error);
  const [dirty, setDirty] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const errorSummary = useRef<HTMLDivElement>(null);
  const payloadRef = useRef(d);
  const draftRef = useRef(draft);
  const saveChain = useRef<Promise<unknown>>(Promise.resolve());
  const uploadReservations = useRef({
    contract: new Set<string>(),
    brokerage_checklist: new Set<string>(),
  });
  const contracts = useDocumentUploadQueue<{ id: string; name?: string }>({
    upload: (file, itemId) => uploadFile(file, itemId, "contract"),
    finalize: async (doc) => {
      update({
        documentIds: [...new Set([...payloadRef.current.documentIds, doc.id])],
      });
      await persistPayload(payloadRef.current);
    },
    onBatchComplete: async () => {
      await resumeQuery.refresh();
    },
    maxFiles: 30,
  });
  const checklists = useDocumentUploadQueue<{ id: string; name?: string }>({
    upload: (file, itemId) => uploadFile(file, itemId, "brokerage_checklist"),
    finalize: async (doc) => {
      const broker = payloadRef.current.broker;
      const ids = [...new Set([...checklistIds(broker), doc.id])];
      update({
        broker: {
          ...broker,
          checklistDocumentId: ids[0],
          checklistDocumentIds: ids,
        },
      });
      await persistPayload(payloadRef.current);
    },
    onBatchComplete: async () => {
      await resumeQuery.refresh();
    },
    maxFiles: 30,
  });
  const pendingUpload = contracts.hasPending || checklists.hasPending;
  const uploading = contracts.running || checklists.running;
  const unsaved = dirty || pendingUpload || uploading;
  const steps = [
    "Service",
    "The deal",
    "Your clients",
    "Title & documents",
    "Final details",
    "Review",
  ];
  useEffect(() => {
    if (loadBlocked || submission) return;
    const frame = requestAnimationFrame(() => heading.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [step, loadBlocked, submission]);
  useEffect(() => {
    if (error) errorSummary.current?.focus();
  }, [error]);
  useEffect(() => {
    if (!unsaved || submission) return;
    const leave = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    const navigate = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      const anchor =
        event.target instanceof Element
          ? event.target.closest<HTMLAnchorElement>("a[href]")
          : null;
      if (
        !anchor ||
        anchor.target === "_blank" ||
        anchor.hasAttribute("download") ||
        anchor.getAttribute("href")?.startsWith("#")
      )
        return;
      if (pendingUpload || uploading) {
        event.preventDefault();
        event.stopPropagation();
        setError(
          "Upload or remove the remaining selected documents before leaving this intake.",
        );
      } else if (
        !window.confirm(
          "This intake has unsaved changes. Leave without saving?",
        )
      ) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", leave);
    document.addEventListener("click", navigate, true);
    return () => {
      window.removeEventListener("beforeunload", leave);
      document.removeEventListener("click", navigate, true);
    };
  }, [unsaved, submission, pendingUpload, uploading]);
  async function openDraft(id: string) {
    if (pendingUpload || uploading) {
      setError(
        "Upload or remove the remaining selected documents before opening another intake.",
      );
      return;
    }
    if (
      unsaved &&
      !window.confirm("Replace your unsaved entries with the saved intake?")
    )
      return;
    setBusy(true);
    setError("");
    try {
      const x = await api<Draft>(
        `/api/v1/intake/drafts/${encodeURIComponent(id)}`,
      );
      if (x.status !== "draft")
        throw new Error(
          "This intake was already submitted. Return to your portal to open the transaction.",
        );
      draftRef.current = x;
      setDraft(x);
      const payload = {
        ...fresh,
        ...x.payload,
        broker: { ...fresh.broker, ...x.payload?.broker },
        gift: { ...fresh.gift, ...x.payload?.gift },
        clients: x.payload?.clients?.length
          ? x.payload.clients
          : [{ name: "" }],
      };
      payloadRef.current = payload;
      setD(payload);
      contracts.clear();
      checklists.clear();
      setDirty(false);
      setSaved("");
      setStep(0);
      requestAnimationFrame(() => heading.current?.focus());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (
      params.get("package") === "listing" ||
      params.get("package") === "full_listing"
    )
      setInitialPayload({
        ...fresh,
        packageCode: "full_listing",
        side: "seller",
        contractSource: "not_yet_executed",
      });
    else if (params.get("side") === "seller")
      setInitialPayload({ ...fresh, side: "seller" });
  }, []);
  function setInitialPayload(payload: Payload) {
    payloadRef.current = payload;
    setD(payload);
  }
  const update = (patch: Partial<Payload>) => {
    const next = { ...payloadRef.current, ...patch };
    payloadRef.current = next;
    setD(next);
    setDirty(true);
  };
  function persistPayload(payload: Payload | Omit<Payload, "broker">) {
    const saving = saveChain.current
      .catch(() => undefined)
      .then(async () => {
        let current = draftRef.current;
        if (!current)
          current = await mutate<Draft>("/api/v1/intake/drafts", { payload });
        else
          current = await mutate<Draft>(
            `/api/v1/intake/drafts/${current.id}`,
            { expectedRevision: current.revision, payload },
            "PATCH",
          );
        draftRef.current = current;
        setDraft(current);
        if (payload === payloadRef.current) setDirty(false);
        setSaved(
          new Date().toLocaleTimeString("en-US", {
            hour: "numeric",
            minute: "2-digit",
          }),
        );
        return current;
      });
    saveChain.current = saving;
    return saving;
  }
  async function save() {
    if (pendingUpload || uploading)
      throw new Error(
        "Upload or remove the remaining selected documents before saving the intake.",
      );
    return persistPayload(payloadRef.current);
  }
  async function uploadFile(
    file: File,
    itemId: string,
    category: "contract" | "brokerage_checklist",
  ) {
    const currentIds =
      category === "contract"
        ? payloadRef.current.documentIds
        : checklistIds(payloadRef.current.broker);
    const reservations = uploadReservations.current[category];
    if (currentIds.length + reservations.size >= 30)
      throw new Error(
        "This intake allows up to 30 documents in this section. Remove any remaining selected files.",
      );
    reservations.add(itemId);
    const f = new FormData();
    f.set("file", file);
    f.set("category", category);
    f.set("visibility", "agent");
    f.set("uploadRequestId", itemId);
    try {
      const doc = await api<{ id: string; name?: string }>(
        "/api/v1/documents",
        { method: "POST", body: f },
      );
      // Count durable records immediately so concurrent uploads cannot exceed the intake limit.
      if (category === "contract")
        update({
          documentIds: [
            ...new Set([...payloadRef.current.documentIds, doc.id]),
          ],
        });
      else {
        const broker = payloadRef.current.broker;
        const ids = [...new Set([...checklistIds(broker), doc.id])];
        update({
          broker: {
            ...broker,
            checklistDocumentId: ids[0],
            checklistDocumentIds: ids,
          },
        });
      }
      return doc;
    } finally {
      reservations.delete(itemId);
    }
  }
  function validate() {
    if (step === 0) {
      if (d.packageCode === "full_listing" && d.side !== "seller")
        throw new Error("Full Listing is available for seller representation.");
    }
    const emails = [
      ...d.clients.map((client) => client.email),
      d.title.email,
      d.lender?.email,
      d.broker.email,
    ];
    if (
      emails.some((email) => email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    )
      throw new Error("Enter a valid email address or leave it blank.");
  }
  async function next() {
    setBusy(true);
    setError("");
    try {
      validate();
      await save();
      setStep((x) => Math.min(x + 1, 5));
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function submit() {
    setBusy(true);
    setError("");
    try {
      if (pendingUpload || uploading)
        throw new Error(
          "Upload or remove the remaining selected documents before submitting the intake.",
        );
      if (
        d.packageCode === "essentials" &&
        !d.broker.name.trim() &&
        !d.broker.email.trim() &&
        !d.broker.ownChecklist &&
        !d.broker.pre1978 &&
        !checklistIds(d.broker).length
      ) {
        const { broker: _broker, ...payload } = d;
        const current = await persistPayload(payload);
        const result = await mutate<{ matter: Matter }>(
          `/api/v1/intake/drafts/${current.id}/submit`,
          {
            expectedRevision: current.revision,
            idempotencyKey: `intake-submit-${current.id}`,
          },
        );
        setDirty(false);
        setSubmission(result.matter);
        return;
      }
      const current = await save();
      const result = await mutate<{ matter: Matter }>(
        `/api/v1/intake/drafts/${current.id}/submit`,
        {
          expectedRevision: current.revision,
          idempotencyKey: `intake-submit-${current.id}`,
        },
      );
      setDirty(false);
      setSubmission(result.matter);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (submission)
    return (
      <div className={s.wrap}>
        <div className={`${s.card} ${s.success}`}>
          <CheckCircle2 size={45} strokeWidth={1} />
          <p className={s.eyebrow}>Intake received</p>
          <h1>Your transaction is submitted.</h1>
          <p>
            {submission.propertyAddress}
            <br />
            The intake and follow-up tasks are saved in your transaction file.
            <br />
            Your coordinator can now review the information you provided.
          </p>
          <Link className={s.btn} href="/portal">
            Return to your portal <ArrowRight size={14} />
          </Link>
        </div>
      </div>
    );
  return (
    <div className={s.wrap}>
      <div className={s.heading}>
        <div>
          <p className={s.eyebrow}>Weatherly Transaction Co.</p>
          <h1>New transaction</h1>
          <p>
            Choose your service and enter the transaction details. You can save
            a draft and finish later.
          </p>
        </div>
        <Link className={s.secondary} href="/portal">
          Your portal
        </Link>
      </div>
      <div className={s.notice} style={{ marginTop: 0 }}>
        Submitting as{" "}
        <strong>{session.data?.user?.name || "your signed-in profile"}</strong>
        {session.data?.user?.email && <> · {session.data.user.email}</>}
        <br />
        <span className={s.hint}>
          All detail fields and document uploads are optional. You can submit a
          mock or incomplete transaction and fill in details later. Representing
          both sides? Submit one intake for each.
        </span>
      </div>
      <p className={s.notice} role="status" aria-live="polite">
        {pendingUpload || uploading
          ? "Upload or remove the remaining selected documents before continuing or leaving. Completed uploads are retained."
          : unsaved
            ? "Unsaved changes. Save before leaving this intake."
            : saved
              ? `Saved at ${saved}.`
              : draft
                ? "Saved intake loaded."
                : "This intake has not been saved yet."}
      </p>
      {resumeQuery.loading && !draft && (
        <p role="status" className={s.notice}>
          Checking saved intakes…
        </p>
      )}
      {resumeQuery.error && (
        <div className={s.error} role="alert">
          <p>Saved intakes could not be loaded: {resumeQuery.error}</p>
          <button
            className={s.secondary}
            onClick={() => void resumeQuery.refresh()}
            disabled={busy || pendingUpload || uploading}
          >
            Try again
          </button>
          {!draft && !allowSeparateIntake && (
            <button
              className={s.secondary}
              onClick={() => setAllowSeparateIntake(true)}
            >
              Start a separate new intake
            </button>
          )}
          <p>Existing saved intakes have not been changed.</p>
        </div>
      )}
      {!draft && resume.length > 0 && (
        <details className={s.notice}>
          <summary style={{ cursor: "pointer" }}>
            Resume a saved intake ({resume.length})
          </summary>
          {resume.map((x) => (
            <button
              className={s.secondary}
              key={x.id}
              style={{ margin: "10px 8px 0 0" }}
              disabled={busy || pendingUpload || uploading}
              onClick={() => void openDraft(x.id)}
            >
              {x.payload?.propertyAddress || "Untitled intake"}
            </button>
          ))}
        </details>
      )}
      <p
        className={s.srOnly}
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        Step {step + 1} of {steps.length}: {steps[step]}
      </p>
      <fieldset
        disabled={busy || loadBlocked || uploading}
        style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}
      >
        <legend className={s.srOnly}>Transaction intake</legend>
        <div className={s.steps} aria-label="Intake progress">
          {steps.map((name, i) => (
            <div
              key={name}
              className={`${s.step} ${i <= step ? s.active : ""}`}
              aria-current={i === step ? "step" : undefined}
            >
              <span>{i < step ? <Check size={11} /> : i + 1}</span>
              {name}
            </div>
          ))}
        </div>
        {error && (
          <div
            className={s.error}
            role="alert"
            ref={errorSummary}
            tabIndex={-1}
          >
            <p>{error}</p>
            {draft && (
              <button
                className={s.secondary}
                disabled={busy}
                onClick={() => void openDraft(draft.id)}
              >
                Reload saved intake (replace current entries)
              </button>
            )}
          </div>
        )}
        <div className={s.card}>
          {step === 0 && (
            <>
              <h2 ref={heading} tabIndex={-1}>
                Choose a service
              </h2>
              <p className={s.sub}>
                Choose the service that fits this transaction.
              </p>
              <div className={s.choices}>
                {[
                  {
                    code: "essentials",
                    name: "Essentials",
                    desc: "Contract-to-close coordination",
                    price: 375,
                  },
                  {
                    code: "complete",
                    name: "Complete",
                    desc: "Contract-to-close + compliance and paperwork",
                    price: 475,
                  },
                  {
                    code: "full_listing",
                    name: "Full Listing",
                    desc: "Seller pre-listing support through closing",
                    price: 625,
                  },
                ].map((p) => (
                  <label className={s.choice} key={p.code}>
                    <input
                      type="radio"
                      name="package"
                      checked={d.packageCode === p.code}
                      onChange={() =>
                        update({
                          packageCode: p.code,
                          side: p.code === "full_listing" ? "seller" : d.side,
                          contractSource: d.documentIds.length
                            ? "upload"
                            : p.code === "full_listing"
                              ? "not_yet_executed"
                              : "upload",
                          dotloopLoopId: undefined,
                          title: { choice: "have" },
                          lender:
                            d.purchaseType === "financed"
                              ? { choice: "have" }
                              : undefined,
                        })
                      }
                    />
                    <div style={{ flex: 1 }}>
                      <strong>{p.name}</strong>
                      <small>{p.desc}</small>
                    </div>
                    <strong>${p.price}</strong>
                  </label>
                ))}
              </div>
              <h3>Who do you represent?</h3>
              <div className={s.inline}>
                {["buyer", "seller"].map((side) => (
                  <label className={s.choice} key={side}>
                    <input
                      type="radio"
                      name="side"
                      value={side}
                      disabled={
                        d.packageCode === "full_listing" && side === "buyer"
                      }
                      checked={d.side === side}
                      onChange={() =>
                        update({
                          side,
                          hoa: "none",
                          priorPolicy: "not_applicable",
                          title: { choice: "have" },
                          lender:
                            d.purchaseType === "financed"
                              ? { choice: "have" }
                              : undefined,
                        })
                      }
                    />
                    {side === "buyer" ? "Buyer" : "Seller"}
                  </label>
                ))}
              </div>
            </>
          )}
          {step === 1 && (
            <>
              <h2 ref={heading} tabIndex={-1}>
                The deal
              </h2>
              <p className={s.sub}>
                Add any property details or documents you have. You can continue
                with these fields blank.
              </p>
              <label className={s.field}>
                Property address
                <input
                  className={s.input}
                  value={d.propertyAddress}
                  onChange={(e) => update({ propertyAddress: e.target.value })}
                  autoComplete="street-address"
                  placeholder="Street address, city, state, ZIP"
                />
              </label>
              <h3>Is this a cash purchase?</h3>
              <div className={s.inline}>
                {[
                  ["cash", "Yes, cash purchase"],
                  ["financed", "No, financed purchase"],
                ].map(([v, n]) => (
                  <label className={s.choice} key={v}>
                    <input
                      type="radio"
                      name="cash"
                      checked={d.purchaseType === v}
                      onChange={() =>
                        update({
                          purchaseType: v,
                          lender: v === "cash" ? undefined : { choice: "have" },
                        })
                      }
                    />
                    {n}
                  </label>
                ))}
              </div>
              <h3>Executed contract</h3>
              <div className={s.choices}>
                <label className={s.choice}>
                  <input
                    name="source"
                    type="radio"
                    disabled={pendingUpload}
                    checked={d.contractSource === "upload"}
                    onChange={() =>
                      update({
                        contractSource: "upload",
                        dotloopLoopId: undefined,
                      })
                    }
                  />
                  Upload the executed contract
                </label>
                {d.packageCode !== "essentials" && (
                  <label className={s.choice}>
                    <input
                      name="source"
                      type="radio"
                      disabled={pendingUpload || d.documentIds.length > 0}
                      checked={d.contractSource === "dotloop"}
                      onChange={() =>
                        update({ contractSource: "dotloop", documentIds: [] })
                      }
                    />
                    It’s already uploaded in Dotloop
                  </label>
                )}
                {d.packageCode === "full_listing" && (
                  <label className={s.choice}>
                    <input
                      name="source"
                      type="radio"
                      disabled={pendingUpload || d.documentIds.length > 0}
                      checked={d.contractSource === "not_yet_executed"}
                      onChange={() =>
                        update({
                          contractSource: "not_yet_executed",
                          documentIds: [],
                          dotloopLoopId: undefined,
                        })
                      }
                    />
                    Not under contract yet. Start a listing.
                  </label>
                )}
              </div>
              {d.documentIds.length > 0 && (
                <p className={s.hint}>
                  Uploaded contracts stay attached to this intake. Continue with
                  the upload source for these documents.
                </p>
              )}
              {d.contractSource === "upload" && (
                <div className={s.file}>
                  <DocumentUploadQueue
                    queue={contracts}
                    label="Executed contracts and amendments"
                    disabled={
                      busy || checklists.hasPending || checklists.running
                    }
                  />
                  {d.documentIds.length > 0 && (
                    <p
                      style={{
                        fontFamily: "inherit",
                        fontSize: 12,
                        color: "#71805e",
                      }}
                    >
                      <CheckCircle2 size={14} /> {d.documentIds.length} contract
                      document(s) uploaded. Unfinished intake saves are shown in
                      the queue above.
                    </p>
                  )}
                </div>
              )}
              {d.contractSource === "dotloop" && (
                <>
                  <div className={s.notice}>
                    Enter the Dotloop loop ID. Ireland can check it after
                    Dotloop is connected. You may still need to upload the
                    signed contract.
                  </div>
                  <label className={s.field}>
                    Dotloop loop ID
                    <input
                      className={s.input}
                      value={d.dotloopLoopId || ""}
                      onChange={(e) =>
                        update({ dotloopLoopId: e.target.value })
                      }
                    />
                  </label>
                </>
              )}
            </>
          )}
          {step === 2 && (
            <>
              <h2 ref={heading} tabIndex={-1}>
                {d.side === "buyer" ? "Buyer" : "Seller"} contact information
              </h2>
              <p className={s.sub}>
                Who should we reach out to? Add each person on this side of the
                transaction.
              </p>
              {d.clients.map((c, i) => (
                <div className={s.client} key={i}>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                    }}
                  >
                    <h3 style={{ marginTop: 0 }}>Client {i + 1}</h3>
                    {i > 0 && (
                      <button
                        className={s.secondary}
                        onClick={() =>
                          update({
                            clients: d.clients.filter((_, j) => j !== i),
                          })
                        }
                      >
                        Remove
                      </button>
                    )}
                  </div>
                  <label className={s.field}>
                    Full name
                    <input
                      className={s.input}
                      value={c.name}
                      onChange={(e) =>
                        update({
                          clients: d.clients.map((x, j) =>
                            j === i ? { ...x, name: e.target.value } : x,
                          ),
                        })
                      }
                    />
                  </label>
                  <label className={s.field}>
                    Relationship / additional context (optional)
                    <input
                      className={s.input}
                      value={c.relationship || ""}
                      placeholder="e.g. spouses, co-buyers"
                      onChange={(e) =>
                        update({
                          clients: d.clients.map((x, j) =>
                            j === i
                              ? {
                                  ...x,
                                  relationship: e.target.value || undefined,
                                }
                              : x,
                          ),
                        })
                      }
                    />
                  </label>
                  <div className={s.grid}>
                    <label className={s.field}>
                      Email
                      <input
                        type="email"
                        className={s.input}
                        value={c.email || ""}
                        onChange={(e) =>
                          update({
                            clients: d.clients.map((x, j) =>
                              j === i
                                ? { ...x, email: e.target.value || undefined }
                                : x,
                            ),
                          })
                        }
                      />
                    </label>
                    <label className={s.field}>
                      Phone
                      <input
                        type="tel"
                        className={s.input}
                        value={c.phone || ""}
                        onChange={(e) =>
                          update({
                            clients: d.clients.map((x, j) =>
                              j === i
                                ? { ...x, phone: e.target.value || undefined }
                                : x,
                            ),
                          })
                        }
                      />
                    </label>
                  </div>
                </div>
              ))}
              <button
                className={s.secondary}
                disabled={d.clients.length >= 12}
                onClick={() =>
                  update({ clients: [...d.clients, { name: "" }] })
                }
              >
                <Plus size={13} />
                Add another {d.side}
              </button>
              <h3>May we contact your client directly?</h3>
              <Choices
                name="contact"
                value={d.directContact}
                options={[
                  ["copy_agent", "Yes, copy me on everything"],
                  ["through_agent", "No, only through me"],
                ]}
                onChange={(v) => update({ directContact: v })}
              />
            </>
          )}
          {step === 3 && (
            <>
              <h2 ref={heading} tabIndex={-1}>
                Title, lender & documents
              </h2>
              <p className={s.sub}>
                Tell Ireland which documents you have and who to contact for
                anything missing.
              </p>
              <HandlingForm
                title="Title company"
                value={d.title}
                onChange={(v) => update({ title: v })}
                side={d.side}
                compliance={d.packageCode !== "essentials"}
              />
              {d.purchaseType === "financed" && (
                <HandlingForm
                  title="Lender"
                  value={d.lender || { choice: "have" }}
                  onChange={(v) => update({ lender: v })}
                  side={d.side}
                  compliance={d.packageCode !== "essentials"}
                />
              )}
              <h3>HOA documents</h3>
              <p className={s.hint}>
                “I” means you; “you” means your Weatherly coordinator.
              </p>
              <Choices
                name="hoa"
                value={d.hoa}
                options={
                  d.side === "buyer"
                    ? [
                        ["none", "No HOA / not applicable"],
                        [
                          "received_sent",
                          "I received it and already sent it to the buyer",
                        ],
                        [
                          "mls_dotloop_send",
                          "It’s in MLS or Dotloop. Please send it to the buyer",
                        ],
                        [
                          "request_listing_agent",
                          "I haven’t received it. Please reach out to the listing agent",
                        ],
                        [
                          "agent_will_email",
                          "I got it from the listing agent. I’ll email it to you to send to the buyer",
                        ],
                      ]
                    : [
                        ["none", "No HOA / not applicable"],
                        [
                          "sent_buyers_agent",
                          "I already sent it to the buyer’s agent",
                        ],
                        [
                          "mls_dotloop_send",
                          "It’s in MLS or Dotloop. Please send it to the buyer’s agent",
                        ],
                        [
                          "seller_will_email",
                          "I haven’t received it. The seller will email it to you; please forward it",
                        ],
                      ]
                }
                onChange={(v) => update({ hoa: v })}
              />
              {d.side === "seller" && (
                <>
                  <h3>Reissue discount (prior title policy)</h3>
                  <Choices
                    name="policy"
                    value={d.priorPolicy || "not_applicable"}
                    options={[
                      ["not_applicable", "N/A"],
                      [
                        "dotloop_send",
                        "It’s in Dotloop. Please send it to title",
                      ],
                      [
                        "request_sellers",
                        "Please reach out to the sellers for their previous policy",
                      ],
                      [
                        "agent_will_email",
                        "I got it from the sellers. I’ll email you a copy to send to title",
                      ],
                    ]}
                    onChange={(v) => update({ priorPolicy: v })}
                  />
                </>
              )}
            </>
          )}
          {step === 4 && (
            <>
              <h2 ref={heading} tabIndex={-1}>
                The final details
              </h2>
              <p className={s.sub}>
                Add your broker’s details, any brokerage checklist and your gift
                preferences.
              </p>
              <div className={s.grid}>
                <label className={s.field}>
                  Broker of record (optional)
                  <input
                    className={s.input}
                    value={d.broker.name}
                    onChange={(e) =>
                      update({ broker: { ...d.broker, name: e.target.value } })
                    }
                  />
                </label>
                <label className={s.field}>
                  Broker email (optional)
                  <input
                    type="email"
                    className={s.input}
                    value={d.broker.email}
                    onChange={(e) =>
                      update({ broker: { ...d.broker, email: e.target.value } })
                    }
                  />
                </label>
              </div>
              <h3>Was the property built before 1978?</h3>
              <Choices
                name="pre1978"
                value={String(d.broker.pre1978)}
                options={[
                  ["true", "Yes"],
                  ["false", "No"],
                ]}
                onChange={(v) =>
                  update({ broker: { ...d.broker, pre1978: v === "true" } })
                }
              />
              <label className={s.choice}>
                <input
                  type="checkbox"
                  checked={d.broker.ownChecklist}
                  disabled={pendingUpload || checklistIds(d.broker).length > 0}
                  onChange={(e) =>
                    update({
                      broker: { ...d.broker, ownChecklist: e.target.checked },
                    })
                  }
                />
                My brokerage has its own checklist
              </label>
              {checklistIds(d.broker).length > 0 && (
                <p className={s.hint}>
                  Uploaded brokerage documents remain attached to this intake.
                </p>
              )}
              {d.broker.ownChecklist && (
                <div style={{ marginTop: 18 }}>
                  <DocumentUploadQueue
                    queue={checklists}
                    label="Brokerage checklists and supporting documents"
                    disabled={busy || contracts.hasPending || contracts.running}
                  />
                  {checklistIds(d.broker).length > 0 && (
                    <p className={s.hint}>
                      {checklistIds(d.broker).length} brokerage document(s)
                      uploaded. Unfinished intake saves are shown in the queue
                      above.
                    </p>
                  )}
                </div>
              )}
              <h3>Anything else we should know?</h3>
              <label className={s.field}>
                Additional information
                <textarea
                  className={s.text}
                  value={d.notes}
                  onChange={(e) => update({ notes: e.target.value })}
                  placeholder="Helpful context, special instructions, or anything to keep in mind…"
                />
              </label>
              <h3>Add a closing gift?</h3>
              <Choices
                name="gift"
                value={String(d.gift.requested)}
                options={[
                  ["true", "Yes, I’m interested"],
                  ["false", "No, thank you"],
                ]}
                onChange={(v) =>
                  update({
                    gift:
                      v === "true" ? { requested: true } : { requested: false },
                  })
                }
              />
              {d.gift.requested && (
                <>
                  <div className={s.notice}>
                    Ireland will confirm the gift, price and delivery details
                    with you. This is a request, not an order. Payment is
                    required before ordering.
                  </div>
                  <label className={s.field}>
                    Preferred gift tier
                    <select
                      className={s.select}
                      value={d.gift.tier || ""}
                      onChange={(e) =>
                        update({ gift: { ...d.gift, tier: e.target.value } })
                      }
                    >
                      <option value="">Choose a tier</option>
                      {["classic", "signature", "luxury"].map((t) => (
                        <option key={t} value={t}>
                          {t[0].toUpperCase() + t.slice(1)} · price to be
                          confirmed
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className={s.field}>
                    Gift preference
                    <input
                      className={s.input}
                      value={d.gift.choice || ""}
                      onChange={(e) =>
                        update({
                          gift: {
                            ...d.gift,
                            choice: e.target.value || undefined,
                          },
                        })
                      }
                      placeholder="Tell us what you have in mind"
                    />
                  </label>
                  <label className={s.field}>
                    Personalization
                    <textarea
                      className={s.text}
                      value={d.gift.personalization || ""}
                      onChange={(e) =>
                        update({
                          gift: {
                            ...d.gift,
                            personalization: e.target.value || undefined,
                          },
                        })
                      }
                      placeholder="Names, message, or personalization details"
                    />
                  </label>
                  <label className={s.field}>
                    Delivery address
                    <input
                      className={s.input}
                      value={d.gift.deliveryAddress || ""}
                      onChange={(e) =>
                        update({
                          gift: {
                            ...d.gift,
                            deliveryAddress: e.target.value || undefined,
                          },
                        })
                      }
                    />
                  </label>
                </>
              )}
            </>
          )}
          {step === 5 && (
            <>
              <h2 ref={heading} tabIndex={-1}>
                Review your intake
              </h2>
              <p className={s.sub}>
                Check your details, then send the intake to your coordinator.
                Submitting creates your transaction and its follow-up checklist.
              </p>
              <dl>
                {[
                  [
                    "Service",
                    `${d.packageCode === "essentials" ? "Essentials · $375" : d.packageCode === "complete" ? "Complete · $475" : "Full Listing · $625"} · ${d.side} side`,
                  ],
                  ["Property", d.propertyAddress || "Not provided"],
                  ["Purchase", d.purchaseType],
                  [
                    "Contract",
                    d.contractSource === "upload"
                      ? `${d.documentIds.length} document(s) uploaded`
                      : d.contractSource === "dotloop"
                        ? `Dotloop · ${d.dotloopLoopId || "loop ID to follow"}`
                        : "Pre-listing · contract not yet executed",
                  ],
                  [
                    "Clients",
                    d.clients
                      .filter(
                        (c) => c.name || c.email || c.phone || c.relationship,
                      )
                      .map(
                        (c) =>
                          `${c.name}${c.relationship ? " (" + c.relationship + ")" : ""}${c.email ? " · " + c.email : ""}${c.phone ? " · " + c.phone : ""}`,
                      )
                      .join("\n") || "Not provided",
                  ],
                  [
                    "Contact permission",
                    d.directContact === "copy_agent"
                      ? "Direct contact permitted; copy agent"
                      : "Contact only through agent",
                  ],
                  [
                    "Title",
                    [
                      d.title.choice.replaceAll("_", " "),
                      d.title.name,
                      d.title.email,
                      d.title.phone,
                    ]
                      .filter(Boolean)
                      .join(" · "),
                  ],
                  [
                    "Lender",
                    d.purchaseType === "cash"
                      ? "Not applicable · cash purchase"
                      : [
                          d.lender?.choice?.replaceAll("_", " "),
                          d.lender?.name,
                          d.lender?.email,
                          d.lender?.phone,
                        ]
                          .filter(Boolean)
                          .join(" · "),
                  ],
                  ["HOA", d.hoa.replaceAll("_", " ")],
                  [
                    "Prior title policy",
                    d.priorPolicy?.replaceAll("_", " ") || "N/A",
                  ],
                  [
                    "Broker",
                    [d.broker.name, d.broker.email]
                      .filter(Boolean)
                      .join(" · ") || "Not provided",
                  ],
                  [
                    "Compliance",
                    `${d.broker.pre1978 ? "Built before 1978" : "Built in/after 1978"} · ${d.broker.ownChecklist ? `Brokerage checklist requested${checklistIds(d.broker).length ? ` · ${checklistIds(d.broker).length} document(s) uploaded` : " · files to follow"}` : "Standard checklist"}`,
                  ],
                  [
                    "Gift",
                    d.gift.requested
                      ? `${d.gift.tier || "Tier to follow"} · ${d.gift.choice || "Selection to follow"} · price and payment to be confirmed`
                      : "No closing gift",
                  ],
                  [
                    "Gift personalization",
                    d.gift.personalization || "Not requested",
                  ],
                  [
                    "Gift delivery",
                    d.gift.deliveryAddress || "To be confirmed if needed",
                  ],
                  ["Notes", d.notes || "No additional notes"],
                ].map(([k, v]) => (
                  <div className={s.review} key={k}>
                    <dt>{k}</dt>
                    <dd style={{ whiteSpace: "pre-line" }}>{v}</dd>
                  </div>
                ))}
              </dl>
              <div className={s.notice}>
                <ShieldCheck size={16} /> After submitting, return to your
                portal for updates. Ireland will confirm when the service fee is
                due.
              </div>
            </>
          )}
        </div>
        <div className={s.actions}>
          <button
            className={s.secondary}
            disabled={busy || pendingUpload || uploading || step === 0}
            onClick={() => setStep((x) => Math.max(0, x - 1))}
          >
            <ArrowLeft size={13} />
            Back
          </button>
          <div className={s.footer}>
            <button
              className={s.secondary}
              disabled={busy || pendingUpload || uploading}
              onClick={async () => {
                setBusy(true);
                setError("");
                try {
                  await save();
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Save & continue later
            </button>
            <span>
              {unsaved
                ? "Unsaved changes"
                : saved
                  ? `Saved at ${saved}`
                  : draft
                    ? "Saved intake loaded"
                    : "Not saved yet"}
            </span>
          </div>
          {step < 5 ? (
            <button
              className={s.btn}
              disabled={busy || pendingUpload || uploading}
              onClick={() => void next()}
            >
              {busy ? "Saving…" : "Continue"}
              <ArrowRight size={13} />
            </button>
          ) : (
            <button
              className={s.btn}
              disabled={busy || pendingUpload || uploading}
              onClick={() => void submit()}
            >
              {busy ? "Submitting…" : "Submit transaction"}
              <Check size={13} />
            </button>
          )}
        </div>
      </fieldset>
    </div>
  );
}
function checklistIds(broker: Payload["broker"]) {
  return [
    ...new Set([
      ...(broker.checklistDocumentIds || []),
      ...(broker.checklistDocumentId ? [broker.checklistDocumentId] : []),
    ]),
  ];
}
function Choices({
  name,
  value,
  options,
  onChange,
}: {
  name: string;
  value: string;
  options: string[][];
  onChange: (v: string) => void;
}) {
  return (
    <div className={s.choices}>
      {options.map(([v, n]) => (
        <label className={s.choice} key={v}>
          <input
            type="radio"
            name={name}
            checked={value === v}
            onChange={() => onChange(v)}
          />
          {n}
        </label>
      ))}
    </div>
  );
}
function HandlingForm({
  title,
  value,
  onChange,
  side,
  compliance,
}: {
  title: string;
  value: Handling;
  onChange: (v: Handling) => void;
  side: string;
  compliance: boolean;
}) {
  let options = [["have", "I have the details"]];
  if (title === "Title company")
    options.push(
      side === "buyer"
        ? ["listing_agent", "Not sure. Please reach out to the listing agent"]
        : ["mls", "It’s listed in the MLS"],
    );
  else {
    if (compliance) options.push(["dotloop", "See pre-approval in Dotloop"]);
    if (side === "seller")
      options.push([
        "buyers_agent",
        "Not sure. Please reach out to the buyer’s agent",
      ]);
  }
  return (
    <>
      <h3>{title}</h3>
      <Choices
        name={title}
        value={value.choice}
        options={options}
        onChange={(v) => onChange({ choice: v })}
      />
      {value.choice === "have" && (
        <>
          <label className={s.field}>
            {title === "Lender" ? "Lender / loan officer" : "Company name"}
            <input
              className={s.input}
              value={value.name || ""}
              onChange={(e) =>
                onChange({ ...value, name: e.target.value || undefined })
              }
            />
          </label>
          <div className={s.grid}>
            <label className={s.field}>
              Phone
              <input
                type="tel"
                className={s.input}
                value={value.phone || ""}
                onChange={(e) =>
                  onChange({ ...value, phone: e.target.value || undefined })
                }
              />
            </label>
            <label className={s.field}>
              Email
              <input
                type="email"
                className={s.input}
                value={value.email || ""}
                onChange={(e) =>
                  onChange({ ...value, email: e.target.value || undefined })
                }
              />
            </label>
          </div>
        </>
      )}
    </>
  );
}
