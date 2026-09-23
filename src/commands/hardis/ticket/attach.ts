/* jscpd:ignore-start */
import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import c from 'chalk';
import { uxLog } from '../../../common/utils/index.js';
import { TicketProvider, TicketProviderKey, ticketDetailsProviderKeys } from '../../../common/ticketProvider/index.js';
import { addTicketLabelAfterWrite, readUploadFiles, validateTicketLabel } from '../../../common/ticketProvider/ticketOperations.js';
import { t } from '../../../common/utils/i18n.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class TicketAttach extends SfCommand<any> {
  public static title = 'Attach files to a ticket';

  public static description = `
## Command Behavior

**Uploads one or more files on a ticket, so that a document produced by an agent (a solution draft, an estimate) lands where the team reads it.**

- \`--file\` can be repeated: every file is uploaded, and the output has one entry per file (name, id, URL, size).
- Every file is read **before** the first upload: a missing or unreadable file fails the command without attaching anything.
- \`--add-label\` adds a label to the ticket in the same run, on top of the labels already there. A script uses it to mark the tickets already processed. If the label cannot be added after the upload, the command says the change was already saved, then fails with the original error. A caller should then add the label only, not re-run the command: re-running would upload the files again.

### Errors

The provider failures below carry a stable name, to branch on in a script: \`TicketProviderNotConfigured\`, \`TicketProviderNotSupported\`, \`TicketNotFound\` (unknown ticket, or not visible to you), \`TicketAttachmentTooLarge\` (the file is named), \`TicketRateLimited\` (HTTP 429). Input errors caught before any network call (invalid label, unreadable file) and unexpected answers from the server carry no such name.

### Configuration

The ticketing system is deduced from the identifier (\`ACME-123\` is JIRA); \`--provider\` forces it. JIRA (Cloud and Server / Data Center) is supported; Azure Boards and ServiceNow fail with \`TicketProviderNotSupported\`. JIRA variables: \`JIRA_HOST\` + (\`JIRA_EMAIL\` + \`JIRA_TOKEN\`) or \`JIRA_PAT\` or (\`JIRA_CLIENT_ID\` + \`JIRA_CLIENT_SECRET\`).

<details markdown="1">
<summary>Technical explanations</summary>

- **Upload:** \`jira.js\` \`issueAttachments.addAttachment\`, one call per file, so that the file the server refuses is the one named in the error. A refusal on a later file leaves the earlier ones attached.
- **Label:** \`issues.editIssue\` with \`update.labels.add\`, the call the deployment comments already use: the existing labels are kept.
- **Credentials:** the existing JIRA connector is reused, with its credential fallback.

</details>

### Agent Mode

The command never prompts. \`--id\` and \`--file\` are always required:

\`\`\`sh
sf hardis ticket attach --id ACME-123 --file draft-ACME-123.md --add-label backlog-autopilot --agent --json
\`\`\`
`;

  public static examples = [
    '$ sf hardis:ticket:attach --id ACME-123 --file draft-ACME-123.md',
    '$ sf hardis:ticket:attach --id ACME-123 --file draft.md --file estimate.xlsx --agent --json',
    '$ sf hardis:ticket:attach --id ACME-123 --file draft.md --add-label backlog-autopilot --agent --json',
  ];

  public static flags: any = {
    agent: Flags.boolean({
      default: false,
      description: 'Run in non-interactive mode for agents and automation',
    }),
    id: Flags.string({
      char: 'i',
      required: true,
      description: 'Ticket identifier (JIRA key, such as ACME-123)',
    }),
    file: Flags.string({
      multiple: true,
      required: true,
      description: 'File to upload. Repeat the flag to upload several files',
    }),
    'add-label': Flags.string({
      description: 'Label added to the ticket once the files are uploaded',
    }),
    provider: Flags.string({
      char: 'p',
      options: ticketDetailsProviderKeys(),
      description: 'Force the ticketing system instead of deducing it from the identifier',
    }),
    debug: Flags.boolean({
      char: 'd',
      default: false,
      description: messages.getMessage('debugMode'),
    }),
    websocket: Flags.string({
      description: messages.getMessage('websocket'),
    }),
    skipauth: Flags.boolean({
      description: 'Skip authentication check when a default username is required',
    }),
  };

  // Attaching a file is independent from any Salesforce project or org
  public static requiresProject = false;

  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(TicketAttach);
    const ticketId = flags.id.trim();
    // Checked before any write: JIRA refuses a label with spaces, and it is added after the change
    const label = validateTicketLabel(flags['add-label']);
    // Read before any network call: a wrong path must not leave the ticket half attached
    const files = await readUploadFiles(flags.file);
    const { provider, providerClass } = await TicketProvider.resolveProvider({
      ticketId,
      providerKey: flags.provider as TicketProviderKey | undefined,
    });
    const ticketKey = provider.normalizeTicketId(ticketId);
    const attachments = await provider.addTicketAttachments(ticketId, files);
    uxLog('action', this, c.cyan(t('ticketAttachDone', { count: attachments.length, ticketId: ticketKey })));
    const labelAdded = await addTicketLabelAfterWrite(provider, ticketKey, label, this);
    return {
      provider: providerClass.providerKey,
      ticket: ticketKey,
      attachments,
      labelAdded,
    } as unknown as AnyJson;
  }
}
