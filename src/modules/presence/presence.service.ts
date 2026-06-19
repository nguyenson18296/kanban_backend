import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EventsGateway } from '../events/events.gateway';
import { ProjectMember } from '../project/project-member.entity';
import { PRESENCE_EVENTS } from './events/presence.events';
import type {
  WsConnectionClosedEvent,
  WsConnectionOpenedEvent,
} from './events/presence.events';

export interface PresenceState {
  userId: string;
  isOnline: boolean;
  connectionCount: number;
  lastChangedAt: string | null;
}

@Injectable()
export class PresenceService {
  private readonly logger = new Logger(PresenceService.name);
  private readonly connections = new Map<string, Set<string>>();
  private readonly userProjects = new Map<string, Set<string>>();
  private readonly userProjectsPending = new Map<
    string,
    Promise<Set<string>>
  >();
  private readonly lastChangedAt = new Map<string, string>();

  constructor(
    private readonly eventsGateway: EventsGateway,
    @InjectRepository(ProjectMember)
    private readonly projectMemberRepository: Repository<ProjectMember>,
  ) {}

  @OnEvent(PRESENCE_EVENTS.WS_CONNECTION_OPENED, { async: true })
  async handleConnectionOpened(event: WsConnectionOpenedEvent): Promise<void> {
    const { userId, socketId } = event;

    const sockets = this.connections.get(userId) ?? new Set<string>();
    const isFirstSocket = sockets.size === 0;
    sockets.add(socketId);
    this.connections.set(userId, sockets);

    if (isFirstSocket) {
      this.lastChangedAt.set(userId, new Date().toISOString());

      // Store the in-flight Promise BEFORE awaiting so concurrent connects for
      // the same user can await the same query instead of racing past it with
      // an empty `userProjects` entry.
      const fetchPromise = this.projectMemberRepository
        .find({
          where: { user_id: userId },
          select: ['project_id'],
        })
        .then((memberships) => {
          const set = new Set(memberships.map((m) => m.project_id));
          this.userProjects.set(userId, set);
          return set;
        });
      this.userProjectsPending.set(userId, fetchPromise);
    }

    const pending = this.userProjectsPending.get(userId);
    if (pending !== undefined) await pending;

    const rooms = Array.from(this.userProjects.get(userId) ?? []).map(
      (id) => `project:${id}`,
    );
    if (rooms.length === 0) return;

    this.eventsGateway.server.in(socketId).socketsJoin(rooms);

    if (isFirstSocket) {
      this.broadcastPresence(userId, true, sockets.size, rooms);
    }
  }

  @OnEvent(PRESENCE_EVENTS.WS_CONNECTION_CLOSED, { async: true })
  handleConnectionClosed(event: WsConnectionClosedEvent): void {
    const { userId, socketId } = event;
    const sockets = this.connections.get(userId);
    if (!sockets?.has(socketId)) return;

    sockets.delete(socketId);
    if (sockets.size > 0) return;

    this.lastChangedAt.set(userId, new Date().toISOString());

    const projectIds = this.userProjects.get(userId);
    this.connections.delete(userId);
    this.userProjects.delete(userId);
    this.userProjectsPending.delete(userId);

    if (!projectIds || projectIds.size === 0) return;
    const rooms = Array.from(projectIds).map((id) => `project:${id}`);
    this.broadcastPresence(userId, false, 0, rooms);
  }

  isOnline(userId: string): boolean {
    return (this.connections.get(userId)?.size ?? 0) > 0;
  }

  getConnectionCount(userId: string): number {
    return this.connections.get(userId)?.size ?? 0;
  }

  getOnlineStates(userIds: string[]): PresenceState[] {
    return userIds.map((userId) => ({
      userId,
      isOnline: this.isOnline(userId),
      connectionCount: this.getConnectionCount(userId),
      lastChangedAt: this.lastChangedAt.get(userId) ?? null,
    }));
  }

  private broadcastPresence(
    userId: string,
    isOnline: boolean,
    connectionCount: number,
    rooms: string[],
  ): void {
    const payload = {
      userId,
      isOnline,
      connectionCount,
      timestamp: new Date().toISOString(),
    };
    for (const room of rooms) {
      this.eventsGateway.server.to(room).emit('presence:update', payload);
    }
  }
}
