import type { AuthenticatedSession } from '../auth/types';

export type AppEnv = {
  Variables: {
    auth: AuthenticatedSession;
    requestId: string;
  };
};
