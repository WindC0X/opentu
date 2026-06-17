export interface ChatDrawerSendReadinessInput {
  isEmbedded: boolean;
  hasManagedSessionRoute: boolean;
  hasLocalApiKey: boolean;
}

export interface ChatDrawerSendReadiness {
  ready: boolean;
  shouldOpenSettings: boolean;
  message?: string;
}

const STANDALONE_API_KEY_REQUIRED_MESSAGE =
  'API Key 是必需的，请先在设置中配置。';

const EMBEDDED_SESSION_UNAVAILABLE_MESSAGE =
  'Creative chat is unavailable: refresh the page or ask an administrator to enable a text model in New API.';

export function getChatDrawerSendReadiness(
  input: ChatDrawerSendReadinessInput
): ChatDrawerSendReadiness {
  if (input.isEmbedded) {
    return input.hasManagedSessionRoute
      ? { ready: true, shouldOpenSettings: false }
      : {
          ready: false,
          shouldOpenSettings: false,
          message: EMBEDDED_SESSION_UNAVAILABLE_MESSAGE,
        };
  }

  return input.hasLocalApiKey
    ? { ready: true, shouldOpenSettings: false }
    : {
        ready: false,
        shouldOpenSettings: true,
        message: STANDALONE_API_KEY_REQUIRED_MESSAGE,
      };
}
