import {
  HttpStatus,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Notification, NotificationType } from './notification.entity';
import { NotificationQueryDto } from './dto/notification-query.dto';

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    @InjectRepository(Notification)
    private readonly notificationRepository: Repository<Notification>,
  ) {}

  async create(data: {
    type: NotificationType;
    recipient_id: string;
    actor_id: string;
    entity_type: string;
    entity_id: string;
    payload: Record<string, any>;
  }): Promise<Notification | null> {
    // Don't notify yourself
    if (data.recipient_id === data.actor_id) return null;

    const notification = this.notificationRepository.create(data);
    return this.notificationRepository.save(notification);
  }

  async createBatch(
    notifications: {
      type: NotificationType;
      recipient_id: string;
      actor_id: string;
      entity_type: string;
      entity_id: string;
      payload: Record<string, any>;
    }[],
  ): Promise<Notification[]> {
    // Filter out self-notifications
    const filtered = notifications.filter((n) => n.recipient_id !== n.actor_id);
    if (filtered.length === 0) return [];

    const entities = this.notificationRepository.create(filtered);
    return this.notificationRepository.save(entities);
  }

  async findByRecipient(
    recipientId: string,
    query: NotificationQueryDto,
  ): Promise<{
    data: Notification[];
    meta: { page: number; limit: number; total: number; totalPages: number };
  }> {
    try {
      const page = query.page ?? 1;
      const limit = query.limit ?? 20;

      const where: Record<string, any> = { recipient_id: recipientId };
      if (query.is_read !== undefined) where.is_read = query.is_read;
      if (query.type) where.type = query.type;

      const [data, total] = await this.notificationRepository.findAndCount({
        where,
        relations: ['actor'],
        order: { created_at: 'DESC' },
        skip: (page - 1) * limit,
        take: limit,
      });

      return {
        data,
        meta: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      };
    } catch (error) {
      this.logger.error(
        'Failed to fetch notifications',
        (error as Error).stack,
      );
      throw new InternalServerErrorException({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'Failed to fetch notifications',
        error: (error as Error).message,
      });
    }
  }

  async markAsRead(
    recipientId: string,
    notificationIds: string[],
  ): Promise<{ updated: number }> {
    if (notificationIds.length === 0) return { updated: 0 };

    try {
      const result = await this.notificationRepository.update(
        {
          id: In(notificationIds),
          recipient_id: recipientId,
          is_read: false,
        },
        {
          is_read: true,
          read_at: new Date(),
        },
      );
      return { updated: result.affected ?? 0 };
    } catch (error) {
      this.logger.error(
        'Failed to mark notifications as read',
        (error as Error).stack,
      );
      throw new InternalServerErrorException({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'Failed to mark notifications as read',
        error: (error as Error).message,
      });
    }
  }

  async markAllAsRead(recipientId: string): Promise<{ updated: number }> {
    try {
      const result = await this.notificationRepository.update(
        {
          recipient_id: recipientId,
          is_read: false,
        },
        {
          is_read: true,
          read_at: new Date(),
        },
      );
      return { updated: result.affected ?? 0 };
    } catch (error) {
      this.logger.error(
        'Failed to mark all notifications as read',
        (error as Error).stack,
      );
      throw new InternalServerErrorException({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'Failed to mark all notifications as read',
        error: (error as Error).message,
      });
    }
  }

  async getUnreadCount(recipientId: string): Promise<{ count: number }> {
    try {
      const count = await this.notificationRepository.count({
        where: {
          recipient_id: recipientId,
          is_read: false,
        },
      });
      return { count };
    } catch (error) {
      this.logger.error('Failed to get unread count', (error as Error).stack);
      throw new InternalServerErrorException({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'Failed to get unread count',
        error: (error as Error).message,
      });
    }
  }

  async remove(id: string, recipientId: string): Promise<void> {
    try {
      const notification = await this.notificationRepository.findOneBy({
        id,
        recipient_id: recipientId,
      });
      if (!notification) {
        throw new NotFoundException({
          statusCode: HttpStatus.NOT_FOUND,
          message: `Notification with id "${id}" not found`,
        });
      }
      await this.notificationRepository.remove(notification);
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      this.logger.error(
        'Failed to delete notification',
        (error as Error).stack,
      );
      throw new InternalServerErrorException({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'Failed to delete notification',
        error: (error as Error).message,
      });
    }
  }
}
