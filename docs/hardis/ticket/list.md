<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->

# hardis:ticket:list

## Description

## Command Behavior

**Lists the tickets matching a query, so that an agent or a script can process a whole backlog without typing the tickets one by one.**

- The query is **yours**: it is sent as is to the ticketing system (JQL on JIRA), never built or guessed by the command. An empty query is refused, since it would match every ticket.
- Without `--provider`, the only configured ticketing system is queried; when several are configured, `--provider` is required. In an Azure DevOps pipeline, the `SYSTEM_*` variables make Azure Boards count as configured: a JIRA team running there should always pass `--provider jira`.
- `--max-results` caps the number of tickets fetched (50 by default). The command never fetches more than that silently.
- When more tickets match, the output says `truncated: true` and gives a `nextPageToken`. Pass it to `--page-token` to read the next page. The token is **opaque**: relay it as is, never parse or build it.
- Each ticket comes with its key, URL, summary, type, status, priority, assignee, creation and update dates (ISO 8601, UTC) and labels.

### Supported ticketing systems

| Provider                  | Supported                                   |
|---------------------------|---------------------------------------------|
| JIRA Cloud                | Yes                                         |
| JIRA Server / Data Center | No: fails with `TicketProviderNotSupported` |
| Azure Boards, ServiceNow  | No: fails with `TicketProviderNotSupported` |

### Errors

Failures carry a stable name, to branch on in a script: `TicketProviderNotConfigured` (no usable credential), `TicketProviderNotSupported`, `TicketQueryInvalid` (the query was rejected: the server message is kept), `TicketRateLimited` (HTTP 429).

### Configuration

JIRA: `JIRA_HOST` + (`JIRA_EMAIL` + `JIRA_TOKEN`) or `JIRA_PAT` or (`JIRA_CLIENT_ID` + `JIRA_CLIENT_SECRET`), from CI/CD variables or a local **.env** file.

<details markdown="1">
<summary>Technical explanations</summary>

- **Endpoint:** the search goes through `jira.js` `issueSearch.searchForIssuesUsingJqlEnhancedSearchPost`, which calls `/search/jql`. The former `/rest/api/3/search` was removed from Jira Cloud (HTTP 410), and its offset pagination (`startAt` / `total`) was replaced by a cursor. That cursor model gives no exact total, so `totalFetched` counts the tickets actually fetched.
- **Server / Data Center:** `/search/jql` does not exist there. Supporting it would mean encoding `startAt` in the cursor, which is left for later: the opaque cursor lets it be added without changing a flag or a JSON key.
- **Credentials:** the call goes through the existing JIRA connector, so the credential fallback (Basic, PAT, OAuth2 client credentials) applies.

</details>

### Agent Mode

The command never prompts. `--query` is always required. Use `--agent --json` to get the machine-readable result:

```sh
sf hardis ticket list --query "project = ACME AND statusCategory != Done" --agent --json
```

## Parameters

| Name               |  Type   | Description                                                                                                                             | Default | Required |            Options            |
|:-------------------|:-------:|:----------------------------------------------------------------------------------------------------------------------------------------|:-------:|:--------:|:-----------------------------:|
| agent              | boolean | Run in non-interactive mode for agents and automation                                                                                   |         |          |                               |
| debug<br/>-d       | boolean | Activate debug mode (more logs)                                                                                                         |         |          |                               |
| flags-dir          | option  | undefined                                                                                                                               |         |          |                               |
| json               | boolean | Format output as json.                                                                                                                  |         |          |                               |
| max-results        | option  | Maximum number of tickets fetched                                                                                                       |   50    |          |                               |
| output-file<br/>-f | option  | Also write the JSON result at this path (parent folders are created). JSON, not the markdown of ticket get: a list is read by a program |         |          |                               |
| page-token         | option  | nextPageToken returned by the previous page, relayed as is                                                                              |         |          |                               |
| provider<br/>-p    | option  | Ticketing system to query. Defaults to the only one configured                                                                          |         |          | jira<br/>azure<br/>servicenow |
| query<br/>-q       | option  | Query sent as is to the ticketing system (JQL on JIRA)                                                                                  |         |          |                               |
| skipauth           | boolean | Skip authentication check when a default username is required                                                                           |         |          |                               |
| websocket          | option  | Websocket host:port for VsCode SFDX Hardis UI integration                                                                               |         |          |                               |

## Examples

```shell
$ sf hardis:ticket:list --query "project = ACME AND issuetype = Bug AND statusCategory != Done"
```

```shell
$ sf hardis:ticket:list --query "project = ACME" --max-results 100 --agent --json
```

```shell
$ sf hardis:ticket:list --query "project = ACME" --page-token <nextPageToken of the previous page> --agent --json
```

```shell
$ sf hardis:ticket:list --query "project = ACME" --output-file docs/backlog.json
```
