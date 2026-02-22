import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  ParseIntPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam } from '@nestjs/swagger';
import { KanbanColumnService } from './kanban-column.service';
import { KanbanColumn } from './kanban-column.entity';
import { CreateKanbanColumnDto } from './dto/create-kanban-column.dto';
import { UpdateKanbanColumnDto } from './dto/update-kanban-column.dto';

@ApiTags('Columns')
@Controller('columns')
export class KanbanColumnController {
  constructor(private readonly columnService: KanbanColumnService) {}

  @Post()
  @ApiOperation({ summary: 'Create a kanban column' })
  @ApiResponse({
    status: 201,
    description: 'Column created',
    type: KanbanColumn,
  })
  @ApiResponse({ status: 409, description: 'Column name already exists' })
  create(@Body() dto: CreateKanbanColumnDto) {
    return this.columnService.create(dto);
  }

  @Get()
  @ApiOperation({ summary: 'Get all active columns (ordered by position)' })
  @ApiResponse({
    status: 200,
    description: 'List of columns',
    type: [KanbanColumn],
  })
  findAll() {
    return this.columnService.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a column by ID' })
  @ApiParam({ name: 'id', description: 'Column ID' })
  @ApiResponse({
    status: 200,
    description: 'Column found',
    type: KanbanColumn,
  })
  @ApiResponse({ status: 404, description: 'Column not found' })
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.columnService.findOneById(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a column' })
  @ApiParam({ name: 'id', description: 'Column ID' })
  @ApiResponse({
    status: 200,
    description: 'Column updated',
    type: KanbanColumn,
  })
  @ApiResponse({ status: 404, description: 'Column not found' })
  @ApiResponse({ status: 409, description: 'Column name already exists' })
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateKanbanColumnDto,
  ) {
    return this.columnService.update(id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a column' })
  @ApiParam({ name: 'id', description: 'Column ID' })
  @ApiResponse({ status: 200, description: 'Column deleted' })
  @ApiResponse({ status: 404, description: 'Column not found' })
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.columnService.remove(id);
  }
}
