<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->

# hardis:ticket:comment

## Description

## Command Behavior

**Posts a free-text comment on a ticket, and optionally labels it, moves it to a status and sets its story points in the same run, so that an agent or a script can report on a ticket in one call.**

- The text comes from `--body`, or from a file with `--body-file` (alias `--file`) for a long or multi-line text. Exactly one of them is required, and an empty text is refused.
- `--format text` (default) sends the text as is: on JIRA Cloud as Atlassian Document Format paragraphs shown literally, on JIRA Server / Data Center as wiki markup, on Azure Boards as escaped HTML paragraphs. `--format markdown` converts headings, bullet and numbered lists, paragraphs, `**bold**` and ``code`` to ADF (Cloud), wiki markup (Server / Data Center) or HTML (Azure Boards). Every other character of the text is escaped: a text copied from a ticket cannot inject a mention, a link, a macro or markup.
- `--prefix "<text>"` puts that text as the first line of the comment, never twice.
- `--mention-assignee` adds a real mention of the assignee (it notifies them) right under the first line. The assignee is read on the ticket itself, never taken from the text; nothing is added when the ticket is unassigned.
- `--visibility role:<role>` or `group:<group>` restricts the comment on JIRA. Azure Boards refuses it before writing anything.

### Steps and their order

1. **Checks, before any write:** `--allowed-projects a,b` fails with `TicketOutOfScope` when the ticket belongs to another project; `--skip-if-marked` fails with `TicketAlreadyMarked` when the ticket carries `--marker-label` (default: `--add-label`) or when the authenticated account already posted a comment starting with `--prefix`. Invalid flags (label with spaces, bad visibility, JIRA points without `--points-field`) are refused here too.
2. **Comment.**
3. **Label** (`--add-label`, alias `--label`): added on top of the existing labels (an Azure Boards tag). If it cannot be added, the command says the comment was already saved, then fails with the original error: add the label only, do not re-run the command.
4. **Status** (`--transition <status>`): the target status, matched by name, untranslated name or id, never by the name of the transition.
5. **Story points** (`--points <n>`): never replaces a filled value unless `--overwrite-points`. On JIRA `--points-field customfield_NNNNN` is required; on Azure Boards the field is found on the work item type (`StoryPoints`, then `Effort`, then `Size`), or forced with `--points-field`. A type without the field is `skipped`, not an error.

A failed status or points step does not undo the comment: the JSON gives each step its own result (`done`, `skipped`, `failed` with the error name and message, or `not-requested`), and `complete` is false.

This is not the deployment comment: no org and no Pull Request are involved.

### Errors

The failures below carry a stable name, to branch on in a script: `TicketProviderNotConfigured`, `TicketProviderNotSupported`, `TicketNotFound`, `TicketRateLimited` (HTTP 429), `TicketOutOfScope`, `TicketAlreadyMarked`. Input errors caught before any network call and unexpected answers from the server carry no such name.

### Configuration

The ticketing system is deduced from the identifier (`ACME-123` is JIRA, `1234` or `AB-1234` is Azure Boards); `--provider` forces it. ServiceNow fails with `TicketProviderNotSupported`. JIRA variables: `JIRA_HOST` + (`JIRA_EMAIL` + `JIRA_TOKEN`) or `JIRA_PAT` or (`JIRA_CLIENT_ID` + `JIRA_CLIENT_SECRET`). Azure Boards: a token (`CI_SFDX_HARDIS_AZURE_TOKEN`, `SYSTEM_ACCESSTOKEN` or `AZURE_DEVOPS_EXT_PAT`), the organization and project being read from the git remote.

<details markdown="1">
<summary>Technical explanations</summary>

- **JIRA:** `issueComments.addComment` (with `visibility`), `issues.editIssue` with `update.labels.add`, `issues.getTransitions` then `issues.doTransition`, `issues.getIssue` then `issues.editIssue` for the points.
- **Azure Boards:** comments API 7.1-preview on the work item's own team project; tag, state and points are JSON patches guarded by a `test` on the revision read just before, so a concurrent edit fails instead of being overwritten.
- **Checks:** the ticket is read once (`ticket get` without attachments) when `--allowed-projects`, `--skip-if-marked` or `--mention-assignee` is set, and the authenticated account once for `--skip-if-marked`. Reads answered 5xx are retried once; writes never are, since a write answered 5xx may have been saved.

</details>

### Agent Mode

The command never prompts. `--id` and one of `--body` / `--body-file` are always required:

```sh
sf hardis ticket comment --id ACME-123 --file draft.md --format markdown --prefix "Automatic qualification" --skip-if-marked --label ia-qualified --transition "Ready" --points 3 --points-field customfield_10016 --allowed-projects ACME --agent --json
```

## Parameters

|Name|Type|Description|Default|Required|Options|
|:---|:--:|:----------|:-----:|:------:|:-----:|
|add-label|option|Label added to the ticket once the comment is posted||||
|agent|boolean|Run in non-interactive mode for agents and automation||||
|allowed-projects|option|Comma-separated projects the ticket must belong to (TicketOutOfScope otherwise)||||
|body|option|Text of the comment||||
|body-file|option|File holding the text of the comment||||
|debug<br/>-d|boolean|Activate debug mode (more logs)||||
|flags-dir|option|undefined||||
|format|option|text: sent as is. markdown: converted to the comment format of the ticketing system|text||text<br/>markdown|
|id<br/>-i|option|Ticket identifier (JIRA key such as ACME-123, or Azure Boards work item such as 1234 or AB-1234)||||
|json|boolean|Format output as json.||||
|marker-label|option|Label checked by --skip-if-marked. Defaults to --add-label||||
|mention-assignee|boolean|Mention the assignee of the ticket under the first line of the comment||||
|overwrite-points|boolean|Replace story points that are already filled||||
|points|option|Story points written once the comment is posted||||
|points-field|option|Story points field: customfield_NNNNN on JIRA (required), field reference name on Azure Boards (optional)||||
|prefix|option|First line of the comment, added unless the text already starts with it||||
|provider<br/>-p|option|Force the ticketing system instead of deducing it from the identifier|||jira<br/>azure<br/>servicenow|
|skip-if-marked|boolean|Fail with TicketAlreadyMarked, writing nothing, when the ticket already carries the marker label or a prefixed comment of this account||||
|skipauth|boolean|Skip authentication check when a default username is required||||
|transition|option|Status the ticket is moved to once the comment is posted||||
|visibility|option|JIRA only: role:<role> or group:<group> to restrict the comment||||
|websocket|option|Websocket host:port for VsCode SFDX Hardis UI integration||||

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

```shell
$ sf hardis:ticket:comment --id AB-4567 --file draft.md --format markdown --prefix "Automatic qualification" --skip-if-marked --label ia-qualified --transition Ready --points 3 --mention-assignee --allowed-projects "My Project" --agent --json
```

