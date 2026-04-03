import {
  Controller,
  Get,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  ParseUUIDPipe,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { NotificationService } from './notification.service';
import { NotificationQueryDto } from './dto/notification-query.dto';
import { MarkNotificationsReadDto } from './dto/mark-notifications-read.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@ApiTags('Notifications')
@Controller('notifications')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class NotificationController {
  constructor(private readonly notificationService: NotificationService) {}

  @Get()
  @ApiOperation({
    summary: 'Get notifications for the current user (paginated)',
  })
  @ApiResponse({ status: 200, description: 'Paginated list of notifications' })
  findAll(
    @CurrentUser('id') userId: string,
    @Query() query: NotificationQueryDto,
  ) {
    return this.notificationService.findByRecipient(userId, query);
  }

  @Get('unread-count')
  @ApiOperation({ summary: 'Get unread notification count' })
  @ApiResponse({ status: 200, description: 'Unread count' })
  getUnreadCount(@CurrentUser('id') userId: string) {
    return this.notificationService.getUnreadCount(userId);
  }

  @Patch('read')
  @ApiOperation({ summary: 'Mark specific notifications as read' })
  @ApiResponse({ status: 200, description: 'Notifications marked as read' })
  markAsRead(
    @CurrentUser('id') userId: string,
    @Body() dto: MarkNotificationsReadDto,
  ) {
    return this.notificationService.markAsRead(userId, dto.ids);
  }

  @Patch('read-all')
  @ApiOperation({ summary: 'Mark all notifications as read' })
  @ApiResponse({ status: 200, description: 'All notifications marked as read' })
  markAllAsRead(@CurrentUser('id') userId: string) {
    return this.notificationService.markAllAsRead(userId);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a notification' })
  @ApiParam({ name: 'id', description: 'Notification UUID' })
  @ApiResponse({ status: 204, description: 'Notification deleted' })
  @ApiResponse({ status: 404, description: 'Notification not found' })
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.notificationService.remove(id, userId);
  }
}
