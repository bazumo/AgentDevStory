---
tracker:
  kind: linear
  api_key: $LINEAR_API_KEY
  project_slug: "replace_me_linear_project_slug_id"
  active_states:
    - Todo
    - In Progress
    - In Review
  terminal_states:
    - Closed
    - Cancelled
    - Canceled
    - Duplicate
    - Done
polling:
  interval_ms: 10000
workspace:
  root: /tmp/symphony-agentdevstory-workspaces
hooks:
  after_create: |
    git clone --depth 1 https://github.com/bazumo/AgentDevStory.git .
agent:
  max_concurrent_agents: 2
  max_turns: 12
codex:
  command: codex --config shell_environment_policy.inherit=all app-server
  approval_policy: never
  thread_sandbox: workspace-write
  turn_sandbox_policy:
    type: workspaceWrite
---

You are working on Linear issue {{ issue.identifier }} for AgentDevStory.

Title: {{ issue.title }}
State: {{ issue.state }}
URL: {{ issue.url }}

Description:
{% if issue.description %}
{{ issue.description }}
{% else %}
No description provided.
{% endif %}

Use the repository instructions. Implement the issue in the provided workspace,
run appropriate checks, and summarize completed work and blockers only.
