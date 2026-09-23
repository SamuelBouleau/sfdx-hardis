import { expect } from 'chai';
// Load the barrel first, as the provider tests do, to resolve the pre-existing import cycle
import '../../../../src/common/ticketProvider/index.js';
import TicketList, { buildTicketListResult } from '../../../../src/commands/hardis/ticket/list.js';
import TicketAttach from '../../../../src/commands/hardis/ticket/attach.js';

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
    expect(Object.keys(result)).to.deep.equal(['provider', 'query', 'totalFetched', 'nextPageToken', 'truncated', 'tickets']);
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
});
