import { prisma, type Prisma } from "@weatherly/db";
export const placeholderSubject = "[Replace with approved subject]";
export const placeholderBody = "[Replace with approved email wording]";

const placeholderRecipients = [
  {
    side: "buyer",
    key: "client",
    name: "Buyer update",
    recipientGroup: "To buyer",
    role: "client",
  },
  {
    side: "buyer",
    key: "coop",
    name: "Listing agent update",
    recipientGroup: "To listing agent",
    role: "co_op_agent",
  },
  {
    side: "buyer",
    key: "lender",
    name: "Lender update",
    recipientGroup: "To lender",
    role: "lender",
  },
  {
    side: "buyer",
    key: "title",
    name: "Title update",
    recipientGroup: "To title",
    role: "title_rep",
  },
  {
    side: "seller",
    key: "client",
    name: "Seller update",
    recipientGroup: "To seller",
    role: "client",
  },
  {
    side: "seller",
    key: "coop",
    name: "Buyer’s agent update",
    recipientGroup: "To buyer’s agent",
    role: "co_op_agent",
  },
  {
    side: "seller",
    key: "title",
    name: "Title update",
    recipientGroup: "To title",
    role: "title_rep",
  },
];

export function seedPlaceholderEmailTemplates(
  db: Prisma.TransactionClient = prisma,
) {
  return db.communicationTemplate.createMany({
    data: placeholderRecipients.map(
      ({ side, key, name, recipientGroup, role }) => ({
        id: `weatherly-email-placeholder-${side}-${key}`,
        name,
        side,
        phase: "general",
        recipientGroup,
        recipientRoles: [role],
        subject: placeholderSubject,
        body: placeholderBody,
        isPlaceholder: true,
        position: 0,
      }),
    ),
    skipDuplicates: true,
  });
}
