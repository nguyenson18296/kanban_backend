export interface ApiListResponse<T> {
  data: T[];
  status: number;
  success: boolean;
  message?: string;
}
