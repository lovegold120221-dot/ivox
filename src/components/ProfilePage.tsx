import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Upload, Trash2, Link, Globe, User, Mail, Check, Loader2, FileText, AlertCircle, LogOut } from 'lucide-react';
import { auth } from '../firebase';
import { signOut } from 'firebase/auth';
import { supabase } from '../lib/supabase';
import {
  uploadAvatar,
  uploadKnowledgeFile,
  listKnowledgeFiles,
  deleteKnowledgeFile,
  updateKnowledgeDomains,
} from '../lib/supabaseStorage';
import { startWhatsAppPairing, getWhatsAppStatus, disconnectWhatsApp } from '../lib/whatsappClient';

interface ProfilePageProps {
  onClose: () => void;
}

const LS_KEY = 'beatrice_knowledge_domains';

function loadLocalDomains(): string[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveLocalDomains(domains: string[]) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(domains));
  } catch {}
}

export function ProfilePage({ onClose }: ProfilePageProps) {
  const user = auth.currentUser!;
  const isGoogleConnected = user.providerData.some(p => p.providerId === 'google.com');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const knowledgeInputRef = useRef<HTMLInputElement>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(user.photoURL);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [knowledgeFiles, setKnowledgeFiles] = useState<Array<{
    id: string; name: string; type: string; size: number; uploadedAt: string; url: string;
  }>>([]);
  const [domains, setDomains] = useState<string[]>(loadLocalDomains);
  const [domainInput, setDomainInput] = useState('');
  const [uploadingFile, setUploadingFile] = useState(false);
  const [deletingFile, setDeletingFile] = useState<string | null>(null);
  const [savingDomains, setSavingDomains] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [waStatus, setWaStatus] = useState<string>('not_found');
  const [waQrCode, setWaQrCode] = useState<string | null>(null);
  const [waPhone, setWaPhone] = useState<string | null>(null);
  const [waPermissions, setWaPermissions] = useState<Record<string, boolean>>({
    send_messages: false, read_chats: false, access_contacts: false, manage_contacts: false,
    access_groups: false, send_group_messages: false, read_group_chats: false, view_message_history: false
  });
  const [waPairing, setWaPairing] = useState(false);
  const waPollRef = useRef<any>(null);

  useEffect(() => {
    loadProfile();
    return () => {
      if (waPollRef.current) clearInterval(waPollRef.current);
    };
  }, []);

  const loadProfile = async () => {
    try {
      const { data: settings } = await supabase
        .from('user_settings')
        .select('avatar_url, knowledge_domains, whatsapp_permissions, whatsapp_paired, whatsapp_phone')
        .eq('user_id', user.uid)
        .single();
      if (settings) {
        if (settings.avatar_url) setAvatarUrl(settings.avatar_url);
        if (settings.knowledge_domains) {
          setDomains(settings.knowledge_domains);
          saveLocalDomains(settings.knowledge_domains);
        }
        if (settings.whatsapp_permissions) setWaPermissions(prev => ({ ...prev, ...settings.whatsapp_permissions }));
        if (settings.whatsapp_paired) setWaStatus('paired');
        if (settings.whatsapp_phone) setWaPhone(settings.whatsapp_phone);
      }
      const files = await listKnowledgeFiles(user.uid);
      setKnowledgeFiles(files);
    } catch (e) {
      console.error('Failed to load profile:', e);
    }
  };

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError('Only image files are allowed for avatar');
      return;
    }
    setUploadingAvatar(true);
    setError(null);
    try {
      const url = await uploadAvatar(user.uid, file);
      setAvatarUrl(url);
      setSuccess('Avatar updated');
      setTimeout(() => setSuccess(null), 2000);
    } catch (e: any) {
      setError(e.message || 'Failed to upload avatar');
    } finally {
      setUploadingAvatar(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleKnowledgeUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingFile(true);
    setError(null);
    try {
      const result = await uploadKnowledgeFile(user.uid, file);
      setKnowledgeFiles(prev => [{
        id: result.id,
        name: result.name,
        type: result.type,
        size: result.size,
        uploadedAt: new Date().toISOString(),
        url: '',
      }, ...prev]);
      setSuccess('File uploaded to knowledge base');
      setTimeout(() => setSuccess(null), 2000);
    } catch (e: any) {
      setError(e.message || 'Failed to upload file');
    } finally {
      setUploadingFile(false);
      if (knowledgeInputRef.current) knowledgeInputRef.current.value = '';
    }
  };

  const handleDeleteFile = async (fileId: string) => {
    setDeletingFile(fileId);
    setError(null);
    try {
      await deleteKnowledgeFile(user.uid, fileId);
      setKnowledgeFiles(prev => prev.filter(f => f.id !== fileId));
    } catch (e: any) {
      setError(e.message || 'Failed to delete file');
    } finally {
      setDeletingFile(null);
    }
  };

  const addDomain = () => {
    const d = domainInput.trim().toLowerCase().replace(/^https?:\/\//, '');
    if (!d) return;
    if (domains.includes(d)) { setDomainInput(''); return; }
    setDomains(prev => [...prev, d]);
    setDomainInput('');
  };

  const removeDomain = (d: string) => {
    setDomains(prev => prev.filter(x => x !== d));
  };

  const saveDomains = async () => {
    setSavingDomains(true);
    setError(null);
    try {
      await updateKnowledgeDomains(user.uid, domains);
      saveLocalDomains(domains);
      setSuccess('Domains saved');
      setTimeout(() => setSuccess(null), 2000);
    } catch (e: any) {
      saveLocalDomains(domains);
      setSuccess('Domains saved locally (Supabase sync pending — run migration in Supabase SQL Editor)');
      setTimeout(() => setSuccess(null), 4000);
    } finally {
      setSavingDomains(false);
    }
  };

  const toggleWaPermission = async (key: string) => {
    const nextPermissions = { ...waPermissions, [key]: !waPermissions[key] };
    setWaPermissions(nextPermissions);
    try {
      await supabase.from('user_settings').upsert({
        user_id: user.uid,
        whatsapp_permissions: nextPermissions,
        whatsapp_paired: waStatus === 'paired',
        whatsapp_phone: waPhone || null,
        updated_at: new Date().toISOString()
      });
    } catch (error) {
      console.error('Failed to save WhatsApp permissions:', error);
    }
  };

  const formatSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <motion.div
      initial={{ y: '100%' }}
      animate={{ y: 0 }}
      exit={{ y: '100%' }}
      transition={{ type: "spring", damping: 25, stiffness: 200 }}
      className="fixed inset-0 z-50 bg-[#0F0F11] flex flex-col h-full sm:rounded-t-[32px] sm:overflow-hidden sm:mt-12 shadow-2xl"
    >
      <header className="sticky top-0 w-full bg-[#0F0F11]/80 backdrop-blur-xl border-b border-white/5 px-4 py-3 flex items-center justify-between z-10 shrink-0">
        <div className="w-16" />
        <h1 className="text-base font-semibold tracking-wide text-white">Profile</h1>
        <button
          onClick={onClose}
          className="w-16 text-right text-sm font-semibold text-[#d0a78b] hover:text-white transition-colors"
          aria-label="Done"
        >
          Done
        </button>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-6 pb-20 w-full max-w-lg mx-auto space-y-8">
        
        {/* Success/Error toasts */}
        <AnimatePresence>
          {(error || success) && (
            <motion.div
              initial={{ opacity: 0, y: -10, height: 0 }}
              animate={{ opacity: 1, y: 0, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden"
            >
              <div className={`px-4 py-3 rounded-xl flex items-center gap-2 text-sm mb-4 ${
                error ? 'bg-red-500/10 border border-red-500/20 text-red-400' : 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-400'
              }`}>
                {error ? <AlertCircle className="w-4 h-4 shrink-0" /> : <Check className="w-4 h-4 shrink-0" />}
                <span>{error || success}</span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Account Section */}
        <section>
          <h2 className="text-[13px] uppercase tracking-wide text-zinc-500 font-medium px-4 mb-2">Account</h2>
          <div className="bg-[#1C1C1E] rounded-[20px] overflow-hidden">
            <div className="p-4 flex items-center gap-4">
              <div className="relative group shrink-0">
                <div className="w-[72px] h-[72px] rounded-full bg-zinc-800 overflow-hidden border border-white/10">
                  {avatarUrl ? (
                    <img src={avatarUrl} alt="Avatar" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-zinc-500">
                      <User className="w-8 h-8" />
                    </div>
                  )}
                </div>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploadingAvatar}
                  className="absolute inset-0 rounded-full bg-black/40 flex items-center justify-center transition-opacity"
                >
                  {uploadingAvatar ? (
                    <Loader2 className="w-5 h-5 animate-spin text-white" />
                  ) : (
                    <Upload className="w-5 h-5 text-white/80 drop-shadow-md" />
                  )}
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleAvatarUpload}
                  className="hidden"
                />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[17px] text-white font-medium truncate">{user.displayName || 'User'}</p>
                <p className="text-[15px] text-zinc-400 truncate mt-0.5">{user.email}</p>
                <div className="flex items-center gap-1.5 mt-2">
                  <div className={`w-2 h-2 rounded-full ${isGoogleConnected ? 'bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.5)]' : 'bg-zinc-600'}`} />
                  <span className={`text-[11px] uppercase tracking-wider font-semibold ${isGoogleConnected ? 'text-emerald-500' : 'text-zinc-500'}`}>
                    {isGoogleConnected ? 'Google Connected' : 'Google Disconnected'}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Knowledge Base Section */}
        <section>
          <div className="px-4 mb-2 flex items-baseline justify-between">
            <h2 className="text-[13px] uppercase tracking-wide text-zinc-500 font-medium">Knowledge Base</h2>
          </div>
          <div className="bg-[#1C1C1E] rounded-[20px] overflow-hidden">
            <div 
              onClick={() => !uploadingFile && knowledgeInputRef.current?.click()}
              className="p-4 border-b border-white/5 flex items-center justify-between cursor-pointer active:bg-white/5 transition-colors"
            >
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center shrink-0">
                  {uploadingFile ? <Loader2 className="w-4 h-4 text-[#d0a78b] animate-spin" /> : <Upload className="w-4 h-4 text-[#d0a78b]" />}
                </div>
                <div>
                  <p className="text-[15px] text-white">Upload File</p>
                  <p className="text-[13px] text-zinc-500">txt, pdf, doc, csv, md (Max 10MB)</p>
                </div>
              </div>
            </div>
            <input
              ref={knowledgeInputRef}
              type="file"
              accept=".txt,.csv,.pdf,.doc,.docx,.json,.md,text/plain,text/csv,application/json,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              onChange={handleKnowledgeUpload}
              className="hidden"
            />
            
            {knowledgeFiles.map((f, i) => (
              <div key={f.id} className={`p-4 flex items-center justify-between ${i !== knowledgeFiles.length - 1 ? 'border-b border-white/5' : ''}`}>
                <div className="flex items-center gap-3 min-w-0 flex-1 pr-4">
                  <FileText className="w-5 h-5 text-zinc-400 shrink-0" />
                  <div className="min-w-0">
                    <p className="text-[15px] text-white truncate">{f.name}</p>
                    <p className="text-[13px] text-zinc-500">{formatSize(f.size)}</p>
                  </div>
                </div>
                <button
                  onClick={() => handleDeleteFile(f.id)}
                  disabled={deletingFile === f.id}
                  className="p-2 rounded-full active:bg-white/5 text-zinc-500 hover:text-red-400 transition-colors"
                >
                  {deletingFile === f.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                </button>
              </div>
            ))}
            {knowledgeFiles.length === 0 && (
              <div className="p-4">
                <p className="text-[15px] text-zinc-500 text-center">No files uploaded yet.</p>
              </div>
            )}
          </div>
        </section>

        {/* Domains Section */}
        <section>
          <div className="px-4 mb-2 flex items-baseline justify-between">
            <h2 className="text-[13px] uppercase tracking-wide text-zinc-500 font-medium">URL Domains</h2>
          </div>
          <div className="bg-[#1C1C1E] rounded-[20px] overflow-hidden">
            <div className="p-4 border-b border-white/5 flex gap-2 items-center">
              <input
                type="text"
                value={domainInput}
                onChange={e => setDomainInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addDomain(); } }}
                placeholder="Add website URL (e.g. docs.stripe.com)"
                className="flex-1 bg-transparent text-[15px] text-white focus:outline-none placeholder-zinc-500"
              />
              <button
                onClick={addDomain}
                disabled={!domainInput.trim()}
                className="px-3 py-1 bg-white/10 rounded-full text-[13px] font-semibold text-white disabled:opacity-30 active:bg-white/20"
              >
                Add
              </button>
            </div>
            
            {domains.map((d, i) => (
              <div key={d} className={`p-4 flex items-center justify-between ${i !== domains.length - 1 ? 'border-b border-white/5' : ''}`}>
                <div className="flex items-center gap-3 truncate">
                  <Globe className="w-5 h-5 text-zinc-400 shrink-0" />
                  <p className="text-[15px] text-white truncate">{d}</p>
                </div>
                <button
                  onClick={() => removeDomain(d)}
                  className="p-1 active:bg-white/5 text-zinc-500 hover:text-red-400 transition-colors rounded-full shrink-0 ml-2"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            ))}
            {domains.length === 0 && (
              <div className="p-4">
                <p className="text-[15px] text-zinc-500 text-center">No domains added yet.</p>
              </div>
            )}
          </div>
          
          <button
            onClick={saveDomains}
            disabled={savingDomains}
            className="w-full mt-3 p-4 bg-[#1C1C1E] rounded-[20px] text-center active:bg-[#2C2C2E] transition-colors flex items-center justify-center gap-2"
          >
            {savingDomains ? <Loader2 className="w-5 h-5 animate-spin text-[#d0a78b]" /> : <Check className="w-5 h-5 text-[#d0a78b]" />}
            <span className="text-[15px] font-semibold text-[#d0a78b]">Save Domains to Cloud</span>
          </button>
        </section>

        {/* WhatsApp Integration */}
        <section>
          <div className="px-4 mb-2 flex items-baseline justify-between">
            <h2 className="text-[13px] uppercase tracking-wide text-zinc-500 font-medium">WhatsApp</h2>
          </div>
          <div className="bg-[#1C1C1E] rounded-[20px] overflow-hidden">
            <div className="p-4 flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className={`w-2 h-2 rounded-full ${waStatus === 'paired' ? 'bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.5)]' : waStatus === 'qr_ready' || waStatus === 'init' ? 'bg-amber-500 shadow-[0_0_6px_rgba(245,158,11,0.5)]' : 'bg-zinc-600'}`} />
                  <span className={`text-[13px] font-semibold uppercase tracking-wider ${waStatus === 'paired' ? 'text-emerald-500' : waStatus === 'qr_ready' || waStatus === 'init' ? 'text-amber-500' : 'text-zinc-500'}`}>
                    {waStatus === 'paired' ? `Connected${waPhone ? ` (${waPhone})` : ''}` : waStatus === 'qr_ready' ? 'Scan QR code' : waStatus === 'init' ? 'Connecting...' : 'Not connected'}
                  </span>
                </div>
                {waStatus === 'paired' ? (
                  <button
                    onClick={async () => {
                      await disconnectWhatsApp(user.uid);
                      setWaStatus('not_found');
                      setWaPhone(null);
                      setWaQrCode(null);
                      await supabase.from('user_settings').upsert({ user_id: user.uid, whatsapp_paired: false, whatsapp_phone: null, whatsapp_permissions: waPermissions, updated_at: new Date().toISOString() });
                    }}
                    className="px-3 py-1.5 bg-red-500/10 active:bg-red-500/20 rounded-full text-[13px] font-semibold text-red-500 transition-colors"
                  >
                    Disconnect
                  </button>
                ) : (
                  <button
                    onClick={async () => {
                      setWaPairing(true);
                      try {
                        await startWhatsAppPairing(user.uid);
                        setWaStatus('init');
                        waPollRef.current = setInterval(async () => {
                          try {
                            const s = await getWhatsAppStatus(user.uid);
                            setWaStatus(s.status);
                            if (s.qrCode) setWaQrCode(s.qrCode);
                            if (s.phone) setWaPhone(s.phone);
                            if (s.status === 'paired' || s.status === 'disconnected' || s.error) {
                              if (s.status === 'paired') {
                                await supabase.from('user_settings').upsert({ user_id: user.uid, whatsapp_paired: true, whatsapp_phone: s.phone || null, whatsapp_permissions: waPermissions, updated_at: new Date().toISOString() });
                              }
                              if (waPollRef.current) clearInterval(waPollRef.current);
                              waPollRef.current = null;
                              setWaPairing(false);
                            }
                          } catch {
                            if (waPollRef.current) clearInterval(waPollRef.current);
                            waPollRef.current = null;
                            setWaPairing(false);
                          }
                        }, 1500);
                      } catch (e: any) {
                        setWaPairing(false);
                        if (waPollRef.current) clearInterval(waPollRef.current);
                      }
                    }}
                    disabled={waPairing}
                    className="px-3 py-1.5 bg-white/10 active:bg-white/20 rounded-full text-[13px] font-semibold text-white transition-colors disabled:opacity-50"
                  >
                    {waPairing ? 'Pairing...' : 'Pair'}
                  </button>
                )}
              </div>

              {waQrCode && waStatus === 'qr_ready' && (
                <div className="flex flex-col items-center pt-4 border-t border-white/5">
                  <img src={waQrCode} alt="WhatsApp QR" className="w-48 h-48 rounded-[16px] bg-white p-3 mb-2" />
                  <p className="text-[13px] text-zinc-500 text-center">Open WhatsApp &gt; Linked Devices &gt; Link a Device</p>
                  <button onClick={() => { setWaQrCode(null); setWaStatus('not_found'); }} className="text-[15px] font-semibold text-red-500 mt-2 p-2 active:opacity-70">Cancel</button>
                </div>
              )}
            </div>

            {waStatus === 'paired' && (
              <div className="border-t border-white/5">
                {[
                  { key: 'send_messages', label: 'Send Messages' },
                  { key: 'read_chats', label: 'Read Chats' },
                  { key: 'access_contacts', label: 'Access Contacts' },
                  { key: 'manage_contacts', label: 'Manage Contacts' },
                  { key: 'access_groups', label: 'Access Groups' },
                  { key: 'send_group_messages', label: 'Send Group Messages' },
                  { key: 'read_group_chats', label: 'Read Group Chats' },
                  { key: 'view_message_history', label: 'View Message History' },
                ].map((p, i, arr) => (
                  <div key={p.key} className={`p-3 flex items-center justify-between ${i !== arr.length - 1 ? 'border-b border-white/5' : ''}`}>
                    <span className="text-[15px] text-white">{p.label}</span>
                    <button
                      onClick={() => toggleWaPermission(p.key)}
                      aria-pressed={waPermissions[p.key] ? 'true' : 'false'}
                      className={`w-11 h-6 rounded-full transition-all flex items-center ${waPermissions[p.key] ? 'bg-emerald-500' : 'bg-zinc-700'}`}
                    >
                      <span className={`block w-5 h-5 rounded-full bg-white transition-all shadow-sm ${waPermissions[p.key] ? 'ml-5' : 'ml-[2px]'}`} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        {/* Logout Section */}
        <section>
          <button
            onClick={() => { signOut(auth); onClose(); }}
            className="w-full p-4 bg-[#1C1C1E] rounded-[20px] text-center active:bg-[#2C2C2E] transition-colors"
          >
            <span className="text-[15px] font-semibold text-red-500">Sign Out</span>
          </button>
        </section>

      </div>
    </motion.div>
  );
}
