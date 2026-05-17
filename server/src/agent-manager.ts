import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import type { AgentState, TerminalLine } from './types.js';

interface AgentProcess {
  roomId: string;
  proc: ChildProcess;
  state: AgentState;
  lastOutputAt: number;
  outputChunks: number;
  outputBuffer: string[];
  // Buffer for partial JSONL lines from stdout.
  lineBuf: string;
  // Set true when an active tool_use is in flight; cleared on tool_result.
  inToolUse: boolean;
}

export class AgentManager extends EventEmitter {
  private agents = new Map<string, AgentProcess>();
  private workspaceRoot: string;
  private targetRepo: string | undefined;
  private claudeCmd: string;
  private maxConcurrent: number;
  private idleTimer: ReturnType<typeof setInterval> | null = null;

  constructor(opts: {
    workspaceRoot: string;
    targetRepo?: string;
    claudeCmd?: string;
    maxConcurrent?: number;
  }) {
    super();
    this.workspaceRoot = opts.workspaceRoot;
    this.targetRepo = opts.targetRepo;
    this.claudeCmd = opts.claudeCmd ?? 'claude';
    this.maxConcurrent = opts.maxConcurrent ?? 2;

    this.idleTimer = setInterval(() => this.checkIdleAgents(), 3000);
  }

  get runningCount(): number {
    return [...this.agents.values()].filter(
      (a) => a.state === 'typing' || a.state === 'thinking',
    ).length;
  }

  isRunning(roomId: string): boolean {
    return this.agents.has(roomId);
  }

  getState(roomId: string): AgentState {
    return this.agents.get(roomId)?.state ?? 'idle';
  }

  async start(roomId: string, prompt: string): Promise<boolean> {
    if (this.agents.has(roomId)) {
      this.emitTerminal(roomId, 'system', 'Agent already running for this room.');
      return false;
    }

    if (this.runningCount >= this.maxConcurrent) {
      this.emitTerminal(
        roomId,
        'system',
        `Max concurrent agents (${this.maxConcurrent}) reached. Queued.`,
      );
      return false;
    }

    const workDir = await this.ensureWorkspace(roomId);

    this.emitTerminal(roomId, 'system', `Starting Claude Code agent...`);
    this.emitTerminal(roomId, 'system', `Workspace: ${workDir}`);
    this.emitTerminal(roomId, 'system', `Prompt: ${prompt}`);

    // stream-json + --verbose makes claude emit newline-delimited JSON events
    // (assistant/user/tool_use/tool_result/result), letting us distinguish
    // 'executing' (tool_use in flight) from 'typing' (text streaming).
    const args = [
      '-p', prompt,
      '--output-format', 'stream-json',
      '--verbose',
      '--dangerously-skip-permissions',
    ];

    let cmd: string;
    let spawnArgs: string[];
    const parts = this.claudeCmd.split(/\s+/);
    cmd = parts[0];
    spawnArgs = [...parts.slice(1), ...args];

    const proc = spawn(cmd, spawnArgs, {
      cwd: workDir,
      env: {
        ...process.env,
        CLAUDE_CODE_MAX_OUTPUT_TOKENS: '19000',
        IS_SANDBOX: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const agent: AgentProcess = {
      roomId,
      proc,
      state: 'thinking',
      lastOutputAt: Date.now(),
      outputChunks: 0,
      outputBuffer: [],
      lineBuf: '',
      inToolUse: false,
    };
    this.agents.set(roomId, agent);
    this.updateState(roomId, 'thinking');

    proc.stdout?.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      agent.lastOutputAt = Date.now();
      agent.outputChunks++;
      agent.outputBuffer.push(text);

      // Newline-delimited JSON. Buffer partial lines across chunks.
      agent.lineBuf += text;
      const lines = agent.lineBuf.split('\n');
      agent.lineBuf = lines.pop() ?? '';
      for (const line of lines) {
        const t = line.trim();
        if (!t) continue;
        // If a line isn't JSON, treat as plain agent text.
        if (t[0] !== '{') {
          this.emitTerminal(roomId, 'agent', t);
          continue;
        }
        let evt: any;
        try {
          evt = JSON.parse(t);
        } catch {
          this.emitTerminal(roomId, 'agent', t);
          continue;
        }
        this.handleClaudeEvent(roomId, agent, evt);
      }
    });

    proc.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      agent.lastOutputAt = Date.now();
      for (const line of text.split('\n')) {
        if (line.trim()) this.emitTerminal(roomId, 'error', line);
      }
    });

