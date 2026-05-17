import type { LinearIssue } from './types.js';

const LINEAR_API = 'https://api.linear.app/graphql';

const ISSUES_QUERY = `
query ActiveIssues($states: [String!]!) {
  issues(
    filter: { state: { name: { in: $states } } }
    first: 50
    orderBy: updatedAt
  ) {
    nodes {
      id
      identifier
      title
      description
      priority
      state { name }
      labels { nodes { name } }
      comments(first: 20, orderBy: createdAt) {
        nodes {
          id
          body
          createdAt
          user { name isMe }
        }
      }
    }
  }
}`;

const CREATE_COMMENT = `
mutation CreateComment($issueId: String!, $body: String!) {
  commentCreate(input: { issueId: $issueId, body: $body }) {
    success
    comment { id }
  }
}`;

const TRANSITION_ISSUE = `
mutation TransitionIssue($issueId: String!, $stateId: String!) {
  issueUpdate(id: $issueId, input: { stateId: $stateId }) {
    success
  }
}`;

const WORKFLOW_STATES_QUERY = `
query WorkflowStates {
  workflowStates(first: 50) {
    nodes { id name type }
  }
}`;

export interface LinearComment {
  id: string;
  body: string;
  createdAt: string;
  user: { name: string; isMe: boolean };
}

export class LinearClient {
  private apiKey: string;
  private activeStates: string[];
  private terminalStates: string[];
  private stateIdCache = new Map<string, string>();

  constructor(opts: {
    apiKey: string;
    activeStates: string[];
    terminalStates: string[];
  }) {
    this.apiKey = opts.apiKey;
    this.activeStates = opts.activeStates;
    this.terminalStates = opts.terminalStates;
  }

  private async gql(query: string, variables: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    const res = await fetch(LINEAR_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: this.apiKey,
      },
      body: JSON.stringify({ query, variables }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Linear API ${res.status}: ${body}`);
    }

    const json = (await res.json()) as {
      data?: Record<string, unknown>;
      errors?: { message: string }[];
    };

    if (json.errors?.length) {
      throw new Error(`Linear GraphQL: ${json.errors.map((e) => e.message).join(', ')}`);
    }

    return json.data ?? {};
  }

  async fetchActiveIssues(): Promise<LinearIssue[]> {
    const data = await this.gql(ISSUES_QUERY, { states: this.activeStates });
    const issues = data?.issues as { nodes?: LinearIssue[] } | undefined;
    return issues?.nodes ?? [];
  }

  async addComment(issueId: string, body: string): Promise<boolean> {
    try {
      const data = await this.gql(CREATE_COMMENT, { issueId, body });
      const result = data?.commentCreate as { success?: boolean } | undefined;
      return result?.success ?? false;
    } catch (err) {
      console.error('[Linear] failed to add comment:', err);
      return false;
    }
  }

  async transitionIssue(issueId: string, targetStateName: string): Promise<boolean> {
    try {
      const stateId = await this.resolveStateId(targetStateName);
      if (!stateId) {
        console.error(`[Linear] workflow state "${targetStateName}" not found`);
        return false;
      }
      const data = await this.gql(TRANSITION_ISSUE, { issueId, stateId });
      const result = data?.issueUpdate as { success?: boolean } | undefined;
      return result?.success ?? false;
    } catch (err) {
      console.error('[Linear] failed to transition issue:', err);
      return false;
    }
  }

  private async resolveStateId(stateName: string): Promise<string | null> {
    const cached = this.stateIdCache.get(stateName.toLowerCase());
    if (cached) return cached;

    const data = await this.gql(WORKFLOW_STATES_QUERY);
    const states = data?.workflowStates as { nodes?: { id: string; name: string; type: string }[] } | undefined;
    for (const s of states?.nodes ?? []) {
      this.stateIdCache.set(s.name.toLowerCase(), s.id);
    }

    return this.stateIdCache.get(stateName.toLowerCase()) ?? null;
  }

  isTerminalState(stateName: string): boolean {
    return this.terminalStates.some(
      (s) => s.toLowerCase() === stateName.toLowerCase(),
    );
  }
}
