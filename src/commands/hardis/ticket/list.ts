/* jscpd:ignore-start */
import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { Messages, SfError } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import c from 'chalk';
import * as path from 'path';
import fs from '../../../common/utils/fsUtils.js';
import { uxLog } from '../../../common/utils/index.js';
import { uxLogTableWithReport } from '../../../common/utils/filesUtils.js';
import { TicketProvider, TicketProviderKey, ticketDetailsProviderKeys } from '../../../common/ticketProvider/index.js';
import { TICKET_ERROR, TicketSearchResult } from '../../../common/ticketProvider/ticketOperations.js';
import { t } from '../../../common/utils/i18n.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

/** JSON result of the command. Key names and order are part of the contract: do not change them */
export function buildTicketListResult(providerKey: string, query: string, search: TicketSearchResult) {
  return {
    provider: providerKey,
    query,
    totalFetched: search.tickets.length,
    nextPageToken: search.nextPageToken,
    truncated: search.truncated,
    tickets: search.tickets,
  };
}

export default class TicketList extends SfCommand<any> {
  public static title = 'List tickets';

  public static description = `
## Command Behavior

**Lists the tickets matching a query, so that an agent or a script can process a whole backlog without typing the tickets one by one.**

- The query is **yours**: it is sent as is to the ticketing system (JQL on JIRA), never built or guessed by the command. An empty query is refused, since it would match every ticket.
- Without \`--provider\`, the only configured ticketing system is queried; when several are configured, \`--provider\` is required. In an Azure DevOps pipeline, the \`SYSTEM_*\` variables make Azure Boards count as configured: a JIRA team running there should always pass \`--provider jira\`.
- \`--max-results\` caps the number of tickets fetched (50 by default). The command never fetches more than that silently.
- When more tickets match, the output says \`truncated: true\` and gives a \`nextPageToken\`. Pass it to \`--page-token\` to read the next page. The token is **opaque**: relay it as is, never parse or build it.
- Each ticket comes with its key, URL, summary, type, status, priority, assignee, creation and update dates (ISO 8601, UTC) and labels.

### Supported ticketing systems

| Provider | Supported |
|----------|-----------|
| JIRA Cloud | Yes |
| JIRA Server / Data Center | No: fails with \`TicketProviderNotSupported\` |
| Azure Boards, ServiceNow | No: fails with \`TicketProviderNotSupported\` |

### Errors

Failures carry a stable name, to branch on in a script: \`TicketProviderNotConfigured\` (no usable credential), \`TicketProviderNotSupported\`, \`TicketQueryInvalid\` (the query was rejected: the server message is kept), \`TicketRateLimited\` (HTTP 429).

### Configuration

JIRA: \`JIRA_HOST\` + (\`JIRA_EMAIL\` + \`JIRA_TOKEN\`) or \`JIRA_PAT\` or (\`JIRA_CLIENT_ID\` + \`JIRA_CLIENT_SECRET\`), from CI/CD variables or a local **.env** file.

<details markdown="1">
<summary>Technical explanations</summary>

- **Endpoint:** the search goes through \`jira.js\` \`issueSearch.searchForIssuesUsingJqlEnhancedSearchPost\`, which calls \`/search/jql\`. The former \`/rest/api/3/search\` was removed from Jira Cloud (HTTP 410), and its offset pagination (\`startAt\` / \`total\`) was replaced by a cursor. That cursor model gives no exact total, so \`totalFetched\` counts the tickets actually fetched.
- **Server / Data Center:** \`/search/jql\` does not exist there. Supporting it would mean encoding \`startAt\` in the cursor, which is left for later: the opaque cursor lets it be added without changing a flag or a JSON key.
- **Credentials:** the call goes through the existing JIRA connector, so the credential fallback (Basic, PAT, OAuth2 client credentials) applies.

</details>

### Agent Mode

The command never prompts. \`--query\` is always required. Use \`--agent --json\` to get the machine-readable result:

\`\`\`sh
sf hardis ticket list --query "project = ACME AND statusCategory != Done" --agent --json
\`\`\`
`;

  public static examples = [
    '$ sf hardis:ticket:list --query "project = ACME AND issuetype = Bug AND statusCategory != Done"',
    '$ sf hardis:ticket:list --query "project = ACME" --max-results 100 --agent --json',
    '$ sf hardis:ticket:list --query "project = ACME" --page-token <nextPageToken of the previous page> --agent --json',
    '$ sf hardis:ticket:list --query "project = ACME" --output-file docs/backlog.json',
  ];

  public static flags: any = {
    agent: Flags.boolean({
      default: false,
      description: 'Run in non-interactive mode for agents and automation',
    }),
    query: Flags.string({
      char: 'q',
      required: true,
      description: 'Query sent as is to the ticketing system (JQL on JIRA)',
    }),
    provider: Flags.string({
      char: 'p',
      options: ticketDetailsProviderKeys(),
      description: 'Ticketing system to query. Defaults to the only one configured',
    }),
    'max-results': Flags.integer({
      default: 50,
      min: 1,
      description: 'Maximum number of tickets fetched',
    }),
    'page-token': Flags.string({
      description: 'nextPageToken returned by the previous page, relayed as is',
    }),
    'output-file': Flags.string({
      char: 'f',
      description: 'Also write the JSON result at this path (parent folders are created). JSON, not the markdown of ticket get: a list is read by a program',
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

  // Listing tickets is independent from any Salesforce project or org
  public static requiresProject = false;

  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(TicketList);
    const query = (flags.query || '').trim();
    if (!query) {
      throw new SfError(t('ticketListQueryEmpty'), TICKET_ERROR.queryInvalid);
    }
    // No --provider: the only configured connector is taken (an Azure-only setup then answers
    // TicketProviderNotSupported, which is the truth), several configured ones require --provider
    const { provider, providerClass } = await TicketProvider.resolveProvider({
      providerKey: flags.provider as TicketProviderKey | undefined,
    });
    const providerKey = providerClass.providerKey;
    const search = await provider.searchTickets(query, {
      maxResults: flags['max-results'],
      pageToken: flags['page-token'] || null,
    });
    const result = buildTicketListResult(providerKey, query, search);

    uxLog('action', this, c.cyan(t('ticketListDone', { count: result.totalFetched })));
    if (result.tickets.length > 0) {
      await uxLogTableWithReport(this, result.tickets, ['id', 'type', 'status', 'priority', 'assignee', 'subject'], {
        fileNamePrefix: 'ticket-list',
      });
    }
    if (result.truncated) {
      uxLog('warning', this, c.yellow(t('ticketListMore')));
      uxLog('log', this, c.grey(String(result.nextPageToken)));
    }
    if (flags['output-file']) {
      await fs.ensureDir(path.dirname(path.resolve(flags['output-file'])));
      await fs.outputFile(flags['output-file'], JSON.stringify(result, null, 2));
      uxLog('log', this, c.grey(t('ticketListWritten', { file: flags['output-file'] })));
    }
    return result as unknown as AnyJson;
  }
}
