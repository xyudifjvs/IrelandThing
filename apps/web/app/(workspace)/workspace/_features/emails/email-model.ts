export type Template = {
  id: string;
  name: string;
  side: string;
  phase: string;
  serviceGroup?: string | null;
  subject: string;
  body: string;
  revision: number;
  linkedStepKey?: string | null;
  recipientGroup?: string | null;
  recipientRoles?: string[];
  hideNotNeededLines?: boolean | null;
  position?: number | null;
  isPlaceholder?: boolean | null;
};

export type Draft = {
  id: string;
  matterId: string;
  to: string[];
  cc: string[];
  subject: string;
  body: string;
  attachmentIds: string[];
  status: string;
  revision: number;
  sentAt?: string | null;
  providerMessageId?: string | null;
  workItemId?: string | null;
  details?: {
    templateId?: string;
    templateRevision?: number;
    templatePreviewFingerprint?: string;
    templateValues?: Record<string, string>;
    reviewNeeded?: boolean;
    mergeError?: string | null;
    templateNeedsRebind?: boolean;
    sendFailure?: string | null;
    authoredMerge?: {
      subjectSource: string;
      bodySource: string;
      fingerprint: string;
      values?: Record<string, string>;
    };
  };
};

export type FileEmailMessage = {
  id: string;
  providerMessageId: string;
  direction: string;
  fromEmail: string;
  to: string[];
  cc: string[];
  subject: string;
  text: string;
  sentAt: string;
  details?: {
    approvedDraftId?: string;
    internetMessageId?: string;
    inReplyTo?: string;
  };
};

export type FileEmailThread = {
  id: string;
  subject: string;
  messages: FileEmailMessage[];
};

export type EmailWork = {
  id: string;
  title: string;
  matterId: string;
  templateId: string | null;
  linkedStepKey: string | null;
  propertyAddress: string;
  remindOn: string | null;
  laterAt: string | null;
  sentAt: string | null;
  manualCompletedAt: string | null;
  revision: number;
  toSend: boolean;
  checked: boolean;
};
