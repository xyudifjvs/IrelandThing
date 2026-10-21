"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  ArrowLeft,
  Check,
  CheckCircle2,
  Plus,
  Upload,
  ShieldCheck,
} from "lucide-react";
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
  const [file, setFile] = useState<File | null>(null);
  const [uploaded, setUploaded] = useState("");
  const [checklistFile, setChecklistFile] = useState<File | null>(null);
  const [submission, setSubmission] = useState<Matter | null>(null);
  const [resume, setResume] = useState<Draft[]>([]);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (
      params.get("package") === "listing" ||
      params.get("package") === "full_listing"
    )
      setD({
        ...fresh,
        packageCode: "full_listing",
        side: "seller",
        contractSource: "not_yet_executed",
      });
    else if (params.get("side") === "seller")
      setD({ ...fresh, side: "seller" });
    api<Draft[]>("/api/v1/intake/drafts")
      .then((v) => setResume(v.filter((x) => x.status === "draft")))
      .catch(() => {})
      .finally(() => setReady(true));
  }, []);
  const update = (patch: Partial<Payload>) =>
    setD((prev) => ({ ...prev, ...patch }));
  async function save() {
    let current = draft;
    if (!current)
      current = await mutate<Draft>("/api/v1/intake/drafts", { payload: d });
    else
      current = await mutate<Draft>(
        `/api/v1/intake/drafts/${current.id}`,
        { expectedRevision: current.revision, payload: d },
        "PATCH",
      );
    setDraft(current);
    setSaved(
      new Date().toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
      }),
    );
    return current;
  }
  function validate() {
    if (step === 0) {
      if (d.packageCode === "full_listing" && d.side !== "seller")
        throw new Error("Full Listing is available for seller representation.");
    }
    if (step === 1) {
      if (!d.propertyAddress.trim())
        throw new Error("Enter the property address.");
      if (d.contractSource === "upload" && !d.documentIds.length)
        throw new Error("Upload the executed contract before continuing.");
      if (d.contractSource === "dotloop" && !d.dotloopLoopId?.trim())
        throw new Error("Enter the approved Dotloop loop ID.");
    }
    if (step === 2) {
      if (
        d.clients.some(
          (c) =>
            !c.name.trim() ||
            !c.email?.trim() ||
            !c.phone?.trim() ||
            !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email || ""),
        )
      )
        throw new Error("Add a name, email and phone number for each client.");
    }
    if (step === 3) {
      if (d.title.choice === "have" && !d.title.name?.trim())
        throw new Error(
          "Enter the title company name or choose a follow-up instruction.",
        );
      if (
        d.purchaseType === "financed" &&
        d.lender?.choice === "have" &&
        !d.lender.name?.trim()
      )
        throw new Error(
          "Enter the lender name or choose a follow-up instruction.",
        );
    }
    if (step === 4) {
      if (
        d.packageCode !== "essentials" &&
        (!d.broker.name.trim() || !d.broker.email.trim())
      )
        throw new Error("Enter your broker’s name and email.");
      if (d.gift.requested && (!d.gift.tier || !d.gift.choice?.trim()))
        throw new Error(
          "Choose a gift tier and enter your preferred gift. Final availability and pricing require confirmation.",
        );
    }
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
  async function upload() {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      const f = new FormData();
      f.set("file", file);
      f.set("category", "contract");
      f.set("visibility", "agent");
      const doc = await api<{ id: string; name: string }>("/api/v1/documents", {
        method: "POST",
        body: f,
      });
      update({ documentIds: [...d.documentIds, doc.id] });
      setUploaded(doc.name || file.name);
      setFile(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function uploadChecklist() {
    if (!checklistFile) return;
    setBusy(true);
    setError("");
    try {
      const f = new FormData();
      f.set("file", checklistFile);
      f.set("visibility", "agent");
      f.set("category", "brokerage_checklist");
      const doc = await api<{ id: string }>("/api/v1/documents", {
        method: "POST",
        body: f,
      });
      update({ broker: { ...d.broker, checklistDocumentId: doc.id } });
      setChecklistFile(null);
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
      if (
        d.packageCode === "essentials" &&
        !d.broker.name.trim() &&
        !d.broker.email.trim()
      ) {
        const payload = { ...d, broker: undefined };
        let current = draft;
        if (!current)
          current = await mutate<Draft>("/api/v1/intake/drafts", { payload });
        else
          current = await mutate<Draft>(
            `/api/v1/intake/drafts/${current.id}`,
            { expectedRevision: current.revision, payload },
            "PATCH",
          );
        setDraft(current);
        const result = await mutate<{ matter: Matter }>(
          `/api/v1/intake/drafts/${current.id}/submit`,
          {
            expectedRevision: current.revision,
            idempotencyKey: `intake-submit-${current.id}`,
          },
        );
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
          <p className={s.eyebrow}>Every detail, thoughtfully handled</p>
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
  const steps = [
    "Service",
    "The deal",
    "Your clients",
    "Title & documents",
    "Final details",
    "Review",
  ];
  return (
    <div className={s.wrap}>
      <div className={s.heading}>
        <div>
          <p className={s.eyebrow}>Weatherly Transaction Co.</p>
          <h1>New transaction</h1>
          <p>
            Start with the basics. Everything after this adapts to your answers.
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
          Representing both sides? Submit one intake for each.
        </span>
      </div>
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
              onClick={() => {
                setDraft(x);
                setD({
                  ...fresh,
                  ...x.payload,
                  broker: { ...fresh.broker, ...x.payload?.broker },
                  gift: { ...fresh.gift, ...x.payload?.gift },
                  clients: x.payload?.clients?.length
                    ? x.payload.clients
                    : [{ name: "" }],
                });
                setStep(0);
              }}
            >
              {x.payload?.propertyAddress || "Untitled intake"}
            </button>
          ))}
        </details>
      )}
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
        <div className={s.error} role="alert">
          {error}
        </div>
      )}
      <div className={s.card}>
        {step === 0 && (
          <>
            <h2>A little support goes a long way.</h2>
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
                        contractSource:
                          p.code === "full_listing"
                            ? "not_yet_executed"
                            : "upload",
                        documentIds: [],
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
            <h2>The deal</h2>
            <p className={s.sub}>
              Give us the address and the executed contract. We’ll take it from
              there.
            </p>
            <label className={s.field}>
              Property address
              <input
                className={s.input}
                value={d.propertyAddress}
                onChange={(e) => update({ propertyAddress: e.target.value })}
                autoComplete="street-address"
                placeholder="Street address, city, state, ZIP"
                required
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
                    checked={d.contractSource === "not_yet_executed"}
                    onChange={() =>
                      update({
                        contractSource: "not_yet_executed",
                        documentIds: [],
                        dotloopLoopId: undefined,
                      })
                    }
                  />
                  Not under contract yet — start a listing
                </label>
              )}
            </div>
            {d.contractSource === "upload" && (
              <div className={s.file}>
                <Upload size={25} strokeWidth={1} />
                <p>Your executed contract belongs here.</p>
                <span className={s.hint}>
                  PDF or DOCX · up to 20 MB · include amendments
                </span>
                <input
                  type="file"
                  accept=".pdf,.docx"
                  aria-label="Choose executed contract"
                  onChange={(e) => setFile(e.target.files?.[0] || null)}
                />
                {file && (
                  <button
                    className={s.secondary}
                    style={{ marginTop: 15 }}
                    disabled={busy}
                    onClick={() => void upload()}
                  >
                    {busy ? "Uploading…" : "Upload contract"}
                  </button>
                )}
                {d.documentIds.length > 0 && (
                  <p
                    style={{
                      fontFamily: "inherit",
                      fontSize: 12,
                      color: "#71805e",
                    }}
                  >
                    <CheckCircle2 size={14} />{" "}
                    {uploaded || `${d.documentIds.length} saved document(s)`}
                  </p>
                )}
              </div>
            )}
            {d.contractSource === "dotloop" && (
              <>
                <div className={s.notice}>
                  The coordinator will retrieve this contract once Dotloop is
                  authorized. A loop reference is required; this selection does
                  not claim a document has already synced.
                </div>
                <label className={s.field}>
                  Dotloop loop ID
                  <input
                    className={s.input}
                    value={d.dotloopLoopId || ""}
                    onChange={(e) => update({ dotloopLoopId: e.target.value })}
                  />
                </label>
              </>
            )}
          </>
        )}
        {step === 2 && (
          <>
            <h2>
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
                        update({ clients: d.clients.filter((_, j) => j !== i) })
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
                    required
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
                      required
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
                      required
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
              onClick={() => update({ clients: [...d.clients, { name: "" }] })}
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
            <h2>Title, lender & documents</h2>
            <p className={s.sub}>
              Tell us what you have. We’ll chase the rest.
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
                        "It’s in MLS or Dotloop — please send it to the buyer",
                      ],
                      [
                        "request_listing_agent",
                        "I haven’t received it — please reach out to the listing agent",
                      ],
                      [
                        "agent_will_email",
                        "I got it from the listing agent — I’ll email it to you; please send it to the buyer",
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
                        "It’s in MLS or Dotloop — please send it to the buyer’s agent",
                      ],
                      [
                        "seller_will_email",
                        "I haven’t received it — the seller will email it to you; please forward it",
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
                      "It’s in Dotloop — please send it to title",
                    ],
                    [
                      "request_sellers",
                      "Please reach out to the sellers for their previous policy",
                    ],
                    [
                      "agent_will_email",
                      "I got it from the sellers — I’ll email you a copy to send to title",
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
            <h2>The final details</h2>
            <p className={s.sub}>
              Help us apply your brokerage requirements and add a personal
              touch.
            </p>
            <div className={s.grid}>
              <label className={s.field}>
                Broker of record
                {d.packageCode === "essentials" ? " (optional)" : ""}
                <input
                  className={s.input}
                  value={d.broker.name}
                  onChange={(e) =>
                    update({ broker: { ...d.broker, name: e.target.value } })
                  }
                  required
                />
              </label>
              <label className={s.field}>
                Broker email
                {d.packageCode === "essentials" ? " (optional)" : ""}
                <input
                  type="email"
                  className={s.input}
                  value={d.broker.email}
                  onChange={(e) =>
                    update({ broker: { ...d.broker, email: e.target.value } })
                  }
                  required
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
                onChange={(e) =>
                  update({
                    broker: { ...d.broker, ownChecklist: e.target.checked },
                  })
                }
              />
              My brokerage has its own checklist
            </label>
            {d.broker.ownChecklist && (
              <div style={{ marginTop: 18 }}>
                <label className={s.field}>
                  Brokerage checklist (PDF or DOCX)
                  <input
                    className={s.input}
                    type="file"
                    accept=".pdf,.docx"
                    onChange={(e) =>
                      setChecklistFile(e.target.files?.[0] || null)
                    }
                  />
                </label>
                {checklistFile && (
                  <button
                    className={s.secondary}
                    disabled={busy}
                    onClick={() => void uploadChecklist()}
                  >
                    {busy ? "Uploading…" : "Upload brokerage checklist"}
                  </button>
                )}
                {d.broker.checklistDocumentId && (
                  <p className={s.hint}>
                    Brokerage checklist uploaded securely.
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
                  Gift catalog and prices require Ireland’s approval. This
                  records your preference and creates a follow-up task. Payment
                  is required before any gift is ordered.
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
            <h2>A final look before we begin.</h2>
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
                ["Property", d.propertyAddress],
                ["Purchase", d.purchaseType],
                [
                  "Contract",
                  d.contractSource === "upload"
                    ? `${d.documentIds.length} document(s) uploaded`
                    : d.contractSource === "dotloop"
                      ? `Dotloop · ${d.dotloopLoopId}`
                      : "Pre-listing · contract not yet executed",
                ],
                [
                  "Clients",
                  d.clients
                    .map(
                      (c) =>
                        `${c.name}${c.relationship ? " (" + c.relationship + ")" : ""}${c.email ? " · " + c.email : ""}${c.phone ? " · " + c.phone : ""}`,
                    )
                    .join("\n"),
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
                ["Broker", `${d.broker.name} · ${d.broker.email}`],
                [
                  "Compliance",
                  `${d.broker.pre1978 ? "Built before 1978" : "Built in/after 1978"} · ${d.broker.ownChecklist ? `Brokerage checklist requested${d.broker.checklistDocumentId ? " · file uploaded" : " · file to follow"}` : "Standard checklist"}`,
                ],
                [
                  "Gift",
                  d.gift.requested
                    ? `${d.gift.tier} · ${d.gift.choice} · price and payment to be confirmed`
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
              <ShieldCheck size={16} /> Your intake is saved securely. You can
              return to your portal for updates. Service fee timing will be
              confirmed by Ireland.
            </div>
          </>
        )}
      </div>
      <div className={s.actions}>
        <button
          className={s.secondary}
          disabled={busy || step === 0}
          onClick={() => setStep((x) => Math.max(0, x - 1))}
        >
          <ArrowLeft size={13} />
          Back
        </button>
        <div className={s.footer}>
          <button
            className={s.secondary}
            disabled={busy}
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
          {saved && <span role="status">Saved at {saved}</span>}
        </div>
        {step < 5 ? (
          <button className={s.btn} disabled={busy} onClick={() => void next()}>
            {busy ? "Saving…" : "Continue"}
            <ArrowRight size={13} />
          </button>
        ) : (
          <button
            className={s.btn}
            disabled={busy}
            onClick={() => void submit()}
          >
            {busy ? "Submitting…" : "Submit transaction"}
            <Check size={13} />
          </button>
        )}
      </div>
    </div>
  );
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
        ? ["listing_agent", "Not sure — please reach out to the listing agent"]
        : ["mls", "It’s listed in the MLS"],
    );
  else {
    if (compliance) options.push(["dotloop", "See pre-approval in Dotloop"]);
    if (side === "seller")
      options.push([
        "buyers_agent",
        "Not sure — please reach out to the buyer’s agent",
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
