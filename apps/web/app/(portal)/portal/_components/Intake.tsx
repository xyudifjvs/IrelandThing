"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import LegacyIntake from "./LegacyIntake";
import {
  referenceTemplates,
  type ReferenceVariant,
} from "./reference-templates";
import { normalizeReference, type ReferenceIntake } from "./reference-model";
import {
  addPerson,
  escapeHtml,
  readFields,
  relabelPeople,
  renderStep,
  setFields,
  syncConditions,
} from "./reference-dom";
import { useDocumentUploadQueue } from "../../../_components/DocumentUploadQueue";
import {
  api,
  mutate,
  useData,
  type Session,
} from "../../../(workspace)/workspace/_components/data";
import "./reference-intake.css";
type Draft = {
  id: string;
  revision: number;
  status: string;
  payload: Record<string, unknown> & {
    referenceIntake?: ReferenceIntake;
    packageCode?: string;
  };
  submittedMatterId?: string;
};
type Uploaded = { id: string; name: string };
const blank = (variant: ReferenceVariant): ReferenceIntake => ({
  version: 1,
  variant,
  fields: {},
  uploads: {},
  fileNames: {},
});
export default function Intake() {
  const [legacy, setLegacy] = useState(false),
    [legacyDraft, setLegacyDraft] = useState<string>();
  useEffect(() => {
    const q = new URLSearchParams(location.search);
    // Full Listing remains resumable through existing drafts, but is not a new order.
    void q;
  }, []);
  return legacy ? (
    <LegacyIntake initialDraftId={legacyDraft} />
  ) : (
    <ReferenceForm
      openLegacy={(id) => {
        setLegacyDraft(id);
        setLegacy(true);
      }}
    />
  );
}
function ReferenceForm({ openLegacy }: { openLegacy: (id?: string) => void }) {
  const session = useData<Session>("/api/v1/session");
  const actor = session.data?.user;
  const allowed =
    !!actor && ["agent", "coordinator"].includes(actor.role || "");
  const drafts = useData<Draft[]>(allowed ? "/api/v1/intake/drafts" : null);
  const root = useRef<HTMLDivElement>(null),
    ref = useRef<ReferenceIntake>(blank("buyer")),
    draft = useRef<Draft | null>(null);
  const [variant, setVariant] = useState<ReferenceVariant>("buyer"),
    [generation, setGeneration] = useState(0),
    [step, setStep] = useState(0);
  const packageRef = useRef("essentials");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [saved, setSaved] = useState(""),
    [showDrafts, setShowDrafts] = useState(false),
    [dirty, setDirty] = useState(false);
  const [receipt, setReceipt] = useState<{
    id: string;
    matterId: string;
  } | null>(null);
  const busyRef = useRef(false);
  const revisionConflict = useRef(false),
    saveChain = useRef<Promise<unknown>>(Promise.resolve()),
    changes = useRef(0),
    reservations = useRef(new Set<string>());
  const groupFiles = useRef(new WeakMap<File, string>()),
    groupMetadata = useRef(new Map<string, string>());
  const fileKey = (f: {
    name: string;
    size: number;
    lastModified: number;
    type: string;
  }) => JSON.stringify([f.name, f.size, f.lastModified, f.type]);
  function snapshot() {
    if (root.current)
      ref.current = {
        ...ref.current,
        fields: { ...ref.current.fields, ...readFields(root.current) },
      };
    return structuredClone(ref.current);
  }
  function changed() {
    changes.current++;
    setDirty(true);
    setSaved("");
  }
  function persist(value = snapshot()) {
    const changeAtStart = changes.current,
      code = packageRef.current;
    const saving = saveChain.current
      .catch(() => undefined)
      .then(async () => {
        if (revisionConflict.current)
          throw Error(
            "This draft changed in another tab. Reopen its saved version before saving again.",
          );
        const payload = normalizeReference(value, code),
          current = draft.current;
        try {
          const next = current
            ? await mutate<Draft>(
                `/api/v1/intake/drafts/${current.id}`,
                { expectedRevision: current.revision, payload },
                "PATCH",
              )
            : await mutate<Draft>("/api/v1/intake/drafts", { payload });
          draft.current = next;
          if (changeAtStart === changes.current) setDirty(false);
          setSaved(
            "Saved " +
              new Date().toLocaleTimeString("en-US", {
                hour: "numeric",
                minute: "2-digit",
              }),
          );
          return next;
        } catch (e) {
          if (/changed|revision|another/i.test((e as Error).message))
            revisionConflict.current = true;
          throw e;
        }
      });
    saveChain.current = saving;
    return saving;
  }
  const uploads = useDocumentUploadQueue<Uploaded>({
    maxFiles: 120,
    upload: async (file, itemId) => {
      const group = groupFiles.current.get(file) || "contractDocs";
      const count =
        (ref.current.uploads[group] || []).length +
        [...reservations.current].filter((x) => x.startsWith(group + ":"))
          .length;
      if (count >= 30)
        throw Error(
          "This section accepts up to 30 documents. Remove another selected file.",
        );
      reservations.current.add(group + ":" + itemId);
      try {
        const body = new FormData();
        body.set("file", file);
        body.set("category", group === "contractDocs" ? "contract" : "other");
        body.set("visibility", "agent");
        body.set("uploadRequestId", itemId);
        const doc = await api<Uploaded>("/api/v1/documents", {
          method: "POST",
          body,
        });
        // Associate immediately in memory; a failed draft PATCH can retry without re-uploading.
        ref.current = {
          ...ref.current,
          uploads: {
            ...ref.current.uploads,
            [group]: [
              ...new Set([...(ref.current.uploads[group] || []), doc.id]),
            ],
          },
          fileNames: {
            ...ref.current.fileNames,
            [doc.id]: doc.name || file.name,
          },
        };
        changed();
        return { ...doc, name: doc.name || file.name };
      } finally {
        reservations.current.delete(group + ":" + itemId);
      }
    },
    finalize: async () => {
      await persist();
    },
  });
  const pending = uploads.running || uploads.hasPending;
  const queues = useRef(uploads);
  queues.current = uploads;
  useEffect(() => {
    if (uploads.entries.some((x) => x.status === "queued") && !uploads.running)
      void uploads.start();
  }, [uploads.entries, uploads.running]);
  useEffect(() => {
    if (!allowed || !root.current) return;
    const el = root.current;
    if (!Object.keys(ref.current.fields).length) {
      const q = new URLSearchParams(location.search);
      const side = q.get("side") === "seller" ? "seller" : "buyer";
      const requested = q.get("variant");
      const desired =
        requested && Object.hasOwn(referenceTemplates, requested)
          ? (requested as ReferenceVariant)
          : ((side +
              (q.get("package") === "complete"
                ? "-compliance"
                : "")) as ReferenceVariant);
      if (desired !== variant) {
        ref.current = blank(desired);
        setVariant(desired);
        return;
      }
      packageRef.current = variant.endsWith("compliance")
        ? "complete"
        : "essentials";
      ref.current.fields = readFields(el);
    }
    const fields = ref.current.fields;
    if (!fields.directContact) fields.directContact = "copy_agent";
    el.querySelector("[data-agent-name]")!.textContent = actor!.name;
    el.querySelector("[data-agent-email]")!.textContent = actor!.email;
    el.querySelector("#buyers")!.replaceChildren();
    el.querySelector("#contacts")!.replaceChildren();
    for (const kind of ["b", "c"] as const) {
      const indices = [
        ...new Set(
          Object.keys(fields)
            .map((k) => new RegExp("^" + kind + "(\\d+)_").exec(k)?.[1])
            .filter(Boolean),
        ),
      ].map(Number);
      for (const i of indices.length ? indices : [1])
        addPerson(
          el,
          kind,
          i,
          variant.startsWith("seller") ? "seller" : "buyer",
        );
    }
    const contractCard = el.querySelector("#contractDocs")!.closest(".card")!;
    if (!contractCard.querySelector("[data-contract-location]")) {
      const location = document.createElement("div");
      location.className = "field";
      location.dataset.contractLocation = "";
      location.innerHTML =
        '<label class="lbl" for="contractLocation">Executed contract location</label><input type="text" id="contractLocation" name="contractLocation" placeholder="Dotloop loop, shared folder or other location"><p class="hint">Upload the executed contract above, or tell Ireland where she can find it. Required before final submission when no contract is uploaded.</p>';
      contractCard.append(location);
    }
    setFields(el, fields);
    syncConditions(el);
    renderStep(el, step, ref.current);
    // Initial browser defaults are also durable answers; no fabricated person data.
    ref.current.fields = { ...fields, ...readFields(el) };
  }, [allowed, variant, generation, actor?.name, actor?.email]);
  useEffect(() => {
    if (root.current) renderStep(root.current, step, snapshot());
  }, [step, receipt]);
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    for (const group of [
      "contractDocs",
      "hoaFiles",
      "utilFiles",
      "policyFiles",
    ]) {
      const list = el.querySelector("#list-" + group);
      if (!list) continue;
      const entries = uploads.entries.filter(
        (x) => groupMetadata.current.get(fileKey(x)) === group,
      );
      const durable = (ref.current.uploads[group] || [])
        .filter(
          (id) =>
            !entries.some((x) => x.result?.id === id && x.status === "failed"),
        )
        .map(
          (id) =>
            `<li><span class="name">${escapeHtml(ref.current.fileNames[id] || "Saved private document")}<small>Saved privately</small></span><button type="button" class="link quiet" data-remove-doc="${group}:${escapeHtml(id)}">Remove</button></li>`,
        )
        .join("");
      list.innerHTML =
        durable +
        entries
          .filter((x) => x.status !== "saved")
          .map(
            (x) =>
              `<li><span class="name">${escapeHtml(x.name)}<small>${escapeHtml(x.error || x.status)}</small></span><span>${x.status === "failed" ? `<button type="button" class="link" data-retry="${x.id}">Retry</button> ` : ""}${["queued", "failed", "invalid"].includes(x.status) ? `<button type="button" class="link quiet" data-remove-queue="${x.id}">Remove</button>` : ""}</span></li>`,
          )
          .join("");
    }
  }, [uploads.entries, variant, generation, saved]);
  useEffect(() => {
    if (!dirty && !pending) return;
    const before = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    const navigate = (e: MouseEvent) => {
      if (
        !(e.target instanceof Element) ||
        e.defaultPrevented ||
        e.metaKey ||
        e.ctrlKey ||
        e.shiftKey ||
        e.altKey
      )
        return;
      const a = e.target.closest("a[href]");
      if (!a || a.getAttribute("target") === "_blank") return;
      if (
        pending ||
        !confirm("This intake has unsaved changes. Leave without saving?")
      ) {
        e.preventDefault();
        e.stopPropagation();
        if (pending)
          setError(
            "Wait for uploads to finish or remove unfinished files before leaving.",
          );
      }
    };
    window.addEventListener("beforeunload", before);
    document.addEventListener("click", navigate, true);
    return () => {
      window.removeEventListener("beforeunload", before);
      document.removeEventListener("click", navigate, true);
    };
  }, [dirty, pending]);
  async function run(action: () => Promise<void>) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  function check() {
    if (pending)
      throw Error(
        "Wait for uploads to finish, retry failed files or remove them before continuing.",
      );
    const fields = snapshot().fields;
    for (const [key, value] of Object.entries(fields))
      if (
        /(?:^|_)email$/.test(key) &&
        value &&
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value))
      )
        throw Error("Enter a valid email address or leave it blank.");
  }
  async function go(next: number) {
    check();
    await persist();
    setStep(next);
    window.scrollTo({ top: 0 });
    requestAnimationFrame(() =>
      root.current
        ?.querySelector<HTMLElement>(`.step[data-step="${next}"] h1`)
        ?.focus(),
    );
  }
  async function submit() {
    check();
    const value = snapshot();
    if (
      !(value.uploads.contractDocs || []).length &&
      !String(value.fields.contractLocation || "").trim()
    )
      throw Error(
        "Upload the executed contract or tell Ireland where she can find it before submitting. You can save a draft at any point.",
      );
    const current = await persist();
    const result = await mutate<{
      submission: { id: string };
      matter: { id: string };
    }>(`/api/v1/intake/drafts/${current.id}/submit`, {
      expectedRevision: current.revision,
      idempotencyKey: `intake-submit-${current.id}`,
    });
    setReceipt({ id: result.submission.id, matterId: result.matter.id });
    setDirty(false);
    setStep(6);
    await drafts.refresh();
  }
  function addFiles(group: string, files: FileList | File[]) {
    if (busyRef.current || receipt) return;
    for (const file of Array.from(files)) {
      if (!queues.current.entries.some((x) => fileKey(x) === fileKey(file))) {
        groupFiles.current.set(file, group);
        groupMetadata.current.set(fileKey(file), group);
      }
    }
    uploads.addFiles(files);
  }
  function input(e: React.FormEvent<HTMLDivElement>) {
    if (busyRef.current || receipt) return;
    const el = e.target;
    if (!(
      el instanceof HTMLInputElement ||
      el instanceof HTMLSelectElement ||
      el instanceof HTMLTextAreaElement
    ))
      return;
    if (el instanceof HTMLInputElement && el.type === "file") {
      if (el.files) addFiles(el.id, el.files);
      el.value = "";
      return;
    }
    if (el.name === "cash") {
      const lender = root.current!.querySelectorAll<HTMLInputElement>(
        'input[name="lender"]',
      );
      if (el.value === "yes")
        lender.forEach((x) => (x.checked = x.value === "cash"));
      else
        lender.forEach((x) => {
          if (x.value === "cash") x.checked = false;
        });
    }
    changed();
    const value = snapshot();
    if (el.name === "service" || el.name === "side") {
      value.variant = (String(value.fields.side) +
        (value.fields.service === "ctcc"
          ? "-compliance"
          : "")) as ReferenceVariant;
      ref.current = value;
      packageRef.current = value.variant.endsWith("compliance")
        ? "complete"
        : "essentials";
      setVariant(value.variant);
      return;
    }
    syncConditions(root.current!);
  }
  function click(e: React.MouseEvent<HTMLDivElement>) {
    const target = e.target as Element,
      button = target.closest<HTMLButtonElement>("button");
    if (!button) return;
    if (busy || (receipt && button.id !== "restart")) {
      e.preventDefault();
      return;
    }
    const idx = button.dataset.go ?? button.dataset.go2;
    if (idx !== undefined) {
      void run(() => go(Number(idx)));
      return;
    }
    if (button.hasAttribute("data-preferences")) {
      setShowDrafts(true);
      window.scrollTo({ top: 0 });
      return;
    }
    if (button.id === "next") {
      void run(() => (step === 5 ? submit() : go(step + 1)));
      return;
    }
    if (button.id === "back") {
      void run(() => go(Math.max(0, step - 1)));
      return;
    }
    if (button.id === "addBuyer" || button.id === "addContact") {
      const kind = button.id === "addBuyer" ? "b" : "c",
        host = root.current!.querySelector(
          kind === "b" ? "#buyers" : "#contacts",
        )!;
      if (host.children.length >= 12) {
        setError("Add at most 12 people in this section.");
        return;
      }
      const index =
        Math.max(
          0,
          ...[...host.children].map((x) =>
            Number((x as HTMLElement).dataset.k),
          ),
        ) + 1;
      addPerson(root.current!, kind, index, String(ref.current.fields.side));
      changed();
      snapshot();
      return;
    }
    if (button.hasAttribute("data-rm")) {
      const person = button.closest(".person")!;
      const keys = [...person.querySelectorAll<HTMLInputElement>("input")].map(
        (x) => x.name,
      );
      person.remove();
      keys.forEach((k) => delete ref.current.fields[k]);
      relabelPeople(root.current!, String(ref.current.fields.side));
      changed();
      snapshot();
      return;
    }
    if (button.dataset.retry) {
      void uploads.retry(button.dataset.retry);
      return;
    }
    if (button.dataset.removeQueue) {
      const entry = uploads.entries.find(
        (x) => x.id === button.dataset.removeQueue,
      );
      if (entry?.result) {
        const id = entry.result.id;
        for (const group of Object.keys(ref.current.uploads))
          ref.current.uploads[group] = ref.current.uploads[group].filter(
            (x) => x !== id,
          );
        delete ref.current.fileNames[id];
        changed();
        void run(async () => {
          await persist();
        });
      }
      uploads.remove(button.dataset.removeQueue);
      return;
    }
    if (button.dataset.removeDoc) {
      if (pending) {
        setError("Wait for uploads to finish before removing saved documents.");
        return;
      }
      const [group, id] = button.dataset.removeDoc.split(":");
      ref.current.uploads[group] = (ref.current.uploads[group] || []).filter(
        (x) => x !== id,
      );
      if (!Object.values(ref.current.uploads).flat().includes(id))
        delete ref.current.fileNames[id];
      const entry = uploads.entries.find((x) => x.result?.id === id);
      if (entry) uploads.remove(entry.id);
      changed();
      void run(async () => {
        await persist();
      });
      return;
    }
    if (button.id === "payBtn") {
      root.current!.querySelector<HTMLElement>("#payNote")!.hidden = false;
      return;
    }
    if (button.id === "restart") {
      location.href = "/portal/intake";
    }
  }
  async function open(id: string) {
    if (pending)
      throw Error(
        "Finish or remove unfinished uploads before opening another draft.",
      );
    if (dirty && !confirm("Replace unsaved entries with the saved intake?"))
      return;
    const savedDraft = await api<Draft>(
      `/api/v1/intake/drafts/${encodeURIComponent(id)}`,
    );
    if (savedDraft.status !== "draft")
      throw Error(
        "This draft was already submitted. Open the transaction from your portal.",
      );
    if (!savedDraft.payload.referenceIntake) {
      openLegacy(id);
      return;
    }
    draft.current = savedDraft;
    ref.current = structuredClone(savedDraft.payload.referenceIntake);
    packageRef.current = ref.current.variant.endsWith("compliance")
      ? "complete"
      : "essentials";

    revisionConflict.current = false;
    uploads.clear();
    setVariant(ref.current.variant);
    setGeneration((x) => x + 1);
    setStep(0);
    setDirty(false);
    setShowDrafts(false);
    setSaved("Saved draft opened");
  }
  if (session.loading) return <p>Opening your authenticated intake…</p>;
  if (!allowed)
    return (
      <div style={{ padding: 40 }}>
        <h1>Agent portal</h1>
        <p>
          {session.error ||
            "Only agents and coordinators can submit a transaction."}
        </p>
        <Link href="/login?next=/portal/intake">Sign in</Link>
      </div>
    );
  return (
    <div className="weatherly-intake">
      <div className="proto">
        <span>
          {variant.includes("compliance")
            ? "Contract to Close + Compliance"
            : "Contract to Close"}{" "}
          · {variant.startsWith("seller") ? "Seller" : "Buyer"} version
        </span>
        <span
          style={{
            display: "flex",
            gap: 16,
            alignItems: "center",
            flexWrap: "wrap",
          }}
        >
          <Link href="/portal">Your portal</Link>
          <button
            disabled={busy || !!receipt}
            onClick={() =>
              void run(async () => {
                await persist();
                await drafts.refresh();
              })
            }
          >
            Save draft
          </button>
          <button
            disabled={busy || !!receipt}
            onClick={() => {
              setShowDrafts(!showDrafts);
              void drafts.refresh();
            }}
          >
            Resume & preferences
          </button>
          <span>
            {variant.endsWith("compliance") ? "$515" : "$425"} USD · Full
            Listing coming soon
          </span>
        </span>
      </div>
      {showDrafts && (
        <div className="draft-tools">
          <p>Saved drafts</p>
          {drafts.loading ? (
            <p>Loading…</p>
          ) : drafts.error ? (
            <p role="alert">
              {drafts.error}
              <button onClick={() => void drafts.refresh()}>Retry</button>
            </p>
          ) : (
            (drafts.data || [])
              .filter((x) => x.status === "draft")
              .map((x) => (
                <button
                  key={x.id}
                  disabled={busy || !!receipt}
                  onClick={() => void run(() => open(x.id))}
                >
                  {String(x.payload.propertyAddress || "Untitled transaction")}{" "}
                  ·{" "}
                  {x.payload.referenceIntake?.variant || x.payload.packageCode}
                </button>
              ))
          )}
          <label>
            Client communication{" "}
            <select
              aria-label="Client communication preference"
              disabled={busy || !!receipt}
              value={String(ref.current.fields.directContact || "copy_agent")}
              onChange={(e) => {
                if (busyRef.current || receipt) return;
                ref.current.fields.directContact = e.target.value;
                changed();
                if (root.current) renderStep(root.current, step, snapshot());
              }}
            >
              <option value="copy_agent">
                Contact clients directly and copy me
              </option>
              <option value="through_agent">Communicate through me only</option>
            </select>
          </label>
          <p>
            Contract to Close: $425. Contract to Close + Compliance: $515. Full
            Listing is coming soon.
          </p>
        </div>
      )}
      {error && (
        <p className="save-message" role="alert">
          {error}
        </p>
      )}
      {(uploads.selectionError || uploads.completionError) && (
        <p className="save-message" role="alert">
          {uploads.selectionError || uploads.completionError}
        </p>
      )}
      {saved && (
        <p
          className="save-message"
          style={{
            position: "fixed",
            bottom: 8,
            right: 8,
            zIndex: 10,
            borderRadius: 8,
            fontSize: 12,
          }}
          role="status"
        >
          {saved}
        </p>
      )}
      {receipt && (
        <p className="save-message" role="status">
          Saved receipt {receipt.id} ·{" "}
          <Link href={`/portal/transactions/${receipt.matterId}`}>
            Open transaction
          </Link>
        </p>
      )}
      <fieldset
        disabled={busy}
        style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}
      >
        <div
          ref={root}
          key={variant + generation}
          onChange={(e) => {
            if ((e.target as HTMLInputElement).type === "file") input(e);
          }}
          onInput={input}
          onClick={click}
          onSubmit={(e) => e.preventDefault()}
          onDragEnter={(e) => {
            if (!busyRef.current && !receipt)
              (e.target as Element)
                .closest("[data-drop]")
                ?.classList.add("over");
          }}
          onDragLeave={(e) => {
            (e.target as Element)
              .closest("[data-drop]")
              ?.classList.remove("over");
          }}
          onDragOver={(e) => {
            if ((e.target as Element).closest("[data-drop]"))
              e.preventDefault();
          }}
          onDrop={(e) => {
            const drop = (e.target as Element).closest<HTMLElement>(
              "[data-drop]",
            );
            if (drop) {
              e.preventDefault();
              drop.classList.remove("over");
              addFiles(drop.dataset.drop!, e.dataTransfer.files);
            }
          }}
          dangerouslySetInnerHTML={{ __html: referenceTemplates[variant] }}
        />
      </fieldset>
    </div>
  );
}
