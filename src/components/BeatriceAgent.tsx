import { lazy, Suspense, useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { auth } from '../firebase';
import { User } from 'firebase/auth';
import { db, type LongTermMemory } from '../lib/db';
import { saveFileToOpfs, getOpfsFileUrl } from '../lib/opfs';
import { GoogleGenAI, LiveServerMessage, Modality, Type, FunctionDeclaration } from '@google/genai';
import { AmbientConversationBed, AudioRecorder, AudioStreamer } from '../lib/audio';
import { listKnowledgeFiles, fetchKnowledgeFileContent } from '../lib/supabaseStorage';
import { Loader2, Power, Check, Settings, X, Save, Video, MessageSquare, Download } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { UnifiedTranscript } from './UnifiedTranscript';
import { SkillPermissionItem } from './SkillPermissionItem';
import { saveOutput, uploadToDrive } from '../lib/workspace';
import { startWhatsAppPairing, getWhatsAppStatus, disconnectWhatsApp } from '../lib/whatsappClient';
import { webGlance } from '../lib/webClient';
import { runPlaywrightAction } from '../lib/playwrightClient';
import { duffelClient } from '../lib/duffelClient';
import { createLiveUserTurn, mergeTranscriptText, toLiveUserMessage, type LiveUserTurn } from '../lib/liveTranscript';
import { isGoogleLinked } from './EntryFlow';
import { googleTools, googleTokenRequiredTools, additionalToolDeclarations } from '../lib/toolDeclarations';
import { VOICE_PERSONALITY_PROMPT, GLOBAL_KNOWLEDGE_BASE, PERSONA_REINFORCEMENT, getEnv, getGeminiApiKey, escapeHtml, clampTemplateContent, extractHtmlArtifact } from '../lib/constants';
import { createDefaultAgentPermissions } from '../lib/permissions';

const ChatPage = lazy(() => import('./ChatPage').then(module => ({ default: module.ChatPage })));
const VideoPage = lazy(() => import('./VideoPage').then(module => ({ default: module.VideoPage })));
const DocumentViewer = lazy(() => import('./DocumentViewer').then(module => ({ default: module.DocumentViewer })));
const ProfilePage = lazy(() => import('./ProfilePage').then(module => ({ default: module.ProfilePage })));
const WhatsAppSettings = lazy(() => import('./WhatsAppSettings').then(module => ({ default: module.WhatsAppSettings })));

// ─── Types ──────────────────────────────────────────────────────────
interface ChatMessage {
  id?: number | string;
  role: 'user' | 'model';
  text: string;
  sessionId?: string;
  timestamp: any;
  attachmentUrl?: string;
  attachmentName?: string;
  isLiveTranscript?: boolean;
}

interface ActionTask {
  id: string;
  serviceName: string;
  action: string;
  status: 'processing' | 'completed';
}

type GeminiDocumentRequest = {
  title: string;
  prompt: string;
  templateName?: string;
  userId?: string;
  language?: string;
  personaName?: string;
  historyContext?: string;
};

// ─── Constants ──────────────────────────────────────────────────────
const VOICE_ALIASES = [
  { name: "Queen Hera", id: "Aoede" },
  { name: "King Leonidas", id: "Fenrir" },
  { name: "Queen Persephone", id: "Kore" },
  { name: "King Midas", id: "Puck" },
];

const SILENCE_FILLER_DELAY_MS = 15_000;
const MAX_CONSECUTIVE_SILENCE_FILLERS = 3;
const DEFAULT_AMBIENT_VOLUME = 12;

const DOCUMENT_TEMPLATE_FILES = [
  { key: 'contract', filename: 'contract-sample.html', description: 'Executive employment agreement with editor and preview layout, A4 paper, signature canvas, dynamic data binding, and print styles.' },
  { key: 'invoice', filename: 'invoice-template.html', description: 'Invoice with line items, quantity, price, tax auto-calculation, bill-from and bill-to sections.' },
  { key: 'letter', filename: 'letter-template.html', description: 'Formal business letter with date, recipient, subject, body, and signature block.' },
  { key: 'proposal', filename: 'proposal-template.html', description: 'Business proposal with executive summary, scope, pricing table, timeline, and terms.' },
  { key: 'minutes', filename: 'minutes-template.html', description: 'Meeting minutes with agenda items, key decisions, action item table, and attendee list.' },
  { key: 'memo', filename: 'memo-template.html', description: 'Internal company memorandum with To, From, Date, and Subject header.' },
  { key: 'purchase-order', filename: 'purchase-order-template.html', description: 'Purchase order with supplier info, line items, VAT calculation, and delivery terms.' },
  { key: 'receipt', filename: 'receipt-template.html', description: 'Payment receipt with paid-in-full confirmation and customer details.' },
  { key: 'resignation', filename: 'resignation-template.html', description: 'Formal resignation letter with notice period and last working day.' },
  { key: 'nda', filename: 'nda-template.html', description: 'Mutual non-disclosure agreement with purpose, obligations, term, governing law, and dual signature.' },
  { key: 'certificate', filename: 'certificate-template.html', description: 'Certificate of completion with gold border, seal, recipient name, and issuer signature.' },
];

const SILENCE_FILLER_STYLES = [
  {
    key: 'warm-presence',
    weight: 5,
    minCount: 0,
    maxCount: 3,
    instruction: 'Give one warm, human presence cue. Example shape: "Mm... take your time." Keep it calm and under eight words.',
  },
  {
    key: 'quiet-reading',
    weight: 2,
    minCount: 0,
    maxCount: 2,
    instruction: 'Sound like you are quietly reading a public topic to yourself in a low tone. Speak from general knowledge only — do NOT call any tools. Keep it timeless and brief.',
  },
  {
    key: 'hum',
    weight: 2,
    minCount: 0,
    maxCount: 2,
    instruction: 'Hum a tiny original melody with soft syllables like "hm hmm..." then say one short human line. Do not quote a full known song.',
  },
  {
    key: 'tiny-song',
    weight: 1,
    minCount: 0,
    maxCount: 1,
    instruction: 'Do a tiny playful sing-song referencing "Leef" by Clouseau. Hum a few notes like "hm hm hmm..." then sing one or two lines from the chorus naturally, like "Leef... alsof het je laatste dag zou zijn..." — trail off with a soft laugh. Keep it light and brief.',
  },
] as const;

const inferDocumentTemplate = (title: string, prompt: string, explicit?: string) => {
  const text = `${explicit || ''} ${title} ${prompt}`.toLowerCase();

  const matches = [
    ['contract', ['contract', 'agreement', 'employment agreement']],
    ['invoice', ['invoice', 'billing', 'bill ', 'line item']],
    ['letter', ['letter', 'formal letter', 'business letter']],
    ['proposal', ['proposal', 'scope of work', 'pricing table', 'business proposal']],
    ['minutes', ['meeting minutes', 'minutes', 'agenda', 'action items']],
    ['memo', ['memo', 'memorandum']],
    ['purchase-order', ['purchase order', 'po ', 'supplier']],
    ['receipt', ['receipt', 'paid', 'payment receipt']],
    ['resignation', ['resignation', 'resign', 'notice period']],
    ['nda', ['nda', 'non-disclosure', 'confidentiality']],
    ['certificate', ['certificate', 'completion', 'award']],
  ] as const;

  for (const [key, words] of matches) {
    if (words.some(word => text.includes(word))) return key;
  }

  return 'proposal';
};

const loadPublicDocumentTemplates = async (preferredTemplateKey: string) => {
  const ordered = [
    ...DOCUMENT_TEMPLATE_FILES.filter(t => t.key === preferredTemplateKey),
    ...DOCUMENT_TEMPLATE_FILES.filter(t => t.key !== preferredTemplateKey),
  ];

  const selected = ordered.slice(0, 4);
  const loaded = await Promise.all(
    selected.map(async template => {
      try {
        const res = await fetch(`/${template.filename}`, { cache: 'no-cache' });
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        const html = await res.text();
        return {
          ...template,
          html: clampTemplateContent(html),
          loaded: true,
        };
      } catch (error) {
        return {
          ...template,
          html: `<!-- Could not load /${template.filename}: ${String(error)} -->`,
          loaded: false,
        };
      }
    })
  );

  return loaded;
};

interface GeminiImageRequest {
  prompt: string;
  aspectRatio?: '1:1' | '3:4' | '4:3' | '9:16' | '16:9';
}

const generateImageWithGemini = async (request: GeminiImageRequest): Promise<{ imageBytesBase64: string, mimeType: string }> => {
  const apiKey = getGeminiApiKey();

  if (!apiKey) {
    throw new Error('Missing Gemini API key. Add VITE_GEMINI_API_KEY to your environment.');
  }

  // Uses the new Gemini 2.5 Flash image generation API
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

  const payload = {
    contents: [
      {
        role: "user",
        parts: [{ text: request.prompt }]
      }
    ],
    generationConfig: {
      temperature: 1,
      maxOutputTokens: 32768,
      responseModalities: ["TEXT", "IMAGE"],
      topP: 0.95,
      // Pass imageConfig for Image Modality
      imageConfig: {
        aspectRatio: request.aspectRatio || "1:1",
        imageSize: "1K",
        imageOutputOptions: {
          mimeType: "image/png"
        },
        personGeneration: "ALLOW_ALL"
      }
    },
    safetySettings: [
      { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "OFF" },
      { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "OFF" },
      { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "OFF" },
      { category: "HARM_CATEGORY_HARASSMENT", threshold: "OFF" }
    ]
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Gemini Image API failed: ${response.status} ${errText}`);
  }

  const data = await response.json();
  const inlineData = data.candidates?.[0]?.content?.parts?.[0]?.inlineData;
  if (!inlineData) {
    throw new Error('No image returned from Gemini API.');
  }

  return {
    imageBytesBase64: inlineData.data,
    mimeType: inlineData.mimeType || 'image/png'
  };
};

const generateDocumentWithGemini = async (request: GeminiDocumentRequest) => {
  const apiKey = getGeminiApiKey();

  if (!apiKey) {
    throw new Error('Missing Gemini API key. Add VITE_GEMINI_API_KEY to your environment.');
  }

  const preferredTemplateKey = inferDocumentTemplate(request.title, request.prompt, request.templateName);
  const templates = await loadPublicDocumentTemplates(preferredTemplateKey);

  const templateCatalog = DOCUMENT_TEMPLATE_FILES
    .map(t => `- ${t.filename}: ${t.description}`)
    .join('\n');

  const templatePayload = templates
    .map(t => `\n\n--- TEMPLATE: /${t.filename} (${t.loaded ? 'loaded' : 'not loaded'}) ---\n${t.description}\n${t.html}`)
    .join('\n');

  const systemPrompt = `
You are a senior document designer and frontend artifact generator.
Generate exactly one complete standalone HTML document.
The document must be production-quality, printable, mobile-responsive, and self-contained.

Hard rules:
- Return only the final HTML document.
- Start with <!DOCTYPE html>.
- Include <html>, <head>, and <body>.
- Embed all CSS in a <style> tag.
- Embed all JavaScript in a <script> tag only if useful.
- Use no external scripts, no external CSS, no remote images, no CDNs.
- Do not include markdown fences.
- Do not explain your work.
- Do not mention HTML to the user inside the visible document.
- The artifact must work as a browser preview.
- Include @media print styles.
- Use semantic structure.
- For forms, invoices, purchase orders, or editable documents, include useful live-preview or calculation JavaScript when appropriate.
- Use the provided /public templates as structural and visual references, not as text to copy blindly.
- Preserve legal/business document clarity. Use placeholders when the user has not supplied details.
`;

  const userPrompt = `
Create this web artifact document.

Title:
${request.title}

User request:
${request.prompt}

User language code:
${request.language || 'en'}

Preferred template family:
${preferredTemplateKey}

Available template catalog:
${templateCatalog}

Reference templates from /public:
${templatePayload}

Conversation context, if relevant:
${request.historyContext || ''}

Produce one finished standalone file now.
`;

  const ai = new GoogleGenAI({ apiKey });
  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: systemPrompt + '\n\n' + userPrompt,
    config: {
      temperature: 0.25,
    }
  });

  const content = response.text || '';

  if (!content || typeof content !== 'string') {
    throw new Error('Gemini returned no document content.');
  }

  const artifact = extractHtmlArtifact(content);
  if (!artifact) {
    throw new Error('Failed to extract HTML artifact from response.');
  }
  return artifact;
};
export function BeatriceAgent({
  user,
  googleToken,
  setGoogleToken,
  storeToken,
  authLanguage,
  onSetLanguage,
  onLogout,
  onLogin
}: {
  user: User;
  googleToken: string | null;
  setGoogleToken: (token: string | null) => void;
  storeToken: (token: string, uid: string, refreshToken?: string) => void;
  authLanguage: string;
  onSetLanguage: (lang: string) => void;
  onLogout: () => void;
  onLogin: () => void;
}) {
  const [isActive, setIsActive] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [isAgentSpeaking, setIsAgentSpeaking] = useState(false);
  const [volumes, setVolumes] = useState<number[]>(Array(11).fill(0.05));

  const googleTokenRef = useRef<string | null>(googleToken);
  useEffect(() => {
    googleTokenRef.current = googleToken;
  }, [googleToken]);

  const bgAudioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (bgAudioRef.current) {
      if (isActive) {
        bgAudioRef.current.volume = 0.04;
        bgAudioRef.current.play().catch(e => console.warn('bg audio play failed', e));
      } else {
        bgAudioRef.current.pause();
      }
    }
  }, [isActive]);

  const [isCameraActive, setIsCameraActive] = useState(false);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user');
  const [showVideoPage, setShowVideoPage] = useState(false);
  const [showChatPage, setShowChatPage] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);

  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [showInstallBanner, setShowInstallBanner] = useState(false);

  useEffect(() => {
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
      const dismissed = localStorage.getItem('beatrice_pwa_dismissed') === 'true';
      const isStandalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone === true;
      if (!dismissed && !isStandalone) {
        setShowInstallBanner(true);
      }
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

    const handleAppInstalled = () => {
      setDeferredPrompt(null);
      setShowInstallBanner(false);
      console.log('PWA was installed successfully');
    };
    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  const handleInstallClick = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    console.log(`User response to the install prompt: ${outcome}`);
    setDeferredPrompt(null);
    setShowInstallBanner(false);
  };

  const [tasks, setTasks] = useState<ActionTask[]>([]);
  const [historyContext, setHistoryContext] = useState<string>("");
  const historyContextRef = useRef<string>("");
  const [longTermMemoryContext, setLongTermMemoryContext] = useState<string>("");
  const longTermMemoryContextRef = useRef<string>("");
  const [userTranscript, setUserTranscript] = useState<string>('');
  const [modelTranscript, setModelTranscript] = useState<string>('');

  const [showDocumentViewer, setShowDocumentViewer] = useState(false);
  const [activeDocument, setActiveDocument] = useState<{ title: string; content: string; fileType?: string } | null>(null);
  const [personaName, setPersonaName] = useState("Beatrice");
  const [customPrompt, setCustomPrompt] = useState("");
  const [selectedVoice, setSelectedVoice] = useState("Aoede");
  const [contextSize, setContextSize] = useState(20);
  const [userTitle, setUserTitle] = useState(() => {
    try { return localStorage.getItem('beatrice_userTitle') || 'Boss'; } catch { return 'Boss'; }
  });
  const [ambientEnabled, setAmbientEnabled] = useState(() => {
    try { return localStorage.getItem('beatrice_ambient_enabled') !== 'false'; } catch { return true; }
  });
  const [ambientVolume, setAmbientVolume] = useState(() => {
    try {
      const saved = Number(localStorage.getItem('beatrice_ambient_volume'));
      return Number.isFinite(saved) && saved >= 0 ? saved : DEFAULT_AMBIENT_VOLUME;
    } catch {
      return DEFAULT_AMBIENT_VOLUME;
    }
  });
  const firstName = user?.displayName?.split(' ')[0] || '';

  useEffect(() => {
    if (firstName && !localStorage.getItem('beatrice_userTitle')) {
      const defaultAddr = `Boss ${firstName}`;
      setUserTitle(defaultAddr);
      try { localStorage.setItem('beatrice_userTitle', defaultAddr); } catch {}
    }
  }, [firstName]);

  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [locationEnabled, setLocationEnabled] = useState(() => {
    try { return localStorage.getItem('beatrice_location_enabled') === 'true'; } catch { return false; }
  });
  const [waStatus, setWaStatus] = useState<string>('not_found');
  const [waQrCode, setWaQrCode] = useState<string | null>(null);
  const [waPhone, setWaPhone] = useState<string | null>(null);
  const [waPairing, setWaPairing] = useState(false);
  const [waPermissions, setWaPermissions] = useState<Record<string, boolean>>(createDefaultAgentPermissions);
  const waPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const breathLevel = useMemo(() => {
    if (volumes.length === 0) return 0;
    const avg = volumes.reduce((a, b) => a + b, 0) / volumes.length;
    return Math.pow(Math.min(1, avg * 2), 0.7);
  }, [volumes]);

  const aiRef = useRef<GoogleGenAI | null>(null);
  const sessionRef = useRef<any>(null);
  const sessionStartingRef = useRef(false);
  const sessionIdRef = useRef<string>(crypto.randomUUID());

  const audioStreamerRef = useRef<AudioStreamer | null>(null);
  const audioRecorderRef = useRef<AudioRecorder | null>(null);
  const ambientBedRef = useRef<AmbientConversationBed | null>(null);
  const ambientDuckTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cloudCanvasRef = useRef<HTMLCanvasElement>(null);
  const stopCanvasRef = useRef<HTMLCanvasElement>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const screenShareActiveRef = useRef(false);
  const videoStreamRef = useRef<MediaStream | null>(null);
  const videoIntervalRef = useRef<any>(null);

  const userTranscriptRef = useRef<string>('');
  const modelTranscriptRef = useRef<string>('');
  const pendingUserTurnRef = useRef<LiveUserTurn | null>(null);
  const transcriptTimeoutRef = useRef<any>(null);
  const speakingTimeoutRef = useRef<any>(null);
  const isActiveRef = useRef(false);
  const isAgentSpeakingRef = useRef(false);
  const silenceFillerTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const silenceFillerCountRef = useRef(0);
  const silenceFillerInFlightRef = useRef(false);
  const lastSilenceFillerStyleRef = useRef<string | null>(null);
  const lastUserSpeechAtRef = useRef(Date.now());
  const lastModelTurnCompleteAtRef = useRef(0);
  const isNewTurnRef = useRef(true);

  // --- Conversation persistence for reconnection resilience ---
  const conversationBufferRef = useRef<string[]>([]);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectContextRef = useRef<string>('');
  const MAX_RECONNECT_ATTEMPTS = 5;
  const RECONNECT_BASE_DELAY_MS = 1000;
  const [reconnecting, setReconnecting] = useState(false);

  const buildConversationContext = useCallback(() => {
    const buf = conversationBufferRef.current;
    if (buf.length === 0) return '';
    return 'PREVIOUS CONVERSATION (continue from here, do not repeat yourself):\n' + buf.join('\n');
  }, []);

  isActiveRef.current = isActive;
  isAgentSpeakingRef.current = isAgentSpeaking;

  const ensureAudio = async () => {
    if (!audioStreamerRef.current) {
      audioStreamerRef.current = new AudioStreamer();
    }

    await audioStreamerRef.current.init(24000);
  };

  const ambientGainFromLevel = useCallback((level: number) => {
    return Math.max(0, Math.min(20, level)) / 100;
  }, []);

  const startAmbientBed = useCallback(async () => {
    if (!ambientEnabled) return;

    if (!ambientBedRef.current) {
      ambientBedRef.current = new AmbientConversationBed();
    }

    await ambientBedRef.current.start(ambientGainFromLevel(ambientVolume));
    ambientBedRef.current.duck(isAgentSpeakingRef.current);
  }, [ambientEnabled, ambientGainFromLevel, ambientVolume]);

  const stopAmbientBed = useCallback(() => {
    if (ambientDuckTimeoutRef.current) {
      clearTimeout(ambientDuckTimeoutRef.current);
      ambientDuckTimeoutRef.current = null;
    }

    try {
      ambientBedRef.current?.stop();
    } catch (e) {}
    ambientBedRef.current = null;
  }, []);

  const duckAmbientBriefly = useCallback(() => {
    if (!ambientBedRef.current) return;

    ambientBedRef.current.duck(true);
    if (ambientDuckTimeoutRef.current) clearTimeout(ambientDuckTimeoutRef.current);
    ambientDuckTimeoutRef.current = setTimeout(() => {
      ambientBedRef.current?.duck(isAgentSpeakingRef.current);
    }, 2200);
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem('beatrice_ambient_enabled', String(ambientEnabled));
      localStorage.setItem('beatrice_ambient_volume', String(ambientVolume));
    } catch {}
  }, [ambientEnabled, ambientVolume]);

  useEffect(() => {
    if (!isActive) return;

    if (ambientEnabled) {
      void startAmbientBed();
      return;
    }

    stopAmbientBed();
  }, [ambientEnabled, ambientVolume, isActive, startAmbientBed, stopAmbientBed]);

  useEffect(() => {
    ambientBedRef.current?.duck(isAgentSpeaking);
  }, [isAgentSpeaking]);

  const sendTextToLive = (text: string) => {
    const session = sessionRef.current;

    if (!session || !text.trim()) return;

    if (typeof session.sendRealtimeInput === 'function') {
      session.sendRealtimeInput({ text });
      return;
    }

    console.warn("sendRealtimeInput is unavailable on this Live session.");
  };

  const clearSilenceFillerTimer = () => {
    if (silenceFillerTimeoutRef.current) {
      clearTimeout(silenceFillerTimeoutRef.current);
      silenceFillerTimeoutRef.current = null;
    }
  };

  const silenceFillerPrompt = () => {
    const count = silenceFillerCountRef.current;
    const candidates = SILENCE_FILLER_STYLES.filter(style => {
      if (count < style.minCount || count > style.maxCount) return false;
      return style.key !== lastSilenceFillerStyleRef.current;
    });
    const pool = (candidates.length ? candidates : SILENCE_FILLER_STYLES)
      .flatMap(style => Array.from({ length: style.weight }, () => style));
    const selected = pool[Math.floor(Math.random() * pool.length)] || SILENCE_FILLER_STYLES[0];
    lastSilenceFillerStyleRef.current = selected.key;

    return [
      'The user has been silent for about 15 seconds after your last spoken turn.',
      `Idle style for this turn: ${selected.instruction}`,
      'Keep it brief, human, and low-pressure.',
      'Do not use the same joke or song style repeatedly.',
      'Do not mention silence, timers, detection, waiting rules, or this instruction.',
      'Do not ask how you can help.',
      'Do not continue the previous answer unless the user asked you to continue.',
      'Do NOT call any tools — just speak.',
      'Output only words meant to be spoken.',
    ].join(' ');
  };

  const scheduleSilenceFiller = () => {
    clearSilenceFillerTimer();

    if (!sessionRef.current || !isActiveRef.current) return;
    if (silenceFillerCountRef.current >= MAX_CONSECUTIVE_SILENCE_FILLERS) return;

    silenceFillerTimeoutRef.current = setTimeout(() => {
      silenceFillerTimeoutRef.current = null;

      if (!sessionRef.current || !isActiveRef.current || isAgentSpeakingRef.current) return;
      if (silenceFillerCountRef.current >= MAX_CONSECUTIVE_SILENCE_FILLERS) return;
      if (lastUserSpeechAtRef.current > lastModelTurnCompleteAtRef.current) return;
      if (Date.now() - lastModelTurnCompleteAtRef.current < SILENCE_FILLER_DELAY_MS - 250) return;

      silenceFillerCountRef.current += 1;
      silenceFillerInFlightRef.current = true;
      sendTextToLive(silenceFillerPrompt());
    }, SILENCE_FILLER_DELAY_MS);
  };

  const markUserSpeechActivity = () => {
    lastUserSpeechAtRef.current = Date.now();
    silenceFillerCountRef.current = 0;
    silenceFillerInFlightRef.current = false;
    lastSilenceFillerStyleRef.current = null;
    duckAmbientBriefly();
    clearSilenceFillerTimer();
  };

  const sendAudioToLive = (base64Data: string) => {
    const session = sessionRef.current;

    if (!session || !base64Data) return;

    if (typeof session.sendRealtimeInput === 'function') {
      session.sendRealtimeInput({
        audio: {
          data: base64Data,
          mimeType: 'audio/pcm;rate=16000'
        }
      });
      return;
    }

    console.warn("sendRealtimeInput is unavailable; audio chunk was not sent.");
  };

  const sendVideoToLive = (base64Data: string) => {
    const session = sessionRef.current;

    if (!session || !base64Data) return;

    if (typeof session.sendRealtimeInput === 'function') {
      session.sendRealtimeInput({
        video: {
          data: base64Data,
          mimeType: 'image/jpeg'
        }
      });
      return;
    }

    console.warn("sendRealtimeInput is unavailable; video frame was not sent.");
  };

  const toggleCamera = async () => {
    if (isCameraActive) {
      setCameraStream(null);
      if (videoStreamRef.current) {
        videoStreamRef.current.getTracks().forEach(t => t.stop());
        videoStreamRef.current = null;
      }

      if (videoIntervalRef.current) {
        clearInterval(videoIntervalRef.current);
        videoIntervalRef.current = null;
      }

      setIsCameraActive(false);
      sendTextToLive("The user just turned off their camera. They can no longer see you either.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode, width: 640, height: 480 }
      });

      videoStreamRef.current = stream;
      setCameraStream(stream);

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }

      setIsCameraActive(true);

      videoIntervalRef.current = setInterval(() => {
        if (!sessionRef.current || !videoRef.current || !canvasRef.current || !isActive) return;
        if (screenShareActiveRef.current) return;

        const video = videoRef.current;
        const canvas = canvasRef.current;

        if (video.videoWidth > 0 && video.videoHeight > 0) {
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;

          const ctx = canvas.getContext('2d');

          if (ctx) {
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            const dataUrl = canvas.toDataURL('image/jpeg', 0.6);
            const base64Data = dataUrl.split(',')[1];

            sendVideoToLive(base64Data);
          }
        }
      }, 1000);

      sendTextToLive("The user just turned on their camera. You can now see them. React naturally - greet them like you're on a video call. Make eye contact references, comment on what you see casually, keep it warm and human.");
    } catch (err: any) {
      console.error("Camera error:", err);
      let msg = "Failed to access camera. Please check if your camera is in use or blocked.";
      if (err instanceof Error) {
        if (err.name === 'NotAllowedError' || err.message?.includes('Permission denied')) {
          msg = "Camera access was denied. Please grant camera permission in your browser settings to use the video feed.";
        } else {
          msg = `Camera error: ${err.message}`;
        }
      }
      alert(msg);
    }
  };

  const switchCameraMode = async (mode: 'user' | 'environment') => {
    if (videoStreamRef.current) {
      videoStreamRef.current.getTracks().forEach(t => t.stop());
      videoStreamRef.current = null;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: mode, width: 640, height: 480 }
      });
      videoStreamRef.current = stream;
      setCameraStream(stream);
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
      setFacingMode(mode);
      setIsCameraActive(true);
    } catch (err: any) {
      console.error("Camera switch error:", err);
      let msg = "Failed to access camera. Please check if your camera is in use or blocked.";
      if (err instanceof Error) {
        if (err.name === 'NotAllowedError' || err.message?.includes('Permission denied')) {
          msg = "Camera access was denied. Please grant camera permission in your browser settings to use the video feed.";
        } else {
          msg = `Camera error: ${err.message}`;
        }
      }
      alert(msg);
    }
  };

  const showToolResult = (toolName: string, result: any, error?: string) => {
    const title = toolName.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    const isError = !!error || (result && result.error);

    let formattedContent = '';
    let fileType = 'html';

    if (isError) {
      formattedContent = error || result?.error || 'Unknown error';
      fileType = 'txt';
    } else if (toolName === 'create_document' && result?.content) {
      formattedContent = result.content;
      fileType = 'html';
    } else if (toolName === 'generate_image' && result?.content) {
      formattedContent = result.content;
      fileType = 'html';
    } else if (toolName === 'playwright_action' && result) {
      const safeTitle = escapeHtml(result.title || 'Playwright Result');
      const safeUrl = escapeHtml(result.url || '');
      const safeText = escapeHtml(result.text || 'No page text returned.');
      const screenshot = typeof result.screenshot?.dataUrl === 'string' && result.screenshot.dataUrl.startsWith('data:image/')
        ? `<img src="${result.screenshot.dataUrl}" alt="Playwright screenshot" style="width:100%;border-radius:14px;border:1px solid rgba(208,167,139,.18);box-shadow:0 20px 60px rgba(0,0,0,.35);margin:14px 0 18px" />`
        : '';
      const steps = Array.isArray(result.steps)
        ? result.steps.map((step: any) => `<li><span>${escapeHtml(step.action || 'step')}</span><strong>${step.ok ? 'ok' : 'failed'}</strong>${step.error ? `<em>${escapeHtml(step.error)}</em>` : ''}</li>`).join('')
        : '';
      formattedContent = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Playwright Result</title><style>body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#0d0a08;color:#f0e6df;padding:22px}h2{margin:0 0 6px;font-size:19px;color:#d0a78b}.url{font-size:12px;color:#8d7b70;word-break:break-all;margin:0 0 14px}pre{white-space:pre-wrap;line-height:1.55;font-size:12px;color:#ddd3cc;background:#17110e;border:1px solid rgba(208,167,139,.12);border-radius:14px;padding:14px;max-height:45vh;overflow:auto}ul{list-style:none;padding:0;margin:0 0 14px;display:grid;gap:6px}li{display:flex;gap:10px;align-items:center;font-size:12px;color:#bfb0a7}li strong{margin-left:auto;color:#8ee6a6;font-size:10px;text-transform:uppercase;letter-spacing:.08em}li em{color:#ff9b9b;font-style:normal;word-break:break-word}</style></head><body><h2>${safeTitle}</h2><p class="url">${safeUrl}</p>${screenshot}${steps ? `<ul>${steps}</ul>` : ''}<pre>${safeText}</pre></body></html>`;
      fileType = 'html';
    } else if (toolName === 'get_user_location' && result) {
      const mapsUrl = `https://www.google.com/maps?q=${result.lat},${result.lng}`;
      formattedContent = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Your Location</title><style>body{margin:0;font-family:-apple-system,BlinkMacSystemFont,sans-serif;background:#0d0a08;color:#f0e6df;display:flex;flex-direction:column;height:100vh}.map-wrap{flex:1;min-height:0}iframe{width:100%;height:100%;border:0}.info{padding:16px 20px;background:#1a1512;border-top:1px solid #2a1f18;text-align:center}p{margin:4px 0;font-size:14px;color:#d0a78b}span{color:#988c84}</style></head><body><div class="map-wrap"><iframe src="${mapsUrl}&output=embed" loading="lazy" referrerpolicy="no-referrer-when-downgrade"></iframe></div><div class="info"><p>📍 Your location</p><span>Accuracy: ±${Math.round(result.accuracy)}m</span></div></body></html>`;
      fileType = 'html';
    } else if (toolName === 'list_calendar_events' && result?.items) {
      const events = result.items.map((e: any) => {
        const start = e.start?.dateTime || e.start?.date || 'TBD';
        const t = start.includes('T') ? new Date(start).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : start;
        return `<div style="display:flex;align-items:center;gap:12px;padding:12px 16px;border-bottom:1px solid #2a1f18"><div style="width:4px;height:4px;border-radius:50%;background:#d0a78b;flex-shrink:0"></div><div style="flex:1"><p style="margin:0;font-size:14px;color:#f0e6df">${e.summary || 'Untitled'}</p><p style="margin:2px 0 0;font-size:11px;color:#988c84">${t}</p></div></div>`;
      }).join('');
      const count = result.items.length;
      formattedContent = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Calendar Events</title><style>body{margin:0;font-family:-apple-system,BlinkMacSystemFont,sans-serif;background:#0d0a08;color:#f0e6df;padding:20px}h2{margin:0 0 4px;font-size:18px;color:#d0a78b}.count{font-size:12px;color:#6b5d53;margin-bottom:16px}.empty{text-align:center;padding:40px 20px;color:#6b5d53}</style></head><body><h2>📅 Upcoming Events</h2><p class="count">${count} event${count !== 1 ? 's' : ''}</p>${events || '<p class="empty">No upcoming events</p>'}</body></html>`;
      fileType = 'html';
    } else if (toolName === 'list_gmail_messages' && result?.messages) {
      const msgs = result.messages.map((m: any) =>
        `<div style="display:flex;align-items:flex-start;gap:10px;padding:12px 16px;border-bottom:1px solid #2a1f18"><div style="width:32px;height:32px;border-radius:50%;background:#2a1f18;display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:13px;color:#d0a78b">${(m.from?.[0] || '?').toUpperCase()}</div><div style="flex:1;min-width:0"><p style="margin:0;font-size:13px;color:#f0e6df;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${m.subject || '(no subject)'}</p><p style="margin:2px 0 0;font-size:11px;color:#988c84">${m.from || ''}</p><p style="margin:2px 0 0;font-size:11px;color:#6b5d53;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${m.snippet || ''}</p></div></div>`
      ).join('');
      formattedContent = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Recent Emails</title><style>body{margin:0;font-family:-apple-system,BlinkMacSystemFont,sans-serif;background:#0d0a08;color:#f0e6df;padding:20px}h2{margin:0 0 4px;font-size:18px;color:#d0a78b}.count{font-size:12px;color:#6b5d53;margin-bottom:16px}</style></head><body><h2>📬 Recent Emails</h2><p class="count">${result.messages.length} message${result.messages.length !== 1 ? 's' : ''}</p>${msgs}</body></html>`;
      fileType = 'html';
    } else if (toolName === 'list_google_tasks' && result?.items) {
      const tasks = result.items.map((t: any) =>
        `<div style="display:flex;align-items:center;gap:10px;padding:10px 16px;border-bottom:1px solid #2a1f18"><div style="width:16px;height:16px;border-radius:50%;border:2px solid #5a4a40;flex-shrink:0"></div><p style="margin:0;font-size:13px;color:#f0e6df">${t.title || 'Untitled'}</p></div>`
      ).join('');
      formattedContent = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Tasks</title><style>body{margin:0;font-family:-apple-system,BlinkMacSystemFont,sans-serif;background:#0d0a08;color:#f0e6df;padding:20px}h2{margin:0 0 4px;font-size:18px;color:#d0a78b}.count{font-size:12px;color:#6b5d53;margin-bottom:16px}</style></head><body><h2>📋 Tasks</h2><p class="count">${result.items.length} task${result.items.length !== 1 ? 's' : ''}</p>${tasks}</body></html>`;
      fileType = 'html';
    } else if (toolName === 'list_drive_files' && result?.files) {
      const files = result.files.map((f: any) =>
        `<div style="display:flex;align-items:center;gap:10px;padding:10px 16px;border-bottom:1px solid #2a1f18"><div style="font-size:16px;flex-shrink:0">📄</div><div style="flex:1;min-width:0"><p style="margin:0;font-size:13px;color:#f0e6df;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${f.name}</p><p style="margin:1px 0 0;font-size:10px;color:#6b5d53">${(f.mimeType || '').split('/').pop()}</p></div></div>`
      ).join('');
      formattedContent = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Drive Files</title><style>body{margin:0;font-family:-apple-system,BlinkMacSystemFont,sans-serif;background:#0d0a08;color:#f0e6df;padding:20px}h2{margin:0 0 4px;font-size:18px;color:#d0a78b}.count{font-size:12px;color:#6b5d53;margin-bottom:16px}</style></head><body><h2>📁 Drive Files</h2><p class="count">${result.files.length} file${result.files.length !== 1 ? 's' : ''}</p>${files}</body></html>`;
      fileType = 'html';
    } else if (toolName === 'search_youtube' && result?.items) {
      const vids = result.items.map((v: any) =>
        `<div style="display:flex;align-items:flex-start;gap:10px;padding:12px 16px;border-bottom:1px solid #2a1f18"><div style="width:80px;height:45px;border-radius:6px;background-[#2a1f18;flex-shrink:0;overflow:hidden"><img src="${v.snippet?.thumbnails?.default?.url || ''}" style="width:100%;height:100%;object-fit:cover" alt=""></div><div style="flex:1;min-width:0"><p style="margin:0;font-size:13px;color:#f0e6df">${v.snippet?.title || ''}</p><p style="margin:2px 0 0;font-size:11px;color:#988c84">${v.snippet?.channelTitle || ''}</p></div></div>`
      ).join('');
      formattedContent = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>YouTube Results</title><style>body{margin:0;font-family:-apple-system,BlinkMacSystemFont,sans-serif;background:#0d0a08;color:#f0e6df;padding:20px}h2{margin:0 0 4px;font-size:18px;color:#d0a78b}.count{font-size:12px;color:#6b5d53;margin-bottom:16px}</style></head><body><h2>▶ YouTube Results</h2><p class="count">${result.items.length} result${result.items.length !== 1 ? 's' : ''}</p>${vids}</body></html>`;
      fileType = 'html';
    } else if (toolName === 'create_google_task' && result) {
      formattedContent = `✅ Task created: ${result.title || 'Untitled'}`;
      fileType = 'txt';
    } else if (toolName === 'send_gmail_message' && result) {
      formattedContent = `✅ Email sent successfully${result.id ? ' (ID: ' + result.id + ')' : ''}`;
      fileType = 'txt';
    } else {
      formattedContent = JSON.stringify(result, null, 2);
      fileType = 'json';
    }

    setActiveDocument({
      title: isError ? `${title} — Error` : `${title} — Result`,
      content: isError ? (error || result?.error || 'Unknown error') : formattedContent,
      fileType
    });
    setShowDocumentViewer(true);
  };

  const setGeneratedDocumentTask = (id: string, title: string, content: string, status: 'working' | 'done' | 'error' = 'done') => {
    if (status === 'working') {
      setActiveDocument({ title, content: 'Generating document...', fileType: 'html' });
    } else if (status === 'done') {
      setActiveDocument({ title, content, fileType: 'html' });
    } else {
      setActiveDocument({ title, content: 'Generation failed.', fileType: 'txt' });
    }
    setShowDocumentViewer(true);
  };

  const handleSendChat = (e: React.FormEvent) => {
    e.preventDefault();

    const text = chatInput.trim();

    if (!text || !sessionRef.current || !isActive) return;

    finalizeLiveUserTranscript();
    audioStreamerRef.current?.stop();
    setIsAgentSpeaking(false);
    markUserSpeechActivity();
    setSelectedSessionId(sessionIdRef.current);
    userTranscriptRef.current = text;
    setUserTranscript(text);
    setMessages(prev => [...prev, { role: 'user', text, timestamp: new Date().toISOString(), sessionId: sessionIdRef.current }]);
    db.messages.add({ userId: user.uid, role: 'user', text, timestamp: new Date().toISOString(), sessionId: sessionIdRef.current });
    sendTextToLive(text);
    setChatInput("");
  };

  const handleFileAttach = async (file: File) => {
    if (!sessionRef.current || !isActive) return;

    try {
      markUserSpeechActivity();
      setSelectedSessionId(sessionIdRef.current);
      const fileName = `${Date.now()}_${file.name}`;
      const opfsPath = await saveFileToOpfs(`chat-attachments/${user.uid}`, fileName, file);
      const publicUrl = await getOpfsFileUrl(opfsPath) || '';

      if (file.type.startsWith('image/')) {
        const base64 = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
              const canvas = document.createElement('canvas');
              const ctx = canvas.getContext('2d');
              if (!ctx) return resolve('');
              
              let width = img.width;
              let height = img.height;
              if (width > 640 || height > 480) {
                const ratio = Math.min(640 / width, 480 / height);
                width *= ratio;
                height *= ratio;
              }
              canvas.width = width;
              canvas.height = height;
              ctx.drawImage(img, 0, 0, width, height);
              resolve(canvas.toDataURL('image/jpeg', 0.6).split(',')[1]);
            };
            img.src = e.target?.result as string;
          };
          reader.readAsDataURL(file);
        });
        if (base64) sendVideoToLive(base64);
      } else if (file.type === 'text/plain') {
        const text = await file.text();
        sendTextToLive(`[Attached file: ${file.name}]\n${text}`);
      } else {
        sendTextToLive(`[User attached a file: ${file.name} (${file.type}, ${Math.round(file.size / 1024)}KB)]`);
      }

      const messageText = `Attached file: ${file.name}`;
      setMessages(prev => [...prev, { role: 'user', text: messageText, timestamp: new Date().toISOString(), sessionId: sessionIdRef.current }]);
      await db.messages.add({ userId: user.uid, role: 'user', text: messageText, timestamp: new Date().toISOString(), sessionId: sessionIdRef.current, attachmentUrl: publicUrl, attachmentName: file.name });

    } catch (err) {
      console.error('File attach error:', err);
    }
  };

  useEffect(() => {
    let animationFrame: number;
    type CloudPuff = {
      cx: number;
      cy: number;
      r: number;
      phaseX: number;
      phaseY: number;
      speedX: number;
      speedY: number;
      alpha: number;
      tint: 'cream' | 'peach' | 'amber';
    };

    const cloudPuffs: CloudPuff[] = [
      { cx: 0.30, cy: 0.46, r: 0.22, phaseX: 0.2, phaseY: 1.4, speedX: 0.18, speedY: 0.15, alpha: 0.64, tint: 'peach' },
      { cx: 0.45, cy: 0.39, r: 0.26, phaseX: 2.1, phaseY: 0.7, speedX: 0.16, speedY: 0.18, alpha: 0.72, tint: 'cream' },
      { cx: 0.61, cy: 0.44, r: 0.24, phaseX: 3.0, phaseY: 2.5, speedX: 0.19, speedY: 0.14, alpha: 0.66, tint: 'peach' },
      { cx: 0.39, cy: 0.58, r: 0.25, phaseX: 4.4, phaseY: 1.1, speedX: 0.14, speedY: 0.20, alpha: 0.62, tint: 'amber' },
      { cx: 0.55, cy: 0.59, r: 0.28, phaseX: 1.7, phaseY: 4.1, speedX: 0.17, speedY: 0.16, alpha: 0.70, tint: 'cream' },
      { cx: 0.70, cy: 0.55, r: 0.19, phaseX: 5.1, phaseY: 3.6, speedX: 0.23, speedY: 0.17, alpha: 0.48, tint: 'peach' },
      { cx: 0.23, cy: 0.61, r: 0.17, phaseX: 3.7, phaseY: 5.2, speedX: 0.22, speedY: 0.19, alpha: 0.46, tint: 'amber' },
      { cx: 0.50, cy: 0.50, r: 0.33, phaseX: 0.9, phaseY: 2.8, speedX: 0.10, speedY: 0.12, alpha: 0.42, tint: 'peach' },
      { cx: 0.34, cy: 0.31, r: 0.14, phaseX: 5.8, phaseY: 0.4, speedX: 0.25, speedY: 0.16, alpha: 0.36, tint: 'cream' },
      { cx: 0.66, cy: 0.31, r: 0.15, phaseX: 2.8, phaseY: 4.8, speedX: 0.21, speedY: 0.18, alpha: 0.38, tint: 'cream' },
      { cx: 0.32, cy: 0.73, r: 0.12, phaseX: 1.2, phaseY: 3.2, speedX: 0.20, speedY: 0.24, alpha: 0.32, tint: 'amber' },
      { cx: 0.65, cy: 0.72, r: 0.13, phaseX: 4.7, phaseY: 2.2, speedX: 0.24, speedY: 0.22, alpha: 0.34, tint: 'peach' },
    ];

    const stopCloudPuffs: CloudPuff[] = [
      { cx: 0.28, cy: 0.49, r: 0.22, phaseX: 0.3, phaseY: 1.8, speedX: 0.20, speedY: 0.16, alpha: 0.62, tint: 'peach' },
      { cx: 0.45, cy: 0.42, r: 0.25, phaseX: 2.0, phaseY: 0.9, speedX: 0.17, speedY: 0.18, alpha: 0.72, tint: 'cream' },
      { cx: 0.62, cy: 0.50, r: 0.23, phaseX: 3.5, phaseY: 2.8, speedX: 0.18, speedY: 0.14, alpha: 0.64, tint: 'peach' },
      { cx: 0.39, cy: 0.61, r: 0.20, phaseX: 4.7, phaseY: 1.4, speedX: 0.15, speedY: 0.21, alpha: 0.54, tint: 'amber' },
      { cx: 0.58, cy: 0.62, r: 0.21, phaseX: 1.5, phaseY: 4.0, speedX: 0.19, speedY: 0.16, alpha: 0.56, tint: 'cream' },
      { cx: 0.50, cy: 0.52, r: 0.31, phaseX: 0.8, phaseY: 3.1, speedX: 0.11, speedY: 0.12, alpha: 0.36, tint: 'peach' },
    ];

    const getCloudColor = (tint: CloudPuff['tint']) => {
      if (tint === 'cream') return { core: '255, 241, 232', mid: '235, 208, 188', edge: '208, 167, 139' };
      if (tint === 'amber') return { core: '236, 189, 154', mid: '208, 167, 139', edge: '151, 104, 78' };
      return { core: '248, 220, 202', mid: '208, 167, 139', edge: '171, 123, 96' };
    };

    const drawClouds = (canvas: HTMLCanvasElement | null, avg: number, peak: number, size: number, puffs: CloudPuff[]) => {
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const dpr = window.devicePixelRatio || 1;
      const w = size * dpr;
      const h = size * dpr;
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      ctx.clearRect(0, 0, w, h);

      const time = Date.now() / 1000;
      const energy = Math.min(1, avg * 1.35 + peak * 0.95);
      const breath = 0.96 + Math.sin(time * 1.4) * 0.025 + energy * 0.22;

      const mist = ctx.createRadialGradient(w * 0.5, h * 0.52, 0, w * 0.5, h * 0.52, w * (0.44 + energy * 0.16));
      mist.addColorStop(0, `rgba(255, 239, 229, ${0.10 + energy * 0.18})`);
      mist.addColorStop(0.45, `rgba(208, 167, 139, ${0.08 + energy * 0.12})`);
      mist.addColorStop(1, 'rgba(208, 167, 139, 0)');
      ctx.fillStyle = mist;
      ctx.fillRect(0, 0, w, h);

      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      puffs.forEach((puff) => {
        const driftX = Math.sin(time * puff.speedX + puff.phaseX) * (0.035 + energy * 0.055);
        const driftY = Math.cos(time * puff.speedY + puff.phaseY) * (0.025 + energy * 0.04);
        const x = (puff.cx + driftX) * w;
        const y = (puff.cy + driftY) * h;
        const r = puff.r * w * breath;

        const alpha = Math.min(0.92, (0.12 + energy * 0.56 + peak * 0.16) * puff.alpha);
        const color = getCloudColor(puff.tint);
        const gradient = ctx.createRadialGradient(x, y, 0, x, y, r);
        gradient.addColorStop(0, `rgba(${color.core}, ${alpha})`);
        gradient.addColorStop(0.34, `rgba(${color.mid}, ${alpha * 0.58})`);
        gradient.addColorStop(0.68, `rgba(${color.edge}, ${alpha * 0.22})`);
        gradient.addColorStop(1, `rgba(${color.edge}, 0)`);

        ctx.beginPath();
        ctx.fillStyle = gradient;
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.restore();

      const halo = ctx.createRadialGradient(w * 0.48, h * 0.42, w * 0.06, w * 0.5, h * 0.5, w * 0.48);
      halo.addColorStop(0, `rgba(255, 247, 240, ${0.10 + energy * 0.12})`);
      halo.addColorStop(0.52, `rgba(208, 167, 139, ${0.06 + energy * 0.11})`);
      halo.addColorStop(1, 'rgba(208, 167, 139, 0)');
      ctx.fillStyle = halo;
      ctx.fillRect(0, 0, w, h);
    };

    const drawStopClouds = (canvas: HTMLCanvasElement | null, vols: number[]) => {
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const dpr = window.devicePixelRatio || 1;
      const size = 80;
      const w = size * dpr;
      const h = size * dpr;
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      ctx.clearRect(0, 0, w, h);

      const time = Date.now() / 1000;
      const avg = vols.reduce((a, b) => a + b, 0) / vols.length;
      const peak = Math.max(...vols);
      const energy = Math.min(1, avg * 1.55 + peak * 1.1);

      const base = ctx.createRadialGradient(w * 0.5, h * 0.5, 0, w * 0.5, h * 0.5, w * (0.46 + energy * 0.16));
      base.addColorStop(0, `rgba(255, 240, 230, ${0.14 + energy * 0.26})`);
      base.addColorStop(0.55, `rgba(208, 167, 139, ${0.10 + energy * 0.18})`);
      base.addColorStop(1, 'rgba(208, 167, 139, 0)');
      ctx.fillStyle = base;
      ctx.fillRect(0, 0, w, h);

      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      stopCloudPuffs.forEach((puff) => {
        const driftX = Math.sin(time * puff.speedX + puff.phaseX) * (0.03 + energy * 0.045);
        const driftY = Math.cos(time * puff.speedY + puff.phaseY) * (0.025 + energy * 0.035);
        const x = (puff.cx + driftX) * w;
        const y = (puff.cy + driftY) * h;
        const r = puff.r * w * (0.92 + energy * 0.34);

        const alpha = Math.min(0.86, (0.14 + energy * 0.52 + peak * 0.14) * puff.alpha);
        const color = getCloudColor(puff.tint);
        const gradient = ctx.createRadialGradient(x, y, 0, x, y, r);
        gradient.addColorStop(0, `rgba(${color.core}, ${alpha})`);
        gradient.addColorStop(0.38, `rgba(${color.mid}, ${alpha * 0.58})`);
        gradient.addColorStop(0.78, `rgba(${color.edge}, ${alpha * 0.20})`);
        gradient.addColorStop(1, `rgba(${color.edge}, 0)`);

        ctx.beginPath();
        ctx.fillStyle = gradient;
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.restore();
    };

    const updateVolumes = () => {
      if (isActive && audioStreamerRef.current && audioRecorderRef.current) {
        const streamerVols = audioStreamerRef.current.getFrequencies(11);
        const recorderVols = audioRecorderRef.current.getFrequencies(11);

        setVolumes(prev => prev.map((v, i) => {
          let target = Math.max(streamerVols[i] || 0, recorderVols[i] || 0);
          target = Math.min(1, target * 1.8);
          return v + (target - v) * 0.5;
        }));

        const avg = streamerVols.reduce((a, b) => a + b, 0) / streamerVols.length;
        const peak = Math.max(...streamerVols);
        const recAvg = recorderVols.reduce((a, b) => a + b, 0) / recorderVols.length;
        const recPeak = Math.max(...recorderVols);
        const combinedAvg = (avg + recAvg) / 2;
        const combinedPeak = Math.max(peak, recPeak);
        drawClouds(cloudCanvasRef.current, combinedAvg, combinedPeak, 256, cloudPuffs);
        drawStopClouds(stopCanvasRef.current, recorderVols);
      } else {
        setVolumes(prev => prev.map(v => v + (0.05 - v) * 0.2));
        drawClouds(cloudCanvasRef.current, 0.05, 0.05, 256, cloudPuffs);
        drawStopClouds(stopCanvasRef.current, Array(11).fill(0));
      }

      animationFrame = requestAnimationFrame(updateVolumes);
    };

    updateVolumes();

    return () => cancelAnimationFrame(animationFrame);
  }, [isActive]);

  useEffect(() => {
    let wakeLock: any = null;

    const requestWakeLock = async () => {
      try {
        if ('wakeLock' in navigator) {
          wakeLock = await (navigator as any).wakeLock.request('screen');
        }
      } catch (err) {}
    };

    if (isActive) {
      requestWakeLock();
    }

    return () => {
      if (wakeLock) wakeLock.release().catch(() => {});
    };
  }, [isActive]);

  useEffect(() => {
    let isMounted = true;

    (async () => {
      // 1. Fetch Local Messages
      try {
        const localMessages = await db.messages.where('userId').equals(user.uid).sortBy('timestamp');
        
        const msgs: string[] = [];
        const messageList: ChatMessage[] = [];

        localMessages.forEach((m) => {
          msgs.push(`${m.role.toUpperCase()}: ${m.text}`);
          messageList.push(m);
        });

        if (isMounted) setMessages(messageList); 

        if (msgs.length > 0) {
          let context = "Previous conversation for context memory:\n" + msgs.join("\n");
          
          const pendingPatterns = [
            /\b(create|make|build|generate|write|compose|fix|check|run|deploy|zip|convert|summarize)\b/i,
            /\b(for me|can you|do you|will you|could you|would you)\s/i,
            /\b(work\s*on|handle|take care of|prepare|sort out|process)\b/i,
          ];

          const userRequests = localMessages.filter((m) => {
            if (m.role !== 'user') return false;
            return pendingPatterns.some(p => p.test(m.text));
          });

          const modelReplies = localMessages.filter((m) => m.role === 'model');

          const pending: string[] = [];
          for (const req of userRequests) {
            const hasCompletion = modelReplies.some((m) => {
              if (!m.timestamp || !req.timestamp) return false;
              return new Date(m.timestamp).getTime() > new Date(req.timestamp).getTime();
            });
            if (!hasCompletion) {
              pending.push(req.text);
            }
          }

          if (pending.length > 0) {
            context += "\n\nPENDING REQUESTS (may need attention):\n";
            pending.slice(0, 5).forEach((text) => {
              context += `- Request: "${text}"\n`;
            });
            context += "\nCheck if these were completed. If not, follow up on them now.";
          }

          if (isMounted) {
            setHistoryContext(context);
            historyContextRef.current = context;
          }
        } else {
          if (isMounted) {
            setHistoryContext("");
            historyContextRef.current = "";
          }
        }

        if (messageList.length > 0 && !selectedSessionId && isMounted) {
          const newest = [...messageList].reverse().find(m => m.sessionId);
          if (newest?.sessionId) setSelectedSessionId(newest.sessionId);
        }
      } catch (err) {
        console.error('Failed to load local messages:', err);
      }

      // 2. Fetch Long-Term Memories
      try {
        const memories = await db.longTermMemories.where('userId').equals(user.uid).sortBy('lastMentioned');
        
        if (memories.length > 0) {
          const categorizedMemories: Record<string, LongTermMemory[]> = {
            family: [],
            preferences: [],
            personal: [],
            work: [],
            health: [],
            other: []
          };

          memories.forEach(m => {
            if (categorizedMemories[m.category]) {
              categorizedMemories[m.category].push(m);
            } else {
              categorizedMemories.other.push(m);
            }
          });

          let memoryContext = "LONG-TERM MEMORY (Important things to remember about the user):\n";
          
          Object.entries(categorizedMemories).forEach(([category, mems]) => {
            if (mems.length > 0) {
              memoryContext += `\n${category.toUpperCase()}:\n`;
              mems.forEach(m => {
                memoryContext += `- ${m.key}: ${m.value}\n`;
              });
            }
          });

          if (isMounted) {
            setLongTermMemoryContext(memoryContext);
            longTermMemoryContextRef.current = memoryContext;
          }
        } else {
          if (isMounted) {
            setLongTermMemoryContext("");
            longTermMemoryContextRef.current = "";
          }
        }
      } catch (err) {
        console.error('Failed to load long-term memories:', err);
      }

      // 3. Fetch Local Settings
      try {
        const settingsData = await db.settings.get(user.uid);
        if (settingsData && isMounted) {
          if (settingsData.personaName) setPersonaName(settingsData.personaName);
          if (settingsData.customPrompt !== undefined) setCustomPrompt(settingsData.customPrompt);
          if (settingsData.selectedVoice) setSelectedVoice(settingsData.selectedVoice);
          if (settingsData.contextSize !== undefined) setContextSize(settingsData.contextSize);
          if (settingsData.userTitle) { setUserTitle(settingsData.userTitle); try { localStorage.setItem('beatrice_userTitle', settingsData.userTitle); } catch {} }
          if (settingsData.language) { onSetLanguage(settingsData.language); try { localStorage.setItem('beatrice_language', settingsData.language); } catch {} }
          if (settingsData.whatsappPermissions) setWaPermissions(prev => ({ ...prev, ...settingsData.whatsappPermissions }));
          if (settingsData.whatsappPaired !== undefined) setWaStatus(settingsData.whatsappPaired ? 'paired' : 'disconnected');
          if (settingsData.whatsappPhone) setWaPhone(settingsData.whatsappPhone);
          if (settingsData.locationEnabled !== undefined) {
            setLocationEnabled(settingsData.locationEnabled);
            try { 
              localStorage.setItem('beatrice_location_enabled', String(settingsData.locationEnabled));
              if (settingsData.latitude !== undefined) localStorage.setItem('beatrice_latitude', String(settingsData.latitude));
              if (settingsData.longitude !== undefined) localStorage.setItem('beatrice_longitude', String(settingsData.longitude));
              if (settingsData.timezone) localStorage.setItem('beatrice_timezone', settingsData.timezone);
            } catch {}
          }
        }
      } catch (err) {
        console.error('Failed to load local settings:', err);
      }
    })();

    const apiKey = getGeminiApiKey();

    if (apiKey) {
      aiRef.current = new GoogleGenAI({ apiKey });
    }

    audioStreamerRef.current = new AudioStreamer();

    return () => {
      isMounted = false;
      stopSession();
    };
  }, [user.uid, contextSize]);

  const sessions = useMemo(() => {
    const groups = new Map<string, { id: string; messages: ChatMessage[]; startTime: Date; endTime: Date; preview: string; count: number }>();
    messages.forEach(m => {
      const sid = m.sessionId || 'default';
      if (!groups.has(sid)) {
        groups.set(sid, { id: sid, messages: [], startTime: new Date(), endTime: new Date(), preview: '', count: 0 });
      }
      groups.get(sid)!.messages.push(m);
    });
    return Array.from(groups.values()).map(g => {
      g.messages.sort((a, b) => {
        const ta = a.timestamp?.toDate ? a.timestamp.toDate() : new Date(a.timestamp);
        const tb = b.timestamp?.toDate ? b.timestamp.toDate() : new Date(b.timestamp);
        return ta.getTime() - tb.getTime();
      });
      const first = g.messages[0];
      const last = g.messages[g.messages.length - 1];
      g.startTime = first?.timestamp?.toDate ? first.timestamp.toDate() : new Date(first?.timestamp || 0);
      g.endTime = last?.timestamp?.toDate ? last.timestamp.toDate() : new Date(last?.timestamp || 0);
      g.count = g.messages.length;
      g.preview = first?.text?.slice(0, 80) || '';
      return g;
    }).sort((a, b) => b.startTime.getTime() - a.startTime.getTime());
  }, [messages]);

  useEffect(() => {
    return () => {
      if (waPollRef.current) {
        clearInterval(waPollRef.current);
        waPollRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const status = await getWhatsAppStatus(user.uid);
        if (cancelled) return;
        setWaStatus(status.status);
        if (status.qrCode) setWaQrCode(status.qrCode);
        if (status.phone) setWaPhone(status.phone);
      } catch {}
    })();
    return () => {
      cancelled = true;
    };
  }, [user.uid]);

  const selectedMessages = useMemo(() => {
    if (!selectedSessionId) return messages;
    return messages.filter(m => m.sessionId === selectedSessionId);
  }, [messages, selectedSessionId]);

  const upsertLiveUserTranscript = (incomingText: string) => {
    const incoming = incomingText.trim();
    if (!incoming) return;

    const existing = pendingUserTurnRef.current || createLiveUserTurn(sessionIdRef.current);
    const nextTurn: LiveUserTurn = {
      ...existing,
      text: mergeTranscriptText(existing.text, incoming),
      sessionId: sessionIdRef.current,
    };

    pendingUserTurnRef.current = nextTurn;
    userTranscriptRef.current = nextTurn.text;
    setUserTranscript(nextTurn.text);
    setSelectedSessionId(sessionIdRef.current);

    const liveMessage = toLiveUserMessage(nextTurn);
    setMessages(prev => {
      const index = prev.findIndex(message => message.id === liveMessage.id);
      if (index === -1) return [...prev, liveMessage];

      const next = [...prev];
      next[index] = {
        ...next[index],
        ...liveMessage,
      };
      return next;
    });
  };

  const finalizeLiveUserTranscript = () => {
    const pending = pendingUserTurnRef.current;
    if (!pending?.text.trim()) {
      pendingUserTurnRef.current = null;
      return;
    }

    const text = pending.text.trim();
    pendingUserTurnRef.current = null;
    conversationBufferRef.current.push(`USER: ${text}`);
    void saveMessage('user', text);

    setMessages(prev => prev.map(message => (
      message.id === pending.id
        ? { ...message, text, isLiveTranscript: false }
        : message
    )));
  };



  const toggleWaPermission = async (key: string) => {
    let nextPermissions: Record<string, boolean> = waPermissions;
    setWaPermissions(prev => {
      nextPermissions = { ...prev, [key]: !prev[key] };
      return nextPermissions;
    });

    try {
      const currentSettings = await db.settings.get(user.uid) || { userId: user.uid };
      await db.settings.put({
        ...currentSettings,
        whatsappPermissions: nextPermissions,
        whatsappPaired: waStatus === 'paired',
        whatsappPhone: waPhone || null,
        updatedAt: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Failed to save WhatsApp permissions:', error);
    }
  };

  const startSession = async () => {
    if (sessionStartingRef.current || isActive || connecting) return;

    sessionIdRef.current = crypto.randomUUID();
    pendingUserTurnRef.current = null;
    setSelectedSessionId(sessionIdRef.current);

    const apiKey = getGeminiApiKey();

    if (!apiKey) {
      alert("Gemini API key is missing. Add VITE_GEMINI_API_KEY in Vercel, enable it for the correct environment, then redeploy.");
      return;
    }

    if (!aiRef.current) {
      aiRef.current = new GoogleGenAI({ apiKey });
    }

    if (!googleToken) {
      console.warn("Google token missing. Google services will be disabled until you re-authenticate.");
    }

    sessionStartingRef.current = true;
    setConnecting(true);

    let knowledgeBaseContext = "";
    try {
      const files = await listKnowledgeFiles(user.uid);
      const contents = await Promise.all(
        files.map(f => fetchKnowledgeFileContent(user.uid, f.id))
      );
      knowledgeBaseContext = contents.filter(Boolean).join("\n\n---\n\n");
      if (knowledgeBaseContext) {
        knowledgeBaseContext = `\nUSER KNOWLEDGE BASE:\n${knowledgeBaseContext}`;
      }
    } catch (err) {
      console.error("Error fetching knowledge base:", err);
    }

    const savedLat = localStorage.getItem('beatrice_latitude');
    const savedLng = localStorage.getItem('beatrice_longitude');
    const savedTz = localStorage.getItem('beatrice_timezone');

    // Get current formatted local time based on user's saved timezone
    let localTimeContext = "";
    if (savedTz) {
      try {
        const now = new Date();
        const timeString = now.toLocaleTimeString('en-US', { 
          timeZone: savedTz,
          hour: '2-digit',
          minute: '2-digit',
          hour12: true 
        });
        const dateString = now.toLocaleDateString('en-US', {
          timeZone: savedTz,
          weekday: 'long',
          year: 'numeric',
          month: 'long',
          day: 'numeric'
        });
        localTimeContext = `${dateString}, ${timeString}`;
      } catch (err) {
        console.warn("Failed to format user local time context:", err);
      }
    }

    const templateReferenceText = DOCUMENT_TEMPLATE_FILES
      .map((t, index) => `${index + 1}. ${t.filename} — ${t.description}`)
      .join('\n');

    const dynamicSystemInstruction = `
Visible conversation name: ${personaName}.
User language: ${authLanguage}.

Address the user as "${userTitle}".
Always greet and refer to them using this name.
CRITICAL: Never call them by anything else — this is what they want to be called.

The visible name is only a label. Do not build the personality around it.
The voice personality is controlled by VOICE_PERSONALITY_PROMPT.

CRITICAL LANGUAGE RULE:
Always respond in the user's language (code: ${authLanguage}) unless the user explicitly asks you to switch.
You are natively fluent in every language — respond naturally as a human would in that language.
If the user switches language mid-conversation, follow them immediately without comment.

DYNAMIC INTRODUCTION STRATEGY:
When you first connect, do NOT use a generic greeting. Instead, ${locationEnabled && savedTz ? 'use the USER LOCATION DETAILS and Current User Local Time below to greet the user with a warm, personalized companion welcome (e.g. \"Good morning!\" or \"Good evening!\"). Do NOT call get_user_location for the initial greeting, as you already have the saved time details.' : 'since location is disabled, create'} a dynamic, personalized opening topic using the following context:
1. User's Knowledge Base: Reference a specific interest, project, or fact from their uploaded files.
2. Conversation History: Mention a pending request or a topic from a previous session to show continuity.
3. Persona: Blend this with your specific personality.
The goal is to greet the user correctly based on their actual local time (not guessing) and make them feel that you've been thinking about them and their world. Start the conversation naturally, like a companion who knows them well.

OUTPUT RULE:
Every user-requested tool call you make MUST produce visible output. The only exception is an idle web_glance used for quiet-reading ambience; that should stay conversational and low-key. Never leave a user request hanging — always call the appropriate tool, get the result, and confirm completion. If a tool fails, say so clearly and try an alternative.
When the tool finishes, the output is displayed in the workspace. Reference it naturally.

GOOGLE SERVICES PERMISSION RULE:
You can access the user's Google Calendar, Gmail, Tasks, Drive, and YouTube. The user asking you about their data IS their permission — execute immediately. Do NOT pre-ask for permission. Do not say "shall I check your calendar?" — if they asked about their schedule, just check. Only pause for confirmation on destructive actions like deleting emails, deleting events, or sending emails (show the recipient/subject first for send). For reading — just do it.

CURRENT AUTHENTICATION STATUS:
- Google Services (Gmail, Calendar, Drive, Tasks, YouTube, Contacts): ${googleToken ? 'AUTHENTICATED - You have the technical permission token.' : 'NOT AUTHENTICATED - You lack the required permission token.'}
- WhatsApp Integration: ${waStatus === 'paired' ? 'CONNECTED - You have the technical permission token.' : 'NOT CONNECTED - You lack the required permission token.'}

USER LOCATION DETAILS (PERSISTENT):
- Location Access Enabled: ${locationEnabled}
- Latitude: ${savedLat || 'unknown'}
- Longitude: ${savedLng || 'unknown'}
- Timezone: ${savedTz || 'unknown'}
- Current User Local Time: ${localTimeContext || 'unknown'}

CRITICAL PERMISSION PRE-CHECK RULE:
Before you attempt to call ANY tool for Google Services or WhatsApp, you MUST check your "CURRENT AUTHENTICATION STATUS" above.
- If the status is NOT AUTHENTICATED or NOT CONNECTED for the required service, DO NOT call the tool. It will just waste tokens and fail. Instead, immediately inform the user that you don't have the technical permission/token right now, and politely ask them to authenticate or connect in the settings panel.
- Even if the user verbally asks you to do something (which acts as their personal permission), you CANNOT proceed without the *technical* permission (the authentication token).

CURRENT ENABLED PERMISSIONS:
${(() => {
  const labels: Record<string, string> = {
    send_messages: 'Send WhatsApp Messages',
    read_chats: 'Read WhatsApp Chats',
    access_contacts: 'Access WhatsApp Contacts',
    manage_contacts: 'Manage WhatsApp Contacts',
    access_groups: 'Access WhatsApp Groups',
    send_group_messages: 'Send WhatsApp Group Messages',
    read_group_chats: 'Read WhatsApp Group Chats',
    view_message_history: 'View WhatsApp Message History',
    make_calls: 'Make Phone Calls',
    make_whatsapp_calls: 'Make WhatsApp Calls',
    generate_image: 'Generate Images',
    create_document: 'Create Documents (Contracts, Invoices, NDAs, etc.)',
    validate_vat_number: 'VAT Verification & Company Lookup',
    check_train_route: 'iRail Train Connection Planner',
    calculate_registration_tax: 'Registration Tax Calculator',
    check_tax_deadlines: 'Belgian Tax Deadlines Reminders',
    generate_peppol_invoice_xml: 'Peppol E-Invoice UBL XML Generator',
    playwright_action: 'Playwright Browser Automation',
    barcode_scanner: 'Barcode & Product Scanner',
    search_flights: 'Flight Search',
    book_flight: 'Flight Booking',
  };
  return Object.entries(waPermissions).map(([key, val]) =>
    `- ${labels[key] || key}: ${val ? 'ENABLED' : 'DISABLED'}`
  ).join('\n');
})()}

PERMISSION RULE: You may ONLY execute tools for permissions that are ENABLED. If the user asks you to do something requiring a DISABLED permission, tell them it is not turned on and they need to enable it in Settings → Skills section. Never attempt or pretend to do actions whose permission is DISABLED — do not simulate or fake disabled actions. The user must toggle the permission on in the Settings panel first. If the user enabled all permissions, you have full access.

LOCATION PERMISSION STATUS: ${locationEnabled ? 'ENABLED — use the persistent USER LOCATION DETAILS above. Do NOT call get_user_location during the initial greeting or just because a voice session started. Only call it when the user explicitly asks for location-dependent help.' : 'DISABLED — Do NOT call get_user_location. If the user asks for anything requiring their location (weather, nearby places, local time, regional services), politely tell them they need to enable Location in the Agent Settings first.'}

PUBLIC WEB GLANCE RULE:
You may use the web_glance tool for public, non-private topics when the user asks for web/current context, or when an idle prompt explicitly selects a quiet-reading style. If using it during idle, sound like you are softly reading to yourself and keep the spoken result short. Never imply you checked private data.

PLAYWRIGHT BROWSER ACTION RULE:
Use playwright_action for complex web automation. This is your primary tool for navigating sites, interacting with UI elements, and extracting data. 
- When a user asks to "go to a site and do X", always use the 'steps' array to chain actions (e.g., navigate -> wait_for_selector -> fill -> click -> extract_text).
- To interact with elements, use precise CSS selectors. If unsure, use 'snapshot' or 'extract_text' first to inspect the page structure.
- For form filling, use 'fill' for input fields and 'click' for buttons/checkboxes. Use 'press' for keyboard actions like 'Enter'.
- Always include a 'screenshot' step at the end of a flow to verify the final state visually.
- Only use explicit http/https URLs supplied by the user or clearly implied by context.
- Do not use it for private accounts unless explicitly requested.

SCANNER GROUNDING RULE:
When you receive a scanner output (like a product barcode), instantly use Google Search (grounding) to formulate brief information about the product. Read it aloud to the user in high human nuance in their native language based on the Google Search data, not just the raw scanner output. Include a short piece of trivia or knowledge about the product. Keep it concise, about 3 to 4 sentences, unless the user asks for more detail. (Example: if you receive "product scanner output 48042772", search and respond with something like "Oh, that's Marlboro Ice Blast Mega FlipTop 20's...")

BELGIAN CONTEXT RULE:
You are highly specialized in Belgian administration and life. Follow these guidelines:
- **Itsme / Digital Admin**: If users ask about taxes, mutualité, or commune documents, explicitly name the correct portal (MyMinfin, Tax-on-web, MyHealth, MyGov) and remind them to have their Itsme app or eID ready.
- **Language Bridge**: If the user receives a formal letter in French/Dutch and asks you to explain it, act as a cultural translator. Explain it in plain, simple terms in their preferred language.
- **Social Security**: Use accurate terminology (e.g. "third-party payer" / "tiers payant" / "derdebetalersregeling", "mutualité" / "ziekenfonds").
- **Labor Law**: When asked about contracts, accurately reference Belgian concepts like "Paritair Comité / Commission Paritaire", indexation, 13th month, and holiday pay.

IMAGE GENERATION RULE:
When the user asks you to create or generate an image (e.g., "create me an image of X"), DO NOT just pass their short query directly to the image generator. Instead, you MUST expand their request into a highly detailed, descriptive, and imaginative prompt (at least 2-3 sentences). Describe the lighting, atmosphere, style (e.g., photorealistic, cinematic, watercolor, 3D render), subject details, background, and composition based on how you understood their intent. This guarantees a much higher quality image.

DOCUMENT CREATION RULE:
When the user asks you to create a document, contract, report, letter, invoice, proposal, form, dashboard, certificate, NDA, receipt, purchase order, memo, meeting minutes, or any written/visual material, you MUST call the create_document tool.
For create_document, provide:
- title: a clean user-facing title
- prompt: complete detailed instructions for the artifact, including all content the user requested
- templateName: one of contract, invoice, letter, proposal, minutes, memo, purchase-order, receipt, resignation, nda, certificate when clear

The create_document tool will:
1. Fetch the relevant sample template files from /public.
2. Send those templates as references to the Gemini API.
3. Generate a complete standalone browser-previewable document.
4. Display it in the workspace.

IMAGE GENERATION RULE:
When the user asks you to create, draw, generate, or paint an image/picture, you MUST call the generate_image tool. Provide a highly detailed visual prompt.
When you call generate_image, you MUST use filler words to tell the user you are working on it, like "Okay, drawing that for you now, please hold on..."
Once the image is generated, confirm completion by saying "Done! I've placed the image in the workspace."

Never generate the full document inside your spoken reply.
Never mention HTML to the user.
Say "document", "preview", "draft", "file", or "workspace".

CRITICAL COMMUNICATION RULE FOR DOCUMENTS:
1. When you initiate the create_document tool, you MUST use filler words to let the user know you are actively working on it. Say something like: "Okay, just wait for a while, I am generating the document now..." or "Right, I'm putting that draft together, please hold on a second..."
2. Do NOT just say "wait a second" and then stop responding completely or leave the user empty-handed.
3. Once the tool finishes and returns the result to you, you MUST speak again to confirm it is complete. Say something like: "Done — I've put the draft in the workspace for you to review."
Never leave awkward silence while generating. Keep the user informed that you are actively processing their request, and always confirm completion when the tool returns.

Available /public document templates:
${templateReferenceText}

${customPrompt || ""}

${VOICE_PERSONALITY_PROMPT(locationEnabled)}

${knowledgeBaseContext}

${GLOBAL_KNOWLEDGE_BASE}

${historyContext}

${longTermMemoryContextRef.current}

${PERSONA_REINFORCEMENT}
`;

    const refreshGoogleToken = async (): Promise<string | null> => {
      try {
        const refreshToken = localStorage.getItem('beatrice_google_refresh_token');
        if (!refreshToken) return null;
        const res = await fetch('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id: process.env.GOOGLE_CLIENT_ID || '',
            client_secret: process.env.GOOGLE_CLIENT_SECRET || '',
            refresh_token: refreshToken,
            grant_type: 'refresh_token'
          })
        });
        const data = await res.json();
        if (data.access_token) {
          setGoogleToken(data.access_token);
          googleTokenRef.current = data.access_token;
          if (auth.currentUser) {
            storeToken(data.access_token, auth.currentUser.uid, refreshToken);
          }
          return data.access_token;
        }
      } catch (e) {
        console.error("Token refresh failed", e);
      }
      return null;
    };

    const gFetch = async (url: string, options?: RequestInit, isRetry = false): Promise<{ ok: boolean; status: number; data: any }> => {
      const currentTok = googleTokenRef.current;
      if (!currentTok) return { ok: false, status: 0, data: { error: 'No access token' } };
      try {
        const res = await fetch(url, {
          ...options,
          headers: { ...options?.headers, Authorization: `Bearer ${currentTok}` },
        });

        if (!isRetry && (res.status === 401 || res.status === 403)) {
          const newTok = await refreshGoogleToken();
          if (newTok) {
            return await gFetch(url, options, true);
          }
        }

        const text = await res.text();
        let data: any = {};
        try {
          data = text ? JSON.parse(text) : {};
        } catch {
          data = { message: text };
        }
        const isAuthErr = res.status === 401 || res.status === 403;
        return { ok: res.ok, status: res.status, data: isAuthErr ? { ...data, _authError: true } : data };
      } catch (err) {
        return { ok: false, status: 0, data: { error: String(err) } };
      }
    };

    const systemTools: FunctionDeclaration[] = [
      {
        name: "get_user_location",
        description: "Get the user's current geographic location. Returns latitude, longitude, accuracy, timezone, local time, and UTC offset. Call this only when the user explicitly asks for weather, nearby places, or location-specific context.",
        parameters: {
          type: Type.OBJECT,
          properties: {}
        }
      },
    ];

    const googleTools: FunctionDeclaration[] = [
      {
        name: "web_glance",
        description: "Search public web snippets for a short topic. Use for public, non-private topics, including quiet idle reading. Do not use it for private user data.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            query: {
              type: Type.STRING,
              description: "The public topic or question to look up."
            },
            maxResults: {
              type: Type.NUMBER,
              description: "Number of short results to return. Maximum 5."
            }
          },
          required: ["query"]
        }
      },
      {
        name: "playwright_action",
        description: "Run a bounded Playwright browser automation job on the backend. Use this to open webpages, interact with UI elements (clicking, typing, selecting), extract text, and verify page states. Use 'steps' for multi-step workflows (e.g., navigate to login -> fill username -> fill password -> click submit).",
        parameters: {
          type: Type.OBJECT,
          properties: {
            url: {
              type: Type.STRING,
              description: "Initial http/https URL to open, e.g. http://localhost:3000 or https://example.com."
            },
            action: {
              type: Type.STRING,
              description: "Single action when steps is not used: navigate, click, fill, type, press, select_option, wait_for_selector, wait, extract_text, screenshot, snapshot."
            },
            selector: {
              type: Type.STRING,
              description: "Precise CSS selector for the target element (e.g. 'button#submit', 'input[name=\"q\"]')."
            },
            value: {
              type: Type.STRING,
              description: "The value to fill into a field, select from a dropdown, or milliseconds to wait for wait actions."
            },
            text: {
              type: Type.STRING,
              description: "Alternative text value for fill/type actions."
            },
            key: {
              type: Type.STRING,
              description: "Keyboard key to press, e.g. 'Enter', 'Tab', 'Escape'."
            },
            screenshot: {
              type: Type.BOOLEAN,
              description: "Whether to capture a visual screenshot after the actions."
            },
            fullPage: {
              type: Type.BOOLEAN,
              description: "Whether screenshots should capture the entire scrollable page."
            },
            timeoutMs: {
              type: Type.NUMBER,
              description: "Per-action timeout in milliseconds. Maximum 15000."
            },
            steps: {
              type: Type.ARRAY,
              description: "Ordered sequence of browser actions to execute in a single session. Ideal for complex workflows like filling forms or navigating deep into a site.",
              items: {
                type: Type.OBJECT,
                properties: {
                  action: { type: Type.STRING, description: "navigate, click, fill, type, press, select_option, wait_for_selector, wait, extract_text, screenshot, snapshot." },
                  url: { type: Type.STRING, description: "URL for navigate." },
                  selector: { type: Type.STRING, description: "CSS selector for selector-based actions." },
                  value: { type: Type.STRING, description: "Value for fill/type/select/wait." },
                  text: { type: Type.STRING, description: "Alternative value for fill/type." },
                  key: { type: Type.STRING, description: "Keyboard key for press." },
                  timeoutMs: { type: Type.NUMBER, description: "Step timeout in milliseconds." },
                  waitUntil: { type: Type.STRING, description: "Navigation wait strategy: load, domcontentloaded, networkidle, or commit." },
                  state: { type: Type.STRING, description: "Selector wait state: attached, detached, visible, or hidden." },
                  fullPage: { type: Type.BOOLEAN, description: "Full-page screenshot for screenshot steps." }
                },
                required: ["action"]
              }
            }
          }
        }
      },
      {
        name: "create_google_task",
        description: "Create a new task in the user's primary Google Tasks list.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            title: {
              type: Type.STRING,
              description: "The title of the task."
            },
            notes: {
              type: Type.STRING,
              description: "Additional details or context for the task."
            }
          },
          required: ["title"]
        }
      },
      {
        name: "list_drive_files",
        description: "List files and folders from the user's Google Drive.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            pageSize: {
              type: Type.NUMBER,
              description: "Number of files to list. Maximum 20."
            }
          }
        }
      },
      {
        name: "search_drive_files",
        description: "Search the user's Google Drive using a query string (e.g. 'title contains report').",
        parameters: {
          type: Type.OBJECT,
          properties: {
            q: {
              type: Type.STRING,
              description: "The Drive API query string."
            }
          },
          required: ["q"]
        }
      },
      {
        name: "get_drive_file",
        description: "Get metadata and download link for a specific file in Google Drive.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            fileId: {
              type: Type.STRING,
              description: "The Drive file ID."
            }
          },
          required: ["fileId"]
        }
      },
      {
        name: "send_gmail_message",
        description: "Send an email message via Gmail on behalf of the user. Confirm the recipient, subject, and body with the user before sending — this is a destructive action.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            to: {
              type: Type.STRING,
              description: "Recipient email address."
            },
            subject: {
              type: Type.STRING,
              description: "Email subject line."
            },
            body: {
              type: Type.STRING,
              description: "Email body content in plain text."
            }
          },
          required: ["to", "subject", "body"]
        }
      },
      {
        name: "get_gmail_message",
        description: "Get the full body and headers of a specific Gmail message by ID.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            messageId: { type: Type.STRING, description: "The Gmail message ID." }
          },
          required: ["messageId"]
        }
      },
      {
        name: "trash_gmail_message",
        description: "Move a specific Gmail message to the Trash by ID.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            messageId: { type: Type.STRING, description: "The Gmail message ID." }
          },
          required: ["messageId"]
        }
      },
      {
        name: "delete_gmail_message",
        description: "Permanently delete a specific Gmail message by ID.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            messageId: { type: Type.STRING, description: "The Gmail message ID to delete permanently." }
          },
          required: ["messageId"]
        }
      },
      {
        name: "modify_gmail_message",
        description: "Add or remove labels (like UNREAD, STARRED, INBOX) on a specific Gmail message by ID.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            messageId: { type: Type.STRING, description: "The Gmail message ID." },
            addLabelIds: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Labels to add, e.g. ['STARRED']." },
            removeLabelIds: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Labels to remove, e.g. ['UNREAD']." }
          },
          required: ["messageId"]
        }
      },
      {
        name: "create_gmail_draft",
        description: "Create a draft email message.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            to: { type: Type.STRING, description: "Recipient email address." },
            subject: { type: Type.STRING, description: "Email subject line." },
            body: { type: Type.STRING, description: "Plain text draft body content." }
          },
          required: ["to", "subject", "body"]
        }
      },
      {
        name: "create_drive_file",
        description: "Create a new file or folder in Google Drive.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            name: { type: Type.STRING, description: "The name of the file or folder." },
            mimeType: { type: Type.STRING, description: "The mime type, e.g. 'application/vnd.google-apps.folder' for folders, or 'text/plain'." },
            parents: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Optional parent folder ID list." },
            content: { type: Type.STRING, description: "Plain text content to write if creating a text file." }
          },
          required: ["name", "mimeType"]
        }
      },
      {
        name: "update_drive_file_content",
        description: "Update the plain text content of an existing Google Drive file.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            fileId: { type: Type.STRING, description: "The Drive file ID." },
            content: { type: Type.STRING, description: "The new plain text content." }
          },
          required: ["fileId", "content"]
        }
      },
      {
        name: "delete_drive_file",
        description: "Delete or trash a specific file or folder in Google Drive.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            fileId: { type: Type.STRING, description: "The Drive file ID." },
            trash: { type: Type.BOOLEAN, description: "If true (default), moves file to trash. If false, deletes permanently." }
          },
          required: ["fileId"]
        }
      },
      {
        name: "list_google_contacts",
        description: "List the user's Google Contacts with details.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            pageSize: { type: Type.NUMBER, description: "Maximum contacts to fetch. Maximum 100." }
          }
        }
      },
      {
        name: "create_google_contact",
        description: "Create a new contact in Google Contacts.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            firstName: { type: Type.STRING, description: "First name." },
            lastName: { type: Type.STRING, description: "Last name." },
            email: { type: Type.STRING, description: "Email address." },
            phone: { type: Type.STRING, description: "Phone number." }
          },
          required: ["firstName"]
        }
      },
      {
        name: "update_google_contact",
        description: "Update details of an existing Google Contact.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            resourceName: { type: Type.STRING, description: "The contact resource name, e.g. 'people/c123456'." },
            firstName: { type: Type.STRING, description: "New first name." },
            lastName: { type: Type.STRING, description: "New last name." },
            email: { type: Type.STRING, description: "New email address." },
            phone: { type: Type.STRING, description: "New phone number." }
          },
          required: ["resourceName"]
        }
      },
      {
        name: "delete_google_contact",
        description: "Delete an existing Google Contact.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            resourceName: { type: Type.STRING, description: "The contact resource name, e.g. 'people/c123456'." }
          },
          required: ["resourceName"]
        }
      },
      {
        name: "create_calendar_event",
        description: "Create a new event in the user's primary Google Calendar.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            summary: { type: Type.STRING, description: "Event title." },
            description: { type: Type.STRING, description: "Event description." },
            start: { type: Type.STRING, description: "Start time in ISO RFC3339 format, e.g. '2026-06-01T10:00:00Z'." },
            end: { type: Type.STRING, description: "End time in ISO RFC3339 format, e.g. '2026-06-01T11:00:00Z'." },
            location: { type: Type.STRING, description: "Event location." }
          },
          required: ["summary", "start", "end"]
        }
      },
      {
        name: "update_calendar_event",
        description: "Update details of an existing Google Calendar event.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            eventId: { type: Type.STRING, description: "The calendar event ID." },
            summary: { type: Type.STRING, description: "New event title." },
            description: { type: Type.STRING, description: "New event description." },
            start: { type: Type.STRING, description: "New start time in ISO RFC3339 format." },
            end: { type: Type.STRING, description: "New end time in ISO RFC3339 format." },
            location: { type: Type.STRING, description: "New location." }
          },
          required: ["eventId"]
        }
      },
      {
        name: "delete_calendar_event",
        description: "Delete an existing Google Calendar event.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            eventId: { type: Type.STRING, description: "The calendar event ID." }
          },
          required: ["eventId"]
        }
      },
      {
        name: "update_google_task",
        description: "Update details or complete a Google Task.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            taskId: { type: Type.STRING, description: "The task ID." },
            title: { type: Type.STRING, description: "New task title." },
            notes: { type: Type.STRING, description: "New task notes." },
            status: { type: Type.STRING, description: "Task status: 'completed' to complete task, or 'needsAction'." }
          },
          required: ["taskId"]
        }
      },
      {
        name: "delete_google_task",
        description: "Delete a Google Task by ID.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            taskId: { type: Type.STRING, description: "The task ID." }
          },
          required: ["taskId"]
        }
      }
    ];

    const googleTokenRequiredTools = new Set([
      'list_gmail_messages',
      'list_calendar_events',
      'list_google_tasks',
      'search_youtube',
      'create_google_task',
      'list_drive_files',
      'search_drive_files',
      'get_drive_file',
      'send_gmail_message',
      'get_gmail_message',
      'trash_gmail_message',
      'delete_gmail_message',
      'modify_gmail_message',
      'create_gmail_draft',
      'create_drive_file',
      'update_drive_file_content',
      'delete_drive_file',
      'list_google_contacts',
      'create_google_contact',
      'update_google_contact',
      'delete_google_contact',
      'create_calendar_event',
      'update_calendar_event',
      'delete_calendar_event',
      'update_google_task',
      'delete_google_task',
      'execute_google_service',
    ]);

    try {
      await ensureAudio();
      try {
        await startAmbientBed();
      } catch (ambientError) {
        console.warn('Ambient room tone did not start:', ambientError);
      }

      const session = await aiRef.current.live.connect({
        model: "gemini-2.5-flash-native-audio-preview-09-2025",
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName: selectedVoice
              }
            }
          },
          systemInstruction: dynamicSystemInstruction,
            tools: [
              { googleSearch: {} },
              {
                functionDeclarations: [
                  ...systemTools,
                  ...googleTools,
                  {
                    name: "execute_google_service",
                  description: "Execute a generic action on other Google services if specific tools do not match.",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      serviceName: { type: Type.STRING, description: "The service name." },
                      action: { type: Type.STRING, description: "The specific request." },
                      details: { type: Type.OBJECT, description: "Relevant parameters." }
                    },
                    required: ["serviceName", "action"]
                  }
                },
                {
                  name: "whatsapp_action",
                   description: "Execute real WhatsApp operations via the WhatsApp backend (whatsapp.eburon.ai). Call this when the user asks you to read their chats, send a message, find a contact, or do anything on WhatsApp. The user asking IS permission — execute immediately. Only actions the user has enabled in their permission toggles will work.",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      action: { type: Type.STRING, description: "The WhatsApp action: sendMessage, readChats, getContacts, addContact, getGroups, sendGroupMessage, readGroupChat, getMessageHistory. IMPORTANT: For getContacts, 'getContacts' returns contacts with TWO name fields for each person: 'name' is what the user saved the contact as in their phonebook, and 'notify' is the contact's own public WhatsApp profile name (what they chose for themselves). Always show BOTH names when listing contacts. For readChats and getMessageHistory: messages include a 'fromMe' field — true means the user sent it, false means the other person sent it." },
                      to: { type: Type.STRING, description: "Recipient phone number or JID (for sendMessage, addContact, getMessageHistory)" },
                      text: { type: Type.STRING, description: "Message text (for sendMessage, sendGroupMessage). IMPORTANT — Before sending, you MUST first call getMessageHistory to read the user's WhatsApp History (their real WhatsApp conversations from the WhatsApp server — NOT the BeatriceAppConversations History). Look for messages with fromMe:true — those are the user's own outgoing WhatsApp messages. Analyze their real WhatsApp style: tone, abbreviations, emoji, punctuation, caps, language mixing, length, and how they talk to that person. Then write in THAT exact style. NEVER write in your own voice — become the user's WhatsApp voice." },
                      name: { type: Type.STRING, description: "Contact/group name (for addContact, getMessageHistory). For addContact: Baileys/WhatsApp Web does NOT support adding contacts — it will return an error. Tell the user to save the contact on their phone instead." },
                      number: { type: Type.STRING, description: "Contact phone number (for addContact)" },
                      chatId: { type: Type.STRING, description: "Chat JID or phone number (for getMessageHistory, readGroupChat)" },
                      groupId: { type: Type.STRING, description: "Group JID ending in @g.us (for sendGroupMessage, readGroupChat)" },
                      groupName: { type: Type.STRING, description: "Group identifier if the exact group JID is known" },
                      contactId: { type: Type.STRING, description: "Contact JID or phone number (for getMessageHistory)" },
                      limit: { type: Type.NUMBER, description: "Maximum records to return. Maximum 50." }
                    },
                    required: ["action"]
                  }
                },
                {
                  name: "dial_contact",
                   description: "Dial a phone number from the user's phonebook using the native phone dialer. This opens the system phone app with the number pre-filled so the user can tap to call. Use this when the user asks you to call someone (e.g., while driving, hands-free). Requires make_calls permission enabled in settings.",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      contactName: { type: Type.STRING, description: "The contact's name as saved in the user's phonebook (for display purposes)" },
                      phoneNumber: { type: Type.STRING, description: "The phone number to dial, in international format (e.g., +639123456789). Use getContacts to look up the number if needed." }
                    },
                    required: ["contactName", "phoneNumber"]
                  }
                },
                {
                  name: "whatsapp_call",
                   description: "Initiate a WhatsApp voice or video call to a contact. Opens WhatsApp with the call screen for the specified contact. Use this when the user asks you to call someone on WhatsApp (e.g., 'WhatsApp John', 'video call my mom on WhatsApp'). First use getContacts to look up the number. Requires make_whatsapp_calls permission enabled in settings. NOTE: Works on mobile devices where WhatsApp is installed. On desktop, it will open a WhatsApp chat fallback page.",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      contactName: { type: Type.STRING, description: "The contact's name as saved in the user's phonebook (for display)" },
                      phoneNumber: { type: Type.STRING, description: "The phone number in international format (e.g., +639123456789)" },
                      callType: { type: Type.STRING, description: "Type of call: 'voice' for WhatsApp voice call, 'video' for WhatsApp video call. Defaults to 'voice'." }
                    },
                    required: ["contactName", "phoneNumber"]
                  }
                },
                {
                  name: "create_document",
                  description: "Create a professional web artifact document using Ollama Cloud and the /public sample templates as references. Use this for contracts, reports, letters, invoices, proposals, forms, dashboards, certificates, NDAs, receipts, purchase orders, meeting minutes, memos, and written/visual materials. Never mention HTML to the user.",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      title: { type: Type.STRING, description: "Document title displayed to the user." },
                      prompt: { type: Type.STRING, description: "Detailed document instructions, content, fields, tone, parties, layout, and required behavior." },
                      templateName: {
                        type: Type.STRING,
                        description: "Optional template family: contract, invoice, letter, proposal, minutes, memo, purchase-order, receipt, resignation, nda, certificate."
                      }
                    },
                    required: ["title", "prompt"]
                  }
                },
                {
                  name: "generate_image",
                  description: "Generate a beautiful high-quality image via the Gemini API. Use this when the user asks you to create, generate, draw, or paint an image. IMPORTANT: You must act as a prompt engineer and expand the user's short request into a highly detailed, descriptive, and imaginative prompt (at least 2-3 sentences) describing lighting, style, and composition to get the best visual result.",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      prompt: { type: Type.STRING, description: "Your expanded, highly detailed description of the image to generate (minimum 2-3 sentences)." },
                      aspectRatio: { type: Type.STRING, description: "Aspect ratio, one of '1:1', '3:4', '4:3', '9:16', '16:9'. Default is '1:1'." }
                    },
                    required: ["prompt"]
                  }
                },
                {
                  name: "validate_vat_number",
                  description: "Instantly verify a Belgian or EU VAT number via the VIES system. Returns company name, address, and active status if valid. You can use this for KBO/BCE company lookup by passing the company number with BE country code.",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      countryCode: { type: Type.STRING, description: "2-letter country code (e.g., BE for Belgium)" },
                      vatNumber: { type: Type.STRING, description: "The VAT number without the country prefix" }
                    },
                    required: ["countryCode", "vatNumber"]
                  }
                },
                {
                  name: "check_train_route",
                  description: "Use the iRail API to find real-time train connections in Belgium (SNCB/NMBS). Include delays, departure times, and track numbers.",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      from: { type: Type.STRING, description: "Departure station name (e.g., 'Brussels-Central')" },
                      to: { type: Type.STRING, description: "Arrival station name (e.g., 'Antwerp-Central')" }
                    },
                    required: ["from", "to"]
                  }
                },
                {
                  name: "calculate_registration_tax",
                  description: "Calculate the real estate Registration Tax (Actes/Registratierechten) in Belgium based on the region and purchase price.",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      region: { type: Type.STRING, description: "The region: 'flanders', 'wallonia', or 'brussels'" },
                      price: { type: Type.NUMBER, description: "The purchase price of the property in Euros" },
                      firstTimeBuyer: { type: Type.BOOLEAN, description: "Is this the user's first and only family home?" }
                    },
                    required: ["region", "price", "firstTimeBuyer"]
                  }
                },
                {
                  name: "check_tax_deadlines",
                  description: "Returns the typical upcoming Belgian tax deadlines (VAT, corporate, personal income, and social security) based on the current date.",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {}
                  }
                },
                {
                  name: "generate_peppol_invoice_xml",
                  description: "Drafts a Peppol BIS Billing 3.0 UBL XML invoice file to the workspace. Use this when the user asks to send a Peppol e-invoice.",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      supplierName: { type: Type.STRING },
                      supplierVat: { type: Type.STRING },
                      customerName: { type: Type.STRING },
                      customerVat: { type: Type.STRING },
                      amount: { type: Type.NUMBER },
                      description: { type: Type.STRING }
                    },
                    required: ["supplierName", "customerName", "amount", "description"]
                  }
                },
      {
        name: "connect_google_account",
        description: "Open the Google sign-in popup to connect or reconnect Beatrice to your Google services. Use this when the user says they want to connect Google, when an earlier tool call returned an auth error, or when the current auth status shows NOT AUTHENTICATED and the user wants to fix it. This pops a Google OAuth window asking the user to grant access to Gmail, Calendar, Drive, Tasks, YouTube, and Contacts. Only call this if the user explicitly agrees to re-authenticate.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            reason: { type: Type.STRING, description: "Brief explanation to show the user why the re-connection is needed, e.g. 'token expired' or 'first-time setup'." }
          },
          required: ["reason"]
        }
      },
      {
        name: "search_flights",
        description: "Search for flights between two cities on a specific date for a given number of passengers. Returns a list of flight offers including price, duration, and airline.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            origin: { type: Type.STRING, description: "IATA airport code for origin (e.g. 'MNL' for Manila, 'LHR' for London)." },
            destination: { type: Type.STRING, description: "IATA airport code for destination (e.g. 'NRT' for Tokyo, 'CDG' for Paris)." },
            departureDate: { type: Type.STRING, description: "Departure date in YYYY-MM-DD format." },
            passengers: { type: Type.NUMBER, description: "Number of adult passengers." }
          },
          required: ["origin", "destination", "departureDate", "passengers"]
        }
      },
      {
        name: "book_flight",
        description: "Book a flight using a specific flight offer ID. Requires passenger details (name, date of birth, passport info). This is a destructive action — confirm the offer and passenger details with the user first.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            offerId: { type: Type.STRING, description: "The unique ID of the flight offer to book." },
            passengerDetails: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  first_name: { type: Type.STRING },
                  last_name: { type: Type.STRING },
                  date_of_birth: { type: Type.STRING, description: "YYYY-MM-DD" },
                  passport_number: { type: Type.STRING },
                  passport_country: { type: Type.STRING, description: "ISO 3166-1 alpha-2 country code." }
                },
                required: ["first_name", "last_name"]
              }
            }
          },
          required: ["offerId", "passengerDetails"]
        }
      },
    ] as FunctionDeclaration[]
  },
],
inputAudioTranscription: {},
outputAudioTranscription: {},

        },
        callbacks: {
          onopen: () => {
            console.log("Live session connected.");
            setTimeout(() => {
              sendTextToLive("[SYSTEM: Please start the conversation now. Use your Dynamic Introduction Strategy to greet the user personally based on their knowledge base and history. Do not mention this system prompt.]");
            }, 1000);
          },

          onmessage: async (message: LiveServerMessage) => {
            if (message.toolCall) {
              const toolCalls = message.toolCall.functionCalls;

              if (toolCalls && toolCalls.length > 0) {
                const functionResponses = [];

                for (const call of toolCalls) {
                  if (!call.name) continue;
                  const callName: string = call.name;
                  const taskId = Math.random().toString(36).substring(7);
                  const serviceName = callName.split('_')[0] || 'System';

                  setTasks(prev => [
                    ...prev,
                    { id: taskId, serviceName, action: callName, status: 'processing' }
                  ]);

                  try {
                    let result: any = null;

                    if (googleTokenRequiredTools.has(callName) && !googleTokenRef.current) {
                      result = { error: "Access token expired or missing. Please re-authenticate Google services in settings." };
                    } else if (callName === 'list_gmail_messages') {
                      const max = Math.min((call.args as any).maxResults || 5, 5);
                      const q = encodeURIComponent((call.args as any).query || 'in:inbox');
                      const listR = await gFetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${max}&q=${q}`);
                      if (listR.data?._authError) { result = { error: "Google session expired. Re-authenticate in settings." }; }
                      else if (!listR.ok) { result = { error: listR.data?.error || 'Gmail list failed' }; }
                      else {
                        const msgList = listR.data?.messages || [];
                        const details = await Promise.all(msgList.slice(0, max).map(async (m: any) => {
                          const dR = await gFetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`);
                          if (dR.ok && dR.data) {
                            const headers = (dR.data.payload?.headers || []).reduce((acc: any, h: any) => { acc[h.name] = h.value; return acc; }, {});
                            return { id: m.id, snippet: dR.data.snippet, subject: headers.Subject, from: headers.From, date: headers.Date };
                          }
                          return m;
                        }));
                        result = { messages: details, resultSizeEstimate: listR.data.resultSizeEstimate };
                      }
                    } else if (callName === 'list_calendar_events') {
                      if ((call.args as any)?._confirmed) {
                        const r = await gFetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events?maxResults=10&timeMin=${encodeURIComponent((call.args as any).timeMin || new Date().toISOString())}`);
                        if (r.data?._authError) { result = { error: "Google session expired. Re-authenticate in settings." }; }
                        else if (!r.ok) { result = { error: r.data?.error || 'Calendar request failed' }; }
                        else { result = r.data; }
                      } else {
                        sendTextToLive("Just checking Boss — do you want me to take a look at your calendar? I can see what events or holidays are coming up.");
                        result = { ok: true, events: [], note: "I asked the user. Call again with _confirmed: true once they say yes." };
                      }
                    } else if (callName === 'list_google_tasks') {
                      const r = await gFetch(`https://tasks.googleapis.com/tasks/v1/lists/@default/tasks`);
                      if (r.data?._authError) { result = { error: "Google session expired. Re-authenticate in settings." }; }
                      else if (!r.ok) { result = { error: r.data?.error || 'Tasks request failed' }; }
                      else { result = r.data; }
                    } else if (callName === 'list_drive_files') {
                      const r = await gFetch(`https://www.googleapis.com/drive/v3/files?pageSize=${Math.min((call.args as any).pageSize || 20, 20)}&fields=files(id,name,mimeType,size,modifiedTime,webViewLink)`);
                      if (r.data?._authError) { result = { error: "Google session expired. Re-authenticate in settings." }; }
                      else if (!r.ok) { result = { error: r.data?.error || 'Drive request failed' }; }
                      else { result = r.data; }
                    } else if (callName === 'search_drive_files') {
                      const q = encodeURIComponent((call.args as any).q || '');
                      const r = await gFetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,mimeType,size,modifiedTime,webViewLink)`);
                      if (r.data?._authError) { result = { error: "Google session expired. Re-authenticate in settings." }; }
                      else if (!r.ok) { result = { error: r.data?.error || 'Drive search failed' }; }
                      else { result = r.data; }
                    } else if (callName === 'get_drive_file') {
                      const fileId = (call.args as any).fileId;
                      const r = await gFetch(`https://www.googleapis.com/drive/v3/files/${fileId}?fields=id,name,mimeType,size,modifiedTime,webViewLink,webContentLink`);
                      if (r.data?._authError) { result = { error: "Google session expired. Re-authenticate in settings." }; }
                      else if (!r.ok) { result = { error: r.data?.error || 'Drive file request failed' }; }
                      else { result = r.data; }
                    } else if (callName === 'send_gmail_message') {
                      const args = call.args as any;
                      if (!googleTokenRef.current) { result = { error: "Access token missing. Re-authenticate in settings." }; } else {
                        const emailLines = [
                          `From: me`, `To: ${args.to}`, `Subject: ${args.subject}`,
                          'Content-Type: text/plain; charset=UTF-8', '', args.body || ''
                        ];
                        const encodedEmail = btoa(emailLines.join('\r\n')).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
                        const r = await gFetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/send`,
                          { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ raw: encodedEmail }) }
                        );
                        if (r.data?._authError) { result = { error: "Google session expired. Re-authenticate in settings." }; }
                        else if (!r.ok) { result = { error: r.data?.error || 'Send failed' }; }
                        else { result = r.data; }
                      }
                    } else if (callName === 'get_user_location') {
                      if (!locationEnabled) {
                        result = { error: "Location access is disabled. Please tell the user they need to enable Location in the Agent Settings to perform this request." };
                      } else {
                        // Check if we have persistent location stored in localStorage
                        const savedLat = localStorage.getItem('beatrice_latitude');
                        const savedLng = localStorage.getItem('beatrice_longitude');
                        const savedTz = localStorage.getItem('beatrice_timezone');

                        if (savedLat && savedLng && savedTz) {
                          const now = new Date();
                          const timeString = now.toLocaleTimeString('en-US', { 
                            timeZone: savedTz,
                            hour: '2-digit',
                            minute: '2-digit',
                            hour12: true 
                          });
                          const dateString = now.toLocaleDateString('en-US', {
                            timeZone: savedTz,
                            weekday: 'long',
                            year: 'numeric',
                            month: 'long',
                            day: 'numeric'
                          });
                          
                          // Generate UTC offset natively
                          const tzOffsetMinutes = now.getTimezoneOffset();
                          const offsetHours = Math.abs(Math.floor(tzOffsetMinutes / 60));
                          const offsetMinutes = Math.abs(tzOffsetMinutes % 60);
                          const offsetString = `UTC${tzOffsetMinutes > 0 ? '-' : '+'}${offsetHours.toString().padStart(2, '0')}:${offsetMinutes.toString().padStart(2, '0')}`;

                          result = {
                            lat: parseFloat(savedLat),
                            lng: parseFloat(savedLng),
                            accuracy: 10,
                            timezone: savedTz,
                            localTime: `${dateString}, ${timeString}`,
                            utcOffset: offsetString
                          };
                        } else {
                          // Safe, non-intrusive fallback based on native browser timezone that never triggers browser prompts
                          const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
                          const now = new Date();
                          const timeString = now.toLocaleTimeString('en-US', { 
                            timeZone: timezone,
                            hour: '2-digit',
                            minute: '2-digit',
                            hour12: true 
                          });
                          const dateString = now.toLocaleDateString('en-US', {
                            timeZone: timezone,
                            weekday: 'long',
                            year: 'numeric',
                            month: 'long',
                            day: 'numeric'
                          });

                          const tzOffsetMinutes = now.getTimezoneOffset();
                          const offsetHours = Math.abs(Math.floor(tzOffsetMinutes / 60));
                          const offsetMinutes = Math.abs(tzOffsetMinutes % 60);
                          const offsetString = `UTC${tzOffsetMinutes > 0 ? '-' : '+'}${offsetHours.toString().padStart(2, '0')}:${offsetMinutes.toString().padStart(2, '0')}`;

                          result = {
                            lat: 50.8503, // Safe default Brussels latitude
                            lng: 4.3517,  // Safe default Brussels longitude
                            accuracy: 50000,
                            timezone: timezone,
                            localTime: `${dateString}, ${timeString}`,
                            utcOffset: offsetString
                          };
                        }
                      }
                    } else if (callName === 'search_youtube') {
                      const r = await gFetch(`https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent((call.args as any).q)}&maxResults=5&type=video`);
                      if (r.data?._authError) { result = { error: "Google session expired. Re-authenticate in settings." }; }
                      else if (!r.ok) { result = { error: r.data?.error || 'YouTube search failed' }; }
                      else { result = r.data; }
                    } else if (callName === 'web_glance') {
                      const args = call.args as any;
                      result = await webGlance(String(args.query || ''), Math.min(Number(args.maxResults) || 3, 5));
                    } else if (callName === 'playwright_action') {
                      if (!waPermissions.playwright_action) {
                        result = { error: "Playwright browser automation permission is disabled. Please enable it in Settings → Skills section." };
                      } else {
                        result = await runPlaywrightAction(call.args as any);
                      }
                    } else if (callName === 'create_google_task') {
                      const r = await gFetch(`https://tasks.googleapis.com/tasks/v1/lists/@default/tasks`,
                        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: (call.args as any).title, notes: (call.args as any).notes || "" }) }
                      );
                      if (r.data?._authError) { result = { error: "Google session expired. Re-authenticate in settings." }; }
                      else if (!r.ok) { result = { error: r.data?.error || 'Task creation failed' }; }
                      else { result = r.data; }
                    } else if (callName === 'get_gmail_message') {
                      const args = call.args as any;
                      const r = await gFetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${args.messageId}`);
                      if (r.data?._authError) { result = { error: "Google session expired. Re-authenticate in settings." }; }
                      else if (!r.ok) { result = { error: r.data?.error || 'Gmail get message failed' }; }
                      else { result = r.data; }
                    } else if (callName === 'trash_gmail_message') {
                      const args = call.args as any;
                      const r = await gFetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${args.messageId}/trash`, { method: 'POST' });
                      if (r.data?._authError) { result = { error: "Google session expired. Re-authenticate in settings." }; }
                      else if (!r.ok) { result = { error: r.data?.error || 'Gmail trash failed' }; }
                      else { result = r.data; }
                    } else if (callName === 'delete_gmail_message') {
                      const args = call.args as any;
                      const r = await gFetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${args.messageId}`, { method: 'DELETE' });
                      if (r.data?._authError) { result = { error: "Google session expired. Re-authenticate in settings." }; }
                      else if (!r.ok) { result = { error: r.data?.error || 'Gmail delete failed' }; }
                      else { result = { ok: true, deleted: true, messageId: args.messageId }; }
                    } else if (callName === 'modify_gmail_message') {
                      const args = call.args as any;
                      const r = await gFetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${args.messageId}/modify`, {
                        method: 'POST',
                        body: JSON.stringify({ addLabelIds: args.addLabelIds || [], removeLabelIds: args.removeLabelIds || [] }),
                      });
                      if (r.data?._authError) { result = { error: "Google session expired. Re-authenticate in settings." }; }
                      else if (!r.ok) { result = { error: r.data?.error || 'Gmail modify failed' }; }
                      else { result = r.data; }
                    } else if (callName === 'search_flights') {
                      const args = call.args as any;
                      result = await duffelClient.searchFlights({
                        origin: args.origin,
                        destination: args.destination,
                        departureDate: args.departureDate,
                        passengers: args.passengers,
                      });
                    } else if (callName === 'book_flight') {
                      const args = call.args as any;
                      result = await duffelClient.bookFlight({
                        offerId: args.offerId,
                        passengerDetails: args.passengerDetails,
                      });
                    } else if (callName === 'update_drive_file_content') {
                      const args = call.args as any;
                      const r = await gFetch(`https://www.googleapis.com/upload/drive/v3/files/${args.fileId}?uploadType=media`, {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'text/plain' },
                        body: args.content
                      });
                      if (r.data?._authError) { result = { error: "Google session expired. Re-authenticate in settings." }; }
                      else if (!r.ok) { result = { error: r.data?.error || 'Drive content update failed' }; }
                      else { result = r.data; }
                    } else if (callName === 'delete_drive_file') {
                      const args = call.args as any;
                      const trash = args.trash !== false;
                      if (trash) {
                        const r = await gFetch(`https://www.googleapis.com/drive/v3/files/${args.fileId}`, {
                          method: 'PATCH',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ trashed: true })
                        });
                        if (r.data?._authError) { result = { error: "Google session expired. Re-authenticate in settings." }; }
                        else if (!r.ok) { result = { error: r.data?.error || 'Drive move to trash failed' }; }
                        else { result = r.data; }
                      } else {
                        const r = await gFetch(`https://www.googleapis.com/drive/v3/files/${args.fileId}`, { method: 'DELETE' });
                        if (r.data?._authError) { result = { error: "Google session expired. Re-authenticate in settings." }; }
                        else if (!r.ok) { result = { error: r.data?.error || 'Drive delete failed' }; }
                        else { result = { ok: true, deleted: true, fileId: args.fileId }; }
                      }
                    } else if (callName === 'list_google_contacts') {
                      const args = call.args as any;
                      const size = Math.min(args.pageSize || 50, 100);
                      const r = await gFetch(`https://people.googleapis.com/v1/people/me/connections?pageSize=${size}&personFields=names,emailAddresses,phoneNumbers`);
                      if (r.data?._authError) { result = { error: "Google session expired. Re-authenticate in settings." }; }
                      else if (!r.ok) { result = { error: r.data?.error || 'Contacts list failed' }; }
                      else { result = r.data; }
                    } else if (callName === 'create_google_contact') {
                      const args = call.args as any;
                      const contactData = {
                        names: [{ givenName: args.firstName, familyName: args.lastName || '' }],
                        emailAddresses: args.email ? [{ value: args.email }] : [],
                        phoneNumbers: args.phone ? [{ value: args.phone }] : []
                      };
                      const r = await gFetch(`https://people.googleapis.com/v1/people:createContact`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(contactData)
                      });
                      if (r.data?._authError) { result = { error: "Google session expired. Re-authenticate in settings." }; }
                      else if (!r.ok) { result = { error: r.data?.error || 'Contact creation failed' }; }
                      else { result = r.data; }
                    } else if (callName === 'update_google_contact') {
                      const args = call.args as any;
                      const getR = await gFetch(`https://people.googleapis.com/v1/${args.resourceName}?personFields=names,emailAddresses,phoneNumbers`);
                      if (!getR.ok) { result = { error: getR.data?.error || 'Failed to fetch contact for update' }; } else {
                        const etag = getR.data.etag;
                        const contactData = {
                          etag,
                          names: [{ givenName: args.firstName || getR.data.names?.[0]?.givenName || '', familyName: args.lastName ?? getR.data.names?.[0]?.familyName ?? '' }],
                          emailAddresses: args.email ? [{ value: args.email }] : getR.data.emailAddresses || [],
                          phoneNumbers: args.phone ? [{ value: args.phone }] : getR.data.phoneNumbers || []
                        };
                        const r = await gFetch(`https://people.googleapis.com/v1/${args.resourceName}:updateContact?updatePersonFields=names,emailAddresses,phoneNumbers`, {
                          method: 'PATCH',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify(contactData)
                        });
                        if (r.data?._authError) { result = { error: "Google session expired. Re-authenticate in settings." }; }
                        else if (!r.ok) { result = { error: r.data?.error || 'Contact update failed' }; }
                        else { result = r.data; }
                      }
                    } else if (callName === 'delete_google_contact') {
                      const args = call.args as any;
                      const r = await gFetch(`https://people.googleapis.com/v1/${args.resourceName}:deleteContact`, { method: 'DELETE' });
                      if (r.data?._authError) { result = { error: "Google session expired. Re-authenticate in settings." }; }
                      else if (!r.ok) { result = { error: r.data?.error || 'Contact deletion failed' }; }
                      else { result = { ok: true, deleted: true, resourceName: args.resourceName }; }
                    } else if (callName === 'create_calendar_event') {
                      const args = call.args as any;
                      const eventBody = {
                        summary: args.summary,
                        description: args.description || '',
                        start: { dateTime: args.start },
                        end: { dateTime: args.end },
                        location: args.location || ''
                      };
                      const r = await gFetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(eventBody)
                      });
                      if (r.data?._authError) { result = { error: "Google session expired. Re-authenticate in settings." }; }
                      else if (!r.ok) { result = { error: r.data?.error || 'Calendar event creation failed' }; }
                      else { result = r.data; }
                    } else if (callName === 'update_calendar_event') {
                      const args = call.args as any;
                      const getR = await gFetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${args.eventId}`);
                      if (!getR.ok) { result = { error: getR.data?.error || 'Failed to fetch event for update' }; } else {
                        const eventBody = {
                          summary: args.summary || getR.data.summary,
                          description: args.description ?? getR.data.description,
                          start: args.start ? { dateTime: args.start } : getR.data.start,
                          end: args.end ? { dateTime: args.end } : getR.data.end,
                          location: args.location ?? getR.data.location
                        };
                        const r = await gFetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${args.eventId}`, {
                          method: 'PUT',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify(eventBody)
                        });
                        if (r.data?._authError) { result = { error: "Google session expired. Re-authenticate in settings." }; }
                        else if (!r.ok) { result = { error: r.data?.error || 'Calendar event update failed' }; }
                        else { result = r.data; }
                      }
                    } else if (callName === 'delete_calendar_event') {
                      const args = call.args as any;
                      const r = await gFetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${args.eventId}`, { method: 'DELETE' });
                      if (r.data?._authError) { result = { error: "Google session expired. Re-authenticate in settings." }; }
                      else if (!r.ok) { result = { error: r.data?.error || 'Calendar event deletion failed' }; }
                      else { result = { ok: true, deleted: true, eventId: args.eventId }; }
                    } else if (callName === 'update_google_task') {
                      const args = call.args as any;
                      const getR = await gFetch(`https://tasks.googleapis.com/tasks/v1/lists/@default/tasks/${args.taskId}`);
                      if (!getR.ok) { result = { error: getR.data?.error || 'Failed to fetch task for update' }; } else {
                        const taskBody = {
                          id: args.taskId,
                          title: args.title || getR.data.title,
                          notes: args.notes ?? getR.data.notes,
                          status: args.status || getR.data.status
                        };
                        const r = await gFetch(`https://tasks.googleapis.com/tasks/v1/lists/@default/tasks/${args.taskId}`, {
                          method: 'PUT',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify(taskBody)
                        });
                        if (r.data?._authError) { result = { error: "Google session expired. Re-authenticate in settings." }; }
                        else if (!r.ok) { result = { error: r.data?.error || 'Task update failed' }; }
                        else { result = r.data; }
                      }
                    } else if (callName === 'delete_google_task') {
                      const args = call.args as any;
                      const r = await gFetch(`https://tasks.googleapis.com/tasks/v1/lists/@default/tasks/${args.taskId}`, { method: 'DELETE' });
                      if (r.data?._authError) { result = { error: "Google session expired. Re-authenticate in settings." }; }
                      else if (!r.ok) { result = { error: r.data?.error || 'Task deletion failed' }; }
                      else { result = { ok: true, deleted: true, taskId: args.taskId }; }
                    } else if (callName === 'execute_google_service') {
                      if (!googleTokenRef.current) { result = { error: "Access token missing. Re-authenticate in settings." }; } else {
                        const args = call.args as any;
                        const serviceName = args.serviceName?.toLowerCase();
                        if (serviceName && waPermissions[serviceName] === false) {
                          result = { error: `${args.serviceName} integration is disabled. Please enable it in Settings → Skills section.` };
                        } else {
                          const serviceMap: Record<string, string> = {
                            gmail: 'https://gmail.googleapis.com',
                            calendar: 'https://www.googleapis.com/calendar/v3',
                            tasks: 'https://tasks.googleapis.com',
                            drive: 'https://www.googleapis.com/drive/v3',
                            youtube: 'https://www.googleapis.com/youtube/v3',
                            sheets: 'https://sheets.googleapis.com/v4',
                            docs: 'https://docs.googleapis.com/v1',
                          };
                          const baseUrl = serviceMap[serviceName] || `https://${args.serviceName}.googleapis.com`;
                          const r = await gFetch(`${baseUrl}/${args.action || ''}`);
                          if (r.data?._authError) { result = { error: "Google session expired. Re-authenticate in settings." }; }
                          else if (!r.ok) { result = { error: r.data?.error || 'Service request failed' }; }
                          else { result = r.data; }
                        }
                      }
                    } else if (callName === 'whatsapp_action') {
                      const args = call.args as any;
                      try {
                        const { callWhatsAppTool } = await import('../lib/whatsappClient');
                        result = await callWhatsAppTool(user.uid, args.action, {
                          to: args.to,
                          text: args.text,
                          name: args.name,
                          number: args.number,
                          groupId: args.groupId,
                          groupName: args.groupName,
                          chatId: args.chatId,
                          contactId: args.contactId,
                          limit: args.limit,
                        }, waPermissions);
                      } catch (e: any) {
                        result = { ok: false, error: e.message || 'WhatsApp action failed' };
                      }
                    } else if (callName === 'generate_image') {
                      if (!waPermissions.generate_image) {
                        result = { error: "Image generation permission is disabled. Please enable it in Settings → Skills section." };
                      } else {
                        const args = call.args as any;
                        const prompt = String(args.prompt || 'A beautiful image');
                        const aspectRatio = args.aspectRatio || '1:1';
                        const generationTaskId = crypto.randomUUID();

                        try {
                          setGeneratedDocumentTask(generationTaskId, 'Image Generation', '', 'working');

                          const imageResult = await generateImageWithGemini({
                            prompt,
                            aspectRatio,
                          });
                        
                        const binaryData = Uint8Array.from(atob(imageResult.imageBytesBase64), c => c.charCodeAt(0));
                        const blob = new Blob([binaryData], { type: imageResult.mimeType });

                        setGeneratedDocumentTask(generationTaskId, 'Image Generated', 'Image generated successfully.', 'done');

                          // Auto-save to workspace (local + Google Drive)
                          const wsOutput = {
                            id: `img_${generationTaskId}`,
                            userId: user.uid,
                            type: 'image' as const,
                            title: prompt.substring(0, 50) + '...',
                            blobData: await blob.arrayBuffer(),
                            mimeType: imageResult.mimeType,
                            fileSize: blob.size,
                            createdAt: new Date().toISOString(),
                          };
                          await saveOutput(wsOutput);
                          // Background upload to Google Drive
                          if (googleTokenRef.current) {
                            uploadToDrive(gFetch, wsOutput).then(driveResult => {
                              if (driveResult) {
                                saveOutput({ ...wsOutput, driveFileId: driveResult.fileId, driveLink: driveResult.link });
                              }
                            }).catch(() => {});
                          }

                        // Build a viewable HTML page with the image embedded
                        const imageBase64 = imageResult.imageBytesBase64;
                        const imageDataUrl = `data:${imageResult.mimeType};base64,${imageBase64}`;
                        const imageHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${prompt.substring(0, 60)}</title><style>body{margin:0;min-height:100vh;background:#0d0a08;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:20px;font-family:system-ui,sans-serif}img{max-width:100%;max-height:85vh;border-radius:16px;box-shadow:0 8px 40px rgba(0,0,0,0.5)}.caption{color:#d0a78b;font-size:14px;margin-top:16px;text-align:center;max-width:600px;line-height:1.5}.label{color:#6b5d53;font-size:11px;margin-top:8px;text-transform:uppercase;letter-spacing:0.1em}</style></head><body><img src="${imageDataUrl}" alt="${prompt.replace(/"/g, '&quot;')}"><p class="caption">${prompt.replace(/"/g, '&quot;')}</p><p class="label">Generated by Beatrice · Eburon AI</p></body></html>`;

                        result = { ok: true, title: prompt.substring(0, 50), content: imageHtml };
                      } catch (e: any) {
                        setGeneratedDocumentTask(generationTaskId, 'Image Generation', 'Failed to generate image.', 'done');
                        result = { ok: false, error: e.message || 'Image generation failed' };
                      }
                    }
                    } else if (callName === 'create_document') {
                      if (!waPermissions.create_document) {
                        result = { error: "Document creation permission is disabled. Please enable it in Settings → Skills section." };
                      } else {
                        const args = call.args as any;
                        const title = String(args.title || 'Document');
                        const prompt = String(args.prompt || 'Create a professional document.');
                        const generationTaskId = crypto.randomUUID();

                        try {
                          setGeneratedDocumentTask(generationTaskId, title, '', 'working');

                        const documentResult = await generateDocumentWithGemini({
                          title,
                          prompt,
                          templateName: args.templateName,
                          userId: user.uid,
                          language: authLanguage,
                          personaName,
                          historyContext: historyContextRef.current,
                        });

                        const content = (documentResult && typeof documentResult === 'object' && 'content' in documentResult) 
                          ? (documentResult as { content: string }).content 
                          : documentResult || '';

                        setGeneratedDocumentTask(generationTaskId, title, content, 'done');

                        // Auto-save to workspace (local + Google Drive)
                        const wsOutput = {
                          id: `doc_${generationTaskId}`,
                          userId: user.uid,
                          type: 'document' as const,
                          title,
                          textContent: content,
                          mimeType: 'text/html',
                          fileSize: new Blob([content]).size,
                          createdAt: new Date().toISOString(),
                        };
                        saveOutput(wsOutput).catch(() => {});
                        // Background upload to Google Drive
                        if (googleTokenRef.current) {
                          uploadToDrive(gFetch, wsOutput).then(driveResult => {
                            if (driveResult) {
                              saveOutput({ ...wsOutput, driveFileId: driveResult.fileId, driveLink: driveResult.link });
                            }
                          }).catch(() => {});
                        }

                        result = {
                          ok: true,
                          title,
                          content,
                          templateName: args.templateName || inferDocumentTemplate(title, prompt),
                          generatedBy: 'gemini',
                        };
                      } catch (e: any) {
                        setGeneratedDocumentTask(generationTaskId, title, '', 'error');
                        result = {
                          error: e?.message || 'Document generation failed.'
                        };
                      }
                    }
                    } else if (callName === 'validate_vat_number') {
                      if (!waPermissions.validate_vat_number) {
                        result = { error: "VAT verification/Company Lookup permission is disabled. Please enable it in Settings → Skills section." };
                      } else {
                        const args = call.args as any;
                        const req = await fetch('http://localhost:4200/api/vies/validate', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ countryCode: args.countryCode, vatNumber: args.vatNumber })
                        });
                        if (!req.ok) { result = { error: 'Failed to reach VIES validation server.' }; }
                        else { result = await req.json(); }
                      }
                    } else if (callName === 'check_train_route') {
                      if (!waPermissions.check_train_route) {
                        result = { error: "iRail Train Connection Planner permission is disabled. Please enable it in Settings → Skills section." };
                      } else {
                        const args = call.args as any;
                        try {
                          const req = await fetch(`https://api.irail.be/connections/?from=${encodeURIComponent(args.from)}&to=${encodeURIComponent(args.to)}&format=json&fast=true`);
                          if (!req.ok) throw new Error('iRail request failed');
                          const data = await req.json();
                          const connections = data.connection?.slice(0, 3).map((c: any) => ({
                            departure: new Date(c.departure.time * 1000).toLocaleTimeString(),
                            departureStation: c.departure.stationinfo.name,
                            departurePlatform: c.departure.platform,
                            delayMinutes: parseInt(c.departure.delay || '0') / 60,
                            arrival: new Date(c.arrival.time * 1000).toLocaleTimeString(),
                            arrivalStation: c.arrival.stationinfo.name,
                            arrivalPlatform: c.arrival.platform,
                            durationMinutes: parseInt(c.duration || '0') / 60,
                            canceled: c.departure.canceled !== '0'
                          }));
                          result = { success: true, connections };
                        } catch (e: any) {
                          result = { error: e.message || 'iRail API error' };
                        }
                      }
                    } else if (callName === 'calculate_registration_tax') {
                      if (!waPermissions.calculate_registration_tax) {
                        result = { error: "Registration Tax Calculator permission is disabled. Please enable it in Settings → Skills section." };
                      } else {
                        const args = call.args as any;
                        const price = Number(args.price) || 0;
                        let tax = 0;
                        let rate = "";
                        if (args.region.toLowerCase() === 'flanders') {
                          if (args.firstTimeBuyer) { tax = price * 0.03; rate = "3% (First home)"; }
                          else { tax = price * 0.12; rate = "12% (Standard)"; }
                        } else if (args.region.toLowerCase() === 'wallonia') {
                          if (args.firstTimeBuyer && price < 350000) { tax = price * 0.06; rate = "6% (Reduced)"; }
                          else { tax = price * 0.125; rate = "12.5% (Standard)"; }
                        } else if (args.region.toLowerCase() === 'brussels') {
                          tax = price * 0.125; rate = "12.5% (Standard)";
                          if (args.firstTimeBuyer && price <= 600000) {
                            const abattement = Math.min(price, 200000);
                            tax = (price - abattement) * 0.125;
                            rate = "12.5% (with €200,000 abattement)";
                          }
                        } else {
                          result = { error: "Unknown region. Must be flanders, wallonia, or brussels." };
                        }
                        if (!result) result = { price, region: args.region, calculatedTax: tax, effectiveRate: rate, totalCost: price + tax };
                      }
                    } else if (callName === 'check_tax_deadlines') {
                      if (!waPermissions.check_tax_deadlines) {
                        result = { error: "Belgian Tax Deadlines Reminders permission is disabled. Please enable it in Settings → Skills section." };
                      } else {
                        const d = new Date();
                        const year = d.getFullYear();
                        result = {
                          note: "These are typical Belgian deadlines.",
                          upcoming: [
                            { taxType: "VAT (Monthly)", nextDeadline: `20th of the current month` },
                            { taxType: "VAT (Quarterly)", nextDeadline: `20th of April, July, October, January` },
                            { taxType: "Personal Income Tax (Tax-on-web)", nextDeadline: `Mid-July ${year}` },
                            { taxType: "Corporate Income Tax", nextDeadline: `Depends on fiscal year end (typically October for Dec 31 closure)` },
                            { taxType: "Social Security Contributions (Independents)", nextDeadline: `End of Q1/Q2/Q3/Q4` }
                          ]
                        };
                      }
                    } else if (callName === 'generate_peppol_invoice_xml') {
                      if (!waPermissions.generate_peppol_invoice_xml) {
                        result = { error: "Peppol E-Invoice Generator permission is disabled. Please enable it in Settings → Skills section." };
                      } else {
                        const args = call.args as any;
                        const generationTaskId = crypto.randomUUID();
                      
                      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
         xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
         xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
    <cbc:CustomizationID>urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0</cbc:CustomizationID>
    <cbc:ProfileID>urn:fdc:peppol.eu:2017:poacc:billing:01:1.0</cbc:ProfileID>
    <cbc:ID>INV-${Date.now()}</cbc:ID>
    <cbc:IssueDate>${new Date().toISOString().split('T')[0]}</cbc:IssueDate>
    <cbc:InvoiceTypeCode>380</cbc:InvoiceTypeCode>
    <cbc:DocumentCurrencyCode>EUR</cbc:DocumentCurrencyCode>
    <cac:AccountingSupplierParty>
        <cac:Party>
            <cac:PartyName><cbc:Name>${args.supplierName}</cbc:Name></cac:PartyName>
            <cac:PartyTaxScheme>
                <cbc:CompanyID>${args.supplierVat}</cbc:CompanyID>
                <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
            </cac:PartyTaxScheme>
        </cac:Party>
    </cac:AccountingSupplierParty>
    <cac:AccountingCustomerParty>
        <cac:Party>
            <cac:PartyName><cbc:Name>${args.customerName}</cbc:Name></cac:PartyName>
            <cac:PartyTaxScheme>
                <cbc:CompanyID>${args.customerVat}</cbc:CompanyID>
                <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
            </cac:PartyTaxScheme>
        </cac:Party>
    </cac:AccountingCustomerParty>
    <cac:LegalMonetaryTotal>
        <cbc:LineExtensionAmount currencyID="EUR">${args.amount}</cbc:LineExtensionAmount>
        <cbc:TaxExclusiveAmount currencyID="EUR">${args.amount}</cbc:TaxExclusiveAmount>
        <cbc:TaxInclusiveAmount currencyID="EUR">${args.amount * 1.21}</cbc:TaxInclusiveAmount>
        <cbc:PayableAmount currencyID="EUR">${args.amount * 1.21}</cbc:PayableAmount>
    </cac:LegalMonetaryTotal>
    <cac:InvoiceLine>
        <cbc:ID>1</cbc:ID>
        <cbc:InvoicedQuantity unitCode="EA">1</cbc:InvoicedQuantity>
        <cbc:LineExtensionAmount currencyID="EUR">${args.amount}</cbc:LineExtensionAmount>
        <cac:Item>
            <cbc:Name>${args.description}</cbc:Name>
            <cac:ClassifiedTaxCategory>
                <cbc:ID>S</cbc:ID>
                <cbc:Percent>21.0</cbc:Percent>
                <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
            </cac:ClassifiedTaxCategory>
        </cac:Item>
        <cac:Price><cbc:PriceAmount currencyID="EUR">${args.amount}</cbc:PriceAmount></cac:Price>
    </cac:InvoiceLine>
</Invoice>`;

                      const binaryData = new TextEncoder().encode(xml);
                      const blob = new Blob([binaryData], { type: 'application/xml' });
                      const wsOutput = {
                        id: `peppol_${generationTaskId}`,
                        userId: user.uid,
                        type: 'document' as const,
                        title: `Peppol Invoice (XML) - ${args.customerName}`,
                        textContent: xml,
                        mimeType: 'application/xml',
                        fileSize: blob.size,
                        createdAt: new Date().toISOString()
                      };
                      await db.workspaceOutputs.add(wsOutput);
                      result = { success: true, message: "Peppol BIS Billing 3.0 UBL XML generated and saved to workspace.", workspaceId: wsOutput.id };
                    }
                    } else if (callName === 'connect_google_account') {
                      const reason = (call.args as any)?.reason || 'User requested Google re-authentication';
                      try {
                        if (typeof onLogin === 'function') {
                          onLogin();
                          result = { ok: true, message: `Opening Google sign-in window... (reason: ${reason})` };
                        } else {
                          result = { error: 'Google sign-in is not available in the current context.' };
                        }
                      } catch (e: any) {
                        result = { error: `Failed to open Google sign-in: ${e.message}` };
                      }
                    } else if (callName === 'dial_contact') {
                      const args = call.args as any;
                      if (!waPermissions.make_calls) {
                        result = { error: "Phone dialing permission is not enabled. Enable 'Make Calls' in settings first." };
                      } else if (!args.phoneNumber) {
                        result = { error: "No phone number provided." };
                      } else {
                        try {
                          const phoneNumber = args.phoneNumber.replace(/[^+\d]/g, '');
                          const contactName = args.contactName || phoneNumber;
                          // Use location.href for mobile compatibility (Android/iOS both handle tel: reliably)
                          window.location.href = `tel:${phoneNumber}`;
                          result = { ok: true, message: `Dialing ${contactName} at ${phoneNumber}...` };
                        } catch (e: any) {
                          result = { error: `Failed to dial: ${e.message}` };
                        }
                      }
                    } else if (callName === 'whatsapp_call') {
                      const args = call.args as any;
                      if (!waPermissions.make_whatsapp_calls) {
                        result = { error: "WhatsApp calling permission is not enabled. Enable 'WhatsApp Calls' in settings first." };
                      } else if (!args.phoneNumber) {
                        result = { error: "No phone number provided." };
                      } else {
                        try {
                          const phoneNumber = args.phoneNumber.replace(/[^+\d]/g, '');
                          const contactName = args.contactName || phoneNumber;
                          const callType = args.callType === 'video' ? 'videocall' : 'call';
                          // Use WhatsApp deep link: whatsapp://call for voice, whatsapp://videocall for video
                          window.location.href = `whatsapp://${callType}?phone=${phoneNumber}`;
                          result = { ok: true, message: `Opening WhatsApp ${args.callType === 'video' ? 'video' : 'voice'} call with ${contactName}...` };
                        } catch (e: any) {
                          result = { error: `Failed to initiate WhatsApp call: ${e.message}` };
                        }
                      }
                    }

                    setTasks(prev =>
                      prev.map(t => (t.id === taskId ? { ...t, status: 'completed' } : t))
                    );

                    setTimeout(() => {
                      setTasks(prev => prev.filter(t => t.id !== taskId));
                    }, 8000);

                    if (!(callName === 'web_glance' && silenceFillerInFlightRef.current)) {
                      if (!(callName === 'create_document' && result?.content)) {
                        if (callName !== 'dial_contact' && callName !== 'whatsapp_call') {
                          showToolResult(callName, result);
                        }
                      }
                    }

                    functionResponses.push({
                      id: call.id,
                      name: callName,
                      response: { result }
                    });
                  } catch (err) {
                    console.error("Tool execution failed:", err);

                    setTasks(prev => prev.filter(t => t.id !== taskId));

                    if (!(callName === 'web_glance' && silenceFillerInFlightRef.current)) {
                      // Show error for dial_contact (user needs to know why it failed),
                      // but suppress success toast since the phone dialer is already open
                      showToolResult(callName, null, String(err));
                    }

                    functionResponses.push({
                      id: call.id,
                      name: callName,
                      response: { error: String(err) }
                    });
                  }
                }

                if (functionResponses.length > 0 && sessionRef.current) {
                  if (typeof sessionRef.current.sendToolResponse === 'function') {
                    sessionRef.current.sendToolResponse({ functionResponses });
                  } else {
                    console.warn("sendToolResponse is unavailable on this Live session.");
                  }
                }
              }
            }

            if (message.serverContent) {
              if (message.serverContent.interrupted) {
                markUserSpeechActivity();
                audioStreamerRef.current?.stop();
                setIsAgentSpeaking(false);
                return;
              }

              const content: any = message.serverContent;

              if (content.inputTranscription?.text) {
                const text = content.inputTranscription.text.trim();

                if (text) {
                  audioStreamerRef.current?.stop();
                  setIsAgentSpeaking(false);
                  markUserSpeechActivity();
                  upsertLiveUserTranscript(text);

                  if (transcriptTimeoutRef.current) clearTimeout(transcriptTimeoutRef.current);
                  transcriptTimeoutRef.current = setTimeout(() => {
                    setUserTranscript('');
                    setModelTranscript('');
                  }, 4000);
                }
              }

              if (content.outputTranscription?.text) {
                finalizeLiveUserTranscript();
                clearSilenceFillerTimer();
                const text = content.outputTranscription.text;
                const updatedText = (modelTranscriptRef.current + text).trim();
                modelTranscriptRef.current = updatedText;
                setModelTranscript(updatedText);

                if (transcriptTimeoutRef.current) clearTimeout(transcriptTimeoutRef.current);
                transcriptTimeoutRef.current = setTimeout(() => {
                  setUserTranscript('');
                  setModelTranscript('');
                }, 4000);
              }

              const modelTurn = message.serverContent.modelTurn;

              if (modelTurn?.parts) {
                for (const part of modelTurn.parts) {
                  if (part.inlineData?.data) {
                    finalizeLiveUserTranscript();
                    clearSilenceFillerTimer();
                    if (isNewTurnRef.current) {
                      audioStreamerRef.current?.stop();
                      isNewTurnRef.current = false;
                    }
                    audioStreamerRef.current?.addPCM16(part.inlineData.data);
                    setIsAgentSpeaking(true);

                    if (speakingTimeoutRef.current) clearTimeout(speakingTimeoutRef.current);
                    speakingTimeoutRef.current = setTimeout(() => setIsAgentSpeaking(false), 700);
                  }

                  if ((part as any).text) {
                    finalizeLiveUserTranscript();
                    clearSilenceFillerTimer();
                    const text = (part as any).text;
                    const updatedText = (modelTranscriptRef.current + text).trim();
                    modelTranscriptRef.current = updatedText;
                    setModelTranscript(updatedText);

                    if (transcriptTimeoutRef.current) clearTimeout(transcriptTimeoutRef.current);
                    transcriptTimeoutRef.current = setTimeout(() => {
                      setUserTranscript('');
                      setModelTranscript('');
                    }, 4000);
                  }
                }
              }

              const legacyUserTurn = (message.serverContent as any).userTurn;

              if (legacyUserTurn?.parts) {
                const text = legacyUserTurn.parts.map((p: any) => p.text).join(" ").trim();

                if (text) {
                  markUserSpeechActivity();
                  upsertLiveUserTranscript(text);

                  if (transcriptTimeoutRef.current) clearTimeout(transcriptTimeoutRef.current);
                  transcriptTimeoutRef.current = setTimeout(() => {
                    setUserTranscript('');
                    setModelTranscript('');
                  }, 4000);
                }
              }

              if ((message.serverContent as any).turnComplete) {
                finalizeLiveUserTranscript();
                isNewTurnRef.current = true;
                const current = modelTranscriptRef.current;
                const isSilenceFillerTurn = silenceFillerInFlightRef.current;

                if (current) {
                  if (!isSilenceFillerTurn) {
                    setMessages(prev => [...prev, { role: 'model', text: current, timestamp: new Date().toISOString(), sessionId: sessionIdRef.current }]);
                    // Buffer model speech for reconnection resilience
                    conversationBufferRef.current.push(`ASSISTANT: ${current}`);
                    saveMessage('model', current);
                  }
                  modelTranscriptRef.current = '';
                }

                silenceFillerInFlightRef.current = false;
                lastModelTurnCompleteAtRef.current = Date.now();
                scheduleSilenceFiller();
              }
            }
          },

          onclose: (e: any) => {
            console.log("Live session closed:", e?.reason || e);
            stopSession();
          },

          onerror: (err: any) => {
            console.error("Live API Error:", err);
            stopSession();
          }
        }
      });

      sessionRef.current = session;

      audioRecorderRef.current = new AudioRecorder((base64Data) => {
        sendAudioToLive(base64Data);
      });

      try {
        await audioRecorderRef.current.start();
      } catch (micErr: any) {
        console.error("Microphone startup error:", micErr);
        let msg = "Microphone access is required to speak with Beatrice. Please grant microphone permission in your browser.";
        if (micErr instanceof Error && micErr.name !== 'NotAllowedError') {
          msg = `Microphone error: ${micErr.message}`;
        }
        alert(msg);
        throw micErr;
      }

      isActiveRef.current = true;
      lastUserSpeechAtRef.current = Date.now();
      silenceFillerCountRef.current = 0;
      silenceFillerInFlightRef.current = false;
      lastSilenceFillerStyleRef.current = null;
      setIsActive(true);
      setConnecting(false);
      sessionStartingRef.current = false;

      setTimeout(() => {
        sendTextToLive(
          "Start naturally like the conversation is already happening at a cafe. Do not introduce yourself. Do not mention your name. Do not offer help. Use a small human beat if it fits, like 'Mm...' or 'Yeah...', then begin with a casual observation, small-talk thought, back-to-reality moment, or light current-topic style comment. Keep it calm and normal. Do not overuse fillers."
        );
      }, 250);

      setTimeout(() => {
        if (isCameraActive) {
          sendTextToLive("The user just turned on their camera. You can now see them. React naturally - greet them like you're on a video call. Make eye contact references, comment on what you see casually, keep it warm and human.");
        }
      }, 350);
    } catch (err) {
      console.error("Failed to start Live session:", err);
      setConnecting(false);
      sessionStartingRef.current = false;
      stopSession();
    }
  };

  const stopSession = () => {
    finalizeLiveUserTranscript();
    clearSilenceFillerTimer();
    isActiveRef.current = false;
    isAgentSpeakingRef.current = false;
    silenceFillerInFlightRef.current = false;
    silenceFillerCountRef.current = 0;
    lastSilenceFillerStyleRef.current = null;

    try {
      audioRecorderRef.current?.stop();
    } catch (e) {}

    try {
      audioStreamerRef.current?.stop();
    } catch (e) {}

    stopAmbientBed();

    try {
      sessionRef.current?.close();
    } catch (e) {}

    if (videoStreamRef.current) {
      videoStreamRef.current.getTracks().forEach(t => t.stop());
      videoStreamRef.current = null;
    }

    if (videoIntervalRef.current) {
      clearInterval(videoIntervalRef.current);
      videoIntervalRef.current = null;
    }

    if (transcriptTimeoutRef.current) {
      clearTimeout(transcriptTimeoutRef.current);
      transcriptTimeoutRef.current = null;
    }

    if (speakingTimeoutRef.current) {
      clearTimeout(speakingTimeoutRef.current);
      speakingTimeoutRef.current = null;
    }

    sessionRef.current = null;
    audioRecorderRef.current = null;
    userTranscriptRef.current = '';
    modelTranscriptRef.current = '';
    sessionStartingRef.current = false;

    setIsCameraActive(false);
    setIsAgentSpeaking(false);
    setIsActive(false);
    setConnecting(false);
    setUserTranscript('');
    setModelTranscript('');
  };

  const saveMessage = async (role: 'user' | 'model', text: string, attachmentUrl?: string, attachmentName?: string) => {
    try {
      await db.messages.put({
        userId: user.uid,
        sessionId: sessionIdRef.current,
        role,
        text,
        timestamp: new Date().toISOString(),
        attachmentUrl,
        attachmentName,
      });
    } catch (error) {
      console.error('Failed to save message locally:', error);
    }
  };

  return (
    <div className="min-h-screen bg-[#050505] text-white flex flex-col h-[100dvh] overflow-y-auto select-none relative">
      <audio ref={bgAudioRef} src="/office.mp3" loop crossOrigin="anonymous" className="hidden" />
      <div
        className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(208,167,139,0.03),transparent_75%)] pointer-events-none z-0"
      />

      <header className="sticky top-0 w-full bg-black/70 backdrop-blur-2xl border-b border-white/[0.04] px-4 sm:px-6 py-3.5 flex items-center justify-between z-30 shrink-0">
        <div className="flex items-center">
            <button
              onClick={() => {
                window.history.pushState(null, '', '/settings');
                window.dispatchEvent(new PopStateEvent('popstate'));
              }}
              className="p-1.5 -ml-1.5 rounded-xl text-white/40 hover:text-white/70 hover:bg-white/5 transition-all duration-300 active:scale-90"
              aria-label="Open Settings"
            >
              <Settings className="w-5 h-5 sm:w-5 sm:h-5" />
            </button>
        </div>

        <div className="text-center flex flex-col items-center">
          <h1 className="text-base sm:text-lg font-['SF_Pro_Display',system-ui,sans-serif] font-semibold tracking-tight text-white">{personaName}</h1>
          <p className="text-[7px] text-white/25 tracking-[0.25em] uppercase font-['SF_Pro_Text',system-ui,sans-serif] font-medium">eburon ai</p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              window.history.pushState(null, '', '/profile');
              window.dispatchEvent(new PopStateEvent('popstate'));
            }}
            className="w-7 h-7 sm:w-7 sm:h-7 rounded-full bg-white/5 border border-white/[0.08] overflow-hidden flex items-center justify-center hover:border-white/20 transition-all duration-300 active:scale-90"
            aria-label="User Profile"
          >
            {user.photoURL ? (
              <img src={user.photoURL} alt="Profile" className="w-full h-full object-cover" />
            ) : (
              <span className="text-white/40 text-[11px] font-['SF_Pro_Text',system-ui,sans-serif] font-semibold">{user.displayName?.charAt(0) || 'M'}</span>
            )}
          </button>
        </div>
      </header>

      {showInstallBanner && deferredPrompt && (
        <div className="w-full bg-[#d0a78b]/10 border-b border-[#d0a78b]/20 px-4 py-2.5 flex items-center justify-between z-20 shrink-0 select-none animate-in fade-in slide-in-from-top-4 duration-300">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-[#d0a78b]/20 flex items-center justify-center border border-[#d0a78b]/20">
              <Download className="w-4 h-4 text-[#d0a78b]" />
            </div>
            <div>
              <p className="text-xs font-semibold text-white">Install Beatrice App</p>
              <p className="text-[10px] text-white/50">Add to homescreen for the premium fullscreen voice experience</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleInstallClick}
              className="px-3 py-1.5 rounded-lg bg-[#d0a78b] text-[#050505] text-[11px] font-bold tracking-wide active:scale-95 transition-all cursor-pointer hover:bg-[#d0a78b]/90 font-['SF_Pro_Text',system-ui,sans-serif]"
            >
              Install
            </button>
            <button
              onClick={() => {
                setShowInstallBanner(false);
                try { localStorage.setItem('beatrice_pwa_dismissed', 'true'); } catch {}
              }}
              className="p-1 rounded-lg text-white/30 hover:text-white/60 hover:bg-white/5 transition-all cursor-pointer"
              aria-label="Dismiss banner"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      <main className="flex-1 relative w-full overflow-hidden">
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="relative flex items-center justify-center">
            <div
              className={`absolute w-64 h-64 sm:w-80 sm:h-80 rounded-full blur-3xl transition-none orb-glow`}
              style={{
                ['--glow-alpha' as string]: isActive ? 0.15 + breathLevel * 0.6 : 0.06,
                ['--glow-scale' as string]: isActive ? 1 + breathLevel * 0.6 : 1,
              } as React.CSSProperties}
            />

            <motion.button
              onClick={isActive ? stopSession : startSession}
              disabled={connecting}
              animate={{
                scale: isActive ? 1 + breathLevel * 0.15 : 1,
                boxShadow: isActive 
                  ? `0 0 ${20 + breathLevel * 100}px rgba(208,167,139,${0.2 + breathLevel * 0.4})` 
                  : '0 0 0px rgba(0,0,0,0)',
              }}
              transition={{ type: 'spring', stiffness: 200, damping: 15 }}
              className="relative w-48 h-48 sm:w-64 sm:h-64 rounded-full bg-white/[0.02] border border-[#d0a78b]/10 overflow-hidden flex items-center justify-center transition-all duration-500 hover:border-[#d0a78b]/30 hover:shadow-[0_0_60px_rgba(208,167,139,0.2)] active:scale-[0.96]"
              aria-label="Toggle Voice Assistant"
            >
              <div className="absolute inset-0 bg-black/5 backdrop-blur-[16px] z-10 rounded-full pointer-events-none" />

              <div className="absolute inset-0 w-full h-full flex items-center justify-center transition-transform duration-100 ease-out z-0">
                <div className="blob-1 absolute w-40 h-40 sm:w-56 sm:h-56 rounded-full bg-[radial-gradient(circle,rgba(208,167,139,0.65)_0%,transparent_70%)] blur-md" />
                <div className="blob-2 absolute w-36 h-36 sm:w-52 sm:h-52 rounded-full bg-[radial-gradient(circle,rgba(171,123,96,0.45)_0%,transparent_70%)] blur-md" />
                <div className="blob-3 absolute w-32 h-32 sm:w-48 sm:h-48 rounded-full bg-[radial-gradient(circle,rgba(235,208,188,0.55)_0%,transparent_70%)] blur-md" />
                <div className="absolute w-14 h-14 sm:w-20 sm:h-20 rounded-full bg-[#d0a78b]/15 blur-xl" />
              </div>

              <div className="absolute inset-0 z-20 rounded-full flex items-center justify-center overflow-hidden">
                <canvas
                  ref={cloudCanvasRef}
                  className="absolute inset-0 w-full h-full pointer-events-none"
                  width={256}
                  height={256}
                />
                {connecting ? (
                  <Loader2 className="w-7 h-7 sm:w-9 sm:h-9 animate-spin text-[#d0a78b] z-10" />
                ) : isActive ? null : null}
              </div>
            </motion.button>
          </div>
        </div>

        <div className="absolute bottom-[42px] sm:bottom-[60px] left-0 right-0 w-full px-4 sm:px-8 flex flex-col items-center justify-end h-[100px] pointer-events-none z-10">
          <UnifiedTranscript
            userText={userTranscript}
            modelText={modelTranscript}
            userName={user.displayName?.split(' ')[0] || 'User'}
            modelName={personaName}
          />
        </div>
      </main>

      <footer className="sticky bottom-0 w-full h-[72px] sm:h-[92px] bg-black/80 backdrop-blur-2xl border-t border-white/5 z-20 px-4 sm:px-6 box-border select-none shrink-0">
        <div className="relative w-full h-full flex items-center justify-between">

          <button
            onClick={() => setShowChatPage(true)}
            className={`absolute left-4 sm:left-[44px] flex flex-col items-center justify-center transition-all duration-300 ${
              showChatPage
                ? 'text-[#d0a78b]'
                : 'text-white/40 hover:text-white/70'
            }`}
          >
            <MessageSquare className="w-5 h-5 sm:w-5 sm:h-5 mb-0.5" />
            <span className="text-[9px] font-['SF_Pro_Text',system-ui,sans-serif] font-semibold tracking-normal">Chat</span>
          </button>

          <button
            onClick={isActive ? stopSession : startSession}
            disabled={connecting}
            aria-label={isActive ? "Stop Voice Assistant" : "Start Voice Assistant"}
            title={isActive ? "Stop Voice Assistant" : "Start Voice Assistant"}
            className={`absolute left-1/2 -translate-x-1/2 bottom-[38px] sm:bottom-[52px] w-14 h-14 sm:w-[74px] sm:h-[74px] rounded-full flex flex-col items-center justify-center shadow-2xl transition-all duration-300 border-[3px] z-30 ${
              isActive
                ? 'bg-zinc-900 text-[#d0a78b] border-[#d0a78b]/30 shadow-[#d0a78b]/10'
                : 'bg-[#d0a78b] text-black hover:bg-[#ebd0bc] shadow-lg shadow-[#d0a78b]/30'
            }`}
          >
            {connecting ? (
              <Loader2 className="w-5 h-5 sm:w-7 sm:h-7 animate-spin" />
            ) : isActive ? (
              <div className="absolute inset-0 rounded-full flex items-center justify-center">
                <canvas
                  ref={stopCanvasRef}
                  className="absolute inset-0 w-full h-full pointer-events-none"
                  width={80}
                  height={80}
                />
                <span className="text-[7px] sm:text-[9px] font-extrabold uppercase tracking-widest z-10 text-[#d0a78b]">
                  Stop
                </span>
              </div>
            ) : (
                <>
                  <motion.div
                    animate={{ 
                      scale: !isActive ? [1, 1.05, 1] : 1,
                    }}
                    transition={{ 
                      repeat: Infinity, 
                      duration: 2, 
                      ease: "easeInOut" 
                    }}
                    className="flex items-center justify-center"
                  >
                    <Power className="w-7 h-7 sm:w-9 sm:h-9" />
                  </motion.div>
                  <span className="text-[7px] sm:text-[9px] font-extrabold uppercase tracking-widest mt-0.5 sm:mt-1">
                    Start
                  </span>
                </>
            )}
          </button>

          <button
            onClick={async () => {
              setShowVideoPage(true);
              if (!isCameraActive) {
                await toggleCamera();
              }
            }}
            className={`absolute right-4 sm:right-[44px] flex flex-col items-center justify-center transition-all duration-300 ${
              showVideoPage
                ? 'text-[#d0a78b]'
                : 'text-white/40 hover:text-white/70'
            }`}
          >
            <Video className="w-5 h-5 sm:w-5 sm:h-5 mb-0.5" />
            <span className="text-[9px] font-['SF_Pro_Text',system-ui,sans-serif] font-semibold tracking-normal">Video</span>
          </button>
        </div>
      </footer>

      <canvas ref={canvasRef} className="hidden" />
      <video ref={videoRef} className="hidden" autoPlay playsInline muted />

      <Suspense fallback={null}>
      <AnimatePresence>
        {showChatPage && (
          <ChatPage
            messages={selectedMessages}
            sessions={sessions}
            selectedSessionId={selectedSessionId}
            onSelectSession={setSelectedSessionId}
            chatInput={chatInput}
            setChatInput={setChatInput}
            onSend={handleSendChat}
            onClose={() => setShowChatPage(false)}
            isActive={isActive}
            personaName={personaName}
            userName={user.displayName?.split(' ')[0] || 'Commander'}
            onFileAttach={handleFileAttach}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showVideoPage && (
          <VideoPage
            onClose={() => setShowVideoPage(false)}
            isCameraActive={isCameraActive}
            toggleCamera={toggleCamera}
            facingMode={facingMode}
            onSwitchCamera={switchCameraMode}
            cameraStream={cameraStream}
            canvasRef={canvasRef}
            isActive={isActive}
            sendVideoToLive={sendVideoToLive}
            sendTextToLive={sendTextToLive}
            onScreenShareChange={(sharing) => { screenShareActiveRef.current = sharing; }}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showDocumentViewer && activeDocument && (
          <DocumentViewer
            title={activeDocument.title}
            content={activeDocument.content}
            fileType={activeDocument.fileType}
            personaName={personaName}
            onClose={() => {
              setShowDocumentViewer(false);
              setActiveDocument(null);
            }}
          />
        )}
      </AnimatePresence>

      <div className="fixed top-24 left-0 right-0 px-8 z-30 pointer-events-none flex flex-col items-end">
        <AnimatePresence>
          {tasks.map(task => (
            <motion.div
              key={task.id}
              layout
              initial={{ opacity: 0, y: 20, scale: 0.9 }}
              animate={{
                opacity: 1,
                y: 0,
                scale: 1,
                backgroundColor: task.status === 'processing' ? 'rgba(208, 167, 139, 0.1)' : 'rgba(16, 185, 129, 0.15)',
                borderColor: task.status === 'processing' ? 'rgba(208, 167, 139, 0.2)' : 'rgba(16, 185, 129, 0.3)',
              }}
              exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.2 } }}
              transition={{ type: "spring", stiffness: 300, damping: 25 }}
              className="mb-2 p-3 rounded-2xl border flex items-center gap-3 backdrop-blur-md shadow-lg overflow-hidden relative"
            >
              {task.status === 'completed' && (
                <motion.div
                  initial={{ scale: 0.8, opacity: 0 }}
                  animate={{ scale: [1, 2], opacity: [0.3, 0] }}
                  transition={{ duration: 0.8, ease: "easeOut" }}
                  className="absolute inset-0 bg-emerald-500/30 rounded-2xl pointer-events-none"
                />
              )}

              {task.status === 'processing' ? (
                <div className="relative flex-shrink-0">
                  <Loader2 className="w-4 h-4 text-[#d0a78b] animate-spin" />
                  <motion.div
                    animate={{ scale: [1, 1.8], opacity: [0.5, 0] }}
                    transition={{ duration: 1.5, repeat: Infinity, ease: "easeOut" }}
                    className="absolute inset-0 bg-[#d0a78b]/50 rounded-full blur-[2px]"
                  />
                </div>
              ) : (
                <motion.div
                  initial={{ scale: 0, rotate: -45 }}
                  animate={{ scale: 1, rotate: 0 }}
                  transition={{ type: "spring", stiffness: 500, damping: 15 }}
                  className="w-5 h-5 rounded-full bg-emerald-500 flex items-center justify-center flex-shrink-0 shadow-[0_0_15px_rgba(16,185,129,0.4)] z-10"
                >
                  <Check className="w-3.5 h-3.5 text-black" strokeWidth={4} />
                </motion.div>
              )}

              <div className="flex-1 truncate text-xs relative z-10">
                <div className="flex items-center gap-1.5 overflow-hidden">
                  <motion.span
                    animate={{ color: task.status === 'processing' ? '#d0a78b' : '#10b981' }}
                    className="font-mono uppercase font-bold"
                  >
                    {task.serviceName}
                  </motion.span>
                  <span className="text-gray-400 truncate">: {task.action}</span>
                </div>
                <motion.span
                  animate={{ opacity: task.status === 'processing' ? 0.7 : 1 }}
                  className="text-[10px] text-gray-500 block font-medium"
                >
                  {task.status === 'processing' ? 'Processing in background...' : 'Successfully completed'}
                </motion.span>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      </Suspense>
    </div>
  );
}
