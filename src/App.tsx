import { useEffect, useState, useCallback } from 'react';
import { auth } from './firebase';
import { db } from './lib/db';
import {
  onAuthStateChanged,
  signOut,
  User,
  signInWithPopup,
  GoogleAuthProvider,
  linkWithPopup,
  reauthenticateWithPopup,
  getAdditionalUserInfo
} from 'firebase/auth';
import { Loader2 } from 'lucide-react';
import { EntryFlow } from './components/EntryFlow';
import { AuthPage } from './components/AuthPage';
import { BeatriceAgent } from './components/BeatriceAgent';
import { AdminPortal } from './components/AdminPortal';
import { LocationPermissionPage } from './components/LocationPermissionPage';
import { SettingsPage } from './components/SettingsPage';
import { ProfilePage } from './components/ProfilePage';
import {
  markLocationOnboardingComplete,
  markLocationOnboardingPending,
  shouldShowLocationOnboarding,
} from './lib/locationOnboarding';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [googleToken, setGoogleToken] = useState<string | null>(null);
  const [showEntryFlow, setShowEntryFlow] = useState(true);
  const [showLocationStep, setShowLocationStep] = useState(false);
  const [authLanguage, setAuthLanguage] = useState(() => {
    try { return localStorage.getItem('beatrice_language') || 'en'; } catch { return 'en'; }
  });
  const [currentPath, setCurrentPath] = useState(() => {
    return typeof window !== 'undefined' ? window.location.pathname.replace(/\/+$/, '') : '/';
  });

  useEffect(() => {
    const handlePopState = () => {
      setCurrentPath(window.location.pathname.replace(/\/+$/, '') || '/');
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  useEffect(() => {
    if (!user) {
      setShowLocationStep(false);
      return;
    }

    setShowLocationStep(shouldShowLocationOnboarding(user.uid));
  }, [user]);

  const storeToken = useCallback(async (token: string, uid: string, refreshToken?: string) => {
    setGoogleToken(token);
    try {
      const existing = await db.settings.get(uid) || { userId: uid };
      await db.settings.put({
        ...existing,
        googleToken: token,
        ...(refreshToken ? { googleRefreshToken: refreshToken } : {})
      });
    } catch (err) {
      console.error('Failed to store token locally:', err);
    }
  }, []);

  const clearStoredToken = useCallback(async (uid: string) => {
    try {
      const existing = await db.settings.get(uid);
      if (existing) {
        await db.settings.put({
          ...existing,
          googleToken: undefined,
          googleRefreshToken: undefined
        });
      }
    } catch (err) {
      console.error('Failed to clear token locally:', err);
    }
  }, []);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      console.log('[App] onAuthStateChanged fired, user:', u?.uid);
      setUser(u);

      if (u) {
        try {
          const settings = await db.settings.get(u.uid);
          if (settings?.googleToken) {
            setGoogleToken(settings.googleToken);
          }

          if (!settings) {
            await db.settings.put({
              userId: u.uid,
            });
          }
        } catch (error) {
          console.error('Failed to initialize local settings:', error);
        }
      }

      setLoading(false);
    });

    return () => unsub();
  }, []);

  const handleLogin = useCallback(async () => {
    try {
      const provider = new GoogleAuthProvider();

      provider.addScope('https://mail.google.com/');
      provider.addScope('https://www.googleapis.com/auth/drive');
      provider.addScope('https://www.googleapis.com/auth/drive.file');
      provider.addScope('https://www.googleapis.com/auth/drive.metadata.readonly');
      provider.addScope('https://www.googleapis.com/auth/drive.appdata');
      provider.addScope('https://www.googleapis.com/auth/calendar');
      provider.addScope('https://www.googleapis.com/auth/calendar.events');
      provider.addScope('https://www.googleapis.com/auth/calendar.readonly');
      provider.addScope('https://www.googleapis.com/auth/tasks');
      provider.addScope('https://www.googleapis.com/auth/youtube');
      provider.addScope('https://www.googleapis.com/auth/youtube.force-ssl');
      provider.addScope('https://www.googleapis.com/auth/spreadsheets');
      provider.addScope('https://www.googleapis.com/auth/documents');
      provider.addScope('https://www.googleapis.com/auth/contacts');
      provider.addScope('https://www.googleapis.com/auth/userinfo.profile');

      provider.setCustomParameters({
        prompt: 'consent',
        access_type: 'offline'
      });

      let result;
      const currentUser = auth.currentUser;
      if (currentUser) {
        const isGoogleLinked = currentUser.providerData.some(p => p.providerId === 'google.com');
        if (isGoogleLinked) {
          result = await reauthenticateWithPopup(currentUser, provider);
        } else {
          result = await linkWithPopup(currentUser, provider);
        }
      } else {
        result = await signInWithPopup(auth, provider);
        const additionalInfo = getAdditionalUserInfo(result);
        if (additionalInfo?.isNewUser) {
          markLocationOnboardingPending(result.user.uid);
          setShowLocationStep(true);
        }
      }
      const credential = GoogleAuthProvider.credentialFromResult(result);
      const refreshToken = (result as any)._tokenResponse?.oauthRefreshToken;

      if (credential?.accessToken) {
        setGoogleToken(credential.accessToken);
        storeToken(credential.accessToken, result.user.uid, refreshToken);
      }

      // If we made it here with a currentUser, verify Google is now linked
      if (currentUser && !currentUser.providerData.some(p => p.providerId === 'google.com')) {
        const freshUser = auth.currentUser;
        if (freshUser?.providerData.some(p => p.providerId === 'google.com')) {
          setGoogleToken(credential?.accessToken || null);
        }
      }
    } catch (error: any) {
      console.error("Login failed:", error);
    }
  }, [storeToken]);

  const handleLogout = useCallback(() => {
    setGoogleToken(null);
    if (user) {
      clearStoredToken(user.uid);
    }
    signOut(auth);
  }, [clearStoredToken, user]);

  const handleGoogleToken = useCallback((token: string | null) => {
    setGoogleToken(token);
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#050505] text-white flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="w-10 h-10 animate-spin text-amber-500/50" />
          <span className="text-xs font-mono tracking-widest text-amber-500/30 uppercase">
            Initializing System
          </span>
        </div>
      </div>
    );
  }

  if (showEntryFlow) {
    return <EntryFlow onComplete={() => setShowEntryFlow(false)} />;
  }

  if (!user) {
    return <AuthPage onGoogleToken={handleGoogleToken} onLogin={handleLogin} />;
  }

  // Show location permission step for new users after auth
  if (showLocationStep) {
    return (
      <LocationPermissionPage
        userId={user.uid}
        onComplete={() => {
          markLocationOnboardingComplete(user.uid);
          setShowLocationStep(false);
        }}
      />
    );
  }

  const isMainPage = currentPath === '/';

  return (
    <>
      {/* Always mounted — mic + audio + session survive page navigation */}
      <div
        className={isMainPage ? '' : 'fixed inset-0 pointer-events-none opacity-0'}
        aria-hidden={!isMainPage}
      >
        <BeatriceAgent
          user={user}
          googleToken={googleToken}
          setGoogleToken={setGoogleToken}
          storeToken={storeToken}
          authLanguage={authLanguage}
          onSetLanguage={setAuthLanguage}
          onLogout={handleLogout}
          onLogin={handleLogin}
        />
      </div>

      {/* Overlay pages on top — BeatriceAgent stays alive underneath */}
      {currentPath === '/adminportal' && (
        <AdminPortal
          user={user}
          onBack={() => {
            window.history.pushState(null, '', '/');
            window.dispatchEvent(new PopStateEvent('popstate'));
          }}
          onLogout={handleLogout}
        />
      )}
      {currentPath === '/settings' && (
        <SettingsPage
          user={user}
          googleToken={googleToken}
          onLogin={handleLogin}
          onBack={() => {
            window.history.pushState(null, '', '/');
            window.dispatchEvent(new PopStateEvent('popstate'));
          }}
        />
      )}
      {currentPath === '/profile' && (
        <ProfilePage
          onClose={() => {
            window.history.pushState(null, '', '/');
            window.dispatchEvent(new PopStateEvent('popstate'));
          }}
        />
      )}
    </>
  );
}
