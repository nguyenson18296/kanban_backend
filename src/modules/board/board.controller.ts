import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { BoardService } from './board.service';
import { BoardQueryDto } from './dto/board-query.dto';
import { BoardResponseDto } from './dto/board-response.dto';

@ApiTags('Board')
@Controller('board')
export class BoardController {
  constructor(private readonly boardService: BoardService) {}

  @Get()
  @ApiOperation({
    summary: 'Get board with columns and tasks',
    description:
      'Returns all active columns with their tasks, assignees, and labels. Supports filtering and per-column pagination.',
  })
  @ApiResponse({
    status: 200,
    description: 'Board data',
    type: BoardResponseDto,
  })
  getBoard(@Query() query: BoardQueryDto): Promise<BoardResponseDto> {
    return this.boardService.getBoard(query);
  }
}
