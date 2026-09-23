import { SfError } from "@salesforce/core";
import type { Version3Models } from "jira.js";
import * as path from "path";
import fs from "../utils/fsUtils.js";
import { t } from "../utils/i18n.js";

/**
 * Names carried by SfError.name for the ticket list / attach / comment commands.
 * Callers branch their recovery logic on these identifiers, never on the message text: the values
 * are part of the command contract and must not change.
 */
export const TICKET_ERROR = {
  providerNotConfigured: "TicketProviderNotConfigured",
  providerNotSupported: "TicketProviderNotSupported",
  queryInvalid: "TicketQueryInvalid",
  notFound: "TicketNotFound",
  attachmentTooLarge: "TicketAttachmentTooLarge",
  rateLimited: "TicketRateLimited",
} as const;

export type TicketOperation = "list" | "attach" | "comment" | "label";

/** One entry of `sf hardis ticket list` */
export interface TicketSummary {
  id: string;
  url: string;
  subject: string;
  type: string;
  status: string;
  priority: string;
  assignee: string | null;
  created: string;
  updated: string;
  labels: string[];
}

export interface TicketSearchOptions {
  maxResults: number;
  /** Opaque cursor returned by the previous page: relayed as is, never parsed */
  pageToken?: string | null;
}

export interface TicketSearchResult {
  tickets: TicketSummary[];
  nextPageToken: string | null;
  truncated: boolean;
}

export interface TicketUploadFile {
  filename: string;
  content: Buffer;
  size: number;
}

export interface TicketAttachmentResult {
  filename: string;
  id: string;
  url: string;
  size: number;
}

export interface TicketErrorContext {
  providerLabel: string;
  operation: TicketOperation;
  ticketId?: string;
  filename?: string;
}

const NOT_SUPPORTED_KEYS: Record<TicketOperation, string> = {
  list: "ticketListNotSupported",
  attach: "ticketAttachNotSupported",
  comment: "ticketCommentNotSupported",
  label: "ticketLabelNotSupported",
};

export function ticketProviderNotSupported(providerLabel: string, operation: TicketOperation): SfError {
  return new SfError(t(NOT_SUPPORTED_KEYS[operation], { provider: providerLabel }), TICKET_ERROR.providerNotSupported);
}

export function httpStatusOf(error: any): number | undefined {
  const status = error?.status ?? error?.response?.status;
  return typeof status === "number" ? status : undefined;
}

/** What the server said, rather than the generic "Request failed with status code 400" */
export function serverMessageOf(error: any): string {
  const data = error?.response?.data;
  const messages: string[] = [];
  if (Array.isArray(data?.errorMessages)) {
    messages.push(...data.errorMessages.map(String));
  }
  if (data?.errors && typeof data.errors === "object") {
    messages.push(...Object.values(data.errors).map(String));
  }
  return messages.filter(Boolean).join(" | ") || error?.message || String(error);
}

function isNamedTicketError(error: any): boolean {
  return (Object.values(TICKET_ERROR) as string[]).includes(error?.name);
}

/** Turns an HTTP failure into the named error of the contract; anything else is returned untouched */
export function toTicketError(error: any, context: TicketErrorContext): Error {
  if (isNamedTicketError(error)) {
    return error;
  }
  const status = httpStatusOf(error);
  const message = serverMessageOf(error);
  if (status === 429) {
    return new SfError(t("ticketRateLimited", { provider: context.providerLabel }), TICKET_ERROR.rateLimited);
  }
  if (status === 401) {
    return new SfError(t("ticketProviderCredentialsRefused", { provider: context.providerLabel, message }), TICKET_ERROR.providerNotConfigured);
  }
  if (status === 413) {
    return new SfError(t("ticketAttachmentTooLarge", { file: context.filename || "", provider: context.providerLabel }), TICKET_ERROR.attachmentTooLarge);
  }
  if (status === 400 && context.operation === "list") {
    return new SfError(t("ticketQueryInvalid", { message }), TICKET_ERROR.queryInvalid);
  }
  // A 403 is a missing permission on a ticket that exists: it stays an ordinary error
  if (status === 404 && context.ticketId) {
    return new SfError(t("ticketNotFound", { ticketId: context.ticketId }), TICKET_ERROR.notFound);
  }
  return error instanceof Error ? error : new Error(message);
}

/**
 * Plain text to Atlassian Document Format: one paragraph per block separated by a blank line, and a
 * hard break per line inside a block. Empty text nodes are never emitted: the ADF schema rejects them.
 */
export function buildJiraCommentAdf(text: string): Version3Models.Document {
  const blocks = text.replace(/\r\n/g, "\n").trim().split(/\n{2,}/);
  const paragraphs = blocks.map((block) => {
    const lines = block.split("\n").filter((line) => line.length > 0);
    const content = lines.flatMap((line, index) =>
      index === 0 ? [{ type: "text", text: line }] : [{ type: "hardBreak" }, { type: "text", text: line }]
    );
    return { type: "paragraph", content };
  });
  return { version: 1, type: "doc", content: paragraphs } as Version3Models.Document;
}

/** JIRA writes offsets without a colon (+0200), which Date does not read everywhere */
export function toIsoDateTime(value: string): string {
  if (!value) {
    return "";
  }
  const date = new Date(value.replace(/([+-]\d{2})(\d{2})$/, "$1:$2"));
  return isNaN(date.getTime()) ? value : date.toISOString();
}

/**
 * Reads every file before the first upload, so that a wrong path never leaves a ticket half attached.
 */
export async function readUploadFiles(filePaths: string[]): Promise<TicketUploadFile[]> {
  const files: TicketUploadFile[] = [];
  for (const filePath of filePaths) {
    try {
      const stats = await fs.stat(filePath);
      if (!stats.isFile()) {
        throw new Error("not a file");
      }
      const content = await fs.readFile(filePath);
      files.push({ filename: path.basename(filePath), content, size: stats.size });
    } catch {
      throw new SfError(t("ticketFileNotReadable", { file: filePath }));
    }
  }
  return files;
}

export async function readCommentBody(body: string | undefined, bodyFile: string | undefined): Promise<string> {
  let text = body ?? "";
  if (bodyFile) {
    try {
      text = await fs.readFile(bodyFile, "utf8");
    } catch {
      throw new SfError(t("ticketFileNotReadable", { file: bodyFile }));
    }
  }
  if (!text.trim()) {
    throw new SfError(t("ticketCommentBodyEmpty"));
  }
  return text;
}
