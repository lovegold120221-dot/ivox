import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Loader2, ArrowLeft, Save, Check, AlertCircle } from 'lucide-react';
import { db, type UserSettings } from '../lib/db';
import { supabase } from '../lib/supabase';
import { WhatsAppSettings } from './WhatsAppSettings';
import { SkillPermissionItem } from './SkillPermissionItem';
import { createDefaultAgentPermissions } from '../lib/permissions';

interface SettingsPageProps {
  user: any;
  googleToken: string | null;
  onLogin: () => Promise<void>;
  onBack: () => void;
}

export function SettingsPage({
  user,
  googleToken,
  onLogin,
  onBack
}: SettingsPageProps) {
  const [ambientEnabled, setAmbientEnabled] = useState(() => {
    try { return localStorage.getItem('beatrice_ambient_enabled') !== 'false'; } catch { return true; }
  });
  const [ambientVolume, setAmbientVolume] = useState(() => {
    try {
      const saved = Number(localStorage.getItem('beatrice_ambient_volume'));
      return Number.isFinite(saved) && saved >= 0 ? saved : 12;
    } catch {
      return 12;
    }
  });
  const [locationEnabled, setLocationEnabled] = useState(() => {
    try { return localStorage.getItem('beatrice_location_enabled') !== 'false'; } catch { return true; }
  });
  const [waPermissions, setWaPermissions] = useState<Record<string, boolean>>(createDefaultAgentPermissions);

  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      // 1. Load from Dexie for offline-first speed
      const local = await db.settings.get(user.uid);
      if (local) {
        if (local.locationEnabled !== undefined) setLocationEnabled(local.locationEnabled);
        if (local.whatsappPermissions) {
          setWaPermissions(prev => ({ ...prev, ...local.whatsappPermissions }));
        }
      }

      // 2. Load from Supabase to stay fully sync'd
      let settings: any = null;
      let sbErr: any = null;

      try {
        const res = await supabase
          .from('user_settings')
          .select('whatsapp_permissions, location_enabled')
          .eq('user_id', user.uid)
          .maybeSingle();
        settings = res.data;
        sbErr = res.error;
      } catch (e) {
        console.warn('Initial fetch failed, possibly missing location_enabled column. Retrying fallback...', e);
      }

      // Fallback query if initial query fails due to missing column (e.g. database has not been migrated yet)
      if (sbErr || !settings) {
        try {
          const resFallback = await supabase
            .from('user_settings')
            .select('whatsapp_permissions')
            .eq('user_id', user.uid)
            .maybeSingle();
          if (!resFallback.error && resFallback.data) {
            settings = {
              whatsapp_permissions: resFallback.data.whatsapp_permissions,
              location_enabled: null
            };
            sbErr = null;
          }
        } catch (fallbackErr) {
          console.error('Fallback fetch also failed:', fallbackErr);
        }
      }

      if (!sbErr && settings) {
        if (settings.location_enabled !== null && settings.location_enabled !== undefined) {
          setLocationEnabled(settings.location_enabled);
        }
        if (settings.whatsapp_permissions) {
          setWaPermissions(prev => ({ ...prev, ...settings.whatsapp_permissions }));
        }

        // Sync local Dexie
        const localData = await db.settings.get(user.uid) || ({ userId: user.uid } as UserSettings);
        await db.settings.put({
          ...localData,
          locationEnabled: settings.location_enabled ?? localData.locationEnabled,
          whatsappPermissions: settings.whatsapp_permissions ?? localData.whatsappPermissions,
        });
      }
    } catch (err) {
      console.error('Failed to load Settings Page config:', err);
    }
  };

  const handleSaveSettings = async () => {
    setIsSaving(true);
    setError(null);
    setSuccess(null);

    try {
      // Save local storage values
      try {
        localStorage.setItem('beatrice_ambient_enabled', String(ambientEnabled));
        localStorage.setItem('beatrice_ambient_volume', String(ambientVolume));
        localStorage.setItem('beatrice_location_enabled', String(locationEnabled));
        if (!locationEnabled) {
          localStorage.removeItem('beatrice_latitude');
          localStorage.removeItem('beatrice_longitude');
          localStorage.removeItem('beatrice_timezone');
        }
      } catch {}

      // Save local Dexie DB values
      const local = await db.settings.get(user.uid) || ({ userId: user.uid } as UserSettings);
      const savedLat = locationEnabled ? localStorage.getItem('beatrice_latitude') : null;
      const savedLng = locationEnabled ? localStorage.getItem('beatrice_longitude') : null;
      const savedTz = locationEnabled ? localStorage.getItem('beatrice_timezone') : null;

      await db.settings.put({
        ...local,
        locationEnabled,
        latitude: savedLat ? parseFloat(savedLat) : undefined,
        longitude: savedLng ? parseFloat(savedLng) : undefined,
        timezone: savedTz || undefined,
        whatsappPermissions: waPermissions,
        updatedAt: new Date().toISOString(),
      });

      // Save to Supabase
      let sbError = null;
      try {
        const res = await supabase.from('user_settings').upsert({
          user_id: user.uid,
          location_enabled: locationEnabled,
          latitude: savedLat ? parseFloat(savedLat) : null,
          longitude: savedLng ? parseFloat(savedLng) : null,
          timezone: savedTz || null,
          whatsapp_permissions: waPermissions,
          updated_at: new Date().toISOString(),
        });
        if (res.error) {
          // Fallback if columns are missing
          const resFallback = await supabase.from('user_settings').upsert({
            user_id: user.uid,
            location_enabled: locationEnabled,
            whatsapp_permissions: waPermissions,
            updated_at: new Date().toISOString(),
          });
          sbError = resFallback.error;
        }
      } catch (e) {
        console.warn('Upsert failed, possibly missing location_enabled column. Retrying fallback...', e);
        try {
          const resFallback = await supabase.from('user_settings').upsert({
            user_id: user.uid,
            whatsapp_permissions: waPermissions,
            updated_at: new Date().toISOString(),
          });
          if (!resFallback.error) {
            sbError = null;
          } else {
            sbError = resFallback.error;
          }
        } catch (fallbackErr) {
          console.error('Fallback upsert also failed:', fallbackErr);
          sbError = fallbackErr;
        }
      }

      if (sbError) {
        // Fallback upsert without location_enabled
        try {
          const resFallback = await supabase.from('user_settings').upsert({
            user_id: user.uid,
            whatsapp_permissions: waPermissions,
            updated_at: new Date().toISOString(),
          });
          if (!resFallback.error) {
            sbError = null;
          } else {
            sbError = resFallback.error;
          }
        } catch (fallbackErr) {
          console.error('Fallback upsert also failed:', fallbackErr);
          sbError = fallbackErr;
        }
      }

      if (sbError) throw sbError;

      setSuccess('Settings successfully saved.');
      setTimeout(() => {
        setSuccess(null);
        onBack();
      }, 1500);
    } catch (e: any) {
      setError(e.message || 'Failed to save settings');
    } finally {
      setIsSaving(false);
    }
  };

  const isGoogleLinked = () => !!googleToken;

  return (
    <div className="min-h-screen bg-[#050505] text-white flex flex-col select-none relative">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(208,167,139,0.02),transparent_75%)] pointer-events-none z-0" />

      <header className="sticky top-0 w-full bg-black/80 backdrop-blur-2xl border-b border-white/[0.04] px-4 py-3 flex items-center justify-between z-10 shrink-0">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-sm font-semibold text-[#d0a78b] hover:text-white transition-colors active:scale-95 cursor-pointer"
          aria-label="Back"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back</span>
        </button>
        <h3 className="text-base font-semibold tracking-tight text-white">Agent Settings</h3>
        <button
          onClick={handleSaveSettings}
          className="text-sm font-semibold text-[#d0a78b] hover:text-white transition-colors active:scale-95 cursor-pointer"
          aria-label="Save Settings"
        >
          Save
        </button>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-6 pb-24 w-full max-w-lg mx-auto space-y-8 relative z-10">
        {/* Success/Error Toast Notifications */}
        <AnimatePresence>
          {(error || success) && (
            <motion.div
              initial={{ opacity: 0, y: -10, height: 0 }}
              animate={{ opacity: 1, y: 0, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden"
            >
              <div className={`px-4 py-3 rounded-2xl flex items-center gap-2 text-sm backdrop-blur-2xl ${
                error ? 'bg-red-500/10 border border-red-500/20 text-red-400' : 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-400'
              }`}>
                {error ? <AlertCircle className="w-4 h-4 shrink-0" /> : <Check className="w-4 h-4 shrink-0" />}
                <span>{error || success}</span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Google Integration */}
        <section className="space-y-3">
          <h2 className="text-[11px] font-bold tracking-[0.2em] uppercase text-white/40 mb-3 px-1">Google Integration</h2>
          <div className="bg-white/[0.02] backdrop-blur-md border border-white/[0.04] rounded-3xl shadow-[0_8px_32px_rgba(0,0,0,0.4)] overflow-hidden transition-all duration-300 hover:border-white/[0.07] hover:bg-white/[0.03]">
            <div className="p-5 flex flex-col gap-4">
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-2 bg-black/35 px-3 py-1.5 rounded-full border border-white/[0.02]">
                  <div className={`w-1.5 h-1.5 rounded-full ${isGoogleLinked() ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.6)] animate-pulse' : 'bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.5)]'}`} />
                  <span className={`text-[11px] font-bold uppercase tracking-wider ${isGoogleLinked() ? 'text-emerald-400' : 'text-amber-500'}`}>
                    {isGoogleLinked() ? 'Authenticated' : 'Connection Required'}
                  </span>
                </div>
                <button
                  onClick={onLogin}
                  className="px-4 py-2 bg-[#d0a78b] hover:brightness-110 active:scale-95 rounded-xl text-xs font-bold text-black shadow-[0_4px_16px_rgba(208,167,139,0.2)] hover:shadow-[0_4px_20px_rgba(208,167,139,0.35)] transition-all duration-200 cursor-pointer"
                >
                  {isGoogleLinked() ? 'Connected' : 'Connect Now'}
                </button>
              </div>
              <p className="text-[11px] text-zinc-400 leading-relaxed font-medium">
                {isGoogleLinked()
                  ? 'Gmail, Calendar, Drive, Tasks, and YouTube are connected.'
                  : "Connect to enable Gmail, Calendar, Drive, Tasks, and YouTube on Beatrice's voice pipeline."}
              </p>
            </div>
          </div>
        </section>

        {/* Room Tone */}
        <section className="space-y-3">
          <h2 className="text-[11px] font-bold tracking-[0.2em] uppercase text-white/40 mb-3 px-1">Room Tone</h2>
          <div className="bg-white/[0.02] backdrop-blur-md border border-white/[0.04] rounded-3xl shadow-[0_8px_32px_rgba(0,0,0,0.4)] overflow-hidden transition-all duration-300 hover:border-white/[0.07] hover:bg-white/[0.03]">
            <div className="p-5 border-b border-white/[0.03] flex items-center justify-between">
              <div className="flex flex-col gap-0.5 pr-4">
                <span className="text-[14px] text-zinc-100 font-bold tracking-wide">Enable Ambient Sound</span>
                <span className="text-[11px] text-zinc-400 font-medium leading-relaxed">Add a calming background office/cafe bed during calls</span>
              </div>
              <button
                onClick={() => setAmbientEnabled(v => !v)}
                aria-pressed={ambientEnabled}
                aria-label="Toggle Ambient Sound"
                title="Toggle Ambient Sound"
                className={`w-10 h-6 rounded-full transition-all duration-300 flex items-center shrink-0 cursor-pointer ${ambientEnabled ? 'bg-[#d0a78b] shadow-[0_0_10px_rgba(208,167,139,0.3)]' : 'bg-zinc-800'}`}
              >
                <span className={`block w-4.5 h-4.5 rounded-full bg-white transition-all duration-300 shadow-md ${ambientEnabled ? 'ml-[18px]' : 'ml-[3px]'}`} />
              </button>
            </div>
            <div className="p-5 flex items-center gap-4 bg-white/[0.005]">
              <label htmlFor="ambient-volume-slider" className="text-[11px] uppercase tracking-wider text-zinc-400 font-semibold shrink-0 w-8">Vol</label>
              <input
                id="ambient-volume-slider"
                type="range"
                min="0"
                max="20"
                step="1"
                value={ambientVolume}
                onChange={(e) => setAmbientVolume(parseInt(e.target.value, 10))}
                disabled={!ambientEnabled}
                className="w-full h-1.5 bg-black/40 border border-white/[0.05] accent-[#d0a78b] rounded-lg appearance-none cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed transition-all duration-300"
                aria-label="Ambient Volume"
                title="Ambient Volume"
              />
              <span className="text-xs font-mono font-bold text-zinc-300 shrink-0 w-6 text-right">{ambientVolume}</span>
            </div>
          </div>
        </section>

        {/* Location Access */}
        <section className="space-y-3">
          <h2 className="text-[11px] font-bold tracking-[0.2em] uppercase text-white/40 mb-3 px-1">Location</h2>
          <div className="bg-white/[0.02] backdrop-blur-md border border-white/[0.04] rounded-3xl shadow-[0_8px_32px_rgba(0,0,0,0.4)] overflow-hidden transition-all duration-300 hover:border-white/[0.07] hover:bg-white/[0.03]">
            <div className="p-5 flex items-center justify-between">
              <div className="flex flex-col gap-0.5 pr-4">
                <span className="text-[14px] text-zinc-100 font-bold tracking-wide">Location Access</span>
                <span className="text-[11px] text-zinc-400 font-medium leading-relaxed">Allow Beatrice to use your location for time-based greetings, weather, and local services</span>
              </div>
              <button
                onClick={async () => {
                  const next = !locationEnabled;
                  if (next) {
                    try {
                      const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
                        navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 10000 });
                      });
                      setLocationEnabled(true);
                      try {
                        localStorage.setItem('beatrice_latitude', String(pos.coords.latitude));
                        localStorage.setItem('beatrice_longitude', String(pos.coords.longitude));
                        localStorage.setItem('beatrice_timezone', Intl.DateTimeFormat().resolvedOptions().timeZone);
                      } catch {}
                    } catch {
                      setLocationEnabled(false);
                    }
                  } else {
                    setLocationEnabled(false);
                    try {
                      localStorage.removeItem('beatrice_latitude');
                      localStorage.removeItem('beatrice_longitude');
                      localStorage.removeItem('beatrice_timezone');
                    } catch {}
                  }
                }}
                aria-pressed={locationEnabled}
                aria-label="Toggle Location Access"
                title="Toggle Location Access"
                className={`w-10 h-6 rounded-full transition-all duration-300 flex items-center shrink-0 cursor-pointer ${locationEnabled ? 'bg-[#d0a78b] shadow-[0_0_10px_rgba(208,167,139,0.3)]' : 'bg-zinc-800'}`}
              >
                <span className={`block w-4.5 h-4.5 rounded-full bg-white transition-all duration-300 shadow-md ${locationEnabled ? 'ml-[18px]' : 'ml-[3px]'}`} />
              </button>
            </div>
            <div className="px-5 pb-4">
              <div className="flex items-center gap-2 bg-white/[0.02] rounded-xl px-3 py-2 border border-white/[0.02]">
                <div className={`w-1.5 h-1.5 rounded-full ${locationEnabled ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.6)] animate-pulse' : 'bg-zinc-600'}`} />
                <span className={`text-[10px] font-bold uppercase tracking-wider ${locationEnabled ? 'text-emerald-400' : 'text-zinc-500'}`}>
                  {locationEnabled ? 'Active' : 'Disabled'}
                </span>
              </div>
            </div>
          </div>
        </section>

        {/* WhatsApp Integration Card */}
        <WhatsAppSettings userId={user.uid} />

        {/* Skills & Capabilities Dashboard */}
        <section className="space-y-3">
          <h2 className="text-[11px] font-bold tracking-[0.2em] uppercase text-white/40 mb-3 px-1">Skills & Capabilities</h2>
          <div className="bg-white/[0.02] backdrop-blur-md border border-white/[0.04] rounded-3xl shadow-[0_8px_32px_rgba(0,0,0,0.4)] overflow-hidden transition-all duration-300 hover:border-white/[0.07] hover:bg-white/[0.03]">
            
            {/* WhatsApp Skills */}
            <div className="p-4 border-b border-white/[0.03]">
              <span className="text-[10px] font-bold tracking-[0.15em] uppercase text-zinc-500">WhatsApp Skills</span>
            </div>
            {[
              { key: 'send_messages', label: 'Send Messages', desc: 'Send texts on your behalf' },
              { key: 'read_chats', label: 'Read Chats', desc: 'Scan incoming messages' },
              { key: 'access_contacts', label: 'Access Contacts', desc: 'Search contact records' },
              { key: 'manage_contacts', label: 'Manage Contacts', desc: 'Register or update contacts' },
              { key: 'access_groups', label: 'Access Groups', desc: 'Browse joined groups' },
              { key: 'send_group_messages', label: 'Send Group Messages', desc: 'Post to groups' },
              { key: 'read_group_chats', label: 'Read Group Chats', desc: 'Analyze group discussions' },
              { key: 'view_message_history', label: 'View Message History', desc: 'Read past conversation logs' },
            ].map((s, i, arr) => (
              <SkillPermissionItem
                key={s.key}
                label={s.label}
                desc={s.desc}
                isEnabled={waPermissions[s.key]}
                onToggle={() => setWaPermissions(prev => ({ ...prev, [s.key]: !prev[s.key] }))}
                isLast={i === arr.length - 1}
              />
            ))}

            {/* Google Services */}
            <div className="p-4 border-b border-white/[0.03] border-t border-white/[0.06]">
              <span className="text-[10px] font-bold tracking-[0.15em] uppercase text-zinc-500">Google Services</span>
            </div>
            {[
              { key: 'gmail', label: 'Gmail', desc: 'Read and send emails' },
              { key: 'calendar', label: 'Calendar', desc: 'View events and schedules' },
              { key: 'tasks', label: 'Tasks', desc: 'Manage to-do lists' },
              { key: 'drive', label: 'Drive', desc: 'List and search files' },
              { key: 'youtube', label: 'YouTube', desc: 'Search and discover videos' },
            ].map((s, i, arr) => (
              <SkillPermissionItem
                key={s.key}
                label={s.label}
                desc={s.desc}
                isEnabled={waPermissions[s.key]}
                onToggle={() => setWaPermissions(prev => ({ ...prev, [s.key]: !prev[s.key] }))}
                isLast={i === arr.length - 1}
              />
            ))}

            {/* Phone Skills */}
            <div className="p-4 border-b border-white/[0.03] border-t border-white/[0.06]">
              <span className="text-[10px] font-bold tracking-[0.15em] uppercase text-zinc-500">Phone Skills</span>
            </div>
            {[
              { key: 'make_calls', label: 'Make Phone Calls', desc: 'Dial via native phone dialer' },
              { key: 'make_whatsapp_calls', label: 'WhatsApp Calls', desc: 'Voice and video calls on WhatsApp' },
            ].map((s, i, arr) => (
              <SkillPermissionItem
                key={s.key}
                label={s.label}
                desc={s.desc}
                isEnabled={waPermissions[s.key]}
                onToggle={() => setWaPermissions(prev => ({ ...prev, [s.key]: !prev[s.key] }))}
                isLast={i === arr.length - 1}
              />
            ))}

            {/* Creative Skills */}
            <div className="p-4 border-b border-white/[0.03] border-t border-white/[0.06]">
              <span className="text-[10px] font-bold tracking-[0.15em] uppercase text-zinc-500">Creative Skills</span>
            </div>
            {[
              { key: 'generate_image', label: 'Image Generation', desc: 'Create vivid, detailed visuals' },
              { key: 'create_document', label: 'Document Generation', desc: 'Draft employment agreements, NDAs, invoices, proposals, etc.' }
            ].map((s, i, arr) => (
              <SkillPermissionItem
                key={s.key}
                label={s.label}
                desc={s.desc}
                isEnabled={waPermissions[s.key]}
                onToggle={() => setWaPermissions(prev => ({ ...prev, [s.key]: !prev[s.key] }))}
                isLast={i === arr.length - 1}
              />
            ))}

            {/* Browser Automation */}
            <div className="p-4 border-b border-white/[0.03] border-t border-white/[0.06]">
              <span className="text-[10px] font-bold tracking-[0.15em] uppercase text-zinc-500">Browser Automation</span>
            </div>
            {[
              { key: 'playwright_action', label: 'Playwright Actions', desc: 'Open pages, click, fill, inspect, and screenshot' }
            ].map((s, i, arr) => (
              <SkillPermissionItem
                key={s.key}
                label={s.label}
                desc={s.desc}
                isEnabled={waPermissions[s.key]}
                onToggle={() => setWaPermissions(prev => ({ ...prev, [s.key]: !prev[s.key] }))}
                isLast={i === arr.length - 1}
              />
            ))}

            {/* Travel Skills */}
            <div className="p-4 border-b border-white/[0.03] border-t border-white/[0.06]">
              <span className="text-[10px] font-bold tracking-[0.15em] uppercase text-zinc-500">Travel Skills</span>
            </div>
            {[
              { key: 'search_flights', label: 'Flight Search', desc: 'Search for best flight options in real-time' },
              { key: 'book_flight', label: 'Flight Booking', desc: 'Secure flight tickets via Duffel API' },
            ].map((s, i, arr) => (
              <SkillPermissionItem
                key={s.key}
                label={s.label}
                desc={s.desc}
                isEnabled={waPermissions[s.key]}
                onToggle={() => setWaPermissions(prev => ({ ...prev, [s.key]: !prev[s.key] }))}
                isLast={i === arr.length - 1}
              />
            ))}

            {/* Belgian Admin Skills */}
            <div className="p-4 border-b border-white/[0.03] border-t border-white/[0.06]">
              <span className="text-[10px] font-bold tracking-[0.15em] uppercase text-zinc-500">Belgian Admin Skills</span>
            </div>
            {[
              { key: 'validate_vat_number', label: 'VAT Verification & KBO Lookup', desc: 'Retrieve registered info and check VAT status' },
              { key: 'check_train_route', label: 'iRail Route Planner', desc: 'Live SNCB train departure platform and delays' },
              { key: 'calculate_registration_tax', label: 'Registration Tax Calculator', desc: 'Calculate house purchase closing costs' },
              { key: 'check_tax_deadlines', label: 'Belgian Tax Deadlines', desc: 'Upcoming VAT, CIT, PIT social deadlines' },
              { key: 'generate_peppol_invoice_xml', label: 'Peppol UBL XML Generator', desc: 'Format standard compliant Peppol BIS Billing 3.0 invoice' }
            ].map((s, i, arr) => (
              <SkillPermissionItem
                key={s.key}
                label={s.label}
                desc={s.desc}
                isEnabled={waPermissions[s.key]}
                onToggle={() => setWaPermissions(prev => ({ ...prev, [s.key]: !prev[s.key] }))}
                isLast={i === arr.length - 1}
              />
            ))}

          </div>
        </section>

        {/* Save */}
        <section className="pt-4">
          <button
            onClick={handleSaveSettings}
            disabled={isSaving}
            className="w-full p-4 bg-[#d0a78b] hover:brightness-110 active:scale-[0.98] disabled:opacity-50 rounded-[20px] text-center transition-all duration-200 cursor-pointer shadow-[0_6px_24px_rgba(208,167,139,0.25)] hover:shadow-[0_8px_30px_rgba(208,167,139,0.4)] flex items-center justify-center gap-2"
          >
            {isSaving ? <Loader2 className="w-5 h-5 animate-spin text-black" /> : <Save className="w-5 h-5 text-black" />}
            <span className="text-[15px] font-bold tracking-tight text-black">Save Settings</span>
          </button>
        </section>
      </div>
    </div>
  );
}
