import { beforeEach, describe, it, expect, vi } from "vitest";
import type { Principal } from "@weatherly/platform";
import type { generateStructured } from "@weatherly/ai";
import type { RetrievalReaders } from "../src/retrieval";
const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
  create: vi.fn(),
  updateMany: vi.fn(),
  findUniqueOrThrow: vi.fn(),
  audit: vi.fn(),
  transaction: vi.fn(),
}));
vi.mock("@weatherly/db", () => ({
  prisma: {
    assistantConversation: {
      findFirst: mocks.findFirst,
      create: mocks.create,
      updateMany: mocks.updateMany,
      findUniqueOrThrow: mocks.findUniqueOrThrow,
    },
    $transaction: mocks.transaction,
  },
}));
vi.mock("@weatherly/matters", () => ({
  listMatters: vi.fn(),
  getMatter: vi.fn(),
  requireMatter: vi.fn(),
  audit: mocks.audit,
}));
vi.mock("@weatherly/documents", () => ({
  listDocuments: vi.fn(),
  getDocument: vi.fn(),
}));
vi.mock("@weatherly/billing", () => ({
  listPayments: vi.fn(),
  listGifts: vi.fn(),
}));
vi.mock("@weatherly/ai", () => ({
  aiConfigured: () => true,
  generateStructured: vi.fn(),
}));
import { askAssistant } from "../src/service";
const actor = {
  id: "owner-a",
  role: "coordinator",
  name: "Synthetic",
  email: "synthetic@example.invalid",
} as Principal;
const readers: RetrievalReaders = {
  matter: async () => ({
    id: "matter-a",
    propertyAddress: "Synthetic Magnolia",
    stage: "under_contract",
  }),
  matters: async () => [],
  documents: async () => [],
  document: async () => ({ versions: [] }),
  records: async () => ({ items: [], nextCursor: null, hasMore: false }),
};
const calls: Parameters<typeof generateStructured>[0][] = [];
const generate: typeof generateStructured = async <T>(
  input: Parameters<typeof generateStructured<T>>[0],
) => {
  calls.push(input);
  const data =
    "priorConversation" in (input.data as object)
      ? {
          claims: [
            {
              text: "The stage is under_contract.",
              citations: [
                {
                  sourceId: "matter:matter-a:0",
                  quote: '"stage":"under_contract"',
                },
              ],
            },
          ],
          uncertainties: [],
        }
      : {
          claims: [{ index: 0, supported: true, contradicted: false }],
          answerable: true,
        };
  return {
    data: input.schema.parse(data) as T,
    model: "synthetic/model",
    provider: "synthetic",
    usage: { promptTokens: 10, completionTokens: 10, costUsd: null },
  };
};
beforeEach(() => {
  vi.clearAllMocks();
  calls.length = 0;
  mocks.findFirst.mockResolvedValue({
    id: "conv",
    userId: actor.id,
    matterId: "matter-a",
    updatedAt: new Date(),
    messages: [
      { role: "user", content: "Tell me about Magnolia's closing extension" },
      { role: "assistant", content: "A prior unverified answer" },
    ],
  });
  mocks.updateMany.mockResolvedValue({ count: 1 });
  mocks.findUniqueOrThrow.mockResolvedValue({ id: "conv" });
  mocks.create.mockResolvedValue({ id: "new-conv" });
  mocks.transaction.mockImplementation(async (fn) =>
    fn({
      assistantConversation: {
        updateMany: mocks.updateMany,
        findUniqueOrThrow: mocks.findUniqueOrThrow,
      },
    }),
  );
});
describe("saved conversation context and isolation", () => {
  it("passes actual bounded prior conversation, reports coverage, saves it and uses at most two inference calls", async () => {
    const result = await askAssistant(
      actor,
      {
        question: "What is its stage?",
        matterId: "matter-a",
        conversationId: "conv",
      },
      { readers, generate },
    );
    expect(mocks.findFirst).toHaveBeenCalledWith({
      where: { id: "conv", userId: "owner-a" },
    });
    expect(
      (calls[0].data as { priorConversation: { content: string }[] })
        .priorConversation[0].content,
    ).toContain("Magnolia");
    expect(result.coverage.historyMessagesIncluded).toBe(2);
    expect(result.answer).toBe("The stage is under_contract.");
    expect(calls.length).toBe(2);
    expect(
      mocks.updateMany.mock.calls[0][0].data.messages.at(-1).coverage,
    ).toEqual(result.coverage);
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.anything(),
      actor,
      "assistant.question_answered",
      "AssistantConversation",
      "conv",
      "matter-a",
      expect.objectContaining({ coverage: result.coverage, supported: true }),
    );
  });
  it("rejects another user's conversation and changed matter scopes before inference", async () => {
    mocks.findFirst.mockResolvedValueOnce(null);
    await expect(
      askAssistant(
        actor,
        { question: "What now?", conversationId: "private" },
        { readers, generate },
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      askAssistant(
        actor,
        {
          question: "What now?",
          conversationId: "conv",
          matterId: "other-matter",
        },
        { readers, generate },
      ),
    ).rejects.toMatchObject({ code: "CONVERSATION_SCOPE" });
    expect(calls).toHaveLength(0);
  });
  it.each(["agent", "client"])(
    "rejects %s access before reading a conversation",
    async (role) => {
      await expect(
        askAssistant(
          { ...actor, role } as Principal,
          { question: "Show records" },
          { readers, generate },
        ),
      ).rejects.toMatchObject({ status: 403 });
      expect(mocks.findFirst).not.toHaveBeenCalled();
      expect(calls).toHaveLength(0);
    },
  );
  it("rejects a lost concurrent conversation update", async () => {
    mocks.updateMany.mockResolvedValue({ count: 0 });
    await expect(
      askAssistant(
        actor,
        {
          question: "What is its stage?",
          matterId: "matter-a",
          conversationId: "conv",
        },
        { readers, generate },
      ),
    ).rejects.toMatchObject({ code: "CONVERSATION_CHANGED" });
  });
});
