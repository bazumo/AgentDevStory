import { LinearClient } from "@linear/sdk";
import type { CreateProjectRequest, LinearIssue, LinearTeam } from "../../shared/types";

type GraphqlResponse<T> = {
  data?: T;
  errors?: Array<{ message: string }>;
};

type LinearProjectNode = {
  id: string;
  name: string;
  url?: string | null;
};

type LinearIssueNode = {
  id: string;
  identifier: string;
  title: string;
  description?: string | null;
  priority?: number | null;
  state?: { name?: string | null; type?: string | null } | null;
  branchName?: string | null;
  url?: string | null;
  labels?: { nodes?: Array<{ name?: string | null }> | null } | null;
  inverseRelations?: {
    nodes?: Array<{
      type?: string | null;
      issue?: {
        id?: string | null;
        identifier?: string | null;
        state?: { name?: string | null } | null;
      } | null;
    }> | null;
  } | null;
  createdAt?: string | null;
  updatedAt?: string | null;
};

type ProjectIssuesResponse = {
  issues: {
    nodes: LinearIssueNode[];
    pageInfo: { hasNextPage: boolean; endCursor?: string | null };
  };
};

export type CreatedLinearProject = {
  id: string;
  name: string;
  url: string | null;
};

export class LinearGateway {
  private sdk: LinearClient | null;

  constructor(private readonly apiKey: string | null) {
    this.sdk = apiKey ? new LinearClient({ apiKey }) : null;
  }

  get configured(): boolean {
    return Boolean(this.apiKey);
  }

  async listTeams(): Promise<LinearTeam[]> {
    this.assertConfigured();

    const data = await this.graphql<{
      teams: { nodes: Array<{ id: string; name: string; key?: string | null }> };
    }>(`
      query AgentDevStoryTeams {
        teams(first: 100) {
          nodes {
            id
            name
            key
          }
        }
      }
    `);

    return data.teams.nodes.map((team) => ({
      id: team.id,
      name: team.name,
      key: team.key ?? null
    }));
  }

  async createProject(input: CreateProjectRequest): Promise<CreatedLinearProject> {
    this.assertConfigured();
    if (!this.sdk) throw new Error("Linear SDK client is not initialized");

    const payload = await this.sdk.createProject({
      name: input.name,
      description: input.description ?? "",
      content: input.description ?? "",
      teamIds: [input.teamId]
    });

    if (!payload.success) {
      throw new Error("Linear projectCreate returned success=false");
    }

    const project = await payload.project;
    if (!project) {
      throw new Error("Linear projectCreate did not return a project");
    }

    return {
      id: project.id,
      name: project.name,
      url: project.url ?? null
    };
  }

  async fetchProjectIssues(projectId: string, stateNames: string[]): Promise<LinearIssue[]> {
    this.assertConfigured();

    const issues: LinearIssue[] = [];
    let after: string | null = null;

    do {
      const data: ProjectIssuesResponse = await this.graphql<ProjectIssuesResponse>(
        `
          query AgentDevStoryProjectIssues($projectId: ID!, $stateNames: [String!]!, $first: Int!, $after: String) {
            issues(
              filter: { project: { id: { eq: $projectId } }, state: { name: { in: $stateNames } } }
              first: $first
              after: $after
            ) {
              nodes {
                id
                identifier
                title
                description
                priority
                state { name type }
                branchName
                url
                labels { nodes { name } }
                inverseRelations(first: 20) {
                  nodes {
                    type
                    issue { id identifier state { name } }
                  }
                }
                createdAt
                updatedAt
              }
              pageInfo { hasNextPage endCursor }
            }
          }
        `,
        { projectId, stateNames, first: 50, after }
      );

      issues.push(...data.issues.nodes.map(normalizeIssue));
      after = data.issues.pageInfo.hasNextPage ? data.issues.pageInfo.endCursor ?? null : null;
    } while (after);

    return issues;
  }

  private async graphql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
    this.assertConfigured();
    const apiKey = this.apiKey;
    if (!apiKey) throw new Error("LINEAR_API_KEY is required");

    const response = await fetch("https://api.linear.app/graphql", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: apiKey
      },
      body: JSON.stringify({ query, variables })
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Linear GraphQL request failed: ${response.status} ${body.slice(0, 500)}`);
    }

    const payload = (await response.json()) as GraphqlResponse<T>;
    if (payload.errors?.length) {
      throw new Error(payload.errors.map((error) => error.message).join("; "));
    }

    if (!payload.data) {
      throw new Error("Linear GraphQL response did not include data");
    }

    return payload.data;
  }

  private assertConfigured(): void {
    if (!this.apiKey) throw new Error("LINEAR_API_KEY is required");
  }
}

function normalizeIssue(issue: LinearIssueNode): LinearIssue {
  return {
    id: issue.id,
    identifier: issue.identifier,
    title: issue.title,
    description: issue.description ?? null,
    priority: issue.priority ?? null,
    state: issue.state?.name ?? "Unknown",
    stateType: issue.state?.type ?? null,
    branchName: issue.branchName ?? null,
    url: issue.url ?? null,
    labels: (issue.labels?.nodes ?? [])
      .map((label) => label.name?.toLowerCase())
      .filter((label): label is string => Boolean(label)),
    blockedBy: (issue.inverseRelations?.nodes ?? [])
      .filter((relation) => relation.type === "blocks")
      .map((relation) => ({
        id: relation.issue?.id ?? null,
        identifier: relation.issue?.identifier ?? null,
        state: relation.issue?.state?.name ?? null
      })),
    createdAt: issue.createdAt ?? null,
    updatedAt: issue.updatedAt ?? null,
    runState: "idle"
  };
}
