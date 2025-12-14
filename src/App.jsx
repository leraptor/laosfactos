import React, { useState, useEffect, useRef } from 'react';
import { initializeApp } from 'firebase/app';
import {
  getAuth,
  signInWithCustomToken,
  signInAnonymously,
  onAuthStateChanged,
} from 'firebase/auth';
import { getMessaging, getToken } from 'firebase/messaging';
import { getFunctions, httpsCallable } from 'firebase/functions';
import {
  getFirestore,
  collection,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  query,
  where,
  serverTimestamp,
  writeBatch,
  setDoc
} from 'firebase/firestore';
import {
  Shield,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Activity,
  ScrollText,
  Plus,
  ChevronRight,
  Flame,
  PauseCircle,
  Clock,
  Brain,
  Zap,
  Heart,
  DollarSign,
  Lock,
  Calendar,
  PenTool,
  Fingerprint,
  Hourglass,
  Gavel,
  FileCheck,
  Sparkles,
  Bot,
  Eye,
  Link as LinkIcon,
  Share2,
  AlertOctagon,
  Archive,
  Trophy,
  Skull,
  Scale,
  Trash2,
  MoreHorizontal,
  Book,
  Bell,

} from 'lucide-react';

// --- Utility Functions ---

// Robust Copy to Clipboard that works in iframes
const copyToClipboard = (text) => {
  const textArea = document.createElement("textarea");
  textArea.value = text;

  // Ensure it's not visible but part of the DOM
  textArea.style.position = "fixed";
  textArea.style.left = "-9999px";
  textArea.style.top = "0";
  document.body.appendChild(textArea);

  textArea.focus();
  textArea.select();

  try {
    document.execCommand('copy');
  } catch (err) {
    console.error('Fallback: Oops, unable to copy', err);
  }

  document.body.removeChild(textArea);
};

// Safe renderer to prevent "Objects are not valid as a React child" errors
const SafeRender = ({ content }) => {
  if (content === null || content === undefined) return null;
  if (typeof content === 'string' || typeof content === 'number') return <>{content}</>;
  if (typeof content === 'boolean') return <>{content ? 'True' : 'False'}</>;
  // Fallback for objects/arrays: convert to string
  return <>{JSON.stringify(content)}</>;
};

// Robust Date Formatter for Firestore Timestamps, JS Dates, and Strings
const formatDate = (val) => {
  if (!val) return 'N/A';
  try {
    // Firestore Timestamp
    if (val.toDate && typeof val.toDate === 'function') {
      return val.toDate().toLocaleDateString();
    }
    // JS Date Object
    if (val instanceof Date) {
      return val.toLocaleDateString();
    }
    // String ISO
    return new Date(val).toLocaleDateString();
  } catch (e) {
    return 'Invalid Date';
  }
};

// --- AI Helper (Backend) ---
async function callAIJudge(data) {
  try {
    const judgeViolation = httpsCallable(functions, 'judgeViolation');
    const result = await judgeViolation(data);
    return result.data;
  } catch (e) {
    console.error("AI Judge Error:", e);
    return { verdict: "ERROR", reasoning: "The Void is silent." };
  }
}

async function callAIDrafting(userGoal) {
  try {
    const draftContract = httpsCallable(functions, 'draftContract');
    const result = await draftContract({ userGoal });
    return result.data;
  } catch (e) {
    console.error("AI Draft Error:", e);
    return { title: "Error", behavior: "The Void could not draft this contract." };
  }
}

// --- Firebase Init ---

// 1. PREVIEW CONFIG (Use this here in the chat)
// const firebaseConfig = JSON.parse(__firebase_config);
// const appIdRaw = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
// Sanitize appId for paths
// const appId = appIdRaw.replace(/[^a-zA-Z0-9_-]/g, '_');

// 2. PRODUCTION CONFIG (Use this when deploying to Vercel)
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID
};
const appId = "laosfactos_production";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const messaging = getMessaging(app);
const functions = getFunctions(app);

// --- Constants ---
const MAX_ACTIVE_CONTRACTS = 10;
const MAX_EXCEPTIONS = 5;

const PILLARS = [
  { id: 'longevity', label: 'Longevity', icon: Heart, color: 'text-rose-400' },
  { id: 'wealth', label: 'Wealth', icon: DollarSign, color: 'text-emerald-400' },
  { id: 'contribution', label: 'Contribution', icon: Shield, color: 'text-blue-400' },
  { id: 'inner_world', label: 'Inner World', icon: Brain, color: 'text-purple-400' },
  { id: 'execution', label: 'Execution', icon: Zap, color: 'text-amber-400' },
];

const VIOLATION_REASONS = [
  'Impulse', 'Social Pressure', 'Forgetting', 'Intentional Choice', 'Edge Case'
];

// --- Styles for Animation ---
const styles = `
  @keyframes stamp-slam {
    0% { opacity: 0; transform: scale(3) rotate(15deg); }
    60% { opacity: 1; transform: scale(0.9) rotate(-5deg); }
    80% { transform: scale(1.05) rotate(-3deg); }
    100% { transform: scale(1) rotate(-5deg); }
  }
  .animate-stamp-slam {
    animation: stamp-slam 0.4s cubic-bezier(0.1, 0.9, 0.2, 1) forwards;
  }

  @keyframes shake {
    0%, 100% { transform: translate(0, 0); }
    10%, 30%, 50%, 70%, 90% { transform: translate(-2px, 1px); }
    20%, 40%, 60%, 80% { transform: translate(2px, -1px); }
  }
  .animate-shake {
    animation: shake 0.3s cubic-bezier(.36,.07,.19,.97) both;
  }

  @keyframes scan-fast {
    0% { top: 0%; opacity: 0.8; }
    50% { top: 100%; opacity: 0.8; }
    51% { top: 0%; opacity: 0; }
    100% { top: 0%; opacity: 0; }
  }
  .scan-bar {
    position: absolute;
    left: 0;
    width: 100%;
    height: 4px;
    background: #4ade80; /* emerald-400 */
    box-shadow: 0 0 10px #4ade80;
    animation: scan-fast 1s linear infinite;
  }

  @keyframes flash {
    0% { background-color: transparent; }
    10% { background-color: rgba(255, 255, 255, 0.2); }
    100% { background-color: transparent; }
  }
  .animate-flash {
    animation: flash 0.5s ease-out;
  }
  
  @keyframes text-flicker {
    0% { opacity: 0.1; }
    2% { opacity: 1; }
    8% { opacity: 0.1; }
    9% { opacity: 1; }
    12% { opacity: 0.1; }
    20% { opacity: 1; }
    25% { opacity: 0.3; }
    30% { opacity: 1; }
    70% { opacity: 0.7; }
    72% { opacity: 0.2; }
    77% { opacity: 0.9; }
    100% { opacity: 0.9; }
  }
  .animate-flicker {
    animation: text-flicker 2s linear infinite;
  }
  
  .ai-gradient-text {
    background: linear-gradient(to right, #818cf8, #c084fc, #f472b6);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
  }
  .ai-border {
    border: 1px solid transparent;
    background: linear-gradient(#0f172a, #0f172a) padding-box,
                linear-gradient(to right, #6366f1, #a855f7) border-box;
  }

  .void-stamp {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%) rotate(-15deg);
    border: 4px solid #ef4444;
    color: #ef4444;
    font-weight: 900;
    font-size: 3rem;
    padding: 0.5rem 2rem;
    text-transform: uppercase;
    opacity: 0.6;
    letter-spacing: 0.2em;
    pointer-events: none;
    z-index: 10;
    mix-blend-mode: color-dodge;
  }
  
  .gold-frame {
    border: 1px solid #eab308;
    box-shadow: 0 0 15px rgba(234, 179, 8, 0.15);
    background: linear-gradient(135deg, rgba(234, 179, 8, 0.05), transparent);
  }

  /* Fix for calendar icon visibility in dark mode */
  input[type="date"]::-webkit-calendar-picker-indicator {
    filter: invert(1);
    opacity: 0.7;
    cursor: pointer;
  }
`;

// --- Components ---

const Button = ({ children, onClick, variant = 'primary', className = '', disabled = false }) => {
  const baseStyle = "px-4 py-3 rounded-md font-medium transition-all duration-200 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed";
  const variants = {
    primary: "bg-slate-100 text-slate-900 hover:bg-white hover:shadow-lg hover:shadow-slate-500/20",
    secondary: "bg-slate-800 text-slate-200 hover:bg-slate-700 border border-slate-700",
    danger: "bg-rose-900/30 text-rose-400 border border-rose-900 hover:bg-rose-900/50",
    ghost: "text-slate-400 hover:text-slate-200 hover:bg-slate-800/50",
    outline: "border border-slate-600 text-slate-300 hover:border-slate-400 hover:text-white",
    gold: "bg-amber-500 text-amber-950 hover:bg-amber-400 font-bold tracking-wide",
    ai: "bg-indigo-600 text-white hover:bg-indigo-500 shadow-lg shadow-indigo-500/20 border border-indigo-400/30"
  };

  return (
    <button onClick={onClick} className={`${baseStyle} ${variants[variant]} ${className}`} disabled={disabled}>
      {children}
    </button>
  );
};

