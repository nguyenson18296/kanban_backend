export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

/**
 * Standard shape for offset-paginated list endpoints
 * (`page`/`limit` query params). Distinct from `ApiListResponse`,
 * which is the non-paginated `{ data, status, success }` envelope.
 */
export interface PaginatedResponse<T> {
  data: T[];
  meta: PaginationMeta;
}
