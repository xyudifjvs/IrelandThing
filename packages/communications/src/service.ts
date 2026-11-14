import {
  communicationsConfig,
  createGmailProvider,
  type CommunicationsConfig,
  type GmailProvider,
} from "./gateway";
import {
  connectionStatus,
  connect,
  callback,
  disconnect,
  requestGmail,
  queueSync,
} from "./gmail-connection";
import {
  listThreads,
  listMessages,
  associateThread,
  shareMessage,
} from "./mailbox-threads";
import {
  listDrafts,
  createDraft,
  updateDraft,
  deleteDraft,
  validateAttachments,
} from "./drafts";
import { queueSend, reconcileSend } from "./send-queue";
import {
  listTemplates,
  saveTemplate,
  availableMergeFields,
  renderInDb,
  renderTemplate,
  refreshTemplateDrafts,
  resetTemplate,
} from "./templates";
import { sendSystemEmail } from "./system-email";

export interface CommunicationsDependencies {
  config?: CommunicationsConfig;
  provider?: GmailProvider;
  fetch?: typeof fetch;
}

export class CommunicationsService {
  readonly config: CommunicationsConfig;
  readonly provider: GmailProvider;
  readonly fetch: typeof fetch;

  constructor(deps: CommunicationsDependencies = {}) {
    this.config = deps.config || communicationsConfig();
    this.provider = deps.provider || createGmailProvider(this.config);
    this.fetch = deps.fetch || fetch;
  }

  connectionStatus = connectionStatus.bind(this);
  connect = connect.bind(this);
  callback = callback.bind(this);
  disconnect = disconnect.bind(this);
  queueSync = queueSync.bind(this);
  listThreads = listThreads;
  listMessages = listMessages;
  associateThread = associateThread;
  shareMessage = shareMessage;
  listDrafts = listDrafts;
  createDraft = createDraft.bind(this);
  updateDraft = updateDraft.bind(this);
  deleteDraft = deleteDraft;
  validateAttachments = validateAttachments;
  queueSend = queueSend.bind(this);
  reconcileSend = reconcileSend.bind(this);
  listTemplates = listTemplates;
  saveTemplate = saveTemplate;
  availableMergeFields = availableMergeFields;
  renderInDb = renderInDb;
  renderTemplate = renderTemplate.bind(this);
  refreshTemplateDrafts = refreshTemplateDrafts.bind(this);
  resetTemplate = resetTemplate.bind(this);
  sendSystemEmail = sendSystemEmail.bind(this);

  request<T>(
    ownerId: string,
    endpoint: string,
    method: "GET" | "POST" = "GET",
    body?: unknown,
  ) {
    return requestGmail<T>(this, ownerId, endpoint, method, body);
  }
}

export const createCommunicationsService = (
  deps: CommunicationsDependencies = {},
) => new CommunicationsService(deps);
