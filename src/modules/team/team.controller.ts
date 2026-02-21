import { Controller, Get, Param, ParseIntPipe } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { TeamService } from './team.service';
import { Team } from './team.entity';

@ApiTags('Teams')
@Controller('teams')
export class TeamController {
  constructor(private readonly teamService: TeamService) {}

  @Get()
  @ApiOperation({ summary: 'Get all teams' })
  @ApiResponse({ status: 200, description: 'List of teams', type: [Team] })
  findAll() {
    return this.teamService.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a team by ID' })
  @ApiParam({ name: 'id', description: 'Team ID' })
  @ApiResponse({ status: 200, description: 'Team found', type: Team })
  @ApiResponse({ status: 404, description: 'Team not found' })
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.teamService.findOneById(id);
  }

  @Get(':id/members')
  @ApiOperation({ summary: 'Get team members' })
  @ApiParam({ name: 'id', description: 'Team ID' })
  @ApiResponse({ status: 200, description: 'Team with members', type: Team })
  @ApiResponse({ status: 404, description: 'Team not found' })
  findMembers(@Param('id', ParseIntPipe) id: number) {
    return this.teamService.findWithMembers(id);
  }
}