const Input = ({ label, value, onChange, placeholder, type = "text", className = "", onKeyDown }) => (
  <div className={`flex flex-col gap-2 ${className}`}>
    {label && <label className="text-xs uppercase tracking-wider text-slate-500 font-semibold">{label}</label>}
    <input
      type={type}
      value={value}
      onChange={onChange}
      onKeyDown={onKeyDown}
      placeholder={placeholder}
      className="bg-slate-900 border border-slate-700 rounded-md p-3 text-slate-100 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 placeholder-slate-600 w-full"
    />
  </div>
);

const TextArea = ({ label, value, onChange, placeholder, rows = 3 }) => (
  <div className="flex flex-col gap-2">
    {label && <label className="text-xs uppercase tracking-wider text-slate-500 font-semibold">{label}</label>}
    <textarea
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      rows={rows}
      className="bg-slate-900 border border-slate-700 rounded-md p-3 text-slate-100 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 placeholder-slate-600 resize-none w-full"
    />
  </div>
);

const Badge = ({ children, color = 'slate' }) => {
  const colors = {
    slate: 'bg-slate-800 text-slate-300 border-slate-700',
    rose: 'bg-rose-900/30 text-rose-400 border-rose-800',
    emerald: 'bg-emerald-900/30 text-emerald-400 border-emerald-800',
    amber: 'bg-amber-900/30 text-amber-400 border-amber-800',
  };
  return (
    <span className={`text-[10px] uppercase tracking-wider font-bold px-2 py-1 rounded border ${colors[color] || colors.slate}`}>
      {children}
    </span>
  );
};

// --- Custom Signature Pad ---
const SignaturePad = ({ onSign }) => {
  const canvasRef = useRef(null);
  const isDrawing = useRef(false);
  const [hasDrawn, setHasDrawn] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Set canvas resolution
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * 2;
    canvas.height = rect.height * 2;
    const ctx = canvas.getContext('2d');
    ctx.scale(2, 2);
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#e2e8f0'; // slate-200
    ctx.lineWidth = 2;
  }, []);

  const getCoords = (e) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    return {
      x: clientX - rect.left,
      y: clientY - rect.top
    };
  };

  const startDrawing = (e) => {
    e.preventDefault(); // Prevent scrolling on touch
    isDrawing.current = true;
    const ctx = canvasRef.current.getContext('2d');
    const { x, y } = getCoords(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
  };

  const draw = (e) => {
    e.preventDefault();
    if (!isDrawing.current) return;
    const ctx = canvasRef.current.getContext('2d');
    const { x, y } = getCoords(e);
    ctx.lineTo(x, y);
    ctx.stroke();
    if (!hasDrawn) {
      setHasDrawn(true);
      onSign(true);
    }
  };

  const stopDrawing = () => {
    isDrawing.current = false;
  };

  const clear = () => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasDrawn(false);
    onSign(false);
  };

  return (
    <div className="space-y-2">
      <div className="flex justify-between items-center">
        <label className="text-xs uppercase tracking-wider text-slate-500 font-semibold flex items-center gap-2">
          <PenTool className="w-3 h-3" /> Sign Here
        </label>
        <button onClick={clear} className="text-xs text-rose-400 hover:text-rose-300">Clear</button>
      </div>
      <div className="border-2 border-slate-700 border-dashed rounded-lg bg-slate-900/50 touch-none relative overflow-hidden h-32 w-full">
        {!hasDrawn && <div className="absolute inset-0 flex items-center justify-center text-slate-600 text-xs pointer-events-none">Draw your signature</div>}
        <canvas
          ref={canvasRef}
          className="w-full h-full cursor-crosshair"
          onMouseDown={startDrawing}
          onMouseMove={draw}
          onMouseUp={stopDrawing}
          onMouseLeave={stopDrawing}
          onTouchStart={startDrawing}
          onTouchMove={draw}
          onTouchEnd={stopDrawing}
        />
      </div>
    </div>
  );
};

