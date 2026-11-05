import { buildReferenceReview } from "./reference-review";
import {
  answerLabel,
  answerText,
  type ReferenceIntake,
} from "./reference-model";
export const escapeHtml = (s: unknown) =>
  String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export function readFields(root: HTMLElement) {
  const fields: Record<string, string | boolean> = {};
  root
    .querySelectorAll<
      HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
    >("input[name],select[name],textarea[name]")
    .forEach((el) => {
      if (
        el instanceof HTMLInputElement &&
        ["file", "button", "submit"].includes(el.type)
      )
        return;
      if (el instanceof HTMLInputElement && el.type === "radio") {
        if (el.checked) fields[el.name] = el.value;
        return;
      }
      fields[el.name] =
        el instanceof HTMLInputElement && el.type === "checkbox"
          ? el.checked
          : el.value;
    });
  return fields;
}
export function setFields(
  root: HTMLElement,
  fields: Record<string, string | boolean>,
) {
  root
    .querySelectorAll<
      HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
    >("input[name],select[name],textarea[name]")
    .forEach((el) => {
      if (!(el.name in fields)) return;
      const v = fields[el.name];
      if (el instanceof HTMLInputElement && el.type === "file") return;
      if (el instanceof HTMLInputElement && el.type === "radio")
        el.checked = el.value === v;
      else if (el instanceof HTMLInputElement && el.type === "checkbox")
        el.checked = !!v;
      else el.value = String(v);
    });
}
export function addPerson(
  root: HTMLElement,
  kind: "b" | "c",
  index: number,
  side: string,
) {
  const host = root.querySelector(kind === "b" ? "#buyers" : "#contacts")!;
  const d = document.createElement("div");
  d.className = "person";
  d.dataset.k = String(index);
  const fields =
    kind === "b"
      ? ["name", "email", "phone"]
      : ["name", "email", "phone", "rel"];
  d.innerHTML = `<div class="person-head"><h3 class="ptitle"></h3><button type="button" class="link quiet" data-rm>Remove</button></div><div class="grid ${kind === "b" ? "g3" : "g2"}">${fields.map((field) => `<div class="field"><label class="lbl" for="${kind}${index}_${field}">${{ name: "Name", email: "Email", phone: "Phone", rel: "Relationship to client" }[field]}${kind === "b" ? ' <span class="req">*</span>' : ""}</label><input type="${field === "email" ? "email" : field === "phone" ? "tel" : "text"}" id="${kind}${index}_${field}" name="${kind}${index}_${field}"${field === "rel" ? ' placeholder="Parent, child, etc."' : ""}></div>`).join("")}</div>`;
  host.append(d);
  relabelPeople(root, side);
}
export function relabelPeople(root: HTMLElement, side: string) {
  for (const [id, title] of [
    ["buyers", side === "seller" ? "Seller" : "Buyer"],
    ["contacts", "Contact"],
  ]) {
    const people = root.querySelectorAll<HTMLElement>("#" + id + " .person");
    people.forEach((p, i) => {
      p.querySelector(".ptitle")!.textContent = title + " " + (i + 1);
      p.querySelector<HTMLButtonElement>("[data-rm]")!.hidden =
        people.length === 1;
    });
  }
  root.querySelector<HTMLElement>("#relWrap")!.hidden =
    root.querySelectorAll("#buyers .person").length < 2;
}
export function syncConditions(root: HTMLElement) {
  const fields = readFields(root);
  root.querySelectorAll<HTMLElement>("[data-show]").forEach((el) => {
    const [key, wanted] = el.dataset.show!.split("=");
    const v =
      typeof fields[key] === "boolean"
        ? fields[key]
          ? "on"
          : ""
        : String(fields[key] ?? "");
    el.hidden = !wanted.split("|").includes(v);
  });
  root.querySelector("#giftTotal")!.textContent =
    (fields.tier || "—") + " · [$ price]";
}
export function renderStep(
  root: HTMLElement,
  step: number,
  ref: ReferenceIntake,
) {
  root
    .querySelectorAll<HTMLElement>(".step")
    .forEach((el, i) => (el.hidden = i !== step));
  root.querySelector<HTMLElement>("#back")!.style.visibility =
    step === 0 ? "hidden" : "visible";
  root.querySelector<HTMLElement>("#actions")!.hidden = step === 6;
  root.querySelector("#next")!.textContent =
    step === 5 ? "Submit transaction" : "Continue";
  const steps = [...root.querySelectorAll<HTMLElement>(".step")].slice(0, 6);
  root.querySelector("#nav")!.innerHTML = steps
    .map(
      (el, i) =>
        `<li><button type="button" class="${i === step ? "active" : i < step || step === 6 ? "done" : "todo"}" data-go="${i}"${i === step ? ' aria-current="step"' : ""}><span class="dot"><span>${i + 1}</span></span>${escapeHtml(el.dataset.label)}</button></li>`,
    )
    .join("");
  if (step === 5) {
    const files = Object.fromEntries(
      ["contractDocs", "hoaFiles", "utilFiles", "policyFiles"].map((key) => [
        key,
        (ref.uploads[key] || []).map((id) => ({
          name: ref.fileNames[id] || "Saved private document",
        })),
      ]),
    );
    buildReferenceReview(root, ref.variant, files);
    root
      .querySelector("#review")!
      .insertAdjacentHTML(
        "beforeend",
        `<dt data-contact-review>Client communication</dt><dd data-contact-review>${ref.fields.directContact === "through_agent" ? "Communicate through my agent only" : "Contact clients directly and copy my agent"}</dd><dd data-contact-review><button type="button" class="link quiet" data-preferences>Change</button></dd>`,
      );
    // The prototype review omits contact phones and inactive entries. Make the full
    // saved snapshot inspectable without changing the supplied summary layout.
    const extra = document.createElement("details");
    extra.dataset.fullReview = "";
    extra.innerHTML =
      '<summary>All saved answers and documents</summary><dl class="review">' +
      Object.entries(ref.fields)
        .filter(([, v]) => v !== "" && v !== false)
        .map(
          ([k, v]) =>
            `<dt>${escapeHtml(answerLabel(k, String(ref.fields.side)))}</dt><dd>${escapeHtml(answerText(k, v))}</dd><dd></dd>`,
        )
        .join("") +
      Object.entries(files)
        .filter(([, f]) => f.length)
        .map(
          ([k, f]) =>
            `<dt>${escapeHtml({ contractDocs: "Contract documents", hoaFiles: "HOA documents", utilFiles: "Utilities / previous title policy", policyFiles: "Previous title policy" }[k])}</dt><dd>${f.map((x) => escapeHtml(x.name)).join("<br>")}</dd><dd></dd>`,
        )
        .join("") +
      "</dl>";
    const card = root.querySelector("#review")!.parentElement!;
    card.querySelector("[data-full-review]")?.remove();
    card.append(extra);
  }
}
