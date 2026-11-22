import { describe, expect, it } from 'vitest';
import { ApiError } from '@/api/client';
import { createErrorMessage, validateCreate } from './create';

describe('validateCreate', () => {
  it('returns the request body, with an empty description sent as null', () => {
    expect(validateCreate({ name: ' Thesis ', slug: 'thesis', description: '  ' })).toEqual({
      ok: true,
      body: { name: 'Thesis', slug: 'thesis', description: null },
    });
  });

  it('puts each problem under its field', () => {
    const result = validateCreate({ name: '', slug: 'No', description: '' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(Object.keys(result.errors).sort()).toEqual(['name', 'slug']);
  });

  it('explains the slug rule in words', () => {
    const result = validateCreate({ name: 'X', slug: '9-lives', description: '' });
    expect(result.ok ? null : result.errors.slug).toMatch(/start with a letter/);
  });
});

describe('createErrorMessage', () => {
  it('shows a taken slug under the slug field', () => {
    expect(createErrorMessage(new ApiError(409, 'The slug "ouc" is taken.'))).toEqual({
      field: 'slug',
      message: 'The slug "ouc" is taken.',
    });
  });

  it('shows validation errors from the API on the form', () => {
    expect(createErrorMessage(new ApiError(400, 'The request did not match the schema.'))).toEqual({
      field: null,
      message: 'The request did not match the schema.',
    });
    expect(createErrorMessage(new ApiError(422, 'Unknown provider')).message).toBe('Unknown provider');
  });

  it('explains other failures without hiding the cause', () => {
    expect(createErrorMessage(new ApiError(503, 'Chroma is down')).message).toBe(
      "Couldn't create the workspace: Chroma is down",
    );
    expect(createErrorMessage(new TypeError('Failed to fetch')).message).toBe(
      "Couldn't create the workspace: Failed to fetch",
    );
  });
});
