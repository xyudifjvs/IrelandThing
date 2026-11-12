"use client";

import { Fragment } from "react";
import Link from "next/link";
import { formatDate } from "@weatherly/ui";
import {
  clientName,
  formatCents,
  statusLabels,
  type HtoClosingRow,
} from "./model";
import s from "./hto.module.css";

type Candidate = NonNullable<HtoClosingRow["match"]>["candidates"][number];

export function ClosingTable({
  rows,
  selected,
  toggleRow,
  toggleAll,
  edit,
  editDate,
  resolveMatch,
  matching,
}: {
  rows: HtoClosingRow[];
  selected: ReadonlySet<string>;
  toggleRow: (id: string) => void;
  toggleAll: () => void;
  edit: (row: HtoClosingRow) => void;
  editDate: (row: HtoClosingRow) => void;
  resolveMatch: (row: HtoClosingRow, candidate?: Candidate) => void;
  matching: boolean;
}) {
  return (
    <div
      className={s.tableScroll}
      tabIndex={0}
      role="region"
      aria-label="Closing rows"
    >
      <table className={s.table}>
        <thead>
          <tr>
            <th scope="col">
              <input
                type="checkbox"
                aria-label="Select all displayed closing rows"
                checked={
                  rows.length > 0 && rows.every(({ id }) => selected.has(id))
                }
                onChange={toggleAll}
              />
            </th>
            <th scope="col">Agent</th>
            <th scope="col">Clients</th>
            <th scope="col">Property</th>
            <th scope="col">Side</th>
            <th scope="col">Close date</th>
            <th scope="col">Price</th>
            <th scope="col">Status</th>
            <th scope="col" aria-label="Actions" />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <Fragment key={row.id}>
              <tr>
                <td>
                  <input
                    type="checkbox"
                    aria-label={`Select ${row.propertyAddress}`}
                    checked={selected.has(row.id)}
                    onChange={() => toggleRow(row.id)}
                  />
                </td>
                <td>{row.agentName || "—"}</td>
                <td>
                  {row.clients.length ? (
                    <ul className={s.clients}>
                      {row.clients.map((client, index) => (
                        <li key={client.id ?? index}>
                          <strong>{clientName(client)}</strong>
                          {client.email && <span>{client.email}</span>}
                          {client.phone && <span>{client.phone}</span>}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    "—"
                  )}
                </td>
                <td>
                  {row.matterId ? (
                    <Link
                      className={s.propertyLink}
                      href={`/workspace/transactions/${encodeURIComponent(row.matterId)}`}
                    >
                      {row.propertyAddress}
                    </Link>
                  ) : (
                    row.propertyAddress
                  )}
                </td>
                <td>{row.side === "buyer" ? "Buyer" : "Seller"}</td>
                <td>
                  {row.closeDate ? formatDate(row.closeDate) : "—"}
                  {row.actualCloseDate && (
                    <>
                      <span className={s.detail}>Actual</span>
                      <span className={s.detail}>
                        Checklist · {formatDate(row.checklistCloseDate)}
                      </span>
                    </>
                  )}
                </td>
                <td className={s.money}>
                  {row.purchasePriceCents == null
                    ? "—"
                    : formatCents(row.purchasePriceCents)}
                  {row.previousPriceCents != null && (
                    <span className={s.detail}>
                      was {formatCents(row.previousPriceCents)}
                    </span>
                  )}
                </td>
                <td>
                  <span className={`${s.status} ${s[row.status]}`}>
                    {statusLabels[row.status]}
                  </span>
                  {row.listedDate && row.status === "active_listing" && (
                    <span className={s.detail}>
                      Listed {formatDate(row.listedDate)}
                    </span>
                  )}
                  {row.matterId && (
                    <span className={s.detail}>From your transaction file</span>
                  )}
                </td>
                <td>
                  <button
                    className={s.quiet}
                    onClick={() => edit(row)}
                    aria-label={`Edit ${row.propertyAddress}`}
                  >
                    Edit
                  </button>
                  {row.canonicalDateEditable && (
                    <button
                      className={s.quiet}
                      onClick={() => editDate(row)}
                      aria-label={`Edit close date for ${row.propertyAddress}`}
                    >
                      Close date
                    </button>
                  )}
                </td>
              </tr>
              {row.match && (
                <tr className={s.match}>
                  <td colSpan={9}>
                    <p>
                      {row.match.candidates.length === 1
                        ? `Is this the same as ${row.match.candidates[0].propertyAddress}?`
                        : "Does this file match one of these manual rows?"}
                    </p>
                    <div className={s.actions}>
                      {row.match.candidates.map((candidate) => (
                        <button
                          key={candidate.id}
                          className={s.secondary}
                          disabled={matching}
                          onClick={() => resolveMatch(row, candidate)}
                        >
                          Link {candidate.propertyAddress}
                          {row.match!.candidates.length > 1 &&
                            (candidate.agentName ||
                              candidate.clientNames.length > 0) && (
                              <span className={s.detail}>
                                {[candidate.agentName, ...candidate.clientNames]
                                  .filter(Boolean)
                                  .join(" · ")}
                              </span>
                            )}
                        </button>
                      ))}
                      <button
                        className={s.quiet}
                        disabled={matching}
                        onClick={() => resolveMatch(row)}
                      >
                        Keep separate
                      </button>
                    </div>
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}
