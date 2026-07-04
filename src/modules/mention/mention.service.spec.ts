/// <reference types="jest" />
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { MentionService } from './mention.service';
import { User } from '../user/user.entity';

describe('MentionService', () => {
  let service: MentionService;

  const qb = {
    select: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    getMany: jest.fn(),
  };

  const mockUserRepo = {
    createQueryBuilder: jest.fn(() => qb),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MentionService,
        { provide: getRepositoryToken(User), useValue: mockUserRepo },
      ],
    }).compile();

    service = module.get<MentionService>(MentionService);
  });

  afterEach(() => jest.clearAllMocks());

  it('returns [] without querying when there are no mentions', async () => {
    await expect(
      service.resolveMentionedUserIds('<p>nothing</p>'),
    ).resolves.toEqual([]);
    expect(mockUserRepo.createQueryBuilder).not.toHaveBeenCalled();
  });

  it('resolves active mentioned users by id', async () => {
    qb.getMany.mockResolvedValueOnce([{ id: 'u1' }]);
    const ids = await service.resolveMentionedUserIds(
      '<span data-mention-id="u1">@A</span>',
    );
    expect(ids).toEqual(['u1']);
    expect(qb.andWhere).toHaveBeenCalledWith('user.is_active = true');
  });

  it('drops excluded ids (e.g. the actor)', async () => {
    qb.getMany.mockResolvedValueOnce([{ id: 'u1' }]);
    const ids = await service.resolveMentionedUserIds(
      '<span data-mention-id="u1">@A</span>',
      ['u1'],
    );
    expect(ids).toEqual([]);
  });
});
