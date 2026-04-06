import { config } from "../config";
import type { Session } from "../types";

const STORAGE_KEY = "dj_music_request_session";

async function getCognitoSdk() {
  return import("amazon-cognito-identity-js");
}

export const auth = {
  async login(email: string, password: string): Promise<Session> {
    const { AuthenticationDetails, CognitoUser, CognitoUserPool } = await getCognitoSdk();
    const userPool = new CognitoUserPool({
      UserPoolId: config.userPoolId,
      ClientId: config.userPoolClientId,
    });

    const cognitoUser = new CognitoUser({
      Username: email,
      Pool: userPool,
    });

    const details = new AuthenticationDetails({
      Username: email,
      Password: password,
    });

    return new Promise((resolve, reject) => {
      cognitoUser.authenticateUser(details, {
        onSuccess: (session: { getIdToken: () => { getJwtToken: () => string } }) => {
          const payload: Session = {
            email,
            idToken: session.getIdToken().getJwtToken(),
          };
          try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
          } catch {
            // Session persistence can fail in hardened browser modes.
          }
          resolve(payload);
        },
        onFailure: reject,
      });
    });
  },

  logout() {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Ignore storage errors.
    }
  },

  getSession(): Session | null {
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(STORAGE_KEY);
    } catch {
      return null;
    }

    if (!raw) {
      return null;
    }

    try {
      return JSON.parse(raw) as Session;
    } catch {
      return null;
    }
  },

  async getValidSession(): Promise<Session | null> {
    const { CognitoUserPool } = await getCognitoSdk();
    const userPool = new CognitoUserPool({
      UserPoolId: config.userPoolId,
      ClientId: config.userPoolClientId,
    });
    const currentUser = userPool.getCurrentUser();
    if (!currentUser) {
      return this.getSession();
    }

    return new Promise((resolve) => {
      currentUser.getSession((err: unknown, cognitoSession: any) => {
        if (err || !cognitoSession?.isValid?.()) {
          resolve(this.getSession());
          return;
        }
        const payload: Session = {
          email: currentUser.getUsername(),
          idToken: cognitoSession.getIdToken().getJwtToken(),
        };
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
        } catch {
          // Ignore storage persistence errors.
        }
        resolve(payload);
      });
    });
  },
};
