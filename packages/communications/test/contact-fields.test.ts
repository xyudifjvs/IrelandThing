import { describe, it, expect } from "vitest";
import { contactMergeFields } from "../src/contact-fields";
import { validateMerge } from "../src/policy";
const field = (details: unknown, key: string) =>
  contactMergeFields(details, "matter-synthetic").find((f) => f.key === key)!;
describe("frozen transaction contact merge fields", () => {
  it("uses intake company/representative fields without an external directory lookup", () => {
    const details = {
      referenceIntake: {
        fields: {
          t_co: "Synthetic Title",
          t_contact: "First Rep",
          t_email: "rep@example.test",
          t_phone: "555-0100",
        },
      },
      title: {
        name: "Synthetic Title · First Rep",
        email: "rep@example.test",
        phone: "555-0100",
      },
    };
    expect(field(details, "titleName")).toMatchObject({
      value: "First Rep",
      status: "confirmed",
    });
    expect(field(details, "title_company").value).toBe("Synthetic Title");
    expect(() =>
      validateMerge(
        "{{titleEmail}} {{title_company}} {{client_name}} {{purchasePrice}}",
      ),
    ).not.toThrow();
  });
  it("leaves conflicting and same-company representative values ambiguous", () => {
    const details = {
      referenceIntake: {
        fields: { l_officer: "First Rep", l_email: "first@example.test" },
      },
      contacts: [
        {
          id: "second",
          role: "loan_officer",
          name: "Second Rep",
          company: "Same Company",
          email: "second@example.test",
        },
      ],
    };
    expect(field(details, "lenderName")).toMatchObject({
      value: null,
      status: "ambiguous",
    });
    expect(field(details, "lenderEmail").status).toBe("ambiguous");
  });
  it("uses the explicit reviewed correction while retaining original source evidence", () => {
    const details = {
      referenceIntake: {
        fields: { co_name: "Earlier", co_email: "earlier@example.test" },
      },
      contacts: [
        {
          id: "corrected",
          role: "co_op_agent",
          name: "Correct Rep",
          company: "Howard Hanna",
          email: "correct@example.test",
          reviewedSourceConflict: true,
          sourceConflictReason:
            "Confirmed current representative against source.",
          priorSourceSnapshot: [
            {
              source: "Saved intake",
              role: "co_op_agent",
              name: "Earlier",
              company: "",
              email: "earlier@example.test",
              phone: "",
            },
          ],
        },
      ],
    };
    expect(field(details, "coOpAgentEmail")).toMatchObject({
      value: "correct@example.test",
      status: "confirmed",
      sourceIds: ["matter-synthetic", "corrected"],
    });
    expect(details.referenceIntake.fields.co_name).toBe("Earlier");
    const two = {
      ...details,
      contacts: [
        ...details.contacts,
        {
          id: "third",
          role: "co_op_agent",
          name: "Another Rep",
          email: "third@example.test",
        },
      ],
    };
    expect(field(two, "coOpAgentEmail").status).toBe("ambiguous");
  });
  it("requires fresh review when confirmed evidence changes after a contact conflict was acknowledged", () => {
    const original = {
      source: "Saved intake",
      role: "loan_officer",
      name: "Intake Officer",
      company: "Synthetic Lender",
      email: "intake@example.test",
      phone: "555-0100",
    };
    const details = {
      referenceIntake: {
        fields: {
          l_officer: original.name,
          l_co: original.company,
          l_email: original.email,
          l_phone: original.phone,
        },
      },
      contacts: [
        {
          id: "previously-reviewed",
          role: "loan_officer",
          name: "Reviewed Officer",
          company: "Synthetic Lender",
          email: "reviewed@example.test",
          phone: "555-0200",
          reviewedSourceConflict: true,
          priorSourceSnapshot: [original],
          sourceConflictReason:
            "Reviewed the original intake evidence before selecting this contact.",
        },
      ],
      confirmedFacts: {
        loan_officer_name: "New Confirmed Officer",
        lender_company: "Synthetic Lender",
        lender_email: "new-confirmed@example.test",
        lender_phone: "555-0300",
      },
    };
    const before = JSON.stringify(details);
    expect(field(details, "lenderEmail")).toMatchObject({
      value: null,
      status: "ambiguous",
    });
    expect(field(details, "lenderName")).toMatchObject({
      value: null,
      status: "ambiguous",
    });
    expect(JSON.stringify(details)).toBe(before);
  });
});
