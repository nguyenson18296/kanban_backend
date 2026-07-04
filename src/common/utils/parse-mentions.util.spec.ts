/// <reference types="jest" />
import { parseMentions } from './parse-mentions.util';

describe('parseMentions', () => {
  it('extracts UUIDs from data-mention-id', () => {
    const { ids, names } = parseMentions(
      '<span data-mention-id="a1b2">@Alice</span> hello',
    );
    expect(ids).toEqual(['a1b2']);
    expect(names).toEqual([]);
  });

  it('extracts full names from data-mention spans without an id', () => {
    const { ids, names } = parseMentions(
      '<span data-mention="Bob Smith">@Bob Smith</span>',
    );
    expect(ids).toEqual([]);
    expect(names).toEqual(['Bob Smith']);
  });

  it('prefers the id and does not double-count a span carrying both', () => {
    const { ids, names } = parseMentions(
      '<span data-mention="Alice" data-mention-id="a1b2">@Alice</span>',
    );
    expect(ids).toEqual(['a1b2']);
    expect(names).toEqual([]);
  });

  it('falls back to plain @Full Name text mentions', () => {
    const { ids, names } = parseMentions('hey @John Doe please review');
    expect(ids).toEqual([]);
    expect(names).toEqual(['John Doe']);
  });

  it('returns empty arrays when there are no mentions', () => {
    expect(parseMentions('<p>no mentions here</p>')).toEqual({
      ids: [],
      names: [],
    });
  });
});
