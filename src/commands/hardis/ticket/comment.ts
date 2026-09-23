/* jscpd:ignore-start */
import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import c from 'chalk';
import { uxLog } from '../../../common/utils/index.js';
import { TicketProvider, TicketProviderKey, ticketDetailsProviderKeys } from '../../../common/ticketProvider/index.js';
import { readCommentBody, validateTicketLabel } from '../../../common/ticketProvider/ticketOperations.js';
import { t } from '../../../common/utils/i18n.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

const BODY_FLAGS = ['body', 'body-file'];

export default class TicketComment extends SfCommand<any> {
  public static title = 'Comment a ticket';

  public static description = `
## Command Behavior

**Posts a free-text comment on a ticket, so that an agent or a script can report a status or explain why it hands the ticket back.**

- The text comes from \`--body\`, or from a file with \`--body-file\` for a long or multi-line text. Exactly one of them is required, and an empty text is refused.
- On JIRA Cloud the text is sent as Atlassian Document Format (one paragraph per block separated by a blank line); on JIRA Server / Data Center it is sent as is. There it is rendered as wiki markup, so characters such as \`*\`, \`_\`, \`{\`, \`[\` or \`|\` may be formatted; on Cloud the text is always shown literally.
- \`--add-label\` adds a label to the ticket in the same run, on top of the labels already there. The command does not check whether the same comment was already posted: a script makes its runs idempotent with that label. If the label cannot be added after the comment, the command fails and says the comment is already posted.
- This is not the deployment comment: no org and no Pull Request are involved.

### Errors

Failures carry a stable name, to branch on in a script: \`TicketProviderNotConfigured\`, \`TicketProviderNotSupported\`, \`TicketNotFound\`, \`TicketRateLimited\` (HTTP 429).

### Configuration

The ticketing system is deduced from the identifier (\`ACME-123\` is JIRA); \`--provider\` forces it. JIRA (Cloud and Server / Data Center) is supported; Azure Boards and ServiceNow fail with \`TicketProviderNotSupported\`. JIRA variables: \`JIRA_HOST\` + (\`JIRA_EMAIL\` + \`JIRA_TOKEN\`) or \`JIRA_PAT\` or (\`JIRA_CLIENT_ID\` + \`JIRA_CLIENT_SECRET\`).

<details markdown="1">
<summary>Technical explanations</summary>

- **Comment:** \`jira.js\` \`issueComments.addComment\`, the call the deployment comments already use, with the same split between ADF (Cloud, REST v3) and plain text (Server / Data Center, REST v2).
- **Label:** \`issues.editIssue\` with \`update.labels.add\`: the existing labels are kept.

</details>

### Agent Mode

The command never prompts. \`--id\` and one of \`--body\` / \`--body-file\` are always required:

\`\`\`sh
sf hardis ticket comment --id ACME-123 --body-file status.md --add-label backlog-autopilot --agent --json
\`\`\`
`;

  public static examples = [
    '$ sf hardis:ticket:comment --id ACME-123 --body "Estimated: see the attached draft"',
    '$ sf hardis:ticket:comment --id ACME-123 --body-file status.md --agent --json',
    '$ sf hardis:ticket:comment --id ACME-123 --body-file status.md --add-label backlog-autopilot --agent --json',
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
    body: Flags.string({
      exactlyOne: BODY_FLAGS,
      description: 'Text of the comment',
    }),
    'body-file': Flags.string({
      exactlyOne: BODY_FLAGS,
      description: 'File holding the text of the comment',
    }),
    'add-label': Flags.string({
      description: 'Label added to the ticket once the comment is posted',
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

  // Commenting a ticket is independent from any Salesforce project or org
  public static requiresProject = false;

  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(TicketComment);
    const ticketId = flags.id.trim();
    // Checked before any write: JIRA refuses a label with spaces, and it is added after the change
    const label = validateTicketLabel(flags['add-label']);
    const body = await readCommentBody(flags.body, flags['body-file']);
    const { provider, providerClass } = await TicketProvider.resolveProvider({
      ticketId,
      providerKey: flags.provider as TicketProviderKey | undefined,
    });
    const { commentId } = await provider.addTicketComment(ticketId, body);
    uxLog('action', this, c.cyan(t('ticketCommentDone', { commentId, ticketId })));
    if (label) {
      try {
        await provider.addTicketLabel(ticketId, label);
      } catch (e) {
        uxLog('warning', this, c.yellow(t('ticketLabelFailedAfterWrite', { ticketId, label })));
        throw e;
      }
      uxLog('log', this, c.grey(t('ticketLabelDone', { label, ticketId })));
    }
    return {
      provider: providerClass.providerKey,
      ticket: ticketId,
      commentId,
      labelAdded: label,
    } as unknown as AnyJson;
  }
}
