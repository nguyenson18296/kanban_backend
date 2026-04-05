import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
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
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { TaskService } from './task.service';
import { Task } from './task.entity';
import { CreateTaskDto } from './dto/create-task.dto';
import { CreateSubtaskDto } from './dto/create-subtask.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { ManageAssigneesDto } from './dto/manage-assignees.dto';
import { ManageLabelsDto } from './dto/manage-labels.dto';
import { ReorderTaskDto } from './dto/reorder-task.dto';
import { ReorderSubtaskDto } from './dto/reorder-subtask.dto';
import { MoveTaskDto } from './dto/move-task.dto';
import { SubtaskListResponseDto } from './dto/subtask-list-response.dto';

@ApiTags('Tasks')
@Controller('tasks')
export class TaskController {
  constructor(private readonly taskService: TaskService) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a task' })
  @ApiResponse({ status: 201, description: 'Task created', type: Task })
  create(@Body() dto: CreateTaskDto, @CurrentUser('id') userId: string) {
    return this.taskService.create(dto, userId);
  }

  @Get()
  @ApiOperation({ summary: 'Get all tasks' })
  @ApiResponse({ status: 200, description: 'List of tasks', type: [Task] })
  findAll() {
    return this.taskService.findAll();
  }

  @Get('by-ticket/:ticketId')
  @ApiOperation({ summary: 'Get a task by ticket ID (e.g. KAN-1)' })
  @ApiParam({ name: 'ticketId', description: 'Ticket ID (e.g. KAN-1, WEB-3)' })
  @ApiResponse({ status: 200, description: 'Task found', type: Task })
  @ApiResponse({ status: 404, description: 'Task not found' })
  findByTicketId(@Param('ticketId') ticketId: string) {
    return this.taskService.findByTicketId(ticketId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a task by ID' })
  @ApiParam({ name: 'id', description: 'Task UUID' })
  @ApiResponse({ status: 200, description: 'Task found', type: Task })
  @ApiResponse({ status: 404, description: 'Task not found' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.taskService.findOneById(id);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update a task' })
  @ApiParam({ name: 'id', description: 'Task UUID' })
  @ApiResponse({ status: 200, description: 'Task updated', type: Task })
  @ApiResponse({ status: 404, description: 'Task not found' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTaskDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.taskService.update(id, dto, userId);
  }

  @Patch(':id/reorder')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Reorder a task within the same column' })
  @ApiParam({ name: 'id', description: 'Task UUID' })
  @ApiResponse({ status: 200, description: 'Task reordered', type: Task })
  @ApiResponse({ status: 404, description: 'Task not found' })
  reorder(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReorderTaskDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.taskService.reorder(id, dto.position, userId);
  }

  @Patch(':id/move')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Move a task to a different column' })
  @ApiParam({ name: 'id', description: 'Task UUID' })
  @ApiResponse({ status: 200, description: 'Task moved', type: Task })
  @ApiResponse({ status: 404, description: 'Task or column not found' })
  move(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MoveTaskDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.taskService.move(id, dto.column_id, dto.position, userId);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a task' })
  @ApiParam({ name: 'id', description: 'Task UUID' })
  @ApiResponse({ status: 200, description: 'Task deleted' })
  @ApiResponse({ status: 404, description: 'Task not found' })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.taskService.remove(id);
  }

  @Post(':id/subtasks')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a subtask under a parent task' })
  @ApiParam({ name: 'id', description: 'Parent task UUID' })
  @ApiResponse({ status: 201, description: 'Subtask created', type: Task })
  @ApiResponse({
    status: 400,
    description: 'Cannot nest subtasks deeper than 1 level',
  })
  @ApiResponse({ status: 404, description: 'Parent task not found' })
  createSubtask(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateSubtaskDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.taskService.createSubtask(id, dto, userId);
  }

  @Get(':id/subtasks')
  @ApiOperation({ summary: 'List all subtasks of a task' })
  @ApiParam({ name: 'id', description: 'Parent task UUID' })
  @ApiResponse({
    status: 200,
    description: 'List of subtasks',
    type: SubtaskListResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Task not found' })
  findSubtasks(@Param('id', ParseUUIDPipe) id: string) {
    return this.taskService.findSubtasks(id);
  }

  @Patch(':id/subtasks/:subtaskId/reorder')
  @ApiOperation({ summary: 'Reorder a subtask within its parent' })
  @ApiParam({ name: 'id', description: 'Parent task UUID' })
  @ApiParam({ name: 'subtaskId', description: 'Subtask UUID' })
  @ApiResponse({ status: 200, description: 'Subtask reordered', type: Task })
  @ApiResponse({
    status: 400,
    description: 'Subtask does not belong to parent',
  })
  @ApiResponse({ status: 404, description: 'Task or subtask not found' })
  reorderSubtask(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('subtaskId', ParseUUIDPipe) subtaskId: string,
    @Body() dto: ReorderSubtaskDto,
  ) {
    return this.taskService.reorderSubtask(id, subtaskId, dto.position);
  }

  @Post(':id/assignees')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Add assignees to a task' })
  @ApiParam({ name: 'id', description: 'Task UUID' })
  @ApiResponse({ status: 201, description: 'Assignees added', type: Task })
  @ApiResponse({ status: 404, description: 'Task not found' })
  addAssignees(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ManageAssigneesDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.taskService.addAssignees(id, dto.user_ids, userId);
  }

  @Delete(':id/assignees')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Remove assignees from a task' })
  @ApiParam({ name: 'id', description: 'Task UUID' })
  @ApiResponse({ status: 200, description: 'Assignees removed', type: Task })
  @ApiResponse({ status: 404, description: 'Task not found' })
  removeAssignees(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ManageAssigneesDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.taskService.removeAssignees(id, dto.user_ids, userId);
  }

  @Post(':id/labels')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Add labels to a task' })
  @ApiParam({ name: 'id', description: 'Task UUID' })
  @ApiResponse({ status: 201, description: 'Labels added', type: Task })
  @ApiResponse({ status: 404, description: 'Task not found' })
  addLabels(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ManageLabelsDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.taskService.addLabels(id, dto.label_ids, userId);
  }

  @Delete(':id/labels')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Remove labels from a task' })
  @ApiParam({ name: 'id', description: 'Task UUID' })
  @ApiResponse({ status: 200, description: 'Labels removed', type: Task })
  @ApiResponse({ status: 404, description: 'Task not found' })
  removeLabels(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ManageLabelsDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.taskService.removeLabels(id, dto.label_ids, userId);
  }
}
