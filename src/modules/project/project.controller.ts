import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
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
import { ParseProjectIdPipe } from '../../common/pipes/parse-project-id.pipe';
import { ProjectService } from './project.service';
import { Project } from './project.entity';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { ManageProjectMembersDto } from './dto/manage-project-members.dto';

@ApiTags('Projects')
@Controller('projects')
export class ProjectController {
  constructor(private readonly projectService: ProjectService) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a project' })
  @ApiResponse({
    status: 201,
    description: 'Project created',
    type: Project,
  })
  @ApiResponse({ status: 409, description: 'Project name already exists' })
  create(@Body() dto: CreateProjectDto, @CurrentUser('id') userId: string) {
    return this.projectService.create(dto, userId);
  }

  @Get()
  @ApiOperation({ summary: 'Get all projects' })
  @ApiResponse({
    status: 200,
    description: 'List of projects',
    type: [Project],
  })
  findAll() {
    return this.projectService.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a project by ID' })
  @ApiParam({ name: 'id', description: 'Project ID' })
  @ApiResponse({
    status: 200,
    description: 'Project found',
    type: Project,
  })
  @ApiResponse({ status: 404, description: 'Project not found' })
  findOne(@Param('id', ParseProjectIdPipe) id: string) {
    return this.projectService.findOneById(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a project' })
  @ApiParam({ name: 'id', description: 'Project ID' })
  @ApiResponse({
    status: 200,
    description: 'Project updated',
    type: Project,
  })
  @ApiResponse({ status: 404, description: 'Project not found' })
  @ApiResponse({ status: 409, description: 'Project name already exists' })
  update(
    @Param('id', ParseProjectIdPipe) id: string,
    @Body() dto: UpdateProjectDto,
  ) {
    return this.projectService.update(id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a project' })
  @ApiParam({ name: 'id', description: 'Project ID' })
  @ApiResponse({ status: 200, description: 'Project deleted' })
  @ApiResponse({ status: 404, description: 'Project not found' })
  remove(@Param('id', ParseProjectIdPipe) id: string) {
    return this.projectService.remove(id);
  }

  // --- Project Members ---

  @Get(':id/members')
  @ApiOperation({ summary: 'Get project members' })
  @ApiParam({ name: 'id', description: 'Project ID' })
  @ApiResponse({ status: 200, description: 'List of project members' })
  @ApiResponse({ status: 404, description: 'Project not found' })
  getMembers(@Param('id', ParseProjectIdPipe) id: string) {
    return this.projectService.getMembers(id);
  }

  @Post(':id/members')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Add members to a project (requires admin+)' })
  @ApiParam({ name: 'id', description: 'Project ID' })
  @ApiResponse({ status: 201, description: 'Members added' })
  @ApiResponse({ status: 403, description: 'Insufficient project role' })
  @ApiResponse({ status: 404, description: 'Project or user not found' })
  addMembers(
    @Param('id', ParseProjectIdPipe) id: string,
    @Body() dto: ManageProjectMembersDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.projectService.addMembers(id, dto.user_ids, userId);
  }

  @Delete(':id/members')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Remove members from a project (requires admin+)' })
  @ApiParam({ name: 'id', description: 'Project ID' })
  @ApiResponse({ status: 204, description: 'Members removed' })
  @ApiResponse({ status: 403, description: 'Insufficient project role' })
  @ApiResponse({ status: 404, description: 'Project not found' })
  removeMembers(
    @Param('id', ParseProjectIdPipe) id: string,
    @Body() dto: ManageProjectMembersDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.projectService.removeMembers(id, dto.user_ids, userId);
  }
}
