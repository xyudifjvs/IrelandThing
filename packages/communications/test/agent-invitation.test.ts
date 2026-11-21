import { afterEach, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "@weatherly/db";
import { hashToken } from "@weatherly/platform";
import { createCommunicationsService } from "../src/service";
import {
  queueAgentInvitation,
  sendQueuedAgentInvitation,
} from "../src/agent-invitation-email";
import {
  invitationSignatureFallback,
  renderAgentInvitation,
} from "../src/agent-invitation-template";

afterEach(() => vi.unstubAllEnvs());
it("escapes saved names, signatures and links in HTML while preserving plain text and a nonempty fallback", () => {
  const message = renderAgentInvitation({
    url: "https://www.weatherlytc.com/invite?token=synthetic&test=1",
    name: "<Dana> Agent",
    signature: "Ireland & Team\n<script>unsafe</script>",
  });
  expect(message.html).toContain("Hi &lt;Dana&gt;,");
  expect(message.html).toContain(
    "<strong>Ireland &amp; Team</strong><br>&lt;script&gt;unsafe&lt;/script&gt;",
  );
  expect(message.html).not.toContain("<script>");
  expect(message.html).toContain("token=synthetic&amp;test=1");
  expect(message.text).toContain("Ireland & Team\n<script>unsafe</script>");
  for (const signature of [undefined, "", "  \n "]) {
    const fallback = renderAgentInvitation({
      url: "https://www.weatherlytc.com/invite?token=synthetic",
      signature,
    });
    expect(fallback.text).toContain(invitationSignatureFallback);
    expect(fallback.html).toContain(invitationSignatureFallback);
    expect(fallback.html).not.toContain("{{tc_signature}}");
  }
});

it("sends branded and plain-text invitations with the inviting coordinator's settings, and still withdraws expired jobs", async () => {
  vi.stubEnv(
    "CREDENTIAL_ENCRYPTION_KEY",
    Buffer.alloc(32, 11).toString("base64"),
  );
  vi.stubEnv("WEB_ORIGIN", "https://www.weatherlytc.com");
  const id = `invitation-design-${randomUUID()}`;
  const config = {
    enabled: false,
    outboundEnabled: true,
    resendApiKey: "synthetic-only-key",
    systemFrom: "Weatherly <ireland@weatherlytc.com>",
  };
  const captured: Array<Record<string, unknown>> = [];
  const service = createCommunicationsService({
    config,
    fetch: async (_url, init) => {
      captured.push(JSON.parse(String(init?.body)));
      expect(new Headers(init?.headers).get("Idempotency-Key")).toMatch(
        /^system-invitation:/,
      );
      return new Response(JSON.stringify({ id: "synthetic-provider-id" }), {
        status: 200,
      });
    },
  });
  await prisma.user.create({
    data: {
      id,
      name: "Synthetic Coordinator",
      email: `${id}@example.test`,
      role: "coordinator",
    },
  });
  const roster = await prisma.rosterAgent.create({
    data: {
      name: "Dana Synthetic",
      email: `${id}-recipient@example.test`,
      normalizedEmail: `${id}-recipient@example.test`,
      business: "weatherly",
    },
  });
  try {
    await prisma.mergeFieldSettings.create({
      data: {
        ownerId: id,
        signature:
          "Ireland Weatherly\nWeatherly Transaction Co. · weatherlytc.com",
      },
    });
    for (const [index, expired] of [false, false, true].entries()) {
      if (index === 1)
        await prisma.mergeFieldSettings.update({
          where: { ownerId: id },
          data: { signature: "  " },
        });
      const token = `synthetic-${randomUUID()}-${randomUUID()}`;
      const invite = await prisma.invitation.create({
        data: {
          email: roster.email!,
          role: "agent",
          rosterAgentId: roster.id,
          invitedById: id,
          tokenHash: hashToken(token),
          expiresAt: new Date(Date.now() + 60000),
        },
      });
      await prisma.$transaction((tx) =>
        queueAgentInvitation(tx, { ...invite, acceptanceToken: token }, config),
      );
      const job = await prisma.outboxJob.findUniqueOrThrow({
        where: { idempotencyKey: `system-invitation:${invite.id}` },
      });
      if (expired)
        await prisma.invitation.update({
          where: { id: invite.id },
          data: { expiresAt: new Date(Date.now() - 1000) },
        });
      const result = await sendQueuedAgentInvitation(service, job.payload);
      if (expired) expect(result).toEqual({ expired: true });
      else
        expect(result).toEqual({ providerMessageId: "synthetic-provider-id" });
      const updated = await prisma.outboxJob.findUniqueOrThrow({
        where: { id: job.id },
      });
      expect(updated.payload).not.toHaveProperty("encryptedToken");
      expect(await sendQueuedAgentInvitation(service, updated.payload)).toEqual(
        { alreadyHandled: true },
      );
    }
    expect(captured).toHaveLength(2);
    expect(captured[0]).toMatchObject({
      from: "Ireland at Weatherly <ireland@weatherlytc.com>",
      reply_to: "ireland@weatherlytc.com",
      subject: "You're invited to your Weatherly agent portal",
      to: [roster.email],
    });
    expect(captured[0].html).toContain("Your agent portal is ready.");
    expect(captured[0].html).toContain("Hi Dana,");
    expect(captured[0].html).toContain(
      "Ireland Weatherly</strong><br>Weatherly Transaction Co.",
    );
    expect(captured[0].text).toContain(
      "Ireland Weatherly\nWeatherly Transaction Co.",
    );
    expect(captured[1].text).toContain(invitationSignatureFallback);
    expect(captured[1].html).toContain(invitationSignatureFallback);
  } finally {
    const invites = await prisma.invitation.findMany({
      where: { invitedById: id },
      select: { id: true },
    });
    await prisma.outboxJob.deleteMany({
      where: {
        idempotencyKey: { in: invites.map((i) => `system-invitation:${i.id}`) },
      },
    });
    await prisma.invitation.deleteMany({ where: { invitedById: id } });
    await prisma.rosterAgent.delete({ where: { id: roster.id } });
    await prisma.mergeFieldSettings.deleteMany({ where: { ownerId: id } });
    await prisma.user.delete({ where: { id } });
  }
});
