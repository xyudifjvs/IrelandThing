import { OAuth2Client, type Credentials } from "google-auth-library";
import { HttpError } from "@weatherly/platform";
export const GMAIL_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
];
export interface GmailProvider {
  authorizationUrl(state: string, challenge: string): string;
  exchange(code: string, verifier: string): Promise<Credentials>;
  request<T>(
    tokens: Credentials,
    path: string,
    method?: "GET" | "POST",
    body?: unknown,
  ): Promise<{ data: T; tokens: Credentials }>;
  revoke(tokens: Credentials): Promise<void>;
}
export interface CommunicationsConfig {
  mailbox?: string;
  clientId?: string;
  clientSecret?: string;
  redirectUri?: string;
  enabled: boolean;
  outboundEnabled: boolean;
  pubsubTopic?: string;
  resendApiKey?: string;
  systemFrom?: string;
}
export function communicationsConfig(): CommunicationsConfig {
  return {
    mailbox: process.env.GMAIL_MAILBOX,
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    redirectUri: process.env.GMAIL_REDIRECT_URI,
    enabled: process.env.GMAIL_ENABLED === "true",
    outboundEnabled: process.env.OUTBOUND_EMAIL_ENABLED === "true",
    pubsubTopic: process.env.GMAIL_PUBSUB_TOPIC,
    resendApiKey: process.env.RESEND_API_KEY,
    systemFrom: process.env.SYSTEM_EMAIL_FROM,
  };
}
export function assertConfigured(config: CommunicationsConfig, send = false) {
  if (
    !config.enabled ||
    !config.mailbox ||
    config.mailbox.toLowerCase() === "ireland@ireland.com" ||
    !config.clientId ||
    !config.clientSecret ||
    !config.redirectUri
  )
    throw new HttpError(
      503,
      "GMAIL_NOT_CONFIGURED",
      "Connect an approved real Gmail mailbox; the preview address cannot connect or send",
    );
  if (send && !config.outboundEnabled)
    throw new HttpError(
      503,
      "OUTBOUND_DISABLED",
      "Outbound email is disabled until explicitly configured",
    );
}
export function createGmailProvider(
  config = communicationsConfig(),
): GmailProvider {
  const client = () =>
    new OAuth2Client({
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      redirectUri: config.redirectUri,
    });
  return {
    authorizationUrl(state, challenge) {
      assertConfigured(config);
      return client().generateAuthUrl({
        access_type: "offline",
        prompt: "consent",
        include_granted_scopes: true,
        scope: GMAIL_SCOPES,
        state,
        code_challenge: challenge,
        code_challenge_method: "S256" as never,
        login_hint: config.mailbox,
      });
    },
    async exchange(code, verifier) {
      assertConfigured(config);
      try {
        const { tokens } = await client().getToken({
          code,
          codeVerifier: verifier,
        });
        return tokens;
      } catch {
        throw new HttpError(
          400,
          "OAUTH_EXCHANGE_FAILED",
          "Google authorization failed; start a new connection",
        );
      }
    },
    async request<T>(
      tokens: Credentials,
      endpoint: string,
      method: "GET" | "POST" = "GET",
      body?: unknown,
    ) {
      assertConfigured(config, endpoint === "/messages/send");
      if (!endpoint.startsWith("/") || endpoint.includes("://"))
        throw new Error("Invalid Gmail resource path");
      const auth = client();
      auth.setCredentials(tokens);
      try {
        const response = await auth.request<T>({
          url: `https://gmail.googleapis.com/gmail/v1/users/me${endpoint}`,
          method,
          data: body,
          timeout: 30000,
          retry: false,
        });
        return {
          data: response.data,
          tokens: { ...tokens, ...auth.credentials },
        };
      } catch (error) {
        const e = error as { response?: { status?: number }; status?: number };
        const status = e.response?.status || e.status;
        if (status === 401 || status === 403)
          throw new HttpError(
            status,
            "GMAIL_AUTHORIZATION",
            "Gmail permission expired or was revoked; reconnect",
          );
        if (status === 404)
          throw new HttpError(
            404,
            "GMAIL_NOT_FOUND",
            "Gmail resource or history cursor no longer exists",
          );
        if (status === 429)
          throw new HttpError(
            429,
            "GMAIL_RATE_LIMIT",
            "Google rate limit reached; retry later",
          );
        throw new HttpError(
          502,
          "GMAIL_UNAVAILABLE",
          "Gmail request failed; retry safely",
        );
      }
    },
    async revoke(tokens) {
      const c = client();
      c.setCredentials(tokens);
      await c.revokeCredentials();
    },
  };
}
