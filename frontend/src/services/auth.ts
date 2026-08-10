import { config } from "../config";
import type { Session } from "../types";

const STORAGE_KEY = "dj_music_request_session";

interface CognitoSessionLike {
  isValid: () => boolean;
  getIdToken: () => { getJwtToken: () => string };
}

async function getCognitoSdk() {
  return import("amazon-cognito-identity-js");
}

async function getUserPool() {
  const { CognitoUserPool } = await getCognitoSdk();
  return new CognitoUserPool({
    UserPoolId: config.userPoolId,
    ClientId: config.userPoolClientId,
  });
}

async function getCognitoUser(email: string) {
  const { CognitoUser } = await getCognitoSdk();
  return new CognitoUser({
    Username: email.trim().toLowerCase(),
    Pool: await getUserPool(),
  });
}

export const auth = {
  async login(email: string, password: string): Promise<Session> {
    const { AuthenticationDetails, CognitoUser } = await getCognitoSdk();
    const userPool = await getUserPool();

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

  async signUp(email: string, password: string) {
    const { CognitoUserAttribute } = await getCognitoSdk();
    const userPool = await getUserPool();
    const normalizedEmail = email.trim().toLowerCase();
    const attributes = [new CognitoUserAttribute({ Name: "email", Value: normalizedEmail })];

    return new Promise<{ userConfirmed: boolean; userSub?: string }>((resolve, reject) => {
      userPool.signUp(normalizedEmail, password, attributes, [], (error, result) => {
        if (error || !result) {
          reject(error ?? new Error("Unable to create account."));
          return;
        }
        resolve({
          userConfirmed: result.userConfirmed,
          userSub: result.userSub,
        });
      });
    });
  },

  async confirmSignUp(email: string, code: string) {
    const user = await getCognitoUser(email);
    return new Promise<void>((resolve, reject) => {
      user.confirmRegistration(code.trim(), true, (error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  },

  async resendConfirmationCode(email: string) {
    const user = await getCognitoUser(email);
    return new Promise<void>((resolve, reject) => {
      user.resendConfirmationCode((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  },

  async requestPasswordReset(email: string) {
    const user = await getCognitoUser(email);
    return new Promise<void>((resolve, reject) => {
      user.forgotPassword({
        onSuccess: () => resolve(),
        onFailure: reject,
        inputVerificationCode: () => resolve(),
      });
    });
  },

  async confirmPasswordReset(email: string, code: string, newPassword: string) {
    const user = await getCognitoUser(email);
    return new Promise<void>((resolve, reject) => {
      user.confirmPassword(code.trim(), newPassword, {
        onSuccess: () => resolve(),
        onFailure: reject,
      });
    });
  },

  logout() {
    void getUserPool().then((pool) => pool.getCurrentUser()?.signOut());
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
    const userPool = await getUserPool();
    const currentUser = userPool.getCurrentUser();
    if (!currentUser) {
      return this.getSession();
    }

    return new Promise((resolve) => {
      currentUser.getSession((err: unknown, cognitoSession: CognitoSessionLike | null) => {
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
