export type SymphonyRunningEntry = {
  issue_id?: string;
  issue_identifier?: string;
  state?: string;
  worker_host?: string | null;
  workspace_path?: string | null;
  session_id?: string | null;
  turn_count?: number;
  last_event?: string | null;
  last_message?: string | null;
  started_at?: string | null;
  last_event_at?: string | null;
  tokens?: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
  };
};

export type SymphonyRetryEntry = {
  issue_id?: string;
  issue_identifier?: string;
  attempt?: number;
  due_at?: string | null;
  error?: string | null;
  worker_host?: string | null;
  workspace_path?: string | null;
};

export type SymphonyState = {
  generated_at?: string;
  counts?: {
    running?: number;
    retrying?: number;
  };
  running?: SymphonyRunningEntry[];
  retrying?: SymphonyRetryEntry[];
  error?: {
    code?: string;
    message?: string;
  };
};

export type SymphonyStatus = {
  configured: boolean;
  apiUrl: string | null;
  reachable?: boolean;
  state?: SymphonyState;
  error?: string;
};

export class SymphonyGateway {
  constructor(
    private readonly apiUrl: string | null,
    private readonly apiKey: string | null
  ) {}

  get configured(): boolean {
    return Boolean(this.apiUrl);
  }

  status(): SymphonyStatus {
    return {
      configured: this.configured,
      apiUrl: this.apiUrl
    };
  }

  async state(): Promise<SymphonyStatus> {
    if (!this.configured) return this.status();

    try {
      const response = await fetch(new URL("/api/v1/state", this.apiUrl!).toString(), {
        headers: this.headers()
      });
      if (!response.ok) {
        const body = await response.text();
        return { ...this.status(), reachable: false, error: `${response.status} ${body.slice(0, 500)}` };
      }

      return { ...this.status(), reachable: true, state: await response.json() as SymphonyState };
    } catch (error) {
      return {
        ...this.status(),
        reachable: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  async refresh(): Promise<SymphonyStatus> {
    if (!this.configured) return this.status();

    const response = await fetch(new URL("/api/v1/refresh", this.apiUrl!).toString(), {
      method: "POST",
      headers: this.headers()
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Symphony refresh failed: ${response.status} ${body.slice(0, 500)}`);
    }

    return { ...this.status(), reachable: true, state: await this.state().then((status) => status.state) };
  }

  private headers(): HeadersInit {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;
    return headers;
  }
}
