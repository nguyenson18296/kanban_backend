import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam } from '@nestjs/swagger';
import { TaskService } from './task.service';
import { Task } from './task.entity';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { ManageAssigneesDto } from './dto/manage-assignees.dto';
import { ManageLabelsDto } from './dto/manage-labels.dto';

@ApiTags('Tasks')
@Controller('tasks')
export class TaskController {
  constructor(private readonly taskService: TaskService) {}

  @Post()
  @ApiOperation({ summary: 'Create a task' })
  @ApiResponse({ status: 201, description: 'Task created', type: Task })
  create(@Body() dto: CreateTaskDto) {
    return this.taskService.create(dto);
  }

  @Get()
  @ApiOperation({ summary: 'Get all tasks' })
  @ApiResponse({ status: 200, description: 'List of tasks', type: [Task] })
  findAll() {
    return this.taskService.findAll();
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
  @ApiOperation({ summary: 'Update a task' })
  @ApiParam({ name: 'id', description: 'Task UUID' })
  @ApiResponse({ status: 200, description: 'Task updated', type: Task })
  @ApiResponse({ status: 404, description: 'Task not found' })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateTaskDto) {
    return this.taskService.update(id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a task' })
  @ApiParam({ name: 'id', description: 'Task UUID' })
  @ApiResponse({ status: 200, description: 'Task deleted' })
  @ApiResponse({ status: 404, description: 'Task not found' })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.taskService.remove(id);
  }

  @Post(':id/assignees')
  @ApiOperation({ summary: 'Add assignees to a task' })
  @ApiParam({ name: 'id', description: 'Task UUID' })
  @ApiResponse({ status: 201, description: 'Assignees added', type: Task })
  @ApiResponse({ status: 404, description: 'Task not found' })
  addAssignees(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ManageAssigneesDto,
  ) {
    return this.taskService.addAssignees(id, dto.user_ids);
  }

  @Delete(':id/assignees')
  @ApiOperation({ summary: 'Remove assignees from a task' })
  @ApiParam({ name: 'id', description: 'Task UUID' })
  @ApiResponse({ status: 200, description: 'Assignees removed', type: Task })
  @ApiResponse({ status: 404, description: 'Task not found' })
  removeAssignees(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ManageAssigneesDto,
  ) {
    return this.taskService.removeAssignees(id, dto.user_ids);
  }

  @Post(':id/labels')
  @ApiOperation({ summary: 'Add labels to a task' })
  @ApiParam({ name: 'id', description: 'Task UUID' })
  @ApiResponse({ status: 201, description: 'Labels added', type: Task })
  @ApiResponse({ status: 404, description: 'Task not found' })
  addLabels(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ManageLabelsDto,
  ) {
    return this.taskService.addLabels(id, dto.label_ids);
  }

  @Delete(':id/labels')
  @ApiOperation({ summary: 'Remove labels from a task' })
  @ApiParam({ name: 'id', description: 'Task UUID' })
  @ApiResponse({ status: 200, description: 'Labels removed', type: Task })
  @ApiResponse({ status: 404, description: 'Task not found' })
  removeLabels(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ManageLabelsDto,
  ) {
    return this.taskService.removeLabels(id, dto.label_ids);
  }
}
