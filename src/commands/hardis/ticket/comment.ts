/* jscpd:ignore-start */
import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { Messages, SfError } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import c from 'chalk';
import { uxLog } from '../../../common/utils/index.js';
import { TicketProvider, TicketProviderKey, ticketDetailsProviderKeys } from '../../../common/ticketProvider/index.js';
import { TICKET_ERROR, addTicketLabelAfterWrite, readCommentBody, validateTicketLabel } from '../../../common/ticketProvider/ticketOperations.js';
import {
  NOT_REQUESTED,
  TicketAssignee,
  TicketStepResult,
  assertProjectAllowed,
  isTicketMarked,
  parseAllowedProjects,
  parseCommentVisibility,
  parseStoryPoints,
  stepFailure,
  withCommentPrefix,
} from '../../../common/ticketProvider/ticketQualify.js';
import { t } from '../../../common/utils/i18n.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

const BODY_FLAGS = ['body', 'body-file'];
const JIRA_POINTS_FIELD_RE = /^customfield_\d+$/;

export default class TicketComment extends SfCommand<any> {
  public static title = 'Comment a ticket';

  public static description = `
## Command Behavior

**Posts a free-text comment on a ticket, and optionally labels it, moves it to a status and sets its story points in the same run, so that an agent or a script can report on a ticket in one call.**

- The text comes from \`--body\`, or from a file with \`--body-file\` (alias \`--file\`) for a long or multi-line text. Exactly one of them is required, and an empty text is refused.
- \`--format text\` (default) sends the text as is: on JIRA Cloud as Atlassian Document Format paragraphs shown literally, on JIRA Server / Data Center as wiki markup, on Azure Boards as escaped HTML paragraphs. \`--format markdown\` converts headings, bullet and numbered lists, paragraphs, \`**bold**\` and \`\`code\`\` to ADF (Cloud), wiki markup (Server / Data Center) or HTML (Azure Boards). Every other character of the text is escaped: a text copied from a ticket cannot inject a mention, a link, a macro or markup.
- \`--prefix "<text>"\` puts that text as the first line of the comment, never twice.
- \`--mention-assignee\` adds a real mention of the assignee (it notifies them) right under the first line. The assignee is read on the ticket itself, never taken from the text; nothing is added when the ticket is unassigned.
- \`--visibility role:<role>\` or \`group:<group>\` restricts the comment on JIRA. Azure Boards refuses it before writing anything.

### Steps and their order

1. **Checks, before any write:** \`--allowed-projects a,b\` fails with \`TicketOutOfScope\` when the ticket belongs to another project; \`--skip-if-marked\` fails with \`TicketAlreadyMarked\` when the ticket carries \`--marker-label\` (default: \`--add-label\`) or when the authenticated account already posted a comment starting with \`--prefix\`. Invalid flags (label with spaces, bad visibility, JIRA points without \`--points-field\`) are refused here too.
2. **Comment.**
3. **Label** (\`--add-label\`, alias \`--label\`): added on top of the existing labels (an Azure Boards tag). If it cannot be added, the command says the comment was already saved, then fails with the original error: add the label only, do not re-run the command.
4. **Status** (\`--transition <status>\`): the target status, matched by name, untranslated name or id, never by the name of the transition.
5. **Story points** (\`--points <n>\`): never replaces a filled value unless \`--overwrite-points\`. On JIRA \`--points-field customfield_NNNNN\` is required; on Azure Boards the field is found on the work item type (\`StoryPoints\`, then \`Effort\`, then \`Size\`), or forced with \`--points-field\`. A type without the field is \`skipped\`, not an error.

A failed status or points step does not undo the comment: the JSON gives each step its own result (\`done\`, \`skipped\`, \`failed\` with the error name and message, or \`not-requested\`), and \`complete\` is false.

This is not the deployment comment: no org and no Pull Request are involved.

### Errors

The failures below carry a stable name, to branch on in a script: \`TicketProviderNotConfigured\`, \`TicketProviderNotSupported\`, \`TicketNotFound\`, \`TicketRateLimited\` (HTTP 429), \`TicketOutOfScope\`, \`TicketAlreadyMarked\`. Input errors caught before any network call and unexpected answers from the server carry no such name.

### Configuration

The ticketing system is deduced from the identifier (\`ACME-123\` is JIRA, \`1234\` or \`AB-1234\` is Azure Boards); \`--provider\` forces it. ServiceNow fails with \`TicketProviderNotSupported\`. JIRA variables: \`JIRA_HOST\` + (\`JIRA_EMAIL\` + \`JIRA_TOKEN\`) or \`JIRA_PAT\` or (\`JIRA_CLIENT_ID\` + \`JIRA_CLIENT_SECRET\`). Azure Boards: a token (\`CI_SFDX_HARDIS_AZURE_TOKEN\`, \`SYSTEM_ACCESSTOKEN\` or \`AZURE_DEVOPS_EXT_PAT\`), the organization and project being read from the git remote.

<details markdown="1">
<summary>Technical explanations</summary>

- **JIRA:** \`issueComments.addComment\` (with \`visibility\`), \`issues.editIssue\` with \`update.labels.add\`, \`issues.getTransitions\` then \`issues.doTransition\`, \`issues.getIssue\` then \`issues.editIssue\` for the points.
- **Azure Boards:** comments API 7.1-preview on the work item's own team project; tag, state and points are JSON patches guarded by a \`test\` on the revision read just before, so a concurrent edit fails instead of being overwritten.
- **Checks:** the ticket is read once (\`ticket get\` without attachments) when \`--allowed-projects\`, \`--skip-if-marked\` or \`--mention-assignee\` is set, and the authenticated account once for \`--skip-if-marked\`. Reads answered 5xx are retried once; writes never are, since a write answered 5xx may have been saved.

</details>

### Agent Mode

The command never prompts. \`--id\` and one of \`--body\` / \`--body-file\` are always required:

\`\`\`sh
sf hardis ticket comment --id ACME-123 --file draft.md --format markdown --prefix "Automatic qualification" --skip-if-marked --label ia-qualified --transition "Ready" --points 3 --points-field customfield_10016 --allowed-projects ACME --agent --json
\`\`\`
`;

