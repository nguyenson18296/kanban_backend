import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ParseProjectIdPipe } from '../../common/pipes/parse-project-id.pipe';
import { BoardService } from './board.service';
import { BoardQueryDto } from './dto/board-query.dto';
import { BoardResponseDto } from './dto/board-response.dto';

@ApiTags('Board')
@Controller('board')
export class BoardController {
  constructor(private readonly boardService: BoardService) {}

  @Get(':projectId')
  @ApiOperation({
    summary: 'Get board with columns and tasks for a project',
    description:
      'Returns all active columns with their tasks, assignees, and labels for the given project. Supports filtering and per-column pagination.',
  })
  @ApiParam({ name: 'projectId', description: 'Project ID' })
  @ApiResponse({
    status: 200,
    description: 'Board data',
    type: BoardResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Project not found' })
  getBoard(
    @Param('projectId', ParseProjectIdPipe) projectId: string,
    @Query() query: BoardQueryDto,
  ): Promise<BoardResponseDto> {
    return this.boardService.getBoard(projectId, query);
  }
}
