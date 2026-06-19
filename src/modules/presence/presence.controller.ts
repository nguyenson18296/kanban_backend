import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { GetPresenceQueryDto } from './dto/get-presence.dto';
import {
  PresenceListResponseDto,
  PresenceStateDto,
} from './dto/presence-state.dto';
import { PresenceService } from './presence.service';

@ApiTags('Presence')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('presence')
export class PresenceController {
  constructor(private readonly presenceService: PresenceService) {}

  @Get()
  @ApiOperation({ summary: 'Bulk presence lookup' })
  @ApiResponse({ status: 200, type: PresenceListResponseDto })
  getMany(@Query() query: GetPresenceQueryDto): PresenceListResponseDto {
    const items = this.presenceService.getOnlineStates(query.userIds);
    return { items };
  }

  @Get('me')
  @ApiOperation({ summary: 'Current user presence' })
  @ApiResponse({ status: 200, type: PresenceStateDto })
  getMe(@CurrentUser('id') userId: string): PresenceStateDto {
    const [state] = this.presenceService.getOnlineStates([userId]);
    return state;
  }
}
