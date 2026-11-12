import "dotenv/config";
import { seedPlaceholderEmailTemplates } from "@weatherly/communications";
import { prisma } from "./index";

try {
  const { count } = await seedPlaceholderEmailTemplates();
  console.log(`Email template placeholders added: ${count}`);
} finally {
  await prisma.$disconnect();
}
