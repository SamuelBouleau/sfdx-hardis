<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->

# hardis:ticket:attach

## Description

## Command Behavior

**Uploads one or more files on a ticket, so that a document produced by an agent (a solution draft, an estimate) lands where the team reads it.**

- `--file` can be repeated: every file is uploaded, and the output has one entry per file (name, id, URL, size).
- Every file is read **before** the first upload: a missing or unreadable file fails the command without attaching anything.
- `--add-label` adds a label to the ticket in the same run, on top of the labels already there. A script uses it to mark the tickets already processed. If the label cannot be added after the upload, the command says the change was already saved, then fails with the original error. A caller should then add the label only, not re-run the command: re-running would upload the files again.

### Errors

The provider failures below carry a stable name, to branch on in a script: `TicketProviderNotConfigured`, `TicketProviderNotSupported`, `TicketNotFound` (unknown ticket, or not visible to you), `TicketAttachmentTooLarge` (the file is named), `TicketRateLimited` (HTTP 429). Input errors caught before any network call (invalid label, unreadable file) and unexpected answers from the server carry no such name.

### Configuration

The ticketing system is deduced from the identifier (`ACME-123` is JIRA); `--provider` forces it. JIRA (Cloud and Server / Data Center) is supported; Azure Boards and ServiceNow fail with `TicketProviderNotSupported`. JIRA variables: `JIRA_HOST` + (`JIRA_EMAIL` + `JIRA_TOKEN`) or `JIRA_PAT` or (`JIRA_CLIENT_ID` + `JIRA_CLIENT_SECRET`).

<details markdown="1">
<summary>Technical explanations</summary>

- **Upload:** `jira.js` `issueAttachments.addAttachment`, one call per file, so that the file the server refuses is the one named in the error. A refusal on a later file leaves the earlier ones attached.
- **Label:** `issues.editIssue` with `update.labels.add`, the call the deployment comments already use: the existing labels are kept.
- **Credentials:** the existing JIRA connector is reused, with its credential fallback.

</details>

### Agent Mode

The command never prompts. `--id` and `--file` are always required:

```sh
sf hardis ticket attach --id ACME-123 --file draft-ACME-123.md --add-label backlog-autopilot --agent --json
```

## Parameters

| Name            |  Type   | Description                                                           | Default | Required |            Options            |
|:----------------|:-------:|:----------------------------------------------------------------------|:-------:|:--------:|:-----------------------------:|
| add-label       | option  | Label added to the ticket once the files are uploaded                 |         |          |                               |
| agent           | boolean | Run in non-interactive mode for agents and automation                 |         |          |                               |
| debug<br/>-d    | boolean | Activate debug mode (more logs)                                       |         |          |                               |
| file            | option  | File to upload. Repeat the flag to upload several files               |         |          |                               |
| flags-dir       | option  | undefined                                                             |         |          |                               |
| id<br/>-i       | option  | Ticket identifier (JIRA key, such as ACME-123)                        |         |          |                               |
| json            | boolean | Format output as json.                                                |         |          |                               |
| provider<br/>-p | option  | Force the ticketing system instead of deducing it from the identifier |         |          | jira<br/>azure<br/>servicenow |
| skipauth        | boolean | Skip authentication check when a default username is required         |         |          |                               |
| websocket       | option  | Websocket host:port for VsCode SFDX Hardis UI integration             |         |          |                               |

## Examples

```shell
$ sf hardis:ticket:attach --id ACME-123 --file draft-ACME-123.md
```

```shell
$ sf hardis:ticket:attach --id ACME-123 --file draft.md --file estimate.xlsx --agent --json
```

```shell
$ sf hardis:ticket:attach --id ACME-123 --file draft.md --add-label backlog-autopilot --agent --json
```
