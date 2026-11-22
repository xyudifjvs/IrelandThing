import { useState, type FormEvent } from "react";
import {
  localWallTime,
  wallTimeInstants,
} from "../../../../../../../packages/matters/src/date-graph/calendar";
import { mutate } from "../../_components/data";
import type { TransactionAction } from "../../_components/transaction-controls";
import type { ChecklistTaskRecord } from "./canonical-checklist-model";
import s from "./canonical-checklist.module.css";
import {
  appointmentClock,
  clockWallTime,
  emptyClock,
  type AppointmentClock,
} from "./checklist-presentation";

export type StepEditorKind =
  "title" | "note" | "appointment" | "money" | "wording";

export function ChecklistStepEditor({
  kind,
  task,
  matterId,
  timeZone: fileTimeZone,
  busy,
  act,
  onClose,
}: {
  kind: StepEditorKind;
  task: ChecklistTaskRecord;
  matterId: string;
  timeZone: string | null;
  busy: boolean;
  act: TransactionAction;
  onClose: () => void;
}) {
  const [expectedRevision] = useState(task.revision);
  const stale = expectedRevision !== task.revision;
  const timeZone = fileTimeZone || "America/New_York";
  const savedAppointment = task.appointmentAt ?? task.details?.appointmentAt;
  const [initialWallTime] = useState(() =>
    kind === "appointment" && savedAppointment
      ? (localWallTime(savedAppointment, timeZone) ?? "")
      : "",
  );
  const [clock, setClock] = useState(() => appointmentClock(initialWallTime));
  const [clockEdited, setClockEdited] = useState(false);
  // A place-only edit must retain any seconds/fractions on an existing appointment.
  const wallTime = clockEdited ? clockWallTime(clock) : initialWallTime || null;
  const incompleteClock = wallTime === "";
  function changeClock(field: keyof AppointmentClock, value: string) {
    setClock((current) => ({ ...current, [field]: value }));
    setClockEdited(true);
    setOccurrence("");
  }
  const [occurrence, setOccurrence] = useState(() =>
    savedAppointment && wallTime
      ? new Date(savedAppointment).toISOString()
      : "",
  );
  const choices = wallTime ? wallTimeInstants(wallTime, timeZone) : [];
  const invalidWallTime = !!wallTime && !choices.length;
  const repeatedWallTime = choices.length > 1;
  const appointmentAt = repeatedWallTime
    ? choices.find((instant) => instant === occurrence)
    : choices[0];
  const offsetName = (instant: string) =>
    new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "shortOffset" })
      .formatToParts(new Date(instant))
      .find((part) => part.type === "timeZoneName")?.value;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    if (
      stale ||
      (kind === "appointment" &&
        (incompleteClock || (!!wallTime && !appointmentAt)))
    )
      return;
    const patch =
      kind === "title"
        ? { title: String(values.get("title") || "").trim() }
        : kind === "note"
          ? {
              note: String(values.get("note") || ""),
              showNoteToAgent: values.has("showNoteToAgent"),
            }
          : kind === "wording"
            ? { dateWording: String(values.get("dateWording") || "") }
            : kind === "money"
              ? {
                  amountCents: String(values.get("amount") || "").trim()
                    ? Math.round(Number(values.get("amount")) * 100)
                    : null,
                  ...(task.stepKey === "earnest_money_due"
                    ? { holder: String(values.get("company") || "") }
                    : { company: String(values.get("company") || "") }),
                }
              : {
                  appointmentAt: appointmentAt ?? null,
                  appointmentPlace: String(values.get("place") || "").trim(),
                };
    void act(task.id, async () => {
      await mutate(
        `/api/v1/matters/${matterId}/tasks/${task.id}`,
        { expectedRevision, ...patch },
        "PATCH",
      );
      onClose();
    });
  }

  return (
    <form className={s.editor} onSubmit={submit}>
      {kind === "wording" && (
        <label>
          Date display text
          <input
            name="dateWording"
            maxLength={300}
            defaultValue={task.details?.dateWording || ""}
            placeholder="Use the date / default wording"
          />
          <small>
            Shown to agents and clients. Leave blank to use the date or default
            wording. The real due date stays in place for sorting and reminders.
          </small>
        </label>
      )}
      {kind === "money" && (
        <div className={s.fields}>
          <label>
            Amount ($)
            <input
              name="amount"
              type="number"
              min="0"
              max="100000000"
              step="0.01"
              defaultValue={
                (task.details && Object.hasOwn(task.details, "amountCents")
                  ? task.details.amountCents
                  : (task.details?.earnestMoneyCents ??
                    task.details?.homeWarrantyCents)) != null
                  ? Number(
                      task.details && Object.hasOwn(task.details, "amountCents")
                        ? task.details.amountCents
                        : (task.details?.earnestMoneyCents ??
                            task.details?.homeWarrantyCents),
                    ) / 100
                  : ""
              }
            />
          </label>
          <label>
            {task.stepKey === "earnest_money_due"
              ? "Held by"
              : "Warranty company"}
            <input
              name="company"
              maxLength={300}
              defaultValue={
                task.details?.holder ??
                task.details?.company ??
                task.details?.earnestMoneyHolder ??
                task.details?.homeWarrantyCompany ??
                ""
              }
            />
          </label>
        </div>
      )}
      {kind === "title" && (
        <label>
          Step title
          <input
            name="title"
            defaultValue={task.title}
            required
            maxLength={300}
          />
        </label>
      )}
      {kind === "note" && (
        <>
          <label>
            Step note
            <textarea
              name="note"
              defaultValue={task.note ?? task.details?.note ?? ""}
              maxLength={1000}
            />
          </label>
          <label className={s.check}>
            <input
              type="checkbox"
              name="showNoteToAgent"
              defaultChecked={task.details?.showNoteToAgent ?? false}
            />
            Show to agent
          </label>
        </>
      )}
      {kind === "appointment" && (
        <div className={s.fields}>
          <p className={s.appointmentZone}>Appointment timezone: {timeZone}</p>
          <label>
            Appointment date
            <input
              type="date"
              value={clock.date}
              onChange={(event) => changeClock("date", event.target.value)}
            />
          </label>
          <div className={s.clockFields}>
            <label>
              Hour
              <select
                value={clock.hour}
                onChange={(event) => changeClock("hour", event.target.value)}
              >
                <option value="">Hour</option>
                {Array.from({ length: 12 }, (_, i) => i + 1).map((hour) => (
                  <option key={hour} value={hour}>
                    {hour}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Minute
              <input
                type="number"
                min="0"
                max="59"
                step="1"
                placeholder="00–59"
                value={clock.minute}
                onChange={(event) => changeClock("minute", event.target.value)}
              />
            </label>
            <label>
              AM/PM
              <select
                value={clock.period}
                onChange={(event) => changeClock("period", event.target.value)}
              >
                <option value="">AM/PM</option>
                <option>AM</option>
                <option>PM</option>
              </select>
            </label>
          </div>
          <button
            type="button"
            className={s.textButton}
            onClick={() => {
              setClock({ ...emptyClock });
              setClockEdited(true);
              setOccurrence("");
            }}
          >
            Clear appointment date and time
          </button>
          {incompleteClock && (
            <p role="alert">Choose a date, hour, minute, and AM or PM.</p>
          )}
          {invalidWallTime && (
            <p role="alert">
              This time does not occur in {timeZone}. Choose another time.
            </p>
          )}
          {repeatedWallTime && (
            <label>
              This local time occurs twice. Choose which occurrence.
              <select
                required
                value={appointmentAt ?? ""}
                onChange={(event) => setOccurrence(event.target.value)}
              >
                <option value="">Choose an occurrence</option>
                {choices.map((instant, index) => (
                  <option key={instant} value={instant}>
                    {index === 0 ? "First occurrence" : "Second occurrence"} (
                    {offsetName(instant)})
                  </option>
                ))}
              </select>
            </label>
          )}
          <label>
            Place
            <input
              name="place"
              defaultValue={task.details?.appointmentPlace ?? ""}
              maxLength={300}
            />
          </label>
        </div>
      )}
      {stale && (
        <p role="alert">
          This step changed. Close the editor and reopen it to use the latest
          details.
        </p>
      )}
      <div className={s.actions}>
        <button
          disabled={
            busy ||
            stale ||
            !expectedRevision ||
            (kind === "appointment" &&
              (incompleteClock || (!!wallTime && !appointmentAt)))
          }
        >
          Save
        </button>
        <button type="button" disabled={busy} onClick={onClose}>
          Cancel
        </button>
      </div>
    </form>
  );
}