    proc.on('error', (err) => {
      this.emitTerminal(roomId, 'error', `Failed to start: ${err.message}`);
      this.updateState(roomId, 'error');
      this.agents.delete(roomId);
    });

    proc.on('exit', (code, signal) => {
      const reason = signal ? `signal ${signal}` : `exit code ${code}`;
      const newState: AgentState = code === 0 ? 'success' : 'error';
      const fullOutput = agent.outputBuffer.join('');
      this.emitTerminal(roomId, 'system', `Agent finished (${reason})`);
      this.updateState(roomId, newState);
      this.emit('agent:done', { roomId, exitCode: code, output: fullOutput });
      this.agents.delete(roomId);
    });

    return true;
  }

  sendInput(roomId: string, _input: string): boolean {
    const agent = this.agents.get(roomId);
    if (!agent) return false;
    // stdin is closed (ignore) for claude -p mode; interactive input
    // is not supported in print mode. Return false to signal this.
    return false;
  }

  stop(roomId: string): boolean {
    const agent = this.agents.get(roomId);
    if (!agent) return false;
    agent.proc.kill('SIGTERM');
    setTimeout(() => {
      if (agent.proc.exitCode === null) agent.proc.kill('SIGKILL');
    }, 5000);
    this.emitTerminal(roomId, 'system', 'Agent stopped.');
    return true;
  }

  stopAll(): void {
    for (const [roomId] of this.agents) {
      this.stop(roomId);
    }
    if (this.idleTimer) clearInterval(this.idleTimer);
  }

  private async ensureWorkspace(roomId: string): Promise<string> {
    const dir = join(this.workspaceRoot, roomId);
    await mkdir(dir, { recursive: true });
    return this.targetRepo ?? dir;
  }

  private checkIdleAgents(): void {
    const now = Date.now();
    for (const [roomId, agent] of this.agents) {
      if (
        agent.state === 'typing' &&
        now - agent.lastOutputAt > 4000
      ) {
        this.updateState(roomId, 'thinking');
      }
    }
  }

  private updateState(roomId: string, state: AgentState): void {
    const agent = this.agents.get(roomId);
    if (agent) agent.state = state;
    this.emit('agent:state', { roomId, state });
  }

  // Map a Claude Code stream-json event to a state transition + terminal lines.
  // Event shapes (Claude Code 2.x):
  //   { type: 'system', subtype: 'init', ... }                                  no-op
  //   { type: 'assistant', message: { content: [{ type, ... }] } }              text or tool_use
  //   { type: 'user',      message: { content: [{ type: 'tool_result', ... }] } }
  //   { type: 'result', ... }                                                   final summary
  private handleClaudeEvent(roomId: string, agent: AgentProcess, evt: any): void {
    if (!evt || typeof evt !== 'object') return;
    if (evt.type === 'system') return;

    if (evt.type === 'assistant' && evt.message?.content) {
      let sawText = false;
      let sawTool = false;
      for (const c of evt.message.content) {
        if (!c) continue;
        if (c.type === 'tool_use') {
          sawTool = true;
          agent.inToolUse = true;
          const argsPreview =
            c.input && typeof c.input === 'object'
              ? Object.keys(c.input).slice(0, 3).join(', ')
              : '';
          this.emitTerminal(
            roomId,
            'system',
            `→ tool: ${c.name}${argsPreview ? ` (${argsPreview})` : ''}`,
          );
        } else if (c.type === 'text' && c.text) {
          sawText = true;
          for (const line of String(c.text).split('\n')) {
            if (line.trim()) this.emitTerminal(roomId, 'agent', line);
          }
        }
      }
      if (sawTool)      this.updateState(roomId, 'executing');
      else if (sawText) this.updateState(roomId, 'typing');
      return;
    }

    if (evt.type === 'user' && evt.message?.content) {
      let sawResult = false;
      for (const c of evt.message.content) {
        if (c?.type === 'tool_result') {
          sawResult = true;
          const isErr = c.is_error === true;
          const text = typeof c.content === 'string' ? c.content : '';
          const preview = text.split('\n')[0].slice(0, 120);
          this.emitTerminal(
            roomId,
            isErr ? 'error' : 'shell',
            `← ${isErr ? 'error' : 'result'}${preview ? `: ${preview}` : ''}`,
          );
        }
      }
      if (sawResult) {
        agent.inToolUse = false;
        this.updateState(roomId, 'thinking');
      }
      return;
    }

    // 'result' event: final summary — exit handler writes success/error.
  }

  private emitTerminal(roomId: string, kind: TerminalLine['kind'], text: string): void {
    this.emit('terminal:output', { roomId, kind, text } satisfies TerminalLine);
  }
}
