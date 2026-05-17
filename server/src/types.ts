export type RoomType = 'forge' | 'warroom' | 'blueprint' | 'lounge';
export type AgentState = 'idle' | 'typing' | 'thinking' | 'walking' | 'success' | 'error' | 'dormant';

export interface Room {
  id: string;
  linearIssueId?: string;
  linearIdentifier?: string;
  linearState?: string;
  title: string;
  description: string;
  roomType: RoomType;
  agentState: AgentState;
  characterIndex: number;
  createdAt: string;
  agentPid?: number;
}

export interface LinearIssue {
  id: string;
  identifier: string;
  title: string;
  description: string | null;
  state: { name: string };
  priority: number;
  labels: { nodes: { name: string }[] };
  comments?: { nodes: { id: string; body: string; createdAt: string; user: { name: string; isMe: boolean } }[] };
}

export interface WsMessageIn {
  type: 'terminal:input' | 'rooms:request';
  payload: Record<string, unknown>;
}

export interface WsMessageOut {
  type: string;
  payload: unknown;
}

export interface TerminalLine {
  roomId: string;
  kind: 'agent' | 'shell' | 'error' | 'system';
  text: string;
}
