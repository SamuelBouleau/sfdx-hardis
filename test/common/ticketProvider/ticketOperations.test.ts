import { expect } from 'chai';
import * as os from 'os';
import * as path from 'path';
import fs from '../../../src/common/utils/fsUtils.js';
// Load the barrel first, as ticketProviders.test.ts does, to resolve the pre-existing import cycle
import '../../../src/common/ticketProvider/index.js';
import {
  TICKET_ERROR,
  buildJiraCommentAdf,
  readCommentBody,
  readUploadFiles,
  serverMessageOf,
  toIsoDateTime,
  toTicketError,
} from '../../../src/common/ticketProvider/ticketOperations.js';

/** jira.js HttpException shape: status on the error, server payload under response.data */
function httpError(status: number, data: any = {}): any {
  const error: any = new Error(`Request failed with status code ${status}`);
  error.status = status;
  error.response = { status, data };
  return error;
}

describe('ticketOperations', () => {
  describe('toTicketError', () => {
    const context = { providerLabel: 'JIRA', operation: 'attach' as const, ticketId: 'ACME-1', filename: 'draft.md' };

    it('names a 429 TicketRateLimited', () => {
      expect(toTicketError(httpError(429), context).name).to.equal(TICKET_ERROR.rateLimited);
    });

    it('names a 401 TicketProviderNotConfigured', () => {
      expect(toTicketError(httpError(401), context).name).to.equal(TICKET_ERROR.providerNotConfigured);
    });

    it('names a 413 TicketAttachmentTooLarge, and names the file', () => {
      const error = toTicketError(httpError(413), context);
      expect(error.name).to.equal(TICKET_ERROR.attachmentTooLarge);
      expect(error.message).to.contain('draft.md');
    });

    it('names a 404 on a ticket TicketNotFound, and names the ticket', () => {
      const error = toTicketError(httpError(404), context);
      expect(error.name).to.equal(TICKET_ERROR.notFound);
      expect(error.message).to.contain('ACME-1');
    });

    it('names a 400 on a search TicketQueryInvalid, keeping the server message', () => {
      const error = toTicketError(httpError(400, { errorMessages: ["The value 'NOPE' does not exist for the field 'project'."] }), {
        providerLabel: 'JIRA',
        operation: 'list',
      });
      expect(error.name).to.equal(TICKET_ERROR.queryInvalid);
      expect(error.message).to.contain("The value 'NOPE' does not exist");
    });

    it('does not turn a 403 into TicketNotFound: a missing permission is not a missing ticket', () => {
      expect(toTicketError(httpError(403), context).name).to.not.equal(TICKET_ERROR.notFound);
    });

    it('keeps an error that is already named', () => {
      const named = toTicketError(httpError(404), context);
      expect(toTicketError(named, { providerLabel: 'JIRA', operation: 'label' })).to.equal(named);
    });
  });

  describe('serverMessageOf', () => {
    it('prefers the JIRA errorMessages and errors over the generic axios message', () => {
      const message = serverMessageOf(httpError(400, { errorMessages: ['first'], errors: { jql: 'second' } }));
      expect(message).to.equal('first | second');
    });

    it('falls back to the error message', () => {
      expect(serverMessageOf(new Error('socket hang up'))).to.equal('socket hang up');
    });
  });

  describe('buildJiraCommentAdf', () => {
    it('makes one paragraph per block, and a hard break per line', () => {
      const adf: any = buildJiraCommentAdf('Line 1\nLine 2\n\nSecond block\r\n');
      expect(adf.type).to.equal('doc');
      expect(adf.version).to.equal(1);
      expect(adf.content).to.have.length(2);
      expect(adf.content[0].content).to.deep.equal([
        { type: 'text', text: 'Line 1' },
        { type: 'hardBreak' },
        { type: 'text', text: 'Line 2' },
      ]);
      expect(adf.content[1].content).to.deep.equal([{ type: 'text', text: 'Second block' }]);
    });

    it('never emits an empty text node, which the ADF schema rejects', () => {
      const adf: any = buildJiraCommentAdf('A\n\n\n\nB');
      const texts = adf.content.flatMap((paragraph: any) => paragraph.content).filter((node: any) => node.type === 'text');
      expect(texts.every((node: any) => node.text.length > 0)).to.equal(true);
    });
  });

  describe('toIsoDateTime', () => {
    it('reads the JIRA offset without a colon', () => {
      expect(toIsoDateTime('2026-09-01T12:12:00.000+0200')).to.equal('2026-09-01T10:12:00.000Z');
    });

    it('keeps an unreadable value as it is, and an empty one empty', () => {
      expect(toIsoDateTime('not a date')).to.equal('not a date');
      expect(toIsoDateTime('')).to.equal('');
    });
  });

  describe('readUploadFiles and readCommentBody', () => {
    let tmpDir: string;

    beforeEach(async () => {
      tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ticket-ops-'));
    });

    afterEach(async () => {
      await fs.rm(tmpDir, { recursive: true, force: true });
    });

    it('reads every file with its name and size', async () => {
      const filePath = path.join(tmpDir, 'draft.md');
      await fs.writeFile(filePath, 'hello');
      const files = await readUploadFiles([filePath]);
      expect(files).to.have.length(1);
      expect(files[0].filename).to.equal('draft.md');
      expect(files[0].size).to.equal(5);
      expect(files[0].content.toString()).to.equal('hello');
    });

    it('fails on the missing file before reading the next ones', async () => {
      const existing = path.join(tmpDir, 'ok.md');
      await fs.writeFile(existing, 'ok');
      const missing = path.join(tmpDir, 'missing.md');
      let error: any;
      try {
        await readUploadFiles([existing, missing]);
      } catch (e) {
        error = e;
      }
      expect(error, 'expected a rejection').to.exist;
      expect(error.message).to.contain('missing.md');
    });

    it('rejects a folder given as a file', async () => {
      let error: any;
      try {
        await readUploadFiles([tmpDir]);
      } catch (e) {
        error = e;
      }
      expect(error, 'expected a rejection').to.exist;
    });

    it('reads the body from --body-file', async () => {
      const bodyFile = path.join(tmpDir, 'body.md');
      await fs.writeFile(bodyFile, 'From file');
      expect(await readCommentBody(undefined, bodyFile)).to.equal('From file');
    });

    it('refuses an empty body', async () => {
      let error: any;
      try {
        await readCommentBody('   ', undefined);
      } catch (e) {
        error = e;
      }
      expect(error, 'expected a rejection').to.exist;
    });
  });
});
