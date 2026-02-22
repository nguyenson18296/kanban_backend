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
import { LabelService } from './label.service';
import { Label } from './label.entity';
import { CreateLabelDto } from './dto/create-label.dto';
import { UpdateLabelDto } from './dto/update-label.dto';

@ApiTags('Labels')
@Controller('labels')
export class LabelController {
  constructor(private readonly labelService: LabelService) {}

  @Post()
  @ApiOperation({ summary: 'Create a label' })
  @ApiResponse({ status: 201, description: 'Label created', type: Label })
  @ApiResponse({ status: 409, description: 'Label name already exists' })
  create(@Body() dto: CreateLabelDto) {
    return this.labelService.create(dto);
  }

  @Get()
  @ApiOperation({ summary: 'Get all labels' })
  @ApiResponse({ status: 200, description: 'List of labels', type: [Label] })
  findAll() {
    return this.labelService.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a label by ID' })
  @ApiParam({ name: 'id', description: 'Label UUID' })
  @ApiResponse({ status: 200, description: 'Label found', type: Label })
  @ApiResponse({ status: 404, description: 'Label not found' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.labelService.findOneById(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a label' })
  @ApiParam({ name: 'id', description: 'Label UUID' })
  @ApiResponse({ status: 200, description: 'Label updated', type: Label })
  @ApiResponse({ status: 404, description: 'Label not found' })
  @ApiResponse({ status: 409, description: 'Label name already exists' })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateLabelDto) {
    return this.labelService.update(id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a label' })
  @ApiParam({ name: 'id', description: 'Label UUID' })
  @ApiResponse({ status: 200, description: 'Label deleted' })
  @ApiResponse({ status: 404, description: 'Label not found' })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.labelService.remove(id);
  }
}
