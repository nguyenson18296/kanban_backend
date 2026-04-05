import {
  Controller,
  Get,
  Param,
  Query,
  ParseUUIDPipe,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { ActivityService } from './activity.service';
import { ActivityQueryDto } from './dto/activity-query.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@ApiTags('Task Activities')
@Controller('tasks')
export class ActivityController {
  constructor(private readonly activityService: ActivityService) {}

  @Get(':taskId/activities')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get activity history for a task (paginated)' })
  @ApiParam({ name: 'taskId', description: 'Task UUID' })
  @ApiResponse({
    status: 200,
    description: 'Paginated list of task activities',
  })
  @ApiResponse({ status: 404, description: 'Task not found' })
  findByTask(
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Query() query: ActivityQueryDto,
  ) {
    return this.activityService.findByTask(taskId, query);
  }
}
