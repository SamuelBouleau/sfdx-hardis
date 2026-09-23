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

/** Turns an HTTP failure into the named error of the contract; anything else stays unnamed, with the server reason */
export function toTicketError(error: any, context: TicketErrorContext): Error {
  if (isNamedTicketError(error)) {
    return error;
  }
  const status = httpStatusOf(error);
  const message = serverMessageOf(error);
  const cause = error instanceof Error ? error : undefined;
  if (status === 429) {
    return new SfError(t("ticketRateLimited", { provider: context.providerLabel }), TICKET_ERROR.rateLimited, undefined, cause);
  }
  if (status === 401) {
    return new SfError(
      t("ticketProviderCredentialsRefused", { provider: context.providerLabel, message }),
      TICKET_ERROR.providerNotConfigured,
      undefined,
      cause
    );
  }
  if (status === 413) {
    return new SfError(
      t("ticketAttachmentTooLarge", { file: context.filename || "", provider: context.providerLabel }),
      TICKET_ERROR.attachmentTooLarge,
      undefined,
      cause
    );
  }
  if (status === 400 && context.operation === "list") {
    return new SfError(t("ticketQueryInvalid", { message }), TICKET_ERROR.queryInvalid, undefined, cause);
  }
  // A 403 is a missing permission on a ticket that exists: it stays an ordinary error
  if (status === 404 && context.ticketId) {
    return new SfError(t("ticketNotFound", { ticketId: context.ticketId }), TICKET_ERROR.notFound, undefined, cause);
  }
  if (!cause) {
    return new Error(message);
  }
  // Unnamed on purpose, but with the server reason rather than "Request failed with status code 403"
  return message !== cause.message ? new SfError(message, undefined, undefined, cause) : cause;
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
 * Checked before any write: JIRA refuses a label containing whitespace, and the label is written after the
 * attachment or the comment. Returns null when no label is asked for; the error is unnamed on purpose (P11).
 */
export function validateTicketLabel(label: string | null | undefined): string | null {
  if (label === undefined || label === null || label === "") {
    return null;
  }
  const trimmed = label.trim();
  if (!trimmed || /\s/.test(trimmed)) {
    throw new SfError(t("ticketLabelInvalid", { label }));
  }
  return trimmed;
}

/** Unnamed on purpose (P11), with the read failure kept as the cause */
function fileNotReadable(file: string, error?: unknown): SfError {
  return new SfError(t("ticketFileNotReadable", { file }), undefined, undefined, error instanceof Error ? error : undefined);
}

/**
 * Reads every file before the first upload, so that a wrong path never leaves a ticket half attached.
 */
export async function readUploadFiles(filePaths: string[]): Promise<TicketUploadFile[]> {
  const files: TicketUploadFile[] = [];
  for (const filePath of filePaths) {
    const isFile = await fs.stat(filePath).then(
      (stats) => stats.isFile(),
      (error) => {
        throw fileNotReadable(filePath, error);
      }
    );
    if (!isFile) {
      throw fileNotReadable(filePath);
    }
    let content: Buffer;
    try {
      content = await fs.readFile(filePath);
    } catch (error) {
      throw fileNotReadable(filePath, error);
    }
    files.push({ filename: path.basename(filePath), content, size: content.length });
  }
  return files;
}

export async function readCommentBody(body: string | undefined, bodyFile: string | undefined): Promise<string> {
  let text = body ?? "";
  if (bodyFile) {
    try {
      text = await fs.readFile(bodyFile, "utf8");
    } catch (error) {
      throw fileNotReadable(bodyFile, error);
    }
  }
  if (!text.trim()) {
    throw new SfError(t("ticketCommentBodyEmpty"));
  }
  return text;
}
