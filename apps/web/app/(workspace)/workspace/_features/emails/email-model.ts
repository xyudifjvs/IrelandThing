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
  workItemId?: string | null;
  details?: {
    templateId?: string;
    templateRevision?: number;
    templateValues?: Record<string, string>;
    reviewNeeded?: boolean;
    mergeError?: string | null;
  };
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
};
