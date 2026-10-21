import type { Response } from "express";
import { prisma } from "@weatherly/db";
import {
  newToken,
  hashToken,
  principal,
  assertCoordinator,
} from "@weatherly/platform";
import type {
  OAuthServerProvider,
  AuthorizationParams,
} from "@modelcontextprotocol/sdk/server/auth/provider.js";
import type {
  OAuthClientInformationFull,
  OAuthTokens,
  OAuthTokenRevocationRequest,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import {
  InvalidGrantError,
  InvalidTokenError,
  InvalidClientError,
  UnsupportedGrantTypeError,
} from "@modelcontextprotocol/sdk/server/auth/errors.js";
import { trustedClient, grantPrincipal } from "./access";
export function resourceUrl() {
  return new URL("/api/mcp", process.env.WEB_ORIGIN!);
}
export class WeatherlyOAuth implements OAuthServerProvider {
  clientsStore = {
    getClient: async (
      id: string,
    ): Promise<OAuthClientInformationFull | undefined> => {
      try {
        const c = await trustedClient(id);
        return {
          client_id: c.id,
          client_name: c.name,
          redirect_uris: c.redirectUris as string[],
          token_endpoint_auth_method: "none",
          grant_types: ["authorization_code"],
          response_types: ["code"],
          scope: "weatherly:read",
        };
      } catch {
        return undefined;
      }
    },
  };
  async authorize(
    client: OAuthClientInformationFull,
    params: AuthorizationParams,
    res: Response,
  ) {
    const actor = principal(res.req);
    assertCoordinator(actor);
    await trustedClient(client.client_id);
    if (
      params.scopes?.some((s) => s !== "weatherly:read") ||
      (params.resource &&
        params.resource.toString() !== resourceUrl().toString())
    )
      throw new InvalidGrantError("Invalid scope or resource");
    const request = await prisma.assistantAuthorization.create({
      data: {
        id: newToken(),
        clientId: client.client_id,
        userId: actor.id,
        redirectUri: params.redirectUri,
        codeChallenge: params.codeChallenge,
        state: params.state,
        resource: resourceUrl().toString(),
        expiresAt: new Date(Date.now() + 10 * 60000),
      },
    });
    res.redirect(
      `${process.env.WEB_ORIGIN}/authorize-assistant?request=${encodeURIComponent(request.id)}`,
    );
  }
  async challengeForAuthorizationCode(
    client: OAuthClientInformationFull,
    code: string,
  ) {
    const request = await prisma.assistantAuthorization.findUnique({
      where: { codeHash: hashToken(code) },
    });
    if (
      !request ||
      request.clientId !== client.client_id ||
      request.consumedAt ||
      request.expiresAt <= new Date()
    )
      throw new InvalidGrantError("Invalid or expired authorization code");
    return request.codeChallenge;
  }
  async exchangeAuthorizationCode(
    client: OAuthClientInformationFull,
    code: string,
    _verifier?: string,
    redirectUri?: string,
    resource?: URL,
  ): Promise<OAuthTokens> {
    await trustedClient(client.client_id);
    const token = newToken();
    await prisma.$transaction(async (tx) => {
      const request = await tx.assistantAuthorization.findUnique({
        where: { codeHash: hashToken(code) },
      });
      if (
        !request ||
        request.clientId !== client.client_id ||
        request.redirectUri !== redirectUri ||
        request.consumedAt ||
        !request.authorizedAt ||
        request.expiresAt <= new Date() ||
        (resource && resource.toString() !== request.resource)
      )
        throw new InvalidGrantError("Invalid authorization code binding");
      const used = await tx.assistantAuthorization.updateMany({
        where: { id: request.id, consumedAt: null },
        data: { consumedAt: new Date() },
      });
      if (!used.count)
        throw new InvalidGrantError("Authorization code already used");
      const approved = await trustedClient(client.client_id);
      await tx.assistantGrant.create({
        data: {
          userId: request.userId,
          clientId: client.client_id,
          name: approved.name,
          tokenHash: hashToken(token),
          scopes: ["weatherly:read"],
          approvedClient: true,
          complianceEvidence: approved.complianceEvidence,
          expiresAt: new Date(Date.now() + 3600000),
        },
      });
    });
    return {
      access_token: token,
      token_type: "Bearer",
      expires_in: 3600,
      scope: "weatherly:read",
    };
  }
  async exchangeRefreshToken(): Promise<OAuthTokens> {
    throw new UnsupportedGrantTypeError(
      "Refresh tokens are not issued; authorize again after expiry.",
    );
  }
  async verifyAccessToken(token: string) {
    try {
      const { grant } = await grantPrincipal(token);
      return {
        token,
        clientId: grant.clientId!,
        scopes: ["weatherly:read"],
        expiresAt: Math.floor(grant.expiresAt.valueOf() / 1000),
        resource: resourceUrl(),
      };
    } catch {
      throw new InvalidTokenError(
        "Expired, revoked, or unapproved assistant access",
      );
    }
  }
  async revokeToken(
    client: OAuthClientInformationFull,
    request: OAuthTokenRevocationRequest,
  ) {
    if (!client.client_id) throw new InvalidClientError("Client required");
    await prisma.assistantGrant.updateMany({
      where: {
        clientId: client.client_id,
        tokenHash: hashToken(request.token),
      },
      data: { revokedAt: new Date() },
    });
  }
}
