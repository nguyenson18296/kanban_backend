import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
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
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { SubscriptionService } from './subscription.service';
import { SubscriptionSource } from './task-subscription.entity';
import {
  SubscriptionStatusDto,
  SubscriberListResponseDto,
} from './dto/subscription-response.dto';

@ApiTags('Task Subscriptions')
@Controller('tasks')
export class SubscriptionController {
  constructor(private readonly subscriptionService: SubscriptionService) {}

  @Post(':taskId/subscription')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Subscribe (watch) a task' })
  @ApiParam({ name: 'taskId', description: 'Task UUID' })
  @ApiResponse({ status: 201, type: SubscriptionStatusDto })
  @ApiResponse({ status: 404, description: 'Task not found' })
  async subscribe(
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @CurrentUser('id') userId: string,
  ): Promise<SubscriptionStatusDto> {
    await this.subscriptionService.ensureTaskExists(taskId);
    await this.subscriptionService.subscribeStrict(
      taskId,
      userId,
      SubscriptionSource.MANUAL,
    );
    return this.subscriptionService.getMyStatus(taskId, userId);
  }

  @Delete(':taskId/subscription')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Unsubscribe from a task' })
  @ApiParam({ name: 'taskId', description: 'Task UUID' })
  @ApiResponse({ status: 204, description: 'Unsubscribed' })
  @ApiResponse({ status: 404, description: 'Task not found' })
  async unsubscribe(
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @CurrentUser('id') userId: string,
  ): Promise<void> {
    await this.subscriptionService.ensureTaskExists(taskId);
    await this.subscriptionService.unsubscribe(taskId, userId);
  }

  @Get(':taskId/subscription/me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get my subscription status for a task' })
  @ApiParam({ name: 'taskId', description: 'Task UUID' })
  @ApiResponse({ status: 200, type: SubscriptionStatusDto })
  @ApiResponse({ status: 404, description: 'Task not found' })
  async getMyStatus(
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @CurrentUser('id') userId: string,
  ): Promise<SubscriptionStatusDto> {
    await this.subscriptionService.ensureTaskExists(taskId);
    return this.subscriptionService.getMyStatus(taskId, userId);
  }

  @Get(':taskId/subscribers')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List all subscribers of a task' })
  @ApiParam({ name: 'taskId', description: 'Task UUID' })
  @ApiResponse({ status: 200, type: SubscriberListResponseDto })
  @ApiResponse({ status: 404, description: 'Task not found' })
  async listSubscribers(
    @Param('taskId', ParseUUIDPipe) taskId: string,
  ): Promise<SubscriberListResponseDto> {
    await this.subscriptionService.ensureTaskExists(taskId);
    const subscriptions =
      await this.subscriptionService.listSubscribers(taskId);
    return {
      items: subscriptions.map((s) => ({
        user_id: s.user_id,
        full_name: s.user?.full_name ?? '',
        avatar_url: s.user?.avatar_url ?? null,
        source: s.source,
        created_at: s.created_at.toISOString(),
      })),
    };
  }
}