// --- Oracle Modal ---
function OracleModal({ contract, onClose }) {
  const [query, setQuery] = useState('');
  const [verdict, setVerdict] = useState(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleJudge = async () => {
    if (!query.trim()) return;
    setIsLoading(true);

    const result = await callAIJudge({
      situation: query,
      contractTitle: contract.title,
      contractBehavior: contract.behavior,
      contractExceptions: contract.exceptions
    });

    if (result) setVerdict(result);
    setIsLoading(false);
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/95 backdrop-blur-sm p-6 flex items-center justify-center">
      <div className="w-full max-w-md bg-slate-900 border border-slate-700 rounded-lg shadow-2xl p-6 space-y-6 animate-in zoom-in-95">
        <div className="flex justify-between items-start">
          <div className="flex items-center gap-2 text-indigo-400 font-bold text-lg uppercase tracking-widest">
            <Scale className="w-6 h-6" /> The Oracle
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-white"><XCircle className="w-5 h-5" /></button>
        </div>

        <p className="text-slate-400 text-sm">
          Asking regarding contract: <span className="text-white font-bold">"<SafeRender content={contract.title} />"</span>.
          <br /> Describe the exact situation you are unsure about.
        </p>

        <TextArea
          placeholder="e.g. Can I eat 85% dark chocolate even though I said no sugar?"
          value={query}
          onChange={e => setQuery(e.target.value)}
          rows={3}
        />

        {!verdict && (
          <Button
            onClick={handleJudge}
            disabled={isLoading || !query.trim()}
            variant="ai"
            className="w-full"
          >
            {isLoading ? "Deliberating..." : "Consult the Rules"}
          </Button>
        )}

        {verdict && (
          <div className={"p-4 rounded border-l-4 animate-in fade-in " + (verdict.status === 'ALLOWED' ? 'bg-emerald-950/30 border-emerald-500' : 'bg-rose-950/30 border-rose-500')}>
            <div className={"text-xl font-black uppercase tracking-widest mb-2 " + (verdict.status === 'ALLOWED' ? 'text-emerald-400' : 'text-rose-500')}>
              <SafeRender content={verdict.status} />
            </div>
            <p className="text-slate-300 text-sm font-mono leading-relaxed">
              "<SafeRender content={verdict.reasoning} />"
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// --- Main App Logic ---

export default function Laosfactos() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState('dashboard');
  const [contracts, setContracts] = useState([]);
  const [todayLogs, setTodayLogs] = useState({});
  const [activeViolationContract, setActiveViolationContract] = useState(null);
  const [activeOracleContract, setActiveOracleContract] = useState(null); // New Oracle State
  const [activeJournalContract, setActiveJournalContract] = useState(null); // New Journal State
  const [contractsLoading, setContractsLoading] = useState(true);

  // --- Auth & Data Loading ---
  useEffect(() => {
    const initAuth = async () => {
      try {
        await signInAnonymously(auth);
      } catch (error) {
        console.error("Auth Failed:", error);
        // If error is 400, it might be a bad token. Try signing out.
        if (error.code === 'auth/id-token-expired' || error.message.includes('400')) {
          console.warn("Attempting to clear stuck auth state...");
          await auth.signOut();
          // Retry once
          try { await signInAnonymously(auth); } catch (e) { console.error("Retry failed", e); }
        }
      }
    };

    // Only sign in if not already signed in
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
      if (!u) {
        initAuth();
      }
    });

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) return;

    // Listen to Contracts - Fetch ALL to support history view
    const contractsRef = collection(db, 'users', user.uid, 'contracts');
    const q = query(contractsRef);

    const unsubContracts = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      // Sort logic handled in views
      setContracts(data);
      setContractsLoading(false);
    }, (err) => {
      console.error("Contracts Error:", err);
      setContractsLoading(false);
    });

    // Listen to Today's Logs
    const today = new Date().toISOString().split('T')[0];
    const logsRef = collection(db, 'users', user.uid, 'logs');
    const logsQuery = query(logsRef, where('date', '==', today));

    const unsubLogs = onSnapshot(logsQuery, (snapshot) => {
      const logs = {};
      snapshot.docs.forEach(doc => {
        const data = doc.data();
        logs[data.contractId] = data;
      });
      setTodayLogs(logs);
    }, (err) => console.error("Logs Error:", err));

    return () => {
      unsubContracts();
      unsubLogs();
    };
  }, [user]);

  // --- Actions ---

  const handleCreateContract = async (contractData) => {
    if (!user) return;
    try {
      await addDoc(collection(db, 'users', user.uid, 'contracts'), {
        ...contractData,
        userId: user.uid,
        status: 'active',
        streak: 0,
        createdAt: serverTimestamp(),
        lastCheckIn: null,
        history: []
      });
      setView('dashboard');
    } catch (e) {
      console.error("Error creating contract:", e);
    }
  };

  const handleCheckIn = async (contractId, status, notes = '') => {
    if (!user) return;
    const today = new Date().toISOString().split('T')[0];
    const contract = contracts.find(c => c.id === contractId);
    if (!contract) return;

    try {
      const batch = writeBatch(db);

      // 1. Create Log Entry
      const logRef = doc(collection(db, 'users', user.uid, 'logs'));
      batch.set(logRef, {
        contractId,
        date: today,
        status,
        notes,
        timestamp: serverTimestamp()
      });

      // 2. Update Contract Streak
      const contractRef = doc(db, 'users', user.uid, 'contracts', contractId);
      let newStreak = contract.streak || 0;

      if (status === 'kept') {
        newStreak += 1;
      }

      batch.update(contractRef, {
        lastCheckIn: serverTimestamp(),
        streak: newStreak
      });

      await batch.commit();
    } catch (e) {
      console.error("Check-in failed:", e);
    }
  };

  const handleCompleteContract = async (contract) => {
    if (!user) return;
    try {
      console.log("Completing contract:", contract.id);
      const contractRef = doc(db, 'users', user.uid, 'contracts', contract.id);
      await updateDoc(contractRef, {
        status: 'archived',
        outcome: 'completed',
        archivedAt: serverTimestamp()
      });
      // Force view refresh or just rely on snapshot
    } catch (e) {
      console.error("Error completing contract:", e);
      alert("Failed to complete contract: " + e.message);
    }
  };

  const handleDeleteContract = async (contractId) => {
    if (!user) return;
    if (!window.confirm("Are you sure you want to void this contract? This action is irreversible.")) return;
    try {
      const contractRef = doc(db, 'users', user.uid, 'contracts', contractId);
      await deleteDoc(contractRef);
    } catch (e) {
      console.error("Error deleting contract:", e);
    }
  };

  const handleViolation = async (violationData) => {
    if (!user || !activeViolationContract) return;
    const today = new Date().toISOString().split('T')[0];

    try {
      const batch = writeBatch(db);

      // 1. Log the Violation Event
      const violRef = doc(collection(db, 'users', user.uid, 'violations'));
      batch.set(violRef, {
        ...violationData,
        contractId: activeViolationContract.id,
        contractTitle: activeViolationContract.title,
        timestamp: serverTimestamp()
      });

      // 2. Log Today as 'broken'
      const logRef = doc(collection(db, 'users', user.uid, 'logs'));
      batch.set(logRef, {
        contractId: activeViolationContract.id,
        date: today,
        status: 'broken',
        notes: violationData.story,
        timestamp: serverTimestamp()
      });

      // 3. Reset Streak on Contract
      const contractRef = doc(db, 'users', user.uid, 'contracts', activeViolationContract.id);

      let newStatus = activeViolationContract.status;
      let updates = {
        streak: 0,
        lastCheckIn: serverTimestamp()
      };

      if (violationData.decision === 'pause') {
        updates.status = 'paused';
      }
      if (violationData.decision === 'retire') {
        updates.status = 'archived';
        updates.outcome = 'breached';
        updates.failureReason = violationData.story || violationData.reason;
        updates.archivedAt = serverTimestamp();
      }

      batch.update(contractRef, updates);

      await batch.commit();
      setActiveViolationContract(null);
      setView('dashboard');
    } catch (e) {
      console.error("Violation logging failed:", e);
    }
  };

  const handleEnableNotifications = async () => {
    try {
      if (!("Notification" in window)) {
        alert("This browser does not support desktop notifications");
        return;
      }
      const permission = await Notification.requestPermission();
      if (permission === 'granted') {
        // VAPID key is often required. If you see an error about missing VAPID key, generating a pair in Firebase Console -> Cloud Messaging is needed.
        // Pass it as { vapidKey: 'YOUR_KEY' }
        const token = await getToken(messaging);
        if (token && user) {
          await setDoc(doc(db, 'users', user.uid), { fcmToken: token }, { merge: true });
          alert("Notifications Enabled! You'll receive your daily briefing tomorrow.");
        } else {
          console.warn("No registration token available. Request permission to generate one.");
        }
      }
    } catch (e) {
      console.error("Notification permission error:", e);
      alert("Error enabling notifications. Check console for details (often VAPID key missing).");
    }
  };

  const handleArchiveBriefing = async () => {
    if (!user) return;
    try {
      await updateDoc(doc(db, 'users', user.uid), {
        'dailyBriefing.archived': true
      });
    } catch (e) {
      console.error("Error archiving briefing:", e);
    }
  };

  if (loading) return <div className="min-h-screen bg-slate-950 flex items-center justify-center text-slate-500 font-mono">LOADING CONTRACTS...</div>;

  return (
    <>
      <style>{styles}</style>
      <div className="min-h-screen bg-slate-950 text-slate-200 font-sans selection:bg-indigo-500/30">
        <div className="max-w-md mx-auto min-h-screen flex flex-col relative border-x border-slate-900 shadow-2xl shadow-black">

          {/* Header */}
          <header className="p-6 border-b border-slate-900 bg-slate-950/80 backdrop-blur-sm sticky top-0 z-20">
            <div className="flex justify-between items-center">
              <h1 onClick={() => setView('dashboard')} className="text-xl font-bold tracking-tight text-white cursor-pointer flex items-center gap-2">
                <Shield className="w-5 h-5 text-indigo-500" />
                LAOSFACTOS
              </h1>
              <div className="flex gap-2">
                <button
                  onClick={handleEnableNotifications}
                  className="p-2 rounded-full text-slate-400 hover:bg-slate-900 transition-colors"
                  title="Enable Daily Briefing"
                >
                  <Bell className="w-5 h-5" />
                </button>
                <button
                  onClick={() => setView('history')}
                  className={"p-2 rounded-full transition-colors " + (view === 'history' ? "bg-slate-800 text-white" : "text-slate-400 hover:bg-slate-900")}
                  title="The Ledger"
                >
                  <Archive className="w-5 h-5" />
                </button>
                <button
                  onClick={() => setView('review')}
                  className={"p-2 rounded-full transition-colors " + (view === 'review' ? "bg-slate-800 text-white" : "text-slate-400 hover:bg-slate-900")}
                  title="Review Contracts"
                >
                  <Activity className="w-5 h-5" />
                </button>
              </div>
            </div>
          </header>

          {/* Main Content Area */}
          <main className="flex-1 p-6 pb-24 overflow-y-auto">
            {view === 'dashboard' && (
              <Dashboard
                contracts={contracts}
                todayLogs={todayLogs}
                onCheckIn={handleCheckIn}
                onReportViolation={(contract) => {
                  setActiveViolationContract(contract);
                  setView('violation');
                }}
                onConsultOracle={(contract) => setActiveOracleContract(contract)} // Trigger Oracle
                onDelete={handleDeleteContract}
                onComplete={handleCompleteContract}
                onCreate={() => setView('create')}
                onOpenJournal={(contract) => setActiveJournalContract(contract)}
                loading={loading}
                contractsLoading={contractsLoading}
              />
            )}

            {view === 'create' && (
              <CreateContract
                onCancel={() => setView('dashboard')}
                onSubmit={handleCreateContract}
              />
            )}

            {/* Modals */}
            {view === 'violation' && activeViolationContract && (
              <ViolationFlow
                contract={activeViolationContract}
                onCancel={() => {
                  setActiveViolationContract(null);
                  setView('dashboard');
                }}
                onSubmit={handleViolation}
              />
            )}

            {activeOracleContract && (
              <OracleModal
                contract={activeOracleContract}
                onClose={() => setActiveOracleContract(null)}
              />
            )}

            {activeJournalContract && (
              <JournalModal
                contract={activeJournalContract}
                user={user}
                onClose={() => setActiveJournalContract(null)}
              />
            )}

            {view === 'review' && (
              <ReviewView
                contracts={contracts}
                onBack={() => setView('dashboard')}
              />
            )}

            {view === 'history' && (
              <HistoryView
                contracts={contracts}
                onBack={() => setView('dashboard')}
                onOpenJournal={(contract) => setActiveJournalContract(contract)}
              />
            )}
          </main>

          {/* Quick Nav / Status Bar */}
          <div className="absolute bottom-0 left-0 right-0 bg-slate-900/90 backdrop-blur border-t border-slate-800 p-4 flex justify-between items-center text-xs text-slate-500 font-mono">
            <span>STATUS: {contracts.filter(c => c.status === 'active').length} ACTIVE</span>
            {contracts.length > 0 && (
              <span className="flex items-center gap-1">
                <Flame className="w-3 h-3 text-orange-500" />
                MAX STREAK: {Math.max(...contracts.map(c => c.streak || 0))}
              </span>
            )}
            <span className="text-[9px] text-slate-700 font-mono">v.{typeof __COMMIT_HASH__ !== 'undefined' ? __COMMIT_HASH__ : 'dev'}</span>
          </div>
        </div>
      </div>
    </>
  );
}

// --- Sub-Components ---

