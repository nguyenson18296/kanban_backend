import {
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Task } from '../task/task.entity';
import {
  TaskSubscription,
  SubscriptionSource,
} from './task-subscription.entity';

export interface SubscriptionStatus {
  subscribed: boolean;
  source: SubscriptionSource | null;
  since: string | null;
}

@Injectable()
export class SubscriptionService {
  private readonly logger = new Logger(SubscriptionService.name);

  constructor(
    @InjectRepository(TaskSubscription)
    private readonly subscriptionRepository: Repository<TaskSubscription>,
    @InjectRepository(Task)
    private readonly taskRepository: Repository<Task>,
  ) {}

  /**
   * Core idempotent insert (ON CONFLICT DO NOTHING). On conflict the existing
   * row — and its original source — is preserved. Shared by the best-effort and
   * strict variants below.
   */
  private async insertSubscription(
    taskId: string,
    userId: string,
    source: SubscriptionSource,
  ): Promise<void> {
    await this.subscriptionRepository
      .createQueryBuilder()
      .insert()
      .into(TaskSubscription)
      .values({ task_id: taskId, user_id: userId, source })
      .orIgnore()
      .execute();
  }

  /**
   * Best-effort subscribe for auto-subscribe SIDE EFFECTS (comment / assignment
   * / create). A failure is logged and swallowed so it never turns the primary
   * mutation into a 500. Use `subscribeStrict` for controller-driven flows.
   */
  async subscribe(
    taskId: string,
    userId: string,
    source: SubscriptionSource,
  ): Promise<void> {
    try {
      await this.insertSubscription(taskId, userId, source);
    } catch (error) {
      this.logger.error(
        `Failed to subscribe user ${userId} to task ${taskId}`,
        (error as Error).stack,
      );
    }
  }

  /**
   * Strict subscribe for CONTROLLER-DRIVEN flows (the manual "watch" endpoint).
   * Rethrows on failure so the API surfaces a real error instead of a false
   * 201. Idempotent: an already-subscribed user is a no-op, not an error.
   */
  async subscribeStrict(
    taskId: string,
    userId: string,
    source: SubscriptionSource,
  ): Promise<void> {
    await this.insertSubscription(taskId, userId, source);
  }

  /**
   * Idempotently subscribe many users to a task in a single insert. No-op on
   * an empty list. Resilient (see subscribe()).
   */
  async subscribeMany(
    taskId: string,
    userIds: string[],
    source: SubscriptionSource,
  ): Promise<void> {
    const unique = [...new Set(userIds)];
    if (unique.length === 0) return;
    try {
      await this.subscriptionRepository
        .createQueryBuilder()
        .insert()
        .into(TaskSubscription)
        .values(unique.map((user_id) => ({ task_id: taskId, user_id, source })))
        .orIgnore()
        .execute();
    } catch (error) {
      this.logger.error(
        `Failed to subscribe users to task ${taskId}`,
        (error as Error).stack,
      );
    }
  }

  async unsubscribe(taskId: string, userId: string): Promise<void> {
    await this.subscriptionRepository.delete({
      task_id: taskId,
      user_id: userId,
    });
  }

  async isSubscribed(taskId: string, userId: string): Promise<boolean> {
    return this.subscriptionRepository.existsBy({
      task_id: taskId,
      user_id: userId,
    });
  }

  async getMyStatus(
    taskId: string,
    userId: string,
  ): Promise<SubscriptionStatus> {
    const sub = await this.subscriptionRepository.findOneBy({
      task_id: taskId,
      user_id: userId,
    });
    return sub
      ? {
          subscribed: true,
          source: sub.source,
          since: sub.created_at.toISOString(),
        }
      : { subscribed: false, source: null, since: null };
  }

  /**
   * Returns the user ids subscribed to a task. Resilient: returns [] on error
   * so a fan-out never fails the triggering mutation.
   */
  async getSubscriberIds(taskId: string): Promise<string[]> {
    try {
      const rows = await this.subscriptionRepository.find({
        where: { task_id: taskId },
        select: ['user_id'],
      });
      return rows.map((r) => r.user_id);
    } catch (error) {
      this.logger.error(
        `Failed to load subscribers for task ${taskId}`,
        (error as Error).stack,
      );
      return [];
    }
  }

  async listSubscribers(taskId: string): Promise<TaskSubscription[]> {
    return this.subscriptionRepository.find({
      where: { task_id: taskId },
      relations: ['user'],
      order: { created_at: 'ASC' },
    });
  }

  async ensureTaskExists(taskId: string): Promise<void> {
    const exists = await this.taskRepository.existsBy({ id: taskId });
    if (!exists) {
      throw new NotFoundException({
        statusCode: HttpStatus.NOT_FOUND,
        message: `Task with id "${taskId}" not found`,
      });
    }
  }
}
