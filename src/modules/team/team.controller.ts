import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  ParseIntPipe,
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
import { ParseProjectIdPipe } from '../../common/pipes/parse-project-id.pipe';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { TeamService } from './team.service';
import { CreateTeamDto } from './dto/create-team.dto';
import { AddTeamMemberDto } from './dto/add-team-member.dto';

@ApiTags('Project Teams')
@Controller('projects/:projectId/teams')
export class TeamController {
  constructor(private readonly teamService: TeamService) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a team in a project (requires admin+)' })
  @ApiParam({ name: 'projectId', description: 'Project ID' })
  @ApiResponse({ status: 201, description: 'Team created' })
  @ApiResponse({ status: 403, description: 'Insufficient project role' })
  @ApiResponse({ status: 404, description: 'Project not found' })
  @ApiResponse({
    status: 409,
    description: 'Team name already exists in project',
  })
  create(
    @Param('projectId', ParseProjectIdPipe) projectId: string,
    @Body() dto: CreateTeamDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.teamService.create(projectId, dto, userId);
  }

  @Get()
  @ApiOperation({ summary: 'List all teams in a project' })
  @ApiParam({ name: 'projectId', description: 'Project ID' })
  @ApiResponse({ status: 200, description: 'List of teams' })
  @ApiResponse({ status: 404, description: 'Project not found' })
  findAll(@Param('projectId', ParseProjectIdPipe) projectId: string) {
    return this.teamService.findAllByProject(projectId);
  }

  @Get(':teamId')
  @ApiOperation({ summary: 'Get a team by ID' })
  @ApiParam({ name: 'projectId', description: 'Project ID' })
  @ApiParam({ name: 'teamId', description: 'Team ID' })
  @ApiResponse({ status: 200, description: 'Team found' })
  @ApiResponse({ status: 404, description: 'Team not found' })
  findOne(
    @Param('projectId', ParseProjectIdPipe) projectId: string,
    @Param('teamId', ParseIntPipe) teamId: number,
  ) {
    return this.teamService.findOneById(projectId, teamId);
  }

  @Get(':teamId/members')
  @ApiOperation({ summary: 'List team members' })
  @ApiParam({ name: 'projectId', description: 'Project ID' })
  @ApiParam({ name: 'teamId', description: 'Team ID' })
  @ApiResponse({ status: 200, description: 'List of team members' })
  @ApiResponse({ status: 404, description: 'Team not found' })
  getMembers(
    @Param('projectId', ParseProjectIdPipe) projectId: string,
    @Param('teamId', ParseIntPipe) teamId: number,
  ) {
    return this.teamService.getMembers(projectId, teamId);
  }

  @Post(':teamId/members')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Add a member to a team (requires admin+)' })
  @ApiParam({ name: 'projectId', description: 'Project ID' })
  @ApiParam({ name: 'teamId', description: 'Team ID' })
  @ApiResponse({ status: 201, description: 'Member added' })
  @ApiResponse({ status: 400, description: 'User is not a project member' })
  @ApiResponse({ status: 403, description: 'Insufficient project role' })
  @ApiResponse({ status: 404, description: 'Team not found' })
  @ApiResponse({
    status: 409,
    description: 'User already in a team in this project',
  })
  addMember(
    @Param('projectId', ParseProjectIdPipe) projectId: string,
    @Param('teamId', ParseIntPipe) teamId: number,
    @Body() dto: AddTeamMemberDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.teamService.addMember(projectId, teamId, dto.user_id, userId);
  }

  @Delete(':teamId/members/:userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Remove a member from a team (requires admin+)' })
  @ApiParam({ name: 'projectId', description: 'Project ID' })
  @ApiParam({ name: 'teamId', description: 'Team ID' })
  @ApiParam({ name: 'userId', description: 'User UUID' })
  @ApiResponse({ status: 204, description: 'Member removed' })
  @ApiResponse({ status: 403, description: 'Insufficient project role' })
  @ApiResponse({ status: 404, description: 'Team not found' })
  removeMember(
    @Param('projectId', ParseProjectIdPipe) projectId: string,
    @Param('teamId', ParseIntPipe) teamId: number,
    @Param('userId', ParseUUIDPipe) targetUserId: string,
    @CurrentUser('id') actorId: string,
  ) {
    return this.teamService.removeMember(
      projectId,
      teamId,
      targetUserId,
      actorId,
    );
  }
}
