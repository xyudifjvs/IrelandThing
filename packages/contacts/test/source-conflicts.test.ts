import { describe, expect, it } from "vitest";
import {
  contactValuesConflict,
  prefillPriorContact,
  transactionContactSources,
} from "../../../apps/web/app/(workspace)/workspace/_components/transaction-contact-sources";
const directory = {
  name: "New Representative",
  company: "Synthetic Title",
  email: "new@example.test",
  phone: "555-0202",
};
describe("directory suggestions preserve existing transaction contact evidence", () => {
  it("finds nonblank intake title values even when the new contact form is blank and preserves the original source", () => {
    const details = {
      referenceIntake: {
        fields: {
          t_co: "Synthetic Title",
          t_contact: "Intake Representative",
          t_email: "intake@example.test",
          t_phone: "555-0101",
        },
      },
    };
    const before = JSON.stringify(details),
      sources = transactionContactSources(details, "title_rep");
    expect(sources).toEqual([
      expect.objectContaining({
        source: "Saved intake",
        name: "Intake Representative",
        company: "Synthetic Title",
        email: "intake@example.test",
      }),
    ]);
    expect(
      sources.some((source) => contactValuesConflict(source, directory)),
    ).toBe(true);
    expect(
      prefillPriorContact(sources, {
        name: "",
        company: "",
        email: "",
        phone: "",
      }),
    ).toMatchObject({
      name: "Intake Representative",
      email: "intake@example.test",
    });
    expect(JSON.stringify(details)).toBe(before);
  });
  it("shows lender intake and confirmed/extracted facts separately and never picks a disputed representative", () => {
    const sources = transactionContactSources(
      {
        referenceIntake: {
          fields: {
            l_co: "Synthetic Lender",
            l_officer: "Intake Officer",
            l_email: "intake@example.test",
          },
        },
        confirmedFacts: {
          loan_officer_name: "Confirmed Officer",
          lender_company: "Synthetic Lender",
          lender_email: "confirmed@example.test",
        },
      },
      "loan_officer",
    );
    expect(sources.map((source) => source.source)).toEqual([
      "Saved intake",
      "Confirmed source facts",
    ]);
    expect(
      prefillPriorContact(sources, {
        name: "",
        company: "",
        email: "",
        phone: "",
      }),
    ).toMatchObject({ name: "", company: "Synthetic Lender", email: "" });
    expect(
      sources.every((source) => contactValuesConflict(source, directory)),
    ).toBe(true);
  });
  it("reviews co-op and previously saved transaction representatives without choosing or merging the company match", () => {
    const sources = transactionContactSources(
      {
        referenceIntake: {
          fields: {
            co_name: "Intake Co-op",
            co_brokerage: "Howard Hanna",
            co_email: "coop@example.test",
          },
        },
        contacts: [
          {
            id: "one",
            role: "co_op_agent",
            name: "First Co-op",
            company: "Howard Hanna",
            email: "first@example.test",
          },
          {
            id: "two",
            role: "co_op_agent",
            name: "Second Co-op",
            company: "Howard Hanna",
            email: "second@example.test",
          },
        ],
      },
      "co_op_agent",
    );
    expect(sources).toHaveLength(3);
    expect(sources.map((source) => source.name)).toEqual([
      "Intake Co-op",
      "First Co-op",
      "Second Co-op",
    ]);
    expect(
      prefillPriorContact(sources, {
        name: "",
        company: "",
        email: "",
        phone: "",
      }).name,
    ).toBe("");
    expect(
      transactionContactSources(
        {
          contacts: [
            { id: "one", role: "title_rep", name: "Original" },
            { id: "two", role: "title_company", name: "Other Representative" },
          ],
        },
        "title_rep",
        "one",
      ).map((source) => source.contactId),
    ).toEqual(["two"]);
  });
  it("recognizes the exact legacy normalized projection without creating a false second source; direct details still require conflict review", () => {
    const fields = {
      t_co: "Synthetic Title",
      t_contact: "Original Representative",
      t_email: "original@example.test",
      t_phone: "555-0101",
    };
    const details = {
      referenceIntake: { fields },
      title: {
        choice: "have",
        name: "Synthetic Title · Original Representative",
        email: "original@example.test",
        phone: "555-0101",
      },
    };
    const sources = transactionContactSources(details, "title_company");
    expect(sources).toHaveLength(1);
    expect(
      contactValuesConflict(sources[0], {
        name: fields.t_contact,
        company: fields.t_co,
        email: fields.t_email,
        phone: fields.t_phone,
      }),
    ).toBe(false);
    expect(
      transactionContactSources(
        { lender: { name: "Legacy Officer", email: "legacy@example.test" } },
        "lender",
      ),
    ).toEqual([
      expect.objectContaining({
        source: "Saved transaction details",
        name: "Legacy Officer",
      }),
    ]);
  });
  it("does not populate clients into business-source suggestions and does not overwrite entered values while prefilling", () => {
    const details = {
      clients: [{ name: "Private Client", email: "client@example.test" }],
    };
    expect(transactionContactSources(details, "client")).toEqual([]);
    expect(transactionContactSources(details, "other")).toEqual([]);
    const sources = transactionContactSources(
      { title: { name: "Saved title", email: "saved@example.test" } },
      "title_rep",
    );
    expect(
      prefillPriorContact(sources, {
        name: "Manually entered",
        company: "",
        email: "",
        phone: "",
      }),
    ).toMatchObject({ name: "Manually entered", email: "saved@example.test" });
  });
});
