"use client";

import { useRef, useState, type FormEvent } from "react";
import { mutate } from "../../_components/data";
import {
  apiPath,
  formatHtoAddress,
  priceField,
  readPrice,
  statusLabels,
  type HtoAddress,
  type HtoClosingRow,
  type HtoOperationsView,
  type HtoSide,
  type HtoStatus,
  type LinkedClosingEdit,
} from "./model";
import s from "./hto.module.css";

const blankAddress = { street: "", city: "", state: "", zip: "" };
const emptyClient = { firstName: "", lastName: "", email: "", phone: "" };
const addressLabels = {
  street: "Street address",
  city: "City",
  state: "State",
  zip: "ZIP",
} as const;

type EditableClient = HtoClosingRow["clients"][number] & { key: number };

export function ClosingFactsForm({
  row,
  agents,
  done,
  cancel,
}: {
  row: HtoClosingRow | null;
  agents: HtoOperationsView["agents"];
  done: () => void;
  cancel: () => void;
}) {
  const linked = row?.matterId != null;
  const [agent, setAgent] = useState(row?.agentRosterId ?? "");
  const [address, setAddress] = useState(row?.address ?? blankAddress);
  const [clients, setClients] = useState<EditableClient[]>(() =>
    (row?.clients ?? []).map((person, key) => ({ ...person, key })),
  );
  const nextClientKey = useRef(clients.length);
  const [side, setSide] = useState<HtoSide>(row?.side ?? "seller");
  const [status, setStatus] = useState<HtoStatus>(
    row?.status ?? "active_listing",
  );
  const [closing, setClosing] = useState(row?.closeDate ?? "");
  const [listed, setListed] = useState(row?.listedDate ?? "");
  const [price, setPrice] = useState(priceField(row?.purchasePriceCents));
  const [addressEdited, setAddressEdited] = useState(false);
  const [clientsEdited, setClientsEdited] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const listing = status === "active_listing";

  function editClient(
    key: number,
    field: keyof typeof emptyClient,
    value: string,
  ) {
    setClientsEdited(true);
    setClients(
      clients.map((person) =>
        person.key === key ? { ...person, [field]: value } : person,
      ),
    );
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const parts = {
        street: address.street.trim(),
        city: address.city.trim(),
        state: address.state.trim(),
        zip: address.zip.trim(),
      };
      if ((!linked || addressEdited) && !parts.street)
        throw new Error("Enter a street address.");
      if (
        (!linked || clientsEdited) &&
        clients.some(
          (client) =>
            (!linked || !client.id) &&
            !client.firstName.trim() &&
            !client.lastName.trim(),
        )
      )
        throw new Error("Enter a first or last name for each new client.");
      const people = clients.map(
        ({ id, firstName, lastName, email, phone }) => ({
          ...(linked && id ? { id } : {}),
          firstName,
          lastName,
          email,
          phone,
        }),
      );
      const purchasePriceCents = listing ? null : readPrice(price);
      if (row?.matterId && row.matterRevision != null) {
        const facts: Omit<LinkedClosingEdit, "expectedRevision"> = {};
        if ((row.agentRosterId ?? "") !== agent)
          facts.agentRosterId = agent || null;
        if (row.side !== side) facts.side = side;
        if (!listing && row.purchasePriceCents !== purchasePriceCents)
          facts.purchasePriceCents = purchasePriceCents;
        if (addressEdited) {
          facts.address = parts;
          facts.propertyAddress = formatHtoAddress(parts);
        }
        if (clientsEdited) facts.clients = people;
        if (Object.keys(facts).length)
          await mutate(
            `${apiPath}/rows/${row.id}/facts`,
            { ...facts, expectedRevision: row.matterRevision },
            "PATCH",
          );
      } else {
        const input = {
          address: parts,
          clients: people,
          agentRosterId: agent || null,
          side,
          status,
          closeDate: listing ? null : closing || null,
          listedDate: listed || null,
          purchasePriceCents,
        };
        if (row)
          await mutate(
            `${apiPath}/rows/${row.id}`,
            { ...input, expectedRevision: row.revision },
            "PATCH",
          );
        else await mutate(`${apiPath}/rows`, input);
      }
      done();
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Unable to save this closing row.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className={s.editor}
      noValidate={linked}
      onSubmit={submit}
      aria-label={row ? "Edit closing row" : "Add a closing row"}
    >
      <h2>{row ? `Edit ${row.propertyAddress}` : "Add a closing row"}</h2>
      <div className={s.fields}>
        <label>
          Agent
          <select
            value={agent}
            onChange={(event) => setAgent(event.target.value)}
          >
            <option value="">Unassigned</option>
            {agents
              .filter(({ id, active }) => active || id === row?.agentRosterId)
              .map(({ id, name }) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
          </select>
        </label>
        <label>
          Side
          <select
            value={side}
            onChange={(event) => setSide(event.target.value as HtoSide)}
          >
            <option value="buyer">Buyer</option>
            <option value="seller">Seller</option>
          </select>
        </label>
        {!linked && (
          <label>
            Status
            <select
              value={status}
              onChange={(event) => setStatus(event.target.value as HtoStatus)}
            >
              {Object.entries(statusLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        )}
        {!linked && (listing || listed) && (
          <label>
            Listed date
            <input
              type="date"
              value={listed}
              onChange={(event) => setListed(event.target.value)}
            />
          </label>
        )}
        {!linked && !listing && (
          <label>
            {status === "closed" ? "Actual close date" : "Expected close date"}
            <input
              type="date"
              value={closing}
              onChange={(event) => setClosing(event.target.value)}
            />
          </label>
        )}
        {!listing && (
          <label>
            {status === "closed" ? "Sale price (USD)" : "Contract price (USD)"}
            <input
              inputMode="decimal"
              value={price}
              onChange={(event) => setPrice(event.target.value)}
            />
          </label>
        )}
      </div>
      <fieldset className={s.fieldset}>
        <legend>Property</legend>
        {linked && !row?.address && (
          <p className={s.muted}>
            Saved address: {row?.propertyAddress}. Enter its components to
            include them in the CSV.
          </p>
        )}
        <div className={s.fields}>
          {(Object.keys(addressLabels) as (keyof HtoAddress)[]).map((field) => (
            <label key={field}>
              {addressLabels[field]}
              <input
                value={address[field]}
                onChange={(event) => {
                  setAddressEdited(true);
                  setAddress({ ...address, [field]: event.target.value });
                }}
              />
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset className={s.fieldset}>
        <legend>Clients</legend>
        {clients.map((client, index) => (
          <fieldset className={s.clientForm} key={client.key}>
            <legend>Client {index + 1}</legend>
            {client.name && !client.firstName && !client.lastName && (
              <p className={s.muted}>
                Saved name: {client.name}. Enter the name parts to include them
                in the CSV.
              </p>
            )}
            <div className={s.fields}>
              <label>
                First name
                <input
                  value={client.firstName}
                  onChange={(event) =>
                    editClient(client.key, "firstName", event.target.value)
                  }
                />
              </label>
              <label>
                Last name
                <input
                  value={client.lastName}
                  onChange={(event) =>
                    editClient(client.key, "lastName", event.target.value)
                  }
                />
              </label>
              <label>
                Email
                <input
                  type="email"
                  value={client.email}
                  onChange={(event) =>
                    editClient(client.key, "email", event.target.value)
                  }
                />
              </label>
              <label>
                Phone
                <input
                  type="tel"
                  value={client.phone}
                  onChange={(event) =>
                    editClient(client.key, "phone", event.target.value)
                  }
                />
              </label>
            </div>
            <button
              type="button"
              className={s.quiet}
              onClick={() => {
                setClientsEdited(true);
                setClients(clients.filter(({ key }) => key !== client.key));
              }}
            >
              Remove client {index + 1}
            </button>
          </fieldset>
        ))}
        <button
          type="button"
          className={s.quiet}
          onClick={() => {
            setClientsEdited(true);
            setClients([
              ...clients,
              { ...emptyClient, key: nextClientKey.current++ },
            ]);
          }}
        >
          + Add client
        </button>
      </fieldset>
      {error && (
        <p role="alert" className={s.error}>
          {error}
        </p>
      )}
      <div className={s.actions}>
        <button className={s.primary} disabled={busy}>
          {busy ? "Saving…" : "Save row"}
        </button>
        <button
          type="button"
          className={s.secondary}
          disabled={busy}
          onClick={cancel}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
