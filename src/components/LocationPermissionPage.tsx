import { useState } from 'react';
import { motion } from 'motion/react';
import { MapPin, Shield, Loader2 } from 'lucide-react';
import { db } from '../lib/db';

interface LocationPermissionPageProps {
  userId: string;
  onComplete: () => void;
}

export function LocationPermissionPage({ userId, onComplete }: LocationPermissionPageProps) {
  const [requesting, setRequesting] = useState(false);
  const [error, setError] = useState('');

  const handleAllow = async () => {
    setRequesting(true);
    setError('');
    try {
      // Actually request browser geolocation permission
      await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 10000 });
      });

      // Permission granted — store in settings
      const existing = await db.settings.get(userId) || { userId };
      await db.settings.put({ ...existing, locationEnabled: true });
      try { localStorage.setItem('beatrice_location_done', 'true'); } catch {}
      onComplete();
    } catch (e: any) {
      if (e?.code === 1) {
        // User denied the browser prompt
        setError('Location access was denied. You can enable it later in App Settings.');
        const existing = await db.settings.get(userId) || { userId };
        await db.settings.put({ ...existing, locationEnabled: false });
        try { localStorage.setItem('beatrice_location_done', 'true'); } catch {}
        setTimeout(onComplete, 2000);
      } else {
        setError('Could not determine location. You can try again later in App Settings.');
        setTimeout(onComplete, 2000);
      }
    } finally {
      setRequesting(false);
    }
  };

  const handleSkip = async () => {
    const existing = await db.settings.get(userId) || { userId };
    await db.settings.put({ ...existing, locationEnabled: false });
    try { localStorage.setItem('beatrice_location_done', 'true'); } catch {}
    onComplete();
  };

  return (
    <main className="min-h-screen bg-[#050505] text-white flex flex-col items-center justify-center p-6 relative overflow-hidden">
      {/* Ambient glow */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-[20%] left-1/2 -translate-x-1/2 w-[500px] sm:w-[700px] h-[500px] sm:h-[700px] bg-[#d0a78b]/[0.06] rounded-full blur-[150px]" />
        <div className="absolute bottom-[10%] left-1/2 -translate-x-1/2 w-[400px] sm:w-[600px] h-[400px] sm:h-[600px] bg-amber-700/[0.04] rounded-full blur-[120px]" />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        className="w-full max-w-[400px] z-10 flex flex-col items-center"
      >
        {/* Icon */}
        <motion.div
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ delay: 0.15, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
          className="w-20 h-20 rounded-full bg-gradient-to-br from-[#d0a78b]/20 to-amber-900/30 flex items-center justify-center mb-8 shadow-[0_0_40px_rgba(208,167,139,0.12)]"
        >
          <div className="w-16 h-16 rounded-full bg-[#0a0a0a] border border-[#d0a78b]/15 flex items-center justify-center">
            <MapPin className="w-7 h-7 text-[#d0a78b]" />
          </div>
        </motion.div>

        {/* Card */}
        <div className="w-full backdrop-blur-2xl bg-white/[0.03] border border-white/[0.06] rounded-3xl p-7 flex flex-col items-center shadow-2xl">
          <h2 className="text-xl font-light tracking-wide text-white/90 mb-2 font-['SF_Pro_Display',system-ui,sans-serif] text-center">
            Enable Location
          </h2>
          <p className="text-white/40 text-[13px] mb-6 font-['SF_Pro_Text',system-ui,sans-serif] text-center leading-relaxed max-w-[320px]">
            Beatrice uses your location to provide accurate time-of-day greetings, local weather, nearby recommendations, and Belgian region-specific services.
          </p>

          {/* Privacy badge */}
          <div className="flex items-center gap-2 bg-white/[0.03] border border-white/[0.04] rounded-xl px-4 py-2.5 mb-6 w-full">
            <Shield className="w-4 h-4 text-emerald-400/60 shrink-0" />
            <span className="text-[11px] text-zinc-400 font-medium leading-relaxed font-['SF_Pro_Text',system-ui,sans-serif]">
              Your location is never stored on our servers. It's only used in real-time during your session.
            </span>
          </div>

          {error && (
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="text-amber-400/90 text-xs text-center font-medium bg-amber-500/5 py-2.5 rounded-xl border border-amber-500/10 mb-4 w-full font-['SF_Pro_Text',system-ui,sans-serif]"
            >
              {error}
            </motion.p>
          )}

          <button
            onClick={handleAllow}
            disabled={requesting}
            className="w-full py-3.5 rounded-2xl bg-white text-[#050505] text-sm font-semibold tracking-wide shadow-lg shadow-white/10 active:scale-[0.97] transition-all duration-200 cursor-pointer hover:bg-white/90 disabled:opacity-50 disabled:cursor-not-allowed font-['SF_Pro_Text',system-ui,sans-serif] flex items-center justify-center gap-2"
          >
            {requesting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Requesting Access…
              </>
            ) : (
              <>
                <MapPin className="w-4 h-4" />
                Allow Location Access
              </>
            )}
          </button>
        </div>

        {/* Skip button — outside the card, at bottom */}
        <button
          onClick={handleSkip}
          disabled={requesting}
          className="mt-6 text-white/30 hover:text-white/60 text-sm font-medium transition-colors duration-200 cursor-pointer font-['SF_Pro_Text',system-ui,sans-serif] disabled:cursor-not-allowed"
        >
          Skip for now
        </button>

        <p className="mt-4 text-[10px] text-white/15 font-['SF_Pro_Text',system-ui,sans-serif] text-center max-w-[280px] leading-relaxed">
          You can always change this later in App Settings
        </p>
      </motion.div>
    </main>
  );
}
