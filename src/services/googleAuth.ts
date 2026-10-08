import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getAuth,
  signInWithPopup,
  GoogleAuthProvider,
  onAuthStateChanged,
  User,
  signOut,
} from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';

const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
export const auth = getAuth(app);

export const GMAIL_SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.compose',
];

const provider = new GoogleAuthProvider();
for (const scope of GMAIL_SCOPES) {
  provider.addScope(scope);
}
provider.setCustomParameters({
  prompt: 'consent',
  access_type: 'offline',
});

let isSigningIn = false;
let cachedAccessToken: string | null = null;
let cachedUser: User | null = null;

const authSubscribers: ((user: User | null, token: string | null) => void)[] = [];

function notifySubscribers() {
  for (const sub of authSubscribers) {
    sub(cachedUser, cachedAccessToken);
  }
}

// Global listener
onAuthStateChanged(auth, async (user: User | null) => {
  cachedUser = user;
  if (!user) {
    cachedAccessToken = null;
  }
  notifySubscribers();
});

export const subscribeToAuth = (
  callback: (user: User | null, token: string | null) => void
) => {
  authSubscribers.push(callback);
  callback(cachedUser, cachedAccessToken);
  return () => {
    const idx = authSubscribers.indexOf(callback);
    if (idx >= 0) authSubscribers.splice(idx, 1);
  };
};

export const googleSignIn = async (): Promise<{
  user: User;
  accessToken: string;
} | null> => {
  try {
    isSigningIn = true;
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error('Failed to get Google access token');
    }

    cachedAccessToken = credential.accessToken;
    cachedUser = result.user;
    notifySubscribers();

    return { user: result.user, accessToken: cachedAccessToken };
  } catch (error: any) {
    console.error('Google Sign-in error:', error);
    throw error;
  } finally {
    isSigningIn = false;
  }
};

export const getAccessToken = async (): Promise<string | null> => {
  return cachedAccessToken;
};

export const getCurrentUser = (): User | null => {
  return cachedUser;
};

export const googleLogout = async () => {
  await signOut(auth);
  cachedAccessToken = null;
  cachedUser = null;
  notifySubscribers();
};