  public static examples = [
    '$ sf hardis:ticket:comment --id ACME-123 --body "Estimated: see the attached draft"',
    '$ sf hardis:ticket:comment --id ACME-123 --body-file status.md --agent --json',
    '$ sf hardis:ticket:comment --id ACME-123 --body-file status.md --add-label backlog-autopilot --agent --json',
    '$ sf hardis:ticket:comment --id AB-4567 --file draft.md --format markdown --prefix "Automatic qualification" --skip-if-marked --label ia-qualified --transition Ready --points 3 --mention-assignee --allowed-projects "My Project" --agent --json',
  ];

  public static flags: any = {
    agent: Flags.boolean({
      default: false,
      description: 'Run in non-interactive mode for agents and automation',
    }),
    id: Flags.string({
      char: 'i',
      required: true,
      description: 'Ticket identifier (JIRA key such as ACME-123, or Azure Boards work item such as 1234 or AB-1234)',
    }),
    body: Flags.string({
      exactlyOne: BODY_FLAGS,
      description: 'Text of the comment',
    }),
    'body-file': Flags.string({
      exactlyOne: BODY_FLAGS,
      aliases: ['file'],
      description: 'File holding the text of the comment',
    }),
    format: Flags.string({
      options: ['text', 'markdown'],
      default: 'text',
      description: 'text: sent as is. markdown: converted to the comment format of the ticketing system',
    }),
    prefix: Flags.string({
      description: 'First line of the comment, added unless the text already starts with it',
    }),
    'skip-if-marked': Flags.boolean({
      default: false,
      description: 'Fail with TicketAlreadyMarked, writing nothing, when the ticket already carries the marker label or a prefixed comment of this account',
    }),
    'marker-label': Flags.string({
      description: 'Label checked by --skip-if-marked. Defaults to --add-label',
    }),
    'add-label': Flags.string({
      aliases: ['label'],
      description: 'Label added to the ticket once the comment is posted',
    }),
    transition: Flags.string({
      description: 'Status the ticket is moved to once the comment is posted',
    }),
    points: Flags.string({
      description: 'Story points written once the comment is posted',
    }),
    'points-field': Flags.string({
      description: 'Story points field: customfield_NNNNN on JIRA (required), field reference name on Azure Boards (optional)',
    }),
    'overwrite-points': Flags.boolean({
      default: false,
      description: 'Replace story points that are already filled',
    }),
    'mention-assignee': Flags.boolean({
      default: false,
      description: 'Mention the assignee of the ticket under the first line of the comment',
    }),
    visibility: Flags.string({
      description: 'JIRA only: role:<role> or group:<group> to restrict the comment',
    }),
    'allowed-projects': Flags.string({
      description: 'Comma-separated projects the ticket must belong to (TicketOutOfScope otherwise)',
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
    // Every input is checked before any network call: nothing is written when one of them is wrong
    const label = validateTicketLabel(flags['add-label']);
    const markerLabel = validateTicketLabel(flags['marker-label']) ?? label;
    const visibility = parseCommentVisibility(flags.visibility);
    const points = parseStoryPoints(flags.points);
    const allowedProjects = parseAllowedProjects(flags['allowed-projects']);
    const prefix = flags.prefix || null;
    const skipIfMarked = flags['skip-if-marked'] === true;
    const transition = (flags.transition || '').trim() || null;
    const body = withCommentPrefix(await readCommentBody(flags.body, flags['body-file']), prefix);

    const { provider, providerClass } = await TicketProvider.resolveProvider({
      ticketId,
      providerKey: flags.provider as TicketProviderKey | undefined,
    });
    const isJira = providerClass.providerKey === 'jira';
    if (points !== null && isJira && !JIRA_POINTS_FIELD_RE.test(flags['points-field'] || '')) {
      throw new SfError(t('ticketPointsFieldRequired'));
    }
    if (skipIfMarked && !prefix && !markerLabel) {
      throw new SfError(t('ticketSkipIfMarkedNeedsMarker'));
    }
    const ticketKey = provider.normalizeTicketId(ticketId);

    // One read of the ticket serves the scope check, the marker check and the mention
    let mention: TicketAssignee | null = null;
    if (allowedProjects || skipIfMarked || flags['mention-assignee']) {
      const details = await provider.getTicketDetails(ticketId, { downloadAttachments: false, skipComments: !skipIfMarked });
      if (!details) {
        throw new SfError(t('ticketNotFound', { ticketId: ticketKey }), TICKET_ERROR.notFound);
      }
      assertProjectAllowed(ticketKey, details.project, allowedProjects);
      if (skipIfMarked) {
        const myId = prefix ? (await provider.whoAmI()).id : null;
        const comments = details.comments.map((comment) => ({ authorId: comment.authorId ?? null, body: comment.body }));
        if (isTicketMarked({ labels: details.labels, comments, myId, prefix, label: markerLabel })) {
          throw new SfError(t('ticketAlreadyMarked', { ticketId: ticketKey }), TICKET_ERROR.alreadyMarked);
        }
      }
      if (flags['mention-assignee'] && details.assigneeId) {
        mention = { id: details.assigneeId, displayName: details.assignee || null };
      }
    }

    const { commentId, url } = await provider.addTicketComment(ticketId, body, {
      format: flags.format === 'markdown' ? 'markdown' : 'text',
      mention,
      visibility,
    });
    uxLog('action', this, c.cyan(t('ticketCommentDone', { commentId, ticketId: ticketKey })));
    const labelAdded = await addTicketLabelAfterWrite(provider, ticketKey, label, this);

    const transitionResult = transition === null ? NOT_REQUESTED : await this.runStep(() => provider.transitionTicket(ticketKey, transition).then((status) => ({ status: 'done' as const, value: status })));
    const pointsResult =
      points === null
        ? NOT_REQUESTED
        : await this.runStep(() =>
            provider.setTicketPoints(ticketKey, points, { field: flags['points-field'] || null, overwrite: flags['overwrite-points'] === true })
          );
    const complete = ![transitionResult, pointsResult].some((step) => step.status === 'failed');
    if (!complete) {
      uxLog('warning', this, c.yellow(t('ticketCommentPartial', { ticketId: ticketKey })));
    }
    return {
      provider: providerClass.providerKey,
      ticket: ticketKey,
      commentId,
      url,
      labelAdded,
      label: label === null ? NOT_REQUESTED : { status: 'done', value: label },
      transition: transitionResult,
      points: pointsResult,
      complete,
    } as unknown as AnyJson;
  }

  /** A step after the comment never throws: its failure is reported, the comment stays */
  private async runStep(step: () => Promise<TicketStepResult>): Promise<TicketStepResult> {
    try {
      const result = await step();
      uxLog('log', this, c.grey(JSON.stringify(result)));
      return result;
    } catch (error) {
      uxLog('warning', this, c.yellow((error as Error).message));
      return stepFailure(error);
    }
  }
}
