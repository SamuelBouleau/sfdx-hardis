import { expect } from 'chai';
import * as os from 'os';
import * as path from 'path';
import fs from '../../../../src/common/utils/fsUtils.js';
// Load the barrel first, as the provider tests do, to resolve the pre-existing import cycle
import '../../../../src/common/ticketProvider/index.js';
import TicketList, { buildTicketListResult } from '../../../../src/commands/hardis/ticket/list.js';
import TicketAttach from '../../../../src/commands/hardis/ticket/attach.js';
import TicketComment from '../../../../src/commands/hardis/ticket/comment.js';
import { TICKET_ERROR } from '../../../../src/common/ticketProvider/ticketOperations.js';
import { t } from '../../../../src/common/utils/i18n.js';

/**
 * The flag names and the JSON keys below are consumed by the Claude framework skills, developed in
 * parallel against a stub. Renaming one breaks them silently: this test is the contract guard.
 */
describe('ticket commands contract', () => {
  it('ticket list declares the frozen flags', () => {
    const flags: any = TicketList.flags;
    for (const name of ['query', 'provider', 'max-results', 'page-token', 'agent', 'output-file']) {
      expect(flags, name).to.have.property(name);
    }
    expect(flags['max-results'].default).to.equal(50);
    expect(flags.provider.options).to.deep.equal(['jira', 'azure', 'servicenow']);
    expect(TicketList.requiresProject).to.equal(false);
  });

  it('ticket list returns the keys of the contract, in order', () => {
    const result = buildTicketListResult('jira', 'project = ACME', { tickets: [], nextPageToken: null, truncated: false });
    expect(Object.keys(result)).to.deep.equal(['provider', 'query', 'totalFetched', 'nextPageToken', 'truncated', 'tickets', 'warning']);
    expect(result.totalFetched).to.equal(0);
  });

  it('ticket attach declares the frozen flags, --file repeatable', () => {
    const flags: any = TicketAttach.flags;
    for (const name of ['id', 'file', 'add-label', 'provider', 'agent']) {
      expect(flags, name).to.have.property(name);
    }
    expect(flags.file.multiple).to.equal(true);
    expect(flags.file.required).to.equal(true);
    expect(flags.id.required).to.equal(true);
    expect(TicketAttach.requiresProject).to.equal(false);
  });

  it('ticket comment declares the frozen flags, --body and --body-file exclusive', () => {
    const flags: any = TicketComment.flags;
    for (const name of ['id', 'body', 'body-file', 'add-label', 'provider', 'agent']) {
      expect(flags, name).to.have.property(name);
    }
    expect(flags.body.exactlyOne).to.deep.equal(['body', 'body-file']);
    expect(flags['body-file'].exactlyOne).to.deep.equal(['body', 'body-file']);
    expect(flags.id.required).to.equal(true);
    expect(TicketComment.requiresProject).to.equal(false);
  });
});

/** Runs a command and returns what it threw, or fails the test when it resolved */
async function rejectionOf(run: () => Promise<unknown>): Promise<any> {
  try {
    await run();
  } catch (error) {
    return error;
  }
  throw new Error('expected the command to fail');
}

/**
 * The guards below fail before the provider is resolved, so no credential is needed. The JIRA
 * variables are blanked anyway, so that a regression cannot reach a real ticketing system.
 */
describe('ticket commands guards, before any network call', () => {
  const JIRA_VARS = ['JIRA_HOST', 'JIRA_EMAIL', 'JIRA_TOKEN', 'JIRA_PAT', 'JIRA_CLIENT_ID', 'JIRA_CLIENT_SECRET'];
  const savedEnv: Record<string, string | undefined> = {};
  let tmpDir: string;

  beforeEach(async () => {
    for (const name of JIRA_VARS) {
      savedEnv[name] = process.env[name];
      process.env[name] = '';
    }
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ticket-cmd-'));
  });

  afterEach(async () => {
    for (const name of JIRA_VARS) {
      if (savedEnv[name] === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = savedEnv[name];
      }
    }
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('ticket list refuses a blank query with TicketQueryInvalid', async () => {
    const error = await rejectionOf(() => TicketList.run(['--query', '   ', '--agent']));
    expect(error.name).to.equal(TICKET_ERROR.queryInvalid);
  });

  it('ticket attach refuses a label with a space', async () => {
    const filePath = path.join(tmpDir, 'draft.md');
    await fs.writeFile(filePath, 'draft');
    const error = await rejectionOf(() =>
      TicketAttach.run(['--id', 'ACME-1', '--file', filePath, '--add-label', 'two words', '--agent'])
    );
    expect(error.message).to.equal(t('ticketLabelInvalid', { label: 'two words' }));
  });

  it('ticket attach refuses a missing file', async () => {
    const missing = path.join(tmpDir, 'missing.md');
    const error = await rejectionOf(() => TicketAttach.run(['--id', 'ACME-1', '--file', missing, '--agent']));
    expect(error.message).to.equal(t('ticketFileNotReadable', { file: missing }));
  });

  it('ticket attach refuses a folder given as a file', async () => {
    const error = await rejectionOf(() => TicketAttach.run(['--id', 'ACME-1', '--file', tmpDir, '--agent']));
    expect(error.message).to.equal(t('ticketFileNotReadable', { file: tmpDir }));
  });

  it('ticket comment refuses a blank --body', async () => {
    const error = await rejectionOf(() => TicketComment.run(['--id', 'ACME-1', '--body', '   ', '--agent']));
    expect(error.message).to.equal(t('ticketCommentBodyEmpty'));
  });

  it('ticket comment refuses a --body-file holding only whitespace', async () => {
    const bodyFile = path.join(tmpDir, 'blank.md');
    await fs.writeFile(bodyFile, '  \n\t\n');
    const error = await rejectionOf(() => TicketComment.run(['--id', 'ACME-1', '--body-file', bodyFile, '--agent']));
    expect(error.message).to.equal(t('ticketCommentBodyEmpty'));
  });

  it('ticket comment refuses --body and --body-file together', async () => {
    const bodyFile = path.join(tmpDir, 'body.md');
    await fs.writeFile(bodyFile, 'From file');
    const error = await rejectionOf(() =>
      TicketComment.run(['--id', 'ACME-1', '--body', 'inline', '--body-file', bodyFile, '--agent'])
    );
    expect(error.message).to.contain('--body');
    expect(error.message).to.not.equal(t('ticketCommentBodyEmpty'));
  });
});
