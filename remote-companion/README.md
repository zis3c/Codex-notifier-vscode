# Codex Notifier Remote Companion

Install this companion on the Remote SSH host while Codex Notifier remains
installed locally. It watches the remote Codex session JSONL files for
authoritative `task_complete` events and forwards them to the local
`codexNotifier.notifyComplete` command.
