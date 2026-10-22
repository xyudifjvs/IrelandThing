import "dotenv/config";
import { prisma } from "./index";
import { hashPassword } from "better-auth/crypto";
if (process.env.APP_ENV !== "local" || process.env.NODE_ENV === "production")
  throw new Error(
    "Synthetic seed is allowed only in a local development environment.",
  );
const users = [
  {
    id: "owner-local",
    name: "Ireland",
    email: "ireland@example.test",
    role: "coordinator",
  },
  {
    id: "agent-local",
    name: "Alex Morgan",
    email: "alex.agent@example.test",
    role: "agent",
  },
  {
    id: "client-local",
    name: "Avery Harper",
    email: "avery.client@example.test",
    role: "client",
  },
];
const password = await hashPassword("Weatherly-Local-2026!");
for (const user of users) {
  await prisma.user.upsert({
    where: { id: user.id },
    create: { ...user, emailVerified: true },
    update: {},
  });
  await prisma.account.upsert({
    where: { id: user.id + "-credential" },
    create: {
      id: user.id + "-credential",
      userId: user.id,
      providerId: "credential",
      accountId: user.id,
      password,
    },
    update: {},
  });
}
for (const item of [
  {
    code: "essentials",
    name: "Essentials",
    priceCents: 37500,
    sellerOnly: false,
  },
  { code: "complete", name: "Complete", priceCents: 47500, sellerOnly: false },
  {
    code: "full_listing",
    name: "Full Listing",
    priceCents: 62500,
    sellerOnly: true,
  },
])
  await prisma.catalogItem.upsert({
    where: { code: item.code },
    create: { ...item, approved: true },
    update: { ...item, approved: true },
  });
const date = (offset: number) =>
  new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
const sample = [
  {
    id: "demo-oak",
    title: "Avery & Jordan Harper",
    propertyAddress: "148 Oak Meadow Lane, Columbus, OH",
    side: "buyer",
    packageCode: "complete",
    stage: "under_contract",
    details: {
      synthetic: true,
      purchaseType: "financed",
      directContact: true,
      closingDate: date(14),
      purchasePrice: 425000,
      clients: [
        {
          name: "Avery Harper",
          email: "avery.client@example.test",
          phone: "555-0100",
        },
      ],
    },
  },
  {
    id: "demo-river",
    title: "Morgan Ellis",
    propertyAddress: "62 Riverbend Court, Dublin, OH",
    side: "seller",
    packageCode: "full_listing",
    stage: "listing",
    details: {
      synthetic: true,
      purchaseType: "financed",
      directContact: false,
      clients: [{ name: "Morgan Ellis", email: "morgan@example.test" }],
    },
  },
  {
    id: "demo-maple",
    title: "Taylor Chen",
    propertyAddress: "910 Maple Street, Worthington, OH",
    side: "buyer",
    packageCode: "essentials",
    stage: "closing",
    details: {
      synthetic: true,
      purchaseType: "cash",
      directContact: true,
      closingDate: date(3),
      clients: [{ name: "Taylor Chen", email: "taylor@example.test" }],
    },
  },
];
for (const matter of sample) {
  await prisma.matter.upsert({
    where: { id: matter.id },
    create: { ...matter, agentId: "agent-local" },
    update: {},
  });
}
await prisma.matterParticipant.upsert({
  where: { matterId_userId: { matterId: "demo-oak", userId: "client-local" } },
  create: { matterId: "demo-oak", userId: "client-local", role: "client" },
  update: {},
});
for (const [index, title] of [
  "Confirm earnest money receipt",
  "Review inspection report",
  "Request title commitment",
  "Confirm closing appointment",
].entries())
  await prisma.task.upsert({
    where: { id: "demo-task-" + index },
    create: {
      id: "demo-task-" + index,
      matterId: "demo-oak",
      title,
      kind: "checklist",
      visibility: "agent",
      status: index === 0 ? "completed" : "pending",
      dueDate: date(index - 1),
      details: { synthetic: true },
    },
    update: {},
  });
await prisma.task.upsert({
  where: { id: "demo-private" },
  create: {
    id: "demo-private",
    matterId: "demo-oak",
    title: "Prepare this week’s agent update",
    visibility: "coordinator",
    kind: "todo",
    dueDate: date(1),
  },
  update: {},
});
await prisma.deadline.upsert({
  where: { id: "demo-closing" },
  create: {
    id: "demo-closing",
    matterId: "demo-oak",
    label: "Closing",
    date: date(14),
    status: "confirmed",
    details: { synthetic: true, source: "Local demo fixture" },
  },
  update: {},
});
await prisma.note.upsert({
  where: { id: "demo-note" },
  create: {
    id: "demo-note",
    matterId: "demo-oak",
    authorId: "owner-local",
    body: "Synthetic local preview record. Private coordinator notes stay separate from portal updates.",
    visibility: "coordinator",
  },
  update: {},
});
console.log(
  "Local synthetic accounts, approved catalog, and sample matters are ready.",
);
await prisma.$disconnect();
