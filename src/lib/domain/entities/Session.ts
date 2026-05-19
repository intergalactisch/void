/**
 * Session - groups notes that participated in an AI batch operation
 * (thread, synthesize, bridge, extract, deep-research, swarm) or a manual user grouping.
 *
 * Sessions are first-class artefacts: a note can belong to multiple sessions,
 * each session knows its members and (when AI-led) the run that produced it.
 *
 * Pure domain code — no I/O, no adapter imports.
 */

export type SessionKind =
  | 'thread'
  | 'synthesize'
  | 'bridge'
  | 'extract'
  | 'deep-research'
  | 'swarm'
  | 'manual';

export type SessionType = 'ai-batch' | 'research-session' | 'manual-group';

export type SessionRole = 'source' | 'derived' | 'touched' | 'context';

export type SessionStatus = 'active' | 'completed' | 'failed' | 'cancelled';

export interface SessionMember {
  notePath: string;
  role: SessionRole;
  addedAt: string;
}

export interface Session {
  id: string;
  type: SessionType;
  kind: SessionKind;
  title: string;
  topic?: string;
  status: SessionStatus;
  agentRunId?: string;
  conversationId?: string;
  toolId?: string;
  members: SessionMember[];
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  createdBy: 'user' | 'ai-agent' | 'tool';
}

export interface CreateSessionParams {
  id?: string;
  type: SessionType;
  kind: SessionKind;
  title: string;
  topic?: string;
  agentRunId?: string;
  conversationId?: string;
  toolId?: string;
  members: Array<{ notePath: string; role: SessionRole }>;
  status?: SessionStatus;
  createdBy?: Session['createdBy'];
}

export function createSession(params: CreateSessionParams): Session {
  const now = new Date().toISOString();
  const id = params.id ?? `sess_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  const session: Session = {
    id,
    type: params.type,
    kind: params.kind,
    title: params.title,
    status: params.status ?? 'active',
    members: params.members.map((m) => ({ notePath: m.notePath, role: m.role, addedAt: now })),
    createdAt: now,
    updatedAt: now,
    createdBy: params.createdBy ?? 'ai-agent',
  };
  if (params.topic !== undefined) session.topic = params.topic;
  if (params.agentRunId !== undefined) session.agentRunId = params.agentRunId;
  if (params.conversationId !== undefined) session.conversationId = params.conversationId;
  if (params.toolId !== undefined) session.toolId = params.toolId;
  return session;
}

export function addSessionMember(
  session: Session,
  notePath: string,
  role: SessionRole
): Session {
  if (session.members.some((m) => m.notePath === notePath)) return session;
  const now = new Date().toISOString();
  return {
    ...session,
    members: [...session.members, { notePath, role, addedAt: now }],
    updatedAt: now,
  };
}

export function removeSessionMember(session: Session, notePath: string): Session {
  if (!session.members.some((m) => m.notePath === notePath)) return session;
  const now = new Date().toISOString();
  return {
    ...session,
    members: session.members.filter((m) => m.notePath !== notePath),
    updatedAt: now,
  };
}

export function renameSessionMember(
  session: Session,
  oldPath: string,
  newPath: string
): Session {
  if (!session.members.some((m) => m.notePath === oldPath)) return session;
  const now = new Date().toISOString();
  return {
    ...session,
    members: session.members.map((m) =>
      m.notePath === oldPath ? { ...m, notePath: newPath } : m
    ),
    updatedAt: now,
  };
}

export function setSessionStatus(session: Session, status: SessionStatus): Session {
  const now = new Date().toISOString();
  const next: Session = { ...session, status, updatedAt: now };
  if (status === 'completed' || status === 'failed' || status === 'cancelled') {
    next.completedAt = now;
  }
  return next;
}
