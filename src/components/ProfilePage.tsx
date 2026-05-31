import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Loader2, Power, Check, Settings, X, Save, Activity, Video, MessageSquare, Globe, User, Mail, FileText, AlertCircle, LogOut, Upload, Trash2, Folder, Download, ExternalLink, Image, ArrowLeft } from 'lucide-react';
import { auth } from '../firebase';
import { signOut } from 'firebase/auth';
import { supabase } from '../lib/supabase';
import { db } from '../lib/db';
import {
  uploadAvatar,
  uploadKnowledgeFile,
  listKnowledgeFiles,
  deleteKnowledgeFile,
  updateKnowledgeDomains,
} from '../lib/supabaseStorage';
import { listOutputs, deleteOutput, type WorkspaceOutput } from '../lib/workspace';

const LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'nl-BE', label: 'Dutch (Belgium) / Vlaams' },
  { code: 'af', label: 'Afrikaans' },
  { code: 'sq', label: 'Albanian' },
  { code: 'am', label: 'Amharic' },
  { code: 'ar', label: 'Arabic' },
  { code: 'hy', label: 'Armenian' },
  { code: 'as', label: 'Assamese' },
  { code: 'ay', label: 'Aymara' },
  { code: 'az', label: 'Azerbaijani' },
  { code: 'bm', label: 'Bambara' },
  { code: 'eu', label: 'Basque' },
  { code: 'be', label: 'Belarusian' },
  { code: 'bn', label: 'Bengali' },
  { code: 'bho', label: 'Bhojpuri' },
  { code: 'bs', label: 'Bosnian' },
  { code: 'br', label: 'Breton' },
  { code: 'bg', label: 'Bulgarian' },
  { code: 'my', label: 'Burmese' },
  { code: 'ca', label: 'Catalan' },
  { code: 'ceb', label: 'Cebuano' },
  { code: 'zh', label: 'Chinese (Simplified)' },
  { code: 'zh-TW', label: 'Chinese (Traditional)' },
  { code: 'co', label: 'Corsican' },
  { code: 'hr', label: 'Croatian' },
  { code: 'cs', label: 'Czech' },
  { code: 'da', label: 'Danish' },
  { code: 'dv', label: 'Divehi' },
  { code: 'nl', label: 'Dutch' },
  { code: 'eo', label: 'Esperanto' },
  { code: 'et', label: 'Estonian' },
  { code: 'ee', label: 'Ewe' },
  { code: 'fi', label: 'Finnish' },
  { code: 'fr', label: 'French' },
  { code: 'gl', label: 'Galician' },
  { code: 'lg', label: 'Ganda' },
  { code: 'ka', label: 'Georgian' },
  { code: 'de', label: 'German' },
  { code: 'el', label: 'Greek' },
  { code: 'gn', label: 'Guarani' },
  { code: 'gu', label: 'Gujarati' },
  { code: 'ht', label: 'Haitian Creole' },
  { code: 'ha', label: 'Hausa' },
  { code: 'haw', label: 'Hawaiian' },
  { code: 'iw', label: 'Hebrew' },
  { code: 'hi', label: 'Hindi' },
  { code: 'hmn', label: 'Hmong' },
  { code: 'hu', label: 'Hungarian' },
  { code: 'is', label: 'Icelandic' },
  { code: 'ig', label: 'Igbo' },
  { code: 'id', label: 'Indonesian' },
  { code: 'ga', label: 'Irish' },
  { code: 'it', label: 'Italian' },
  { code: 'ja', label: 'Japanese' },
  { code: 'jv', label: 'Javanese' },
  { code: 'kn', label: 'Kannada' },
  { code: 'kk', label: 'Kazakh' },
  { code: 'km', label: 'Khmer' },
  { code: 'rw', label: 'Kinyarwanda' },
  { code: 'ko', label: 'Korean' },
  { code: 'kri', label: 'Krio' },
  { code: 'ku', label: 'Kurdish' },
  { code: 'ky', label: 'Kyrgyz' },
  { code: 'lo', label: 'Lao' },
  { code: 'la', label: 'Latin' },
  { code: 'lv', label: 'Latvian' },
  { code: 'ln', label: 'Lingala' },
  { code: 'lt', label: 'Lithuanian' },
  { code: 'mk', label: 'Macedonian' },
  { code: 'mg', label: 'Malagasy' },
  { code: 'ms', label: 'Malay' },
  { code: 'ml', label: 'Malayalam' },
  { code: 'mt', label: 'Maltese' },
  { code: 'mi', label: 'Maori' },
  { code: 'mr', label: 'Marathi' },
  { code: 'mni', label: 'Meiteilon (Manipuri)' },
  { code: 'mn', label: 'Mongolian' },
  { code: 'ne', label: 'Nepali' },
  { code: 'nso', label: 'Northern Sotho' },
  { code: 'no', label: 'Norwegian' },
  { code: 'nb', label: 'Norwegian Bokmål' },
  { code: 'nn', label: 'Norwegian Nynorsk' },
  { code: 'oc', label: 'Occitan' },
  { code: 'or', label: 'Odia (Oriya)' },
  { code: 'om', label: 'Oromo' },
  { code: 'ps', label: 'Pashto' },
  { code: 'fa', label: 'Persian' },
  { code: 'pl', label: 'Polish' },
  { code: 'pt', label: 'Portuguese' },
  { code: 'pt-BR', label: 'Portuguese (Brazil)' },
  { code: 'pa', label: 'Punjabi' },
  { code: 'qu', label: 'Quechua' },
  { code: 'ro', label: 'Romanian' },
  { code: 'rm', label: 'Romansh' },
  { code: 'rn', label: 'Rundi' },
  { code: 'ru', label: 'Russian' },
  { code: 'sm', label: 'Samoan' },
  { code: 'sg', label: 'Sango' },
  { code: 'sa', label: 'Sanskrit' },
  { code: 'gd', label: 'Scottish Gaelic' },
  { code: 'sr', label: 'Serbian' },
  { code: 'st', label: 'Sesotho' },
  { code: 'sn', label: 'Shona' },
  { code: 'sd', label: 'Sindhi' },
  { code: 'si', label: 'Sinhala' },
  { code: 'sk', label: 'Slovak' },
  { code: 'sl', label: 'Slovenian' },
  { code: 'so', label: 'Somali' },
  { code: 'es', label: 'Spanish' },
  { code: 'su', label: 'Sundanese' },
  { code: 'sw', label: 'Swahili' },
  { code: 'ss', label: 'Swati' },
  { code: 'sv', label: 'Swedish' },
  { code: 'tl', label: 'Tagalog' },
  { code: 'ty', label: 'Tahitian' },
  { code: 'tg', label: 'Tajik' },
  { code: 'ta', label: 'Tamil' },
  { code: 'tt', label: 'Tatar' },
  { code: 'te', label: 'Telugu' },
  { code: 'th', label: 'Thai' },
  { code: 'bo', label: 'Tibetan' },
  { code: 'ti', label: 'Tigrinya' },
  { code: 'ts', label: 'Tsonga' },
  { code: 'tn', label: 'Tswana' },
  { code: 'tr', label: 'Turkish' },
  { code: 'tk', label: 'Turkmen' },
  { code: 'uk', label: 'Ukrainian' },
  { code: 'ur', label: 'Urdu' },
  { code: 'ug', label: 'Uyghur' },
  { code: 'uz', label: 'Uzbek' },
  { code: 'vi', label: 'Vietnamese' },
  { code: 'cy', label: 'Welsh' },
  { code: 'fy', label: 'Western Frisian' },
  { code: 'xh', label: 'Xhosa' },
  { code: 'yi', label: 'Yiddish' },
  { code: 'yo', label: 'Yoruba' },
  { code: 'zu', label: 'Zulu' },
];