function Dashboard({ contracts, todayLogs, onCheckIn, onReportViolation, onComplete, onCreate, onConsultOracle, onDelete, onOpenJournal, loading, contractsLoading, dailyBriefing, onArchiveBriefing }) {
  const activeContracts = contracts.filter(c => c.status === 'active');
  const pausedContracts = contracts.filter(c => c.status === 'paused');

  const slotsUsed = activeContracts.length;
  const isFull = slotsUsed >= MAX_ACTIVE_CONTRACTS;

  const sortedActive = [...activeContracts].sort((a, b) => {
    const aLogged = !!todayLogs[a.id];
    const bLogged = !!todayLogs[b.id];
    if (aLogged === bLogged) return 0;
    return aLogged ? 1 : -1;
  });

  if (loading || contractsLoading) {
    return (
      <div className="space-y-4">
        {[1, 2].map(i => (
          <div key={i} className="bg-slate-900 border border-slate-800 rounded-lg p-5 flex flex-col gap-4 animate-pulse">
            <div className="flex justify-between items-start">
              <div className="space-y-2 w-full">
                <div className="flex gap-2 mb-1">
                  <div className="w-4 h-4 rounded bg-slate-800"></div>
                  <div className="w-20 h-4 rounded bg-slate-800"></div>
                </div>
                <div className="w-3/4 h-6 rounded bg-slate-800"></div>
              </div>
              <div className="w-8 h-8 rounded bg-slate-800"></div>
            </div>
            <div className="w-full h-20 rounded bg-slate-800"></div>
          </div>
        ))}
      </div>
    );
  }

  if (contracts.length === 0 && pausedContracts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-[60vh] text-center space-y-6 animate-in fade-in duration-500">
        <div className="w-20 h-20 bg-slate-900 rounded-full flex items-center justify-center border border-slate-800">
          <ScrollText className="w-10 h-10 text-slate-600" />
        </div>
        <div className="space-y-2 max-w-xs">
          <h2 className="text-xl font-bold text-white">No Contracts Found</h2>
          <p className="text-slate-500">You have no active agreements with your future self. Draft your first rule to begin.</p>
        </div>
        <Button onClick={onCreate}>Draft First Contract</Button>
      </div>
    );
  }

  return (
    <div className="space-y-8">

      {/* Daily Briefing Widget */}
      {dailyBriefing && !dailyBriefing.archived && (
        <div className="bg-gradient-to-r from-indigo-950/40 to-slate-950 border border-indigo-500/20 rounded-xl p-4 sm:p-6 backdrop-blur-sm relative overflow-hidden group">
          <div className="absolute top-0 right-0 p-4 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              onClick={onArchiveBriefing}
              className="text-indigo-400 hover:text-indigo-300 text-xs uppercase tracking-wider font-bold"
            >
              Archive
            </button>
          </div>
          <div className="flex gap-4 items-start">
            <div className="p-3 bg-indigo-500/10 rounded-lg">
              <Brain className="w-6 h-6 text-indigo-400" />
            </div>
            <div className="space-y-2 max-w-2xl">
              <h3 className="text-indigo-400 text-sm font-bold tracking-widest uppercase">Daily Protocol</h3>
              <p className="text-slate-300 font-serif italic text-lg leading-relaxed">
                "{dailyBriefing.text}"
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Active Contracts List */}
      <div className="space-y-4">
        <div className="flex justify-between items-end">
          <h2 className="text-xs font-bold text-slate-500 uppercase tracking-widest flex items-center gap-2">
            Today's Contracts
            <span className={"px-1.5 py-0.5 rounded text-[10px] " + (isFull ? "bg-amber-900/40 text-amber-500" : "bg-slate-800 text-slate-400")}>
              {slotsUsed}/{MAX_ACTIVE_CONTRACTS}
            </span>
          </h2>

          {isFull ? (
            <div className="flex items-center gap-1.5 text-amber-500 opacity-80 cursor-not-allowed px-2 py-1 rounded bg-amber-950/20 border border-amber-900/30">
              <Lock className="w-3 h-3" />
              <span className="text-[10px] font-bold uppercase tracking-wider">Max Capacity</span>
            </div>
          ) : (
            <button onClick={onCreate} className="text-indigo-400 text-xs font-bold hover:text-indigo-300 flex items-center gap-1 transition-colors">
              <Plus className="w-3 h-3" /> NEW
            </button>
          )}
        </div>

        {sortedActive.map(contract => (
          <ContractCard
            key={contract.id}
            contract={contract}
            todayLog={todayLogs[contract.id]}
            onCheckIn={onCheckIn}
            onReportViolation={onReportViolation}
            onConsultOracle={onConsultOracle}
            onDelete={onDelete}
            onComplete={onComplete}
            onOpenJournal={onOpenJournal}
          />
        ))}
      </div>

      {pausedContracts.length > 0 && (
        <div className="opacity-50">
          <h2 className="text-xs font-bold text-slate-600 uppercase tracking-widest mb-4">Paused Contracts</h2>
          {pausedContracts.map(c => (
            <div key={c.id} className="bg-slate-900/50 border border-slate-800/50 rounded p-4 mb-2 flex justify-between items-center">
              <span className="text-sm text-slate-500"><SafeRender content={c.title} /></span>
              <PauseCircle className="w-4 h-4 text-slate-600" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ContractCard({ contract, todayLog, onCheckIn, onReportViolation, onConsultOracle, onDelete, onComplete, onOpenJournal }) {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setIsMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const getDaysRemaining = (endDateStr) => {
    if (!endDateStr) return null;
    const end = new Date(endDateStr);
    const now = new Date();
    const diffTime = end - now;
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays;
  };

  const todayStr = new Date().toISOString().split('T')[0];
  const isDone = !!todayLog;
  const isKept = todayLog?.status === 'kept';
  const isBroken = todayLog?.status === 'broken';

  const pillar = PILLARS.find(p => p.id === contract.pillar) || PILLARS[0];
  const PillarIcon = pillar.icon;
  const exceptions = Array.isArray(contract.exceptions) ? contract.exceptions : (contract.exceptions ? [contract.exceptions] : []);

  const daysLeft = getDaysRemaining(contract.endDate);
  const isFuture = contract.startDate && contract.startDate > todayStr;
  const isExpired = daysLeft !== null && daysLeft < 0;

  return (
    <div className={"relative group transition-all duration-300 " + (isDone ? "opacity-60" : "opacity-100")}>
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-5 flex flex-col gap-4 shadow-sm hover:border-slate-700">

        {/* Header */}
        <div className="flex justify-between items-start gap-4">
          <div className="space-y-1 min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <PillarIcon className={"w-3 h-3 flex-shrink-0 " + pillar.color} />
              <span className={"text-[10px] font-bold uppercase tracking-wider " + pillar.color}>{pillar.label}</span>
              {daysLeft !== null && !isFuture && (
                <span className={"text-[10px] font-bold uppercase tracking-wider ml-2 flex items-center gap-1 " + (daysLeft < 3 ? "text-rose-500" : "text-slate-500")}>
                  <Clock className="w-3 h-3" />
                  {isExpired ? 'Completed' : (daysLeft + "d left")}
                </span>
              )}
            </div>
            <h3 className="font-semibold text-white leading-tight truncate"><SafeRender content={contract.title} /></h3>
          </div>

          {/* Actions / Menu */}
          <div className="flex items-center gap-2 flex-shrink-0 relative">
            <div className="flex items-center gap-1 bg-slate-950 px-2 py-1 rounded border border-slate-800">
              <Flame className="w-3 h-3 text-orange-500" />
              <span className="text-xs font-mono font-bold text-slate-300">{contract.streak}</span>
            </div>

            <button
              onClick={(e) => { e.stopPropagation(); onConsultOracle(contract); }}
              className="bg-slate-950 p-2 rounded border border-slate-800 hover:border-indigo-500/50 hover:bg-slate-900 transition-colors text-slate-400 hover:text-indigo-400"
              title="Consult the Oracle"
            >
              <Scale className="w-4 h-4" />
            </button>

            <button
              onClick={(e) => { e.stopPropagation(); onOpenJournal(contract); }}
              className="bg-slate-950 p-2 rounded border border-slate-800 hover:border-blue-500/50 hover:bg-slate-900 transition-colors text-slate-400 hover:text-blue-400"
              title="Contract Journal"
            >
              <Book className="w-4 h-4" />
            </button>

            <div className="relative" ref={menuRef}>
              <button
                onClick={(e) => { e.stopPropagation(); setIsMenuOpen(!isMenuOpen); }}
                className="bg-slate-950 p-2 rounded border border-slate-800 hover:border-slate-600 hover:bg-slate-900 transition-colors text-slate-400 hover:text-slate-200"
                title="More Options"
              >
                <MoreHorizontal className="w-4 h-4" />
              </button>

              {isMenuOpen && (
                <div className="absolute right-0 top-full mt-2 w-48 bg-slate-900 border border-slate-700 rounded-md shadow-xl z-50 overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                  <button
                    onClick={(e) => { e.stopPropagation(); onDelete(contract.id); setIsMenuOpen(false); }}
                    className="w-full text-left px-4 py-3 text-rose-400 hover:bg-rose-950/20 hover:text-rose-300 text-xs font-bold uppercase tracking-wider flex items-center gap-2 transition-colors"
                  >
                    <Trash2 className="w-4 h-4" /> Void Contract
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Body Text */}
        {!isDone && (
          <div className="pl-3 border-l-2 border-slate-800 space-y-2">
            <p className="text-xs text-slate-400 font-mono break-words">
              <SafeRender content={contract.behavior} />
            </p>
            {contract.penalty && (
              <div className="text-xs font-bold text-rose-400/80 flex items-start gap-1.5 pt-1">
                <AlertOctagon className="w-3 h-3 mt-0.5 flex-shrink-0" />
                <span>Penalty: <SafeRender content={contract.penalty} /></span>
              </div>
            )}
          </div>
        )}

        {/* Exceptions Badge if present */}
        {!isDone && exceptions.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {exceptions.map((ex, i) => (
              <span key={i} className="text-[10px] px-1.5 py-0.5 bg-slate-800 rounded text-slate-500 border border-slate-700 max-w-full truncate">
                Ex: <SafeRender content={ex} />
              </span>
            ))}
          </div>
        )}

        {/* Actions */}
        <div className="pt-2">
          {isFuture ? (
            <div className="w-full py-3 bg-slate-950/50 border border-slate-800 border-dashed rounded text-center">
              <div className="text-xs font-bold text-slate-500 uppercase tracking-widest flex items-center justify-center gap-2">
                <Hourglass className="w-4 h-4" />
                Pending Start
              </div>
              <div className="text-[10px] text-slate-600 mt-1">
                Starts on {new Date(contract.startDate).toLocaleDateString()}
              </div>
            </div>
          ) : isExpired ? (
            <button
              onClick={() => onComplete(contract)}
              className="w-full bg-amber-500/10 border border-amber-500/50 hover:bg-amber-500/20 text-amber-400 py-3 rounded-md font-bold text-sm transition-all flex items-center justify-center gap-2"
            >
              <Trophy className="w-4 h-4" /> Claim Victory & Archive
            </button>
          ) : isDone ? (
            <div className={"w-full py-2 rounded flex items-center justify-center gap-2 font-bold text-sm " + (isKept ? "bg-emerald-950/30 text-emerald-500 border border-emerald-900/50" : isBroken ? "bg-rose-950/30 text-rose-500 border border-rose-900/50" : "bg-slate-800 text-slate-400")}>
              {isKept && <><CheckCircle2 className="w-4 h-4" /> CONTRACT KEPT</>}
              {isBroken && <><AlertTriangle className="w-4 h-4" /> VIOLATION LOGGED</>}
              {todayLog?.status === 'exception' && <><PauseCircle className="w-4 h-4" /> EXCEPTION DAY</>}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => onCheckIn(contract.id, 'kept')}
                className="bg-slate-800 hover:bg-emerald-900/20 hover:border-emerald-800 hover:text-emerald-400 border border-slate-700 text-slate-300 py-3 rounded-md font-medium text-sm transition-all flex items-center justify-center gap-2"
              >
                <CheckCircle2 className="w-4 h-4" /> Kept
              </button>
              <button
                onClick={() => onReportViolation(contract)}
                className="bg-slate-800 hover:bg-rose-900/20 hover:border-rose-800 hover:text-rose-400 border border-slate-700 text-slate-300 py-3 rounded-md font-medium text-sm transition-all flex items-center justify-center gap-2"
              >
                <XCircle className="w-4 h-4" /> Broke it
              </button>
            </div>
          )}
          {!isDone && !isFuture && !isExpired && (
            <div className="mt-3 flex justify-center">
              <button onClick={() => onCheckIn(contract.id, 'exception')} className="text-[10px] text-slate-600 hover:text-slate-400 uppercase tracking-wider font-bold">
                Mark as Exception / Skip
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ReviewView({ contracts, onBack }) {
  const active = contracts.filter(c => c.status === 'active');
  const totalBreached = contracts.filter(c => c.outcome === 'breached').length;
  const bestStreak = Math.max(...contracts.map(c => c.streak || 0), 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 mb-6 cursor-pointer text-slate-500 hover:text-white" onClick={onBack}>
        <ChevronRight className="w-4 h-4 rotate-180" /> <span className="text-xs font-bold uppercase">Back to Dashboard</span>
      </div>

      <div>
        <h2 className="text-2xl font-bold text-white mb-2">Performance Review</h2>
        <p className="text-slate-400 text-sm">Analyze your discipline and patterns.</p>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="bg-slate-900 p-4 rounded-lg border border-slate-800 text-center">
          <div className="text-2xl font-bold text-white">{active.length}</div>
          <div className="text-[10px] text-slate-500 uppercase tracking-wider">Active</div>
        </div>
        <div className="bg-slate-900 p-4 rounded-lg border border-slate-800 text-center">
          <div className="text-2xl font-bold text-amber-500">{bestStreak}</div>
          <div className="text-[10px] text-slate-500 uppercase tracking-wider">Top Streak</div>
        </div>
        <div className="bg-slate-900 p-4 rounded-lg border border-slate-800 text-center">
          <div className="text-2xl font-bold text-rose-500">{totalBreached}</div>
          <div className="text-[10px] text-slate-500 uppercase tracking-wider">Breached</div>
        </div>
      </div>

      <div className="space-y-4">
        <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest">Active Contracts</h3>
        {active.length === 0 ? (
          <p className="text-slate-500 italic text-sm">No active contracts to review.</p>
        ) : (
          active.map(c => (
            <div key={c.id} className="bg-slate-900 border border-slate-800 p-4 rounded-lg flex justify-between items-center bg-opacity-50">
              <div>
                <h4 className="font-bold text-slate-200 text-sm"><SafeRender content={c.title} /></h4>
                <p className="text-xs text-slate-500 font-mono mt-1"><SafeRender content={c.behavior} /></p>
              </div>
              <div className="text-right pl-4">
                <div className="text-xl font-bold text-indigo-400">{c.streak}</div>
                <div className="text-[10px] text-slate-600 uppercase">Days</div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function HistoryView({ contracts, onBack, onOpenJournal }) {
  const archived = contracts.filter(c => c.status === 'archived');

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 mb-6 cursor-pointer text-slate-500 hover:text-white" onClick={onBack}>
        <ChevronRight className="w-4 h-4 rotate-180" /> <span className="text-xs font-bold uppercase">Back to Dashboard</span>
      </div>

      <div>
        <h2 className="text-2xl font-bold text-white mb-2">The Ledger</h2>
        <p className="text-slate-400 text-sm">The immutable record of your agreements kept and broken.</p>
      </div>

      {archived.length === 0 ? (
        <div className="p-8 border border-dashed border-slate-800 rounded text-center text-slate-600">
          The ledger is empty. No contracts have been archived yet.
        </div>
      ) : (
        <div className="space-y-6">
          {archived.map(c => {
            const isBreached = c.outcome === 'breached';
            const isCompleted = c.outcome === 'completed';

            return (
              <div
                key={c.id}
                className={"relative p-5 rounded-lg border " + (isCompleted ? "gold-frame" : isBreached ? "bg-slate-900 border-rose-900/30" : "bg-slate-900 border-slate-800")}
              >
                {/* Visual Stamp Overlay for Breached */}
                {isBreached && (
                  <div className="void-stamp">VOID</div>
                )}

                <div className="flex justify-between items-start mb-4">
                  <div>
                    <h3 className={"font-bold text-lg " + (isCompleted ? "text-amber-400" : "text-slate-300")}><SafeRender content={c.title} /></h3>
                    <div className="text-xs text-slate-500 font-mono mt-1">
                      Final Streak: {c.streak} days
                    </div>
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); onOpenJournal(c); }}
                    className="p-2 rounded hover:bg-slate-800 text-slate-500 hover:text-blue-400 transition-colors"
                    title="View Journal"
                  >
                    <Book className="w-5 h-5" />
                  </button>
                  {isCompleted && <Trophy className="w-6 h-6 text-amber-400" />}
                  {isBreached && <Skull className="w-6 h-6 text-rose-800" />}
                </div>

                {/* Autopsy Report */}
                {isBreached && c.failureReason && (
                  <div className="bg-rose-950/20 border-l-2 border-rose-900 p-3 mt-4">
                    <div className="text-[10px] text-rose-500 uppercase font-bold mb-1">Cause of Death</div>
                    <p className="text-rose-200/80 text-sm italic">"<SafeRender content={c.failureReason} />"</p>
                  </div>
                )}

                {/* Victory Note */}
                {isCompleted && (
                  <div className="text-center mt-4">
                    <span className="inline-block px-3 py-1 bg-amber-500/10 text-amber-400 text-xs font-bold rounded-full border border-amber-500/20">
                      HONORABLY DISCHARGED
                    </span>
                  </div>
                )}

                <div className="mt-4 pt-4 border-t border-slate-800/50 flex justify-between text-[10px] text-slate-600">
                  <span>Created: {formatDate(c.createdAt)}</span>
                  <span>Archived: {formatDate(c.archivedAt)}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function CreateContract({ onCancel, onSubmit }) {
  const [step, setStep] = useState(1);
  const [exceptionInput, setExceptionInput] = useState('');
  const [isSigned, setIsSigned] = useState(false);
  const [sealingStage, setSealingStage] = useState('idle');
  const [selectedDuration, setSelectedDuration] = useState(null);

  // AI & Audit States
  const [aiPrompt, setAiPrompt] = useState('');
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [showAiInput, setShowAiInput] = useState(false);
  const [auditResult, setAuditResult] = useState(null);
  const [isAuditing, setIsAuditing] = useState(false);

  const [formData, setFormData] = useState({
    title: '',
    pillar: '',
    type: 'AVOID',
    behavior: '',
    startDate: new Date().toISOString().split('T')[0],
    endDate: '',
    importance: 3,
    exceptions: [],
    penalty: '',
    witnessLinked: false
  });

  // --- Autosave Logic (New) ---
  useEffect(() => {
    const savedDraft = localStorage.getItem('laosfactos_draft');
    if (savedDraft) {
      try {
        const parsed = JSON.parse(savedDraft);
        // Only restore if it looks valid
        if (parsed.title || parsed.behavior) {
          setFormData(prev => ({ ...prev, ...parsed }));
          // If we have enough data, maybe jump to step 2? Optional.
          if (parsed.title && parsed.pillar) setStep(1);
        }
      } catch (e) {
        console.error("Failed to load draft", e);
      }
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      localStorage.setItem('laosfactos_draft', JSON.stringify(formData));
    }, 500); // Debounce save
    return () => clearTimeout(timer);
  }, [formData]);

  const clearDraft = () => {
    localStorage.removeItem('laosfactos_draft');
  };

  const update = (field, val) => setFormData(p => ({ ...p, [field]: val }));

  /* --- AI Drafting Logic --- */
  const handleAiDraft = async () => {
    if (!aiPrompt.trim()) return;
    setIsAiLoading(true);


    if (result) {
      setFormData(prev => ({
        ...prev,
        title: result.title || prev.title,
        pillar: result.pillar || prev.pillar,
        type: result.type || prev.type,
        behavior: result.behavior || prev.behavior,
        penalty: result.penalty || prev.penalty,
        exceptions: Array.isArray(result.exceptions) ? result.exceptions.map(String) : [] // Sanitize
      }));
      setShowAiInput(false);
      setStep(2);
    }
    setIsAiLoading(false);
  };

  const handlePreMortemAudit = async () => {
    setIsAuditing(true);
    const systemPrompt = "You are a Devil's Advocate lawyer. Review this personal contract.\n" +
      "Contract Details: " + JSON.stringify(formData) + "\n\n" +
      "Find 1 specific, likely loophole the user's future self will exploit. Be cynical.\n" +
      "Return JSON: { \"weakness\": \"string\", \"suggestion\": \"string\" }";

    const result = await callAIBackend("Audit this contract.", systemPrompt);
    if (result) {
      setAuditResult(result);
    }
    setIsAuditing(false);
  };

  const generateWitnessLink = () => {
    const mockLink = "https://laosfactos.app/c/" + Math.random().toString(36).substr(2, 6);
    copyToClipboard(mockLink);
    update('witnessLinked', true);
    alert("Witness Link Copied to Clipboard! Send this to your accountability partner.");
  };

  // --- Utils ---

  const setDuration = (days) => {
    const start = formData.startDate ? new Date(formData.startDate) : new Date();
    const end = new Date(start);
    end.setDate(start.getDate() + days);
    update('endDate', end.toISOString().split('T')[0]);
    setSelectedDuration(days);
  };

  const handleStartDateChange = (val) => {
    update('startDate', val);
    if (selectedDuration) {
      const start = new Date(val);
      const end = new Date(start);
      end.setDate(start.getDate() + selectedDuration);
      update('endDate', end.toISOString().split('T')[0]);
    }
  };

  const handleManualDateChange = (val) => {
    update('endDate', val);
    setSelectedDuration(null);
  };

  const addException = () => {
    if (!exceptionInput.trim()) return;
    if (formData.exceptions.length >= MAX_EXCEPTIONS) return;
    update('exceptions', [...formData.exceptions, exceptionInput.trim()]);
    setExceptionInput('');
  };

  const removeException = (index) => {
    const newExceptions = [...formData.exceptions];
    newExceptions.splice(index, 1);
    update('exceptions', newExceptions);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addException();
    }
  };

  const handleCommit = async () => {
    setSealingStage('scanning');
    setTimeout(() => setSealingStage('impact'), 2000);
    setTimeout(() => setSealingStage('done'), 2800);
    setTimeout(() => {
      onSubmit(formData);
      clearDraft(); // Clear draft on success
      // Redirect back to home after success screen
      setTimeout(() => {
        onCancel();
      }, 2000);
    }, 4000);
  };

  const isValidStep1 = formData.title && formData.pillar;
  const isValidStep2 = formData.behavior.length > 5;

  if (sealingStage !== 'idle') {
    const isImpact = sealingStage === 'impact' || sealingStage === 'done';
    const isDone = sealingStage === 'done';

    return (
      <div className={"fixed inset-0 z-50 bg-slate-950 flex flex-col items-center justify-center overflow-hidden " + (isImpact ? "animate-shake" : "")}>
        {isImpact && <div className="absolute inset-0 bg-white opacity-20 animate-flash pointer-events-none z-50"></div>}
        <div className="relative w-full max-w-sm text-center p-8">
          <div className="relative mx-auto w-32 h-32 mb-8 flex items-center justify-center">
            {sealingStage === 'scanning' && (
              <>
                <div className="absolute inset-0 bg-indigo-500/20 blur-xl rounded-full"></div>
                <Fingerprint className="w-24 h-24 text-indigo-400 relative z-10 animate-pulse" />
                <div className="absolute inset-0 w-full h-full overflow-hidden rounded-full border border-indigo-500/30">
                  <div className="scan-bar"></div>
                </div>
              </>
            )}
            {isImpact && (
              <div className="relative">
                <Shield className={"w-32 h-32 transition-colors duration-500 " + (isDone ? "text-emerald-500" : "text-slate-700")} />
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="border-[6px] border-emerald-500 text-emerald-500 text-4xl font-black px-4 py-2 opacity-0 animate-stamp-slam tracking-widest uppercase rounded-lg bg-emerald-950/90 backdrop-blur-sm shadow-[0_0_50px_rgba(16,185,129,0.5)]">
                    LOCKED
                  </div>
                </div>
              </div>
            )}
          </div>
          <div className="space-y-2 h-16">
            {sealingStage === 'scanning' && (
              <p className="text-indigo-400 font-mono text-sm animate-flicker">ENCRYPTING BIOMETRIC HASH...</p>
            )}
            {isImpact && !isDone && (
              <p className="text-slate-100 font-black text-xl tracking-[0.2em] scale-110 transition-transform">SEALING...</p>
            )}
            {isDone && (
              <div className="animate-in fade-in zoom-in duration-500">
                <h2 className="text-2xl font-bold text-emerald-400 tracking-wider mb-1">CONTRACT ACTIVE</h2>
                <p className="text-slate-500 font-mono text-xs">Immutable Ledger Updated.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-300">
      <div className="mb-6 flex items-center gap-2 text-slate-500 cursor-pointer hover:text-white" onClick={() => { clearDraft(); onCancel(); }}>
        <XCircle className="w-4 h-4" /> <span className="text-xs font-bold uppercase">Cancel & Discard</span>
      </div>

      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-bold text-white mb-2">Draft New Contract</h2>
          <p className="text-slate-400 text-sm">Step {step} of 3</p>
        </div>

        {/* AI Prompt Input */}
        {step === 1 && !showAiInput && (
          <button
            onClick={() => setShowAiInput(true)}
            className="w-full ai-border p-4 rounded-lg flex items-center justify-between group transition-all hover:scale-[1.01]"
          >
            <div className="flex items-center gap-3">
              <div className="p-2 bg-indigo-500/20 rounded-full text-indigo-400 group-hover:text-white transition-colors">
                <Sparkles className="w-5 h-5" />
              </div>
              <div className="text-left">
                <div className="text-sm font-bold text-white ai-gradient-text">Use AI Drafter</div>
                <div className="text-xs text-slate-400">Describe your goal, I'll write the rules.</div>
              </div>
            </div>
            <ChevronRight className="w-4 h-4 text-slate-600 group-hover:text-white" />
          </button>
        )}

        {showAiInput && step === 1 && (
          <div className="bg-slate-900 border border-indigo-500/30 p-4 rounded-lg space-y-3 animate-in fade-in slide-in-from-top-2">
            <div className="flex justify-between items-center">
              <label className="text-xs uppercase tracking-wider text-indigo-400 font-bold flex items-center gap-2">
                <Bot className="w-4 h-4" /> What is your intent?
              </label>
              <button onClick={() => setShowAiInput(false)} className="text-slate-500 hover:text-white"><XCircle className="w-4 h-4" /></button>
            </div>
            <TextArea
              value={aiPrompt}
              onChange={e => setAiPrompt(e.target.value)}
              placeholder="e.g. I want to stop eating junk food during the week so I can lose weight."
              rows={3}
            />
            <Button
              onClick={handleAiDraft}
              variant="ai"
              className="w-full"
              disabled={isAiLoading}
            >
              {isAiLoading ? <span className="animate-pulse">Analyzing Intent...</span> : <><Sparkles className="w-4 h-4" /> Draft Contract</>}
            </Button>
          </div>
        )}

        {step === 1 && (
          <div className="space-y-6 pt-4 border-t border-slate-800">
            <Input
              label="Contract Title"
              placeholder="e.g. No pizza after 20:00"
              value={formData.title}
              onChange={e => update('title', e.target.value)}
            />

            <div className="space-y-2">
              <label className="text-xs uppercase tracking-wider text-slate-500 font-semibold">Select Pillar</label>
              <div className="grid grid-cols-1 gap-2">
                {PILLARS.map(p => {
                  const Icon = p.icon;
                  const isSelected = formData.pillar === p.id;
                  return (
                    <button
                      key={p.id}
                      onClick={() => update('pillar', p.id)}
                      className={"flex items-center gap-3 p-3 rounded-md border transition-all " + (isSelected ? "bg-slate-800 border-indigo-500 ring-1 ring-indigo-500" : "bg-slate-900 border-slate-700 hover:border-slate-500")}
                    >
                      <div className={"p-2 rounded bg-slate-950 " + (isSelected ? p.color : "text-slate-500")}>
                        <Icon className="w-5 h-5" />
                      </div>
                      <span className={"font-medium " + (isSelected ? "text-white" : "text-slate-400")}>{p.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <Button disabled={!isValidStep1} onClick={() => setStep(2)} className="w-full mt-4">
              Next Step <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-6">
            <div className="flex bg-slate-900 p-1 rounded-md border border-slate-700">
              {['AVOID', 'DO'].map(t => (
                <button
                  key={t}
                  onClick={() => update('type', t)}
                  className={"flex-1 py-2 text-xs font-bold rounded " + (formData.type === t ? "bg-indigo-600 text-white shadow-lg" : "text-slate-500 hover:text-slate-300")}
                >
                  {t === 'AVOID' ? 'I WILL AVOID' : 'I MUST DO'}
                </button>
              ))}
            </div>

            <TextArea
              label="Define the behavior precisely"
              placeholder={formData.type === 'AVOID' ? "e.g. No consuming calories after 20:00. Water/Tea is fine." : "e.g. 45 minutes of Zone 2 cardio."}
              value={formData.behavior}
              onChange={e => update('behavior', e.target.value)}
            />

            {/* Dates & Duration */}
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-4">
                <Input
                  label="Starts On"
                  type="date"
                  value={formData.startDate}
                  onChange={e => handleStartDateChange(e.target.value)}
                  className="text-slate-100"
                />
                <Input
                  label="Ends On (Optional)"
                  type="date"
                  value={formData.endDate}
                  onChange={e => handleManualDateChange(e.target.value)}
                  className="text-slate-100"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Quick Duration (from Start Date)</label>
                <div className="grid grid-cols-3 gap-2">
                  {[15, 28, 58].map(days => (
                    <button
                      key={days}
                      onClick={() => setDuration(days)}
                      className={"border py-2 px-3 rounded text-xs font-bold transition-all " + (selectedDuration === days ? "bg-indigo-600 border-indigo-500 text-white shadow-lg shadow-indigo-500/30" : "bg-slate-900 border-slate-700 hover:bg-slate-800 hover:border-indigo-500 text-slate-300")}
                    >
                      {days} Days
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Exception Manager */}
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <label className="text-xs uppercase tracking-wider text-slate-500 font-semibold">Allowed Exceptions ({formData.exceptions.length}/{MAX_EXCEPTIONS})</label>
              </div>

              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="e.g. Travel, Sick Day..."
                  value={exceptionInput}
                  onChange={e => setExceptionInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  disabled={formData.exceptions.length >= MAX_EXCEPTIONS}
                  className="flex-1 bg-slate-900 border border-slate-700 rounded-md p-3 text-slate-100 focus:outline-none focus:border-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed placeholder-slate-600"
                />
                <button
                  onClick={addException}
                  disabled={!exceptionInput.trim() || formData.exceptions.length >= MAX_EXCEPTIONS}
                  className="bg-slate-800 text-slate-200 px-4 rounded-md border border-slate-700 hover:bg-slate-700 disabled:opacity-50"
                >
                  <Plus className="w-5 h-5" />
                </button>
              </div>

              {formData.exceptions.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-2">
                  {formData.exceptions.map((ex, idx) => (
                    <span key={idx} className="bg-indigo-900/30 border border-indigo-500/30 text-indigo-300 px-2 py-1 rounded text-xs flex items-center gap-2">
                      {ex}
                      <button onClick={() => removeException(idx)} className="hover:text-white">
                        <XCircle className="w-3 h-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* Penalty / Stakes */}
            <div className="pt-2 border-t border-slate-800 mt-2">
              <div className="flex items-center gap-2 mb-2">
                <Gavel className="w-4 h-4 text-rose-500" />
                <label className="text-xs uppercase tracking-wider text-rose-500 font-bold">Stakes / Penalty</label>
              </div>
              <TextArea
                placeholder="If I break this rule, I will... (e.g. Donate $50 to a charity I dislike, Do 100 burpees)"
                value={formData.penalty}
                onChange={e => update('penalty', e.target.value)}
                rows={2}
              />
            </div>

            <div className="flex gap-3 mt-4">
              <Button variant="secondary" onClick={() => setStep(1)} className="flex-1">Back</Button>
              <Button disabled={!isValidStep2} onClick={() => setStep(3)} className="flex-1">Review</Button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-6">

            {/* Pre-Mortem Audit Feature */}
            <div className="bg-slate-900 border border-slate-700 rounded-lg p-4">
              <div className="flex justify-between items-center mb-3">
                <div className="flex items-center gap-2 text-indigo-400 font-bold text-xs uppercase tracking-widest">
                  <Bot className="w-4 h-4" /> Pre-Mortem Audit
                </div>
                {!auditResult && (
                  <button
                    onClick={handlePreMortemAudit}
                    disabled={isAuditing}
                    className="text-[10px] bg-slate-800 hover:bg-slate-700 text-slate-300 px-2 py-1 rounded border border-slate-600 transition-colors"
                  >
                    {isAuditing ? "Scanning..." : "Run Analysis"}
                  </button>
                )}
              </div>

              {auditResult ? (
                <div className="bg-amber-950/20 border border-amber-900/30 p-3 rounded animate-in fade-in">
                  <div className="flex items-start gap-2 mb-2">
                    <AlertOctagon className="w-4 h-4 text-amber-500 mt-0.5" />
                    <span className="text-xs text-amber-200 font-bold">Potential Loophole Detected</span>
                  </div>
                  <p className="text-sm text-slate-300 italic mb-2">"<SafeRender content={auditResult.weakness} />"</p>
                  <div className="text-[10px] text-slate-500">Suggestion: <SafeRender content={auditResult.suggestion} /></div>
                  <button onClick={() => setStep(2)} className="text-[10px] text-indigo-400 underline mt-2 hover:text-indigo-300">
                    Edit Contract to Fix
                  </button>
                </div>
              ) : (
                <p className="text-xs text-slate-500">Let AI find loopholes in this contract before you sign.</p>
              )}
            </div>

            {/* Contract Summary */}
            <div className="bg-slate-900 border border-slate-700 p-6 rounded-lg relative overflow-hidden">
              <div className="absolute top-0 right-0 p-4 opacity-10">
                <Shield className="w-24 h-24" />
              </div>
              <h3 className="text-xs uppercase tracking-widest text-indigo-400 font-bold mb-4">Contract Draft</h3>
              <h1 className="text-xl font-bold text-white mb-2"><SafeRender content={formData.title} /></h1>
              <p className="text-slate-400 font-mono text-sm mb-6"><SafeRender content={formData.behavior} /></p>

              <div className="space-y-2 text-sm text-slate-500 border-t border-slate-800 pt-4">
                <div className="flex justify-between">
                  <span>Type:</span> <span className="text-slate-300 font-bold">{formData.type}</span>
                </div>
                <div className="flex justify-between">
                  <span>Starts:</span> <span className="text-slate-300 font-mono">{formatDate(formData.startDate)}</span>
                </div>
                {formData.endDate && (
                  <div className="flex justify-between">
                    <span>Ends:</span> <span className="text-slate-300 font-mono">{formatDate(formData.endDate)}</span>
                  </div>
                )}
                <div className="flex justify-between items-start">
                  <span>Exceptions:</span>
                  <span className="text-slate-300 text-right">
                    {formData.exceptions.length > 0 ? (
                      formData.exceptions.map((ex, i) => <React.Fragment key={i}>{i > 0 && ", "}<SafeRender content={ex} /></React.Fragment>)
                    ) : 'None'}
                  </span>
                </div>
                {formData.penalty && (
                  <div className="flex justify-between items-start pt-2 mt-2 border-t border-slate-800/50">
                    <span className="text-rose-500 font-bold flex items-center gap-1"><Gavel className="w-3 h-3" /> Penalty:</span>
                    <span className="text-rose-300 text-right text-xs max-w-[60%]">
                      <SafeRender content={formData.penalty} />
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* The Witness Feature */}
            <div className="bg-slate-900 border border-slate-700 rounded-lg p-4 flex justify-between items-center">
              <div>
                <div className="flex items-center gap-2 text-slate-300 font-bold text-xs uppercase tracking-widest">
                  <Eye className="w-4 h-4 text-blue-400" /> The Witness
                </div>
                <p className="text-[10px] text-slate-500 mt-1">Add social stakes by sharing a link.</p>
              </div>
              <button
                onClick={generateWitnessLink}
                className={"flex items-center gap-2 text-xs font-bold px-3 py-2 rounded transition-colors " + (formData.witnessLinked ? "bg-blue-900/30 text-blue-400 border border-blue-800" : "bg-slate-800 text-slate-300 hover:bg-slate-700")}
              >
                {formData.witnessLinked ? <><CheckCircle2 className="w-3 h-3" /> Link Generated</> : <><LinkIcon className="w-3 h-3" /> Copy Link</>}
              </button>
            </div>

            <div className="space-y-4 pt-4 border-t border-slate-800">
              <SignaturePad onSign={setIsSigned} />

              <p className="text-slate-400 text-xs text-center px-4">
                By signing, you make a binding agreement with your future self.
              </p>

              <Button
                onClick={handleCommit}
                disabled={!isSigned}
                variant="gold"
                className="w-full shadow-lg shadow-amber-900/20"
              >
                <Fingerprint className="w-5 h-5" /> SEAL COVENANT
              </Button>
              <Button variant="ghost" onClick={() => setStep(2)} className="w-full">Back to Edit</Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ViolationFlow({ contract, onCancel, onSubmit }) {
  const [reason, setReason] = useState(VIOLATION_REASONS[0]);
  const [story, setStory] = useState('');
  const [decision, setDecision] = useState('recommit'); // recommit, pause, retire

  // AI States
  const [aiVerdict, setAiVerdict] = useState(null);
  const [isAiLoading, setIsAiLoading] = useState(false);

  const handleAiAnalysis = async () => {
    if (!story.trim()) return;
    setIsAiLoading(true);

    const systemPrompt = "You are a Stoic Judge. Analyze the user's violation of a serious contract.\n" +
      "Contract: \"" + contract.title + "\"\n" +
      "User Story: \"" + story + "\"\n\n" +
      "Return JSON only with:\n" +
      "- verdict: A short, brutal but fair philosophical truth about why they failed (max 20 words).\n" +
      "- repair: A concrete, immediate repair action (e.g. \"Do 20 pushups now\", \"Write 100x I will not fail\").";

    const result = await callAIBackend("Analyze this slip.", systemPrompt);
    if (result) setAiVerdict(result);
    setIsAiLoading(false);
  };

  const handleNotifyWitness = () => {
    const text = "I broke my contract \"" + contract.title + "\". Reason: " + reason + ". Explanation: " + story + ". Keep me accountable.";
    if (navigator.share) {
      navigator.share({ title: 'Contract Violation', text: text }).catch(console.error);
    } else {
      copyToClipboard(text);
      alert("Violation report copied to clipboard. Send it to your witness.");
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/95 backdrop-blur-sm p-6 overflow-y-auto flex items-center justify-center">
      <div className="w-full max-w-md bg-slate-900 border border-rose-900/50 rounded-lg shadow-2xl p-6 space-y-6 animate-in zoom-in-95 duration-200">

        <div className="text-center space-y-2 border-b border-slate-800 pb-4">
          <div className="mx-auto w-12 h-12 bg-rose-900/20 rounded-full flex items-center justify-center">
            <AlertTriangle className="w-6 h-6 text-rose-500" />
          </div>
          <h2 className="text-xl font-bold text-white">Contract Broken</h2>
          <p className="text-rose-400 text-sm font-medium">"<SafeRender content={contract.title} />"</p>
          <p className="text-slate-500 text-xs">This is not a moral failure. It is data.</p>
        </div>

        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-xs uppercase tracking-wider text-slate-500 font-semibold">Root Cause</label>
            <div className="flex flex-wrap gap-2">
              {VIOLATION_REASONS.map(r => (
                <button
                  key={r}
                  onClick={() => setReason(r)}
                  className={"text-xs px-3 py-2 rounded border " + (reason === r ? "bg-rose-900/40 border-rose-700 text-rose-300" : "bg-slate-950 border-slate-800 text-slate-500 hover:border-slate-600")}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <TextArea
              label="What actually happened?"
              placeholder="Briefly describe the context (tired, stressed, unplanned event)..."
              value={story}
              onChange={e => setStory(e.target.value)}
            />
            {/* AI Analysis Button */}
            {!aiVerdict && story.length > 5 && (
              <button
                onClick={handleAiAnalysis}
                disabled={isAiLoading}
                className="w-full py-2 bg-slate-800/50 border border-indigo-500/20 rounded text-xs text-indigo-400 font-bold flex items-center justify-center gap-2 hover:bg-slate-800 transition-colors"
              >
                {isAiLoading ? <span className="animate-pulse">Consulting Stoic Judge...</span> : <><Bot className="w-3 h-3" /> Analyze Root Cause</>}
              </button>
            )}
          </div>

          {/* AI Verdict Display */}
          {aiVerdict && (
            <div className="bg-rose-950/20 border border-rose-900/30 p-4 rounded-lg space-y-3 animate-in fade-in slide-in-from-top-2">
              <div className="flex items-center gap-2 text-rose-400 font-bold text-xs uppercase tracking-widest">
                <Gavel className="w-3 h-3" /> The Verdict
              </div>
              <p className="text-slate-300 text-sm italic border-l-2 border-rose-500 pl-3">"<SafeRender content={aiVerdict.verdict} />"</p>
              <div className="bg-slate-950 p-3 rounded border border-slate-800">
                <div className="text-[10px] text-slate-500 uppercase font-bold mb-1">Recommended Repair</div>
                <div className="text-white text-sm"><SafeRender content={aiVerdict.repair} /></div>
              </div>
            </div>
          )}

          {/* Witness Notification - Show only if witness linked */}
          {contract.witnessLinked && (
            <div className="p-3 bg-blue-950/20 border border-blue-900/30 rounded flex items-center justify-between">
              <div className="text-xs text-blue-300">
                <span className="font-bold">Witness Alert:</span> You must notify your witness.
              </div>
              <button
                onClick={handleNotifyWitness}
                className="p-2 bg-blue-900/50 hover:bg-blue-800 text-blue-300 rounded"
                title="Send Notification"
              >
                <Share2 className="w-4 h-4" />
              </button>
            </div>
          )}

          <div className="space-y-2">
            <label className="text-xs uppercase tracking-wider text-slate-500 font-semibold">Decision</label>
            <div className="grid grid-cols-1 gap-2">
              <button
                onClick={() => setDecision('recommit')}
                className={"p-3 rounded border text-left flex items-center gap-3 " + (decision === 'recommit' ? "bg-slate-800 border-indigo-500 ring-1 ring-indigo-500" : "bg-slate-950 border-slate-800")}
              >
                <div className="p-2 bg-slate-900 rounded text-indigo-400"><Clock className="w-4 h-4" /></div>
                <div>
                  <div className="text-sm font-bold text-slate-200">Recommit</div>
                  <div className="text-xs text-slate-500">Reset streak, keep going.</div>
                </div>
              </button>

              <button
                onClick={() => setDecision('pause')}
                className={"p-3 rounded border text-left flex items-center gap-3 " + (decision === 'pause' ? "bg-slate-800 border-indigo-500 ring-1 ring-indigo-500" : "bg-slate-950 border-slate-800")}
              >
                <div className="p-2 bg-slate-900 rounded text-amber-400"><PauseCircle className="w-4 h-4" /></div>
                <div>
                  <div className="text-sm font-bold text-slate-200">Pause Contract</div>
                  <div className="text-xs text-slate-500">Conditions have changed.</div>
                </div>
              </button>

              <button
                onClick={() => setDecision('retire')}
                className={"p-3 rounded border text-left flex items-center gap-3 " + (decision === 'retire' ? "bg-rose-900/20 border-rose-800 ring-1 ring-rose-900" : "bg-slate-950 border-slate-800")}
              >
                <div className="p-2 bg-rose-900 rounded text-rose-400"><Skull className="w-4 h-4" /></div>
                <div>
                  <div className="text-sm font-bold text-rose-400">Retire Contract</div>
                  <div className="text-xs text-slate-500">Accept breach & archive.</div>
                </div>
              </button>
            </div>
          </div>
        </div>

        <div className="flex gap-3 pt-4 border-t border-slate-800">
          <Button variant="ghost" onClick={onCancel} className="flex-1">Cancel</Button>
          <Button variant="danger" onClick={() => onSubmit({ reason, story, decision })} className="flex-1">
            Log & Reset
          </Button>
        </div>

      </div>
    </div>
  );
}

// --- Journal Modal ---
function JournalModal({ contract, user, onClose }) {
  const [logs, setLogs] = useState([]);
  const [newLog, setNewLog] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user || !contract) return;
    const q = query(
      collection(db, 'users', user.uid, 'contracts', contract.id, 'journal'),
      // orderBy('createdAt', 'desc') // Requires index, using client sort for now if small
    );
    const unsub = onSnapshot(q, (snap) => {
      const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      // Client-side sort to avoid index creation for now
      data.sort((a, b) => (b.createdAt?.toMillis() || 0) - (a.createdAt?.toMillis() || 0));
      setLogs(data);
      setLoading(false);
    });
    return () => unsub();
  }, [user, contract]);

  const handleAddLog = async () => {
    if (!newLog.trim()) return;
    try {
      await addDoc(collection(db, 'users', user.uid, 'contracts', contract.id, 'journal'), {
        text: newLog.trim(),
        createdAt: serverTimestamp(),
        type: 'manual'
      });
      setNewLog('');
    } catch (e) {
      console.error("Error adding log:", e);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/95 backdrop-blur-sm p-6 flex items-center justify-center">
      <div className="w-full max-w-md bg-slate-900 border border-slate-700 rounded-lg shadow-2xl p-6 flex flex-col h-[70vh] animate-in zoom-in-95">
        <div className="flex justify-between items-center mb-4">
          <div className="flex items-center gap-2 text-blue-400 font-bold text-lg uppercase tracking-widest">
            <Book className="w-6 h-6" /> Contract Journal
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-white"><XCircle className="w-5 h-5" /></button>
        </div>

        <div className="bg-slate-950/50 p-3 rounded border border-slate-800 mb-4">
          <h3 className="font-bold text-slate-200 text-sm"><SafeRender content={contract.title} /></h3>
          <p className="text-xs text-slate-500 font-mono mt-1 line-clamp-2"><SafeRender content={contract.behavior} /></p>
        </div>

        {/* Logs List */}
        <div className="flex-1 overflow-y-auto space-y-3 mb-4 pr-2">
          {loading ? (
            <div className="text-center text-slate-600 text-xs animate-pulse mt-10">Loading thoughts...</div>
          ) : logs.length === 0 ? (
            <div className="text-center text-slate-600 text-xs mt-10 italic">No journal entries yet.</div>
          ) : (
            logs.map(log => (
              <div key={log.id} className="bg-slate-800/50 border border-slate-700/50 rounded p-3 text-sm">
                <p className="text-slate-300 whitespace-pre-wrap"><SafeRender content={log.text} /></p>
                <div className="text-[10px] text-slate-600 mt-2 text-right">
                  {formatDate(log.createdAt)}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Input Area */}
        <div className="space-y-2 pt-4 border-t border-slate-800">
          <TextArea
            placeholder="Log your thoughts, near-misses, or wins..."
            value={newLog}
            onChange={e => setNewLog(e.target.value)}
            rows={2}
          />
          <Button onClick={handleAddLog} disabled={!newLog.trim()} className="w-full" variant="secondary">
            Add Entry
          </Button>
        </div>
      </div>
    </div>
  );
}