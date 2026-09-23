<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->

# hardis:ticket:comment

## Description

## Command Behavior

**Posts a free-text comment on a ticket, so that an agent or a script can report a status or explain why it hands the ticket back.**

- The text comes from `--body`, or from a file with `--body-file` for a long or multi-line text. Exactly one of them is required, and an empty text is refused.
- On JIRA Cloud the text is sent as Atlassian Document Format (one paragraph per block separated by a blank line); on JIRA Server / Data Center it is sent as is. There it is rendered as wiki markup, so characters such as `*`, `_`, `{`, `[` or `|` may be formatted; on Cloud the text is always shown literally.
- `--add-label` adds a label to the ticket in the same run, on top of the labels already there. The command does not check whether the same comment was already posted: a script makes its runs idempotent with that label. If the label cannot be added after the comment, the command says the change was already saved, then fails with the original error. A caller should then add the label only, not re-run the command: re-running would post the comment again.
- This is not the deployment comment: no org and no Pull Request are involved.

### Errors

The provider failures below carry a stable name, to branch on in a script: `TicketProviderNotConfigured`, `TicketProviderNotSupported`, `TicketNotFound`, `TicketRateLimited` (HTTP 429). Input errors caught before any network call (invalid label, unreadable file, empty body) and unexpected answers from the server carry no such name.

### Configuration

The ticketing system is deduced from the identifier (`ACME-123` is JIRA); `--provider` forces it. JIRA (Cloud and Server / Data Center) is supported; Azure Boards and ServiceNow fail with `TicketProviderNotSupported`. JIRA variables: `JIRA_HOST` + (`JIRA_EMAIL` + `JIRA_TOKEN`) or `JIRA_PAT` or (`JIRA_CLIENT_ID` + `JIRA_CLIENT_SECRET`).

<details markdown="1">
<summary>Technical explanations</summary>

- **Comment:** `jira.js` `issueComments.addComment`, the call the deployment comments already use, with the same split between ADF (Cloud, REST v3) and plain text (Server / Data Center, REST v2).
- **Label:** `issues.editIssue` with `update.labels.add`: the existing labels are kept.

</details>

### Agent Mode

The command never prompts. `--id` and one of `--body` / `--body-file` are always required:

```sh
sf hardis ticket comment --id ACME-123 --body-file status.md --add-label backlog-autopilot --agent --json
```

## Parameters

| Name            |  Type   | Description                                                           | Default | Required |            Options            |
|:----------------|:-------:|:----------------------------------------------------------------------|:-------:|:--------:|:-----------------------------:|
| add-label       | option  | Label added to the ticket once the comment is posted                  |         |          |                               |
| agent           | boolean | Run in non-interactive mode for agents and automation                 |         |          |                               |
| body            | option  | Text of the comment                                                   |         |          |                               |
| body-file       | option  | File holding the text of the comment                                  |         |          |                               |
| debug<br/>-d    | boolean | Activate debug mode (more logs)                                       |         |          |                               |
| flags-dir       | option  | undefined                                                             |         |          |                               |
| id<br/>-i       | option  | Ticket identifier (JIRA key, such as ACME-123)                        |         |          |                               |
| json            | boolean | Format output as json.                                                |         |          |                               |
| provider<br/>-p | option  | Force the ticketing system instead of deducing it from the identifier |         |          | jira<br/>azure<br/>servicenow |
| skipauth        | boolean | Skip authentication check when a default username is required         |         |          |                               |
| websocket       | option  | Websocket host:port for VsCode SFDX Hardis UI integration             |         |          |                               |

## Examples

```shell
$ sf hardis:ticket:comment --id ACME-123 --body "Estimated: see the attached draft"
```

```shell
$ sf hardis:ticket:comment --id ACME-123 --body-file status.md --agent --json
```

```shell
$ sf hardis:ticket:comment --id ACME-123 --body-file status.md --add-label backlog-autopilot --agent --json
```
