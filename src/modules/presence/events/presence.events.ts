export const PRESENCE_EVENTS = {
  WS_CONNECTION_OPENED: 'ws.connection.opened',
  WS_CONNECTION_CLOSED: 'ws.connection.closed',
} as const;

export interface WsConnectionOpenedEvent {
  userId: string;
  socketId: string;
}

export interface WsConnectionClosedEvent {
  userId: string;
  socketId: string;
}
