import {
  HttpStatus,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { KanbanColumn } from '../kanban-column/kanban-column.entity';
import { Task } from '../task/task.entity';
import { BoardQueryDto } from './dto/board-query.dto';
import { BoardResponseDto } from './dto/board-response.dto';

@Injectable()
export class BoardService {
  private readonly logger = new Logger(BoardService.name);

  constructor(
    @InjectRepository(KanbanColumn)
    private readonly columnRepository: Repository<KanbanColumn>,
    @InjectRepository(Task)
    private readonly taskRepository: Repository<Task>,
  ) {}

  async getBoard(query: BoardQueryDto): Promise<BoardResponseDto> {
    try {
      const columns = await this.columnRepository.find({
        where: { is_archived: false },
        order: { position: 'ASC' },
      });

      if (columns.length === 0) {
        return { columns: [] };
      }

      const columnIds = columns.map((c) => c.id);

      // Build shared filter conditions (used by both count and task queries)
      const conditions: string[] = ['t.column_id IN (:...columnIds)'];
      const params: Record<string, any> = { columnIds };

      if (query.priority) {
        conditions.push('t.priority = :priority');
        params.priority = query.priority;
      }

      if (query.search) {
        const escaped = query.search
          .replaceAll('\\', '\\\\')
          .replaceAll(/[%_]/g, String.raw`\$&`);
        conditions.push('t.title ILIKE :search');
        params.search = `%${escaped}%`;
      }

      if (query.assigneeId) {
        conditions.push(
          't.id IN (SELECT task_id FROM task_assignees WHERE user_id = :assigneeId)',
        );
        params.assigneeId = query.assigneeId;
      }

      if (query.labelId) {
        conditions.push(
          't.id IN (SELECT task_id FROM task_labels WHERE label_id = :labelId)',
        );
        params.labelId = query.labelId;
      }

      const filterWhere = conditions.join(' AND ');

      // Query 1: Count matching tasks per column (lightweight aggregate)
      const counts = await this.taskRepository
        .createQueryBuilder('t')
        .select('t.column_id', 'column_id')
        .addSelect('COUNT(*)', 'task_count')
        .where(filterWhere, params)
        .groupBy('t.column_id')
        .getRawMany();

      const countMap = new Map<number, number>(
        counts.map((r) => [Number(r.column_id), Number(r.task_count)]),
      );

      // Query 2: Fetch only top N tasks per column using ROW_NUMBER
      const taskQb = this.taskRepository
        .createQueryBuilder('task')
        .select([
          'task.id',
          'task.title',
          'task.ticket_id',
          'task.position',
          'task.status',
          'task.priority',
          'task.created_at',
          'task.column_id',
        ])
        .leftJoin('task.assignees', 'assignee')
        .addSelect(['assignee.id', 'assignee.full_name', 'assignee.avatar_url'])
        .leftJoin('task.labels', 'label')
        .addSelect(['label.id', 'label.name', 'label.color'])
        .where(
          `task.id IN (
            SELECT ranked.id FROM (
              SELECT t.id,
                     ROW_NUMBER() OVER (PARTITION BY t.column_id ORDER BY t.position ASC) AS rn
              FROM tasks t
              WHERE ${filterWhere}
            ) ranked
            WHERE ranked.rn <= :tasksPerColumn
          )`,
          { ...params, tasksPerColumn: query.tasksPerColumn },
        )
        .orderBy('task.column_id', 'ASC')
        .addOrderBy('task.position', 'ASC');

      const limitedTasks = await taskQb.getMany();

      const tasksByColumn = new Map<number, Task[]>();
      for (const task of limitedTasks) {
        const list = tasksByColumn.get(task.column_id) ?? [];
        list.push(task);
        tasksByColumn.set(task.column_id, list);
      }

      return {
        columns: columns.map((col) => ({
          id: col.id,
          name: col.name,
          position: col.position,
          color: col.color,
          task_count: countMap.get(col.id) ?? 0,
          tasks: (tasksByColumn.get(col.id) ?? []).map((t) => ({
            id: t.id,
            title: t.title,
            ticket_id: t.ticket_id,
            position: t.position,
            status: t.status,
            priority: t.priority,
            created_at: t.created_at,
            assignees: (t.assignees ?? []).map((a) => ({
              id: a.id,
              full_name: a.full_name,
              avatar_url: a.avatar_url,
            })),
            labels: (t.labels ?? []).map((l) => ({
              id: l.id,
              name: l.name,
              color: l.color,
            })),
          })),
        })),
      };
    } catch (error) {
      this.logger.error('Failed to fetch board', (error as Error).stack);
      throw new InternalServerErrorException({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'Failed to fetch board',
        error: (error as Error).message,
      });
    }
  }
}
