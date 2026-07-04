import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../user/user.entity';
import { parseMentions } from '../../common/utils/parse-mentions.util';

@Injectable()
export class MentionService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  /**
   * Parse @mentions from HTML content and resolve them to active user ids.
   * Accepts both direct UUIDs (data-mention-id) and full_names; verifies each
   * against active users and drops any id in excludeIds (e.g. the actor).
   */
  async resolveMentionedUserIds(
    html: string,
    excludeIds: string[] = [],
  ): Promise<string[]> {
    const mentions = parseMentions(html);
    if (mentions.ids.length === 0 && mentions.names.length === 0) {
      return [];
    }

    const resolvedIds = new Set<string>();
    const excludeSet = new Set(excludeIds);

    // Direct UUIDs — verify they exist and are active
    if (mentions.ids.length > 0) {
      const usersById = await this.userRepository
        .createQueryBuilder('user')
        .select('user.id')
        .where('user.id IN (:...ids)', { ids: mentions.ids })
        .andWhere('user.is_active = true')
        .getMany();
      for (const u of usersById) {
        if (!excludeSet.has(u.id)) resolvedIds.add(u.id);
      }
    }

    // Name-based fallback — resolve full_name to id
    if (mentions.names.length > 0) {
      const usersByName = await this.userRepository
        .createQueryBuilder('user')
        .select('user.id')
        .where('user.full_name IN (:...names)', { names: mentions.names })
        .andWhere('user.is_active = true')
        .getMany();
      for (const u of usersByName) {
        if (!excludeSet.has(u.id)) resolvedIds.add(u.id);
      }
    }

    return [...resolvedIds];
  }
}