const VOICE_ALIASES = [
  { id: 'Aoede', name: 'Wonder Woman' },
  { id: 'Charon', name: 'Batman' },
  { id: 'Fenrir', name: 'Wolverine' },
  { id: 'Kore', name: 'Supergirl' },
  { id: 'Puck', name: 'Spider-Man' },
];

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

export function ProfilePage({ 
  onClose
}: ProfilePageProps) {
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
  const [workspaceOutputs, setWorkspaceOutputs] = useState<WorkspaceOutput[]>([]);
  const [loadingWorkspace, setLoadingWorkspace] = useState(false);
  const [deletingWorkspaceId, setDeletingWorkspaceId] = useState<string | null>(null);

  // Internal standalone settings states
  const [personaName, setPersonaName] = useState('Beatrice');
  const [customPrompt, setCustomPrompt] = useState('');
  const [userTitle, setUserTitle] = useState('Boss');
  const [contextSize, setContextSize] = useState(20);
  const [authLanguage, setAuthLanguage] = useState(() => {
    try { return localStorage.getItem('beatrice_language') || 'en'; } catch { return 'en'; }
  });
  const [selectedVoice, setSelectedVoice] = useState('Aoede');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    loadProfile();
    loadWorkspace();
  }, []);

  const loadWorkspace = async () => {
    setLoadingWorkspace(true);
    try {
      const outputs = await listOutputs(user.uid);
      setWorkspaceOutputs(outputs);
    } catch (e) {
      console.error('Failed to load workspace:', e);
    } finally {
      setLoadingWorkspace(false);
    }
  };

  const handleWorkspaceDelete = async (id: string) => {
    setDeletingWorkspaceId(id);
    try {
      await deleteOutput(id);
      setWorkspaceOutputs(prev => prev.filter(w => w.id !== id));
    } catch (e: any) {
      setError(e.message || 'Failed to delete');
    } finally {
      setDeletingWorkspaceId(null);
    }
  };

  const loadProfile = async () => {
    try {
      // Load from local Dexie DB first
      const local = await db.settings.get(user.uid);
      if (local) {
        if (local.personaName) setPersonaName(local.personaName);
        if (local.customPrompt) setCustomPrompt(local.customPrompt);
        if (local.userTitle) setUserTitle(local.userTitle);
        if (local.contextSize) setContextSize(local.contextSize);
        if (local.language) setAuthLanguage(local.language);
        if (local.selectedVoice) setSelectedVoice(local.selectedVoice);
        if (local.avatarUrl) setAvatarUrl(local.avatarUrl);
        if (local.knowledgeDomains) {
          setDomains(local.knowledgeDomains);
          saveLocalDomains(local.knowledgeDomains);
        }
      }

      // Load from Supabase to sync
      const { data: settings } = await supabase
        .from('user_settings')
        .select('avatar_url, knowledge_domains, persona_name, custom_prompt, user_title, context_size, selected_voice, language')
        .eq('user_id', user.uid)
        .maybeSingle();

      if (settings) {
        if (settings.avatar_url) setAvatarUrl(settings.avatar_url);
        if (settings.knowledge_domains) {
          setDomains(settings.knowledge_domains);
          saveLocalDomains(settings.knowledge_domains);
        }
        if (settings.persona_name) setPersonaName(settings.persona_name);
        if (settings.custom_prompt) setCustomPrompt(settings.custom_prompt);
        if (settings.user_title) setUserTitle(settings.user_title);
        if (settings.context_size) setContextSize(settings.context_size);
        if (settings.language) setAuthLanguage(settings.language);
        if (settings.selected_voice) setSelectedVoice(settings.selected_voice);

        // Sync to Dexie
        const localData = await db.settings.get(user.uid) || { userId: user.uid };
        await db.settings.put({
          ...localData,
          avatarUrl: settings.avatar_url || localData.avatarUrl,
          knowledgeDomains: settings.knowledge_domains || localData.knowledgeDomains,
          personaName: settings.persona_name || localData.personaName,
          customPrompt: settings.custom_prompt || localData.customPrompt,
          userTitle: settings.user_title || localData.userTitle,
          contextSize: settings.context_size || localData.contextSize,
          language: settings.language || localData.language,
          selectedVoice: settings.selected_voice || localData.selectedVoice,
        });
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
      setSuccess('Domains saved locally to indexedDB.');
      setTimeout(() => setSuccess(null), 4000);
    } finally {
      setSavingDomains(false);
    }
  };



  const formatSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };
  const handleSaveSettings = async () => {
    setIsSaving(true);
    setError(null);
    setSuccess(null);

    try {
      // Save to local Dexie DB
      const local = await db.settings.get(user.uid) || { userId: user.uid };
      await db.settings.put({
        ...local,
        personaName,
        customPrompt,
        selectedVoice,
        contextSize,
        userTitle,
        language: authLanguage,
        avatarUrl: avatarUrl || undefined,
        updatedAt: new Date().toISOString(),
      });

      // Save to Supabase
      let sbError = null;
      try {
        const { error } = await supabase.from('user_settings').upsert({
          user_id: user.uid,
          persona_name: personaName,
          custom_prompt: customPrompt,
          selected_voice: selectedVoice,
          context_size: contextSize,
          user_title: userTitle,
          language: authLanguage,
          avatar_url: avatarUrl,
          updated_at: new Date().toISOString(),
        });
        sbError = error;
      } catch (e) {
        console.warn('Supabase upsert failed, possibly missing columns. Falling back to local storage...', e);
      }

      if (sbError) {
        console.warn('Supabase upsert returned error:', sbError);
      }

      try { localStorage.setItem('beatrice_userTitle', userTitle); } catch {}
      try { localStorage.setItem('beatrice_language', authLanguage); } catch {}

      setSuccess('Profile settings successfully saved.');
      setTimeout(() => {
        setSuccess(null);
        onClose();
      }, 1500);
    } catch (e: any) {
      const msg = e instanceof Error ? e.message : 'Failed to save settings';
      setError(msg);
      setTimeout(() => setError(null), 4000);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#050505] text-white flex flex-col select-none relative">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(208,167,139,0.02),transparent_75%)] pointer-events-none z-0" />
      
      <header className="sticky top-0 w-full bg-black/80 backdrop-blur-2xl border-b border-white/[0.04] px-4 py-3 flex items-center justify-between z-10 shrink-0">
        <button
          onClick={onClose}
          className="flex items-center gap-1.5 text-sm font-semibold text-[#d0a78b] hover:text-white transition-colors active:scale-95 cursor-pointer"
          aria-label="Back"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back</span>
        </button>
        <h1 className="text-base font-semibold tracking-wide text-white">Profile Settings</h1>
        <div className="w-16" />
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
              <div className={`px-4 py-3 rounded-2xl flex items-center gap-2 text-sm backdrop-blur-2xl ${
                error ? 'bg-red-500/10 border border-red-500/20 text-red-400' : 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-400'
              }`}>
                {error ? <AlertCircle className="w-4 h-4 shrink-0" /> : <Check className="w-4 h-4 shrink-0" />}
                <span>{error || success}</span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Account Section */}
        <section className="space-y-3">
          <h2 className="text-[11px] font-['SF_Pro_Text',system-ui,sans-serif] font-bold tracking-[0.2em] uppercase text-white/40 mb-3 px-1">Account</h2>
          <div className="bg-white/[0.02] backdrop-blur-md border border-white/[0.04] rounded-3xl shadow-[0_8px_32px_rgba(0,0,0,0.4)] overflow-hidden transition-all duration-300 hover:border-white/[0.07] hover:bg-white/[0.03]">
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
                  title="Upload Profile Photo"
                  aria-label="Upload Profile Photo"
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
        <section className="space-y-3">
          <div className="px-1 mb-3 flex items-baseline justify-between">
            <h2 className="text-[11px] font-['SF_Pro_Text',system-ui,sans-serif] font-bold tracking-[0.2em] uppercase text-white/40">Knowledge Base</h2>
          </div>
          <div className="bg-white/[0.02] backdrop-blur-md border border-white/[0.04] rounded-3xl shadow-[0_8px_32px_rgba(0,0,0,0.4)] overflow-hidden transition-all duration-300 hover:border-white/[0.07] hover:bg-white/[0.03]">
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
              title="Upload Knowledge Base File"
              aria-label="Upload Knowledge Base File"
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
        <section className="space-y-3">
          <div className="px-1 mb-3 flex items-baseline justify-between">
            <h2 className="text-[11px] font-['SF_Pro_Text',system-ui,sans-serif] font-bold tracking-[0.2em] uppercase text-white/40">URL Domains</h2>
          </div>
          <div className="bg-white/[0.02] backdrop-blur-md border border-white/[0.04] rounded-3xl shadow-[0_8px_32px_rgba(0,0,0,0.4)] overflow-hidden transition-all duration-300 hover:border-white/[0.07] hover:bg-white/[0.03]">
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
                  aria-label={`Remove domain ${d}`}
                  title={`Remove domain ${d}`}
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
            className="w-full mt-3 p-4 bg-white/[0.03] backdrop-blur-2xl border border-white/[0.06] rounded-[20px] text-center active:bg-white/[0.06] transition-all flex items-center justify-center gap-2"
          >
            {savingDomains ? <Loader2 className="w-5 h-5 animate-spin text-[#d0a78b]" /> : <Check className="w-5 h-5 text-[#d0a78b]" />}
            <span className="text-[15px] font-['SF_Pro_Text',system-ui,sans-serif] font-semibold text-[#d0a78b]">Save Domains to Cloud</span>
          </button>
        </section>

        {/* Workspace Section */}
        <section className="space-y-3">
          <div className="px-1 mb-3 flex items-baseline justify-between">
            <h2 className="text-[11px] font-['SF_Pro_Text',system-ui,sans-serif] font-bold tracking-[0.2em] uppercase text-white/40">Workspace</h2>
            <span className="text-[11px] text-zinc-600">auto-saved locally · synced to Drive</span>
          </div>
          <div className="bg-white/[0.02] backdrop-blur-md border border-white/[0.04] rounded-3xl shadow-[0_8px_32px_rgba(0,0,0,0.4)] overflow-hidden transition-all duration-300 hover:border-white/[0.07] hover:bg-white/[0.03]">
            {loadingWorkspace ? (
              <div className="p-8 flex items-center justify-center">
                <Loader2 className="w-5 h-5 animate-spin text-zinc-500" />
              </div>
            ) : workspaceOutputs.length === 0 ? (
              <div className="p-6 text-center">
                <Folder className="w-8 h-8 text-zinc-600 mx-auto mb-2" />
                <p className="text-[15px] text-zinc-500">No outputs yet.</p>
                <p className="text-[13px] text-zinc-600 mt-1">Documents, images, and captures from Beatrice will appear here.</p>
              </div>
            ) : (
              workspaceOutputs.map((w, i) => (
                <div key={w.id} className={`p-4 flex items-center justify-between ${i !== workspaceOutputs.length - 1 ? 'border-b border-white/5' : ''}`}>
                  <div className="flex items-center gap-3 min-w-0 flex-1 pr-4">
                    <div className="w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center shrink-0">
                      {w.type === 'image' || w.type === 'screenshot' || w.type === 'capture' ? (
                        <Image className="w-4 h-4 text-zinc-400" />
                      ) : (
                        <FileText className="w-4 h-4 text-zinc-400" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="text-[15px] text-white truncate">{w.title}</p>
                      <p className="text-[11px] text-zinc-500 flex items-center gap-2 mt-0.5">
                        <span className="capitalize">{w.type}</span>
                        <span>&middot;</span>
                        <span>{w.fileSize < 1024 ? `${w.fileSize} B` : w.fileSize < 1048576 ? `${(w.fileSize / 1024).toFixed(1)} KB` : `${(w.fileSize / 1048576).toFixed(1)} MB`}</span>
                        <span>&middot;</span>
                        <span>{new Date(w.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric' })}</span>
                      </p>
                      {w.driveLink && (
                        <a
                           href={w.driveLink}
                           target="_blank"
                           rel="noopener noreferrer"
                           className="text-[11px] text-[#d0a78b] hover:underline inline-flex items-center gap-1 mt-0.5"
                           onClick={e => e.stopPropagation()}
                        >
                           <ExternalLink className="w-3 h-3" />
                           Drive
                        </a>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {w.textContent && (
                      <button
                        onClick={() => {
                          const blob = new Blob([w.textContent!], { type: w.mimeType });
                          const url = URL.createObjectURL(blob);
                          window.open(url, '_blank');
                          setTimeout(() => URL.revokeObjectURL(url), 60000);
                        }}
                        className="p-2 rounded-full active:bg-white/5 text-zinc-500 hover:text-[#d0a78b] transition-colors"
                        aria-label="Preview"
                        title="Preview"
                      >
                        <Download className="w-4 h-4" />
                      </button>
                    )}
                    <button
                      onClick={() => handleWorkspaceDelete(w.id)}
                      disabled={deletingWorkspaceId === w.id}
                      className="p-2 rounded-full active:bg-white/5 text-zinc-500 hover:text-red-400 transition-colors"
                      aria-label="Delete"
                      title="Delete"
                    >
                      {deletingWorkspaceId === w.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
          {workspaceOutputs.length > 0 && (
            <p className="text-[11px] text-zinc-600 px-4 mt-2">
              {workspaceOutputs.filter(w => w.driveLink).length}/{workspaceOutputs.length} synced to Google Drive
            </p>
          )}
        </section>

        {/* Persona Settings */}
        <section className="space-y-3">
          <h2 className="text-[11px] font-['SF_Pro_Text',system-ui,sans-serif] font-bold tracking-[0.2em] uppercase text-white/40 mb-3 px-1">Persona Configuration</h2>
          <div className="bg-white/[0.02] backdrop-blur-md border border-white/[0.04] rounded-3xl shadow-[0_8px_32px_rgba(0,0,0,0.4)] overflow-hidden transition-all duration-300 hover:border-white/[0.07] hover:bg-white/[0.03] divide-y divide-white/5">
            <div className="p-4 flex flex-col gap-1">
              <label className="text-[13px] text-zinc-500">Persona Name</label>
              <input
                type="text"
                value={personaName}
                onChange={(e) => setPersonaName(e.target.value)}
                placeholder="e.g. Beatrice"
                className="bg-transparent text-[15px] text-white focus:outline-none"
              />
            </div>
            <div className="p-4 flex flex-col gap-1">
              <label className="text-[13px] text-zinc-500">System Prompt Context</label>
              <textarea
                value={customPrompt}
                onChange={(e) => setCustomPrompt(e.target.value)}
                placeholder="Enter character traits or specific rules..."
                className="bg-transparent text-[15px] text-white focus:outline-none h-24 resize-none leading-relaxed"
              />
            </div>
            <div className="p-4 flex flex-col gap-1">
              <label className="text-[13px] text-zinc-500">What Should Beatrice Call You?</label>
              <input
                type="text"
                value={userTitle}
                onChange={(e) => setUserTitle(e.target.value)}
                placeholder="e.g. Boss"
                className="bg-transparent text-[15px] text-white focus:outline-none"
              />
            </div>
            <div className="p-4 flex flex-col gap-1">
              <label htmlFor="context-size-slider" className="text-[13px] text-zinc-500">Conversation Context (Messages)</label>
              <div className="flex items-center gap-4 mt-2">
                <input
                  id="context-size-slider"
                  type="range"
                  min="0"
                  max="50"
                  step="1"
                  value={contextSize}
                  onChange={(e) => setContextSize(parseInt(e.target.value))}
                  className="w-full accent-amber-500 h-1.5 bg-white/5 rounded-lg appearance-none cursor-pointer"
                  aria-label="Conversation Context (Messages)"
                  title="Conversation Context (Messages)"
                />
                <span className="text-[13px] text-zinc-500 shrink-0 w-6 text-right">{contextSize}</span>
              </div>
            </div>
          </div>
        </section>

        {/* Language & Voice */}
        <section className="space-y-3">
          <h2 className="text-[11px] font-['SF_Pro_Text',system-ui,sans-serif] font-bold tracking-[0.2em] uppercase text-white/40 mb-3 px-1">Speech & Language</h2>
          <div className="bg-white/[0.02] backdrop-blur-md border border-white/[0.04] rounded-3xl shadow-[0_8px_32px_rgba(0,0,0,0.4)] overflow-hidden transition-all duration-300 hover:border-white/[0.07] hover:bg-white/[0.03] divide-y divide-white/5">
            <div className="p-4 flex items-center justify-between">
              <label htmlFor="language-select" className="text-[15px] text-white">Language</label>
              <select
                id="language-select"
                value={authLanguage}
                onChange={(e) => {
                  setAuthLanguage(e.target.value);
                  try { localStorage.setItem('beatrice_language', e.target.value); } catch {}
                }}
                className="bg-transparent text-[15px] text-zinc-400 outline-none text-right cursor-pointer"
                aria-label="Select Language"
                title="Select Language"
              >
                {LANGUAGES.map(l => (
                  <option key={l.code} value={l.code} className="bg-[#1C1C1E] text-white">{l.label}</option>
                ))}
              </select>
            </div>
            <div className="p-4 flex flex-col gap-3">
              <span className="text-[15px] text-white mb-1">Agent Voice</span>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {VOICE_ALIASES.map(v => (
                  <button
                    key={v.id}
                    onClick={() => setSelectedVoice(v.id)}
                    className={`flex items-center justify-between px-4 py-3 rounded-xl transition-all ${selectedVoice === v.id ? 'bg-amber-500/10 text-amber-500 font-medium' : 'bg-white/5 text-zinc-400'}`}
                  >
                    <span>{v.name}</span>
                    {selectedVoice === v.id && <Check className="w-4 h-4" />}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="space-y-3">
          <button
            onClick={handleSaveSettings}
            disabled={isSaving}
            className="w-full p-4 bg-[#d0a78b] rounded-[20px] text-center active:brightness-90 transition-all disabled:opacity-50 flex items-center justify-center gap-2 shadow-lg shadow-[#d0a78b]/20"
          >
            {isSaving ? <Loader2 className="w-5 h-5 animate-spin text-black" /> : <Save className="w-5 h-5 text-black" />}
            <span className="text-[15px] font-['SF_Pro_Text',system-ui,sans-serif] font-bold text-black">Save Settings</span>
          </button>
        </section>

        {/* Logout Section */}
        <section className="space-y-3">
          <button
            onClick={() => { signOut(auth); onClose(); }}
            className="w-full p-4 bg-white/[0.03] backdrop-blur-2xl border border-white/[0.06] rounded-[20px] text-center active:bg-white/[0.06] transition-all"
          >
            <span className="text-[15px] font-['SF_Pro_Text',system-ui,sans-serif] font-semibold text-red-400">Sign Out</span>
          </button>
        </section>

      </div>
    </div>
  );
}
