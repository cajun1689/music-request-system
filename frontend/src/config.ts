export const config = {
  apiBaseUrl: import.meta.env.VITE_API_BASE_URL as string,
  websocketUrl: import.meta.env.VITE_WEBSOCKET_URL as string,
  userPoolId: import.meta.env.VITE_USER_POOL_ID as string,
  userPoolClientId: import.meta.env.VITE_USER_POOL_CLIENT_ID as string,
};
