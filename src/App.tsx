import React, { useState, useEffect } from 'react';
import {
  CheckCircle2,
  Clock,
  AlertTriangle,
  TrendingUp,
  Plus,
  Trash2,
  Sparkles,
  Calendar,
  Award,
  Check,
  Activity,
  Flame,
  Info,
  Lightbulb,
  Layers,
  Loader2,
  CheckSquare,
  AlertCircle,
  HelpCircle,
  ChevronRight,
  RefreshCw,
  Zap,
  BarChart2,
  LogIn,
  UserPlus,
  LogOut,
  Lock,
  Mail,
  User,
  ShieldCheck
} from 'lucide-react';

// Task and Subtask Interfaces
interface Subtask {
  id: string;
  title: string;
  completed: boolean;
}

interface RescuePlan {
  timeRemaining: string;
  priorityActions: Array<{ title: string; durationMinutes: number }>;
  skipActions: string[];
  estimatedMinutes: number;
}

interface Task {
  id: string;
  title: string;
  description: string;
  deadline: string;
  difficulty: 'Easy' | 'Medium' | 'Hard';
  priority: 'Critical' | 'High' | 'Medium' | 'Low';
  risk: 'Low' | 'Medium' | 'High';
  riskReason: string;
  estimatedMinutes: number;
  completed: boolean;
  completedAt: string | null;
  subtasks: Subtask[];
  createdAt: string;
  rescuePlan?: RescuePlan;
}

interface AIAnalysis {
  recommendation: string;
  focusStrategy: string;
  readiness: 'Optimal' | 'Good' | 'Needs Focus' | 'Critical Overload';
  schedule: Array<{
    taskId: string;
    timeSlot: string;
    focusGoal: string;
    reason: string;
  }>;
}

export default function App() {
  // Authentication State
  const [currentUser, setCurrentUser] = useState<{ id: string; name: string; email: string } | null>(() => {
    const saved = localStorage.getItem('auth_user');
    try {
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });
  const [authMode, setAuthMode] = useState<'login' | 'signup'>('login');
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authName, setAuthName] = useState('');
  const [authLoading, setAuthLoading] = useState(false);

  // Navigation & UI States
  const [activeTab, setActiveTab] = useState<'plan' | 'tasks' | 'metrics' | 'insights'>('plan');
  const [tasks, setTasks] = useState<Task[]>([]);
  const [aiAnalysis, setAiAnalysis] = useState<AIAnalysis | null>(null);
  const [isLoadingTasks, setIsLoadingTasks] = useState(false);
  const [isAnalyzingAI, setIsAnalyzingAI] = useState(false);
  const [isCreatingTask, setIsCreatingTask] = useState(false);
  const [generatingRescuePlanId, setGeneratingRescuePlanId] = useState<string | null>(null);
  const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Form Inputs
  const [newTitle, setNewTitle] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newDeadline, setNewDeadline] = useState('');
  const [newDifficulty, setNewDifficulty] = useState<'Easy' | 'Medium' | 'Hard'>('Medium');

  // In-app productivity timer (Bonus interactive helper)
  const [timerTask, setTimerTask] = useState<Task | null>(null);
  const [timerSeconds, setTimerSeconds] = useState(25 * 60);
  const [timerActive, setTimerActive] = useState(false);

  // Helper: headers dictionary for authentication
  const getHeaders = () => {
    const token = localStorage.getItem('auth_token');
    return {
      'Content-Type': 'application/json',
      ...(token ? { 'Authorization': `Bearer ${token}` } : {})
    };
  };

  // Load initial tasks when user is authenticated
  useEffect(() => {
    if (currentUser) {
      fetchTasks();
    } else {
      setTasks([]);
      setAiAnalysis(null);
    }
  }, [currentUser]);

  // Sync AI analysis whenever tasks change
  useEffect(() => {
    if (currentUser && tasks.length > 0) {
      triggerAIAnalysis();
    } else {
      setAiAnalysis(null);
    }
  }, [tasks.length, currentUser]);

  // Toast notifications helper
  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setNotification({ message, type });
    setTimeout(() => {
      setNotification(null);
    }, 4000);
  };

  // Authentication Handlers
  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!authEmail.trim() || !authPassword.trim() || !authName.trim()) {
      showToast('All fields are required.', 'error');
      return;
    }
    setAuthLoading(true);
    try {
      const res = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: authEmail, password: authPassword, name: authName })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Signup failed');

      showToast('Account created successfully! Please log in.', 'success');
      setAuthMode('login');
      setAuthPassword('');
      setAuthName('');
    } catch (err: any) {
      showToast(err.message, 'error');
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!authEmail.trim() || !authPassword.trim()) {
      showToast('Please enter both email and password.', 'error');
      return;
    }
    setAuthLoading(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: authEmail, password: authPassword })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Invalid credentials');

      localStorage.setItem('auth_token', data.token);
      localStorage.setItem('auth_user', JSON.stringify(data.user));
      setCurrentUser(data.user);
      showToast(`Welcome back, ${data.user.name}!`, 'success');
      setAuthEmail('');
      setAuthPassword('');
    } catch (err: any) {
      showToast(err.message, 'error');
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('auth_token');
    localStorage.removeItem('auth_user');
    setCurrentUser(null);
    showToast('Logged out successfully.', 'success');
  };

  // Fetch tasks from API
  const fetchTasks = async () => {
    setIsLoadingTasks(true);
    try {
      const res = await fetch('/api/tasks', {
        headers: getHeaders()
      });
      if (!res.ok) throw new Error('Failed to load tasks');
      const data = await res.json();
      setTasks(data);
    } catch (err: any) {
      showToast(err.message, 'error');
    } finally {
      setIsLoadingTasks(false);
    }
  };

  // Create Task
  const handleCreateTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim() || !newDeadline || !newDifficulty) {
      showToast('Please fill out all required fields.', 'error');
      return;
    }

    setIsCreatingTask(true);
    showToast('Decomposing task & predicting risk with Gemini AI...', 'success');

    try {
      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({
          title: newTitle,
          description: newDescription,
          deadline: newDeadline,
          difficulty: newDifficulty,
        }),
      });

      if (!res.ok) throw new Error('Failed to analyze and save task');
      const newTask = await res.json();
      setTasks((prev) => [newTask, ...prev]);

      // Reset form
      setNewTitle('');
      setNewDescription('');
      setNewDeadline('');
      setNewDifficulty('Medium');
      setIsCreatingTask(false);
      showToast(`Task "${newTask.title}" decomposed successfully!`, 'success');
    } catch (err: any) {
      setIsCreatingTask(false);
      showToast(err.message, 'error');
    }
  };

  // Toggle Subtask Completion
  const toggleSubtask = async (taskId: string, subtaskId: string) => {
    try {
      const res = await fetch(`/api/tasks/${taskId}/subtasks/${subtaskId}`, {
        method: 'PATCH',
        headers: getHeaders(),
      });
      if (!res.ok) throw new Error('Failed to update subtask status');
      const updatedTask = await res.json();
      setTasks((prev) => prev.map((t) => (t.id === taskId ? updatedTask : t)));
    } catch (err: any) {
      showToast(err.message, 'error');
    }
  };

  // Toggle Task Status (Completed / Active)
  const toggleTaskStatus = async (task: Task) => {
    try {
      const nextCompleted = !task.completed;
      // Also check/uncheck all subtasks for ease of use
      const updatedSubtasks = task.subtasks.map((s) => ({
        ...s,
        completed: nextCompleted,
      }));

      const res = await fetch(`/api/tasks/${task.id}`, {
        method: 'PUT',
        headers: getHeaders(),
        body: JSON.stringify({
          completed: nextCompleted,
          subtasks: updatedSubtasks,
        }),
      });

      if (!res.ok) throw new Error('Failed to update task');
      const updated = await res.json();
      setTasks((prev) => prev.map((t) => (t.id === task.id ? updated : t)));
      showToast(
        nextCompleted
          ? `Great job! "${task.title}" completed!`
          : `Task "${task.title}" marked as active.`,
        'success'
      );
    } catch (err: any) {
      showToast(err.message, 'error');
    }
  };

  // Delete Task
  const deleteTask = async (taskId: string) => {
    try {
      const res = await fetch(`/api/tasks/${taskId}`, {
        method: 'DELETE',
        headers: getHeaders(),
      });
      if (!res.ok) throw new Error('Failed to delete task');
      setTasks((prev) => prev.filter((t) => t.id !== taskId));
      showToast('Task deleted successfully.', 'success');
    } catch (err: any) {
      showToast(err.message, 'error');
    }
  };

  // Generate Rescue Plan for High-Risk Task
  const generateRescuePlan = async (taskId: string) => {
    setGeneratingRescuePlanId(taskId);
    showToast('Consulting Gemini AI to build last-minute rescue plan...', 'success');
    try {
      const res = await fetch(`/api/tasks/${taskId}/rescue-plan`, {
        method: 'POST',
        headers: getHeaders(),
      });
      if (!res.ok) throw new Error('Failed to generate rescue plan');
      const updatedPlan = await res.json();
      // Update local task with the returned rescuePlan
      setTasks((prev) =>
        prev.map((t) => (t.id === taskId ? { ...t, rescuePlan: updatedPlan } : t))
      );
      showToast('Rescue plan generated! Review actionable prioritized steps below.', 'success');
    } catch (err: any) {
      showToast(err.message, 'error');
    } finally {
      setGeneratingRescuePlanId(null);
    }
  };

  // Explicitly trigger Gemini AI Optimization / Analysis
  const triggerAIAnalysis = async () => {
    setIsAnalyzingAI(true);
    try {
      const res = await fetch('/api/ai/analyze', {
        method: 'POST',
        headers: getHeaders(),
      });
      if (!res.ok) throw new Error('AI Engine failed to respond');
      const data = await res.json();
      setAiAnalysis(data);
    } catch (err: any) {
      console.error(err);
    } finally {
      setIsAnalyzingAI(false);
    }
  };

  // Helper: Format relative hours/days remaining
  const getTimeRemaining = (deadlineStr: string) => {
    const now = new Date();
    const deadline = new Date(deadlineStr);
    const diffMs = deadline.getTime() - now.getTime();
    if (diffMs < 0) return 'Overdue';

    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    if (diffHours < 24) {
      return `${diffHours}h left`;
    }
    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays}d left`;
  };

  // Helper: Format standard dates nicely
  const formatDateNicely = (dateStr: string) => {
    const options: Intl.DateTimeFormatOptions = {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    };
    return new Date(dateStr).toLocaleDateString('en-US', options);
  };

  // Calculate Metrics
  const totalTasks = tasks.length;
  const completedTasks = tasks.filter((t) => t.completed).length;
  const completionPercentage = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

  const totalSubtasks = tasks.reduce((acc, t) => acc + t.subtasks.length, 0);
  const completedSubtasks = tasks.reduce(
    (acc, t) => acc + t.subtasks.filter((s) => s.completed).length,
    0
  );

  const activeHighRiskCount = tasks.filter((t) => !t.completed && t.risk === 'High').length;
  const overallRisk =
    activeHighRiskCount > 1 ? 'High' : activeHighRiskCount === 1 ? 'Medium' : 'Low';

  // Calculate estimated hours saved by breaking tasks down
  // Let's assume each actionable subtask decomposition saves 20 minutes of planning/overhead time
  const timeSavedHours = ((totalSubtasks * 20) / 60).toFixed(1);

  // Custom visual theme setup based on "Obsidian Neon"
  if (!currentUser) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col justify-center items-center font-sans text-slate-100 relative overflow-hidden">
        {/* Dynamic decorative glowing grid */}
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#1e293b_1px,transparent_1px),linear-gradient(to_bottom,#1e293b_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_50%,#000_70%,transparent_100%)] opacity-20 pointer-events-none"></div>

        {/* Abstract futuristic glowing background blobs */}
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-indigo-600/15 rounded-full blur-3xl pointer-events-none"></div>
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-violet-600/15 rounded-full blur-3xl pointer-events-none"></div>
        <div className="absolute top-12 right-12 w-64 h-64 bg-emerald-500/5 rounded-full blur-2xl pointer-events-none animate-pulse"></div>

        {/* Toast Notification */}
        {notification && (
          <div
            id="toast-notification"
            className={`fixed top-6 right-6 z-50 p-4 rounded-xl shadow-lg border flex items-center gap-3 transition-all duration-300 transform translate-y-0 ${
              notification.type === 'success'
                ? 'bg-emerald-950/95 border-emerald-500/30 text-emerald-300'
                : 'bg-rose-950/95 border-rose-500/30 text-rose-300'
            }`}
          >
            {notification.type === 'success' ? (
              <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
            ) : (
              <AlertCircle className="w-5 h-5 text-rose-400 shrink-0" />
            )}
            <span className="text-sm font-medium">{notification.message}</span>
          </div>
        )}

        <div className="w-full max-w-md p-8 bg-slate-900/60 backdrop-blur-2xl border border-slate-800/80 rounded-3xl shadow-2xl relative z-10">
          {/* Logo */}
          <div className="flex flex-col items-center mb-8 text-center">
            <div className="w-12 h-12 bg-gradient-to-tr from-indigo-500 via-indigo-600 to-violet-600 rounded-2xl flex items-center justify-center text-white font-black text-2xl shadow-lg shadow-indigo-500/20 mb-3">
              N
            </div>
            <h1 className="text-3xl font-black tracking-tight bg-gradient-to-r from-white via-indigo-200 to-indigo-400 bg-clip-text text-transparent">
              NextMove AI
            </h1>
            <p className="text-xs text-indigo-400 font-bold uppercase tracking-widest mt-1.5">
              Task Decomposition & Risk Prediction
            </p>
          </div>

          {authMode === 'login' ? (
            <form onSubmit={handleLogin} className="space-y-4">
              <div className="space-y-1">
                <label className="text-xs font-black text-indigo-400 uppercase tracking-wider block">Email Address</label>
                <div className="relative">
                  <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                  <input
                    type="email"
                    required
                    value={authEmail}
                    onChange={(e) => setAuthEmail(e.target.value)}
                    placeholder="name@example.com"
                    className="w-full bg-slate-950 border border-slate-800 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 rounded-xl py-3 pl-11 pr-4 text-sm text-white placeholder-slate-600 outline-none transition-all"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-black text-indigo-400 uppercase tracking-wider block">Password</label>
                <div className="relative">
                  <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                  <input
                    type="password"
                    required
                    value={authPassword}
                    onChange={(e) => setAuthPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full bg-slate-950 border border-slate-800 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 rounded-xl py-3 pl-11 pr-4 text-sm text-white placeholder-slate-600 outline-none transition-all"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={authLoading}
                className="w-full bg-gradient-to-r from-indigo-600 via-indigo-500 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white font-extrabold text-sm py-3.5 px-4 rounded-xl transition-all shadow-md shadow-indigo-950/50 hover:shadow-indigo-500/20 flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 mt-2"
              >
                {authLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin text-white" />
                ) : (
                  <>
                    <LogIn className="w-4 h-4" />
                    <span>Sign In</span>
                  </>
                )}
              </button>

              <div className="text-center pt-4 border-t border-slate-800/80 mt-4">
                <p className="text-xs text-slate-400">
                  Don't have an account?{' '}
                  <button
                    type="button"
                    onClick={() => {
                      setAuthMode('signup');
                      setAuthEmail('');
                      setAuthPassword('');
                    }}
                    className="text-indigo-400 hover:text-indigo-300 font-extrabold underline hover:no-underline transition-all cursor-pointer"
                  >
                    Create account
                  </button>
                </p>
              </div>
            </form>
          ) : (
            <form onSubmit={handleSignup} className="space-y-4">
              <div className="space-y-1">
                <label className="text-xs font-black text-indigo-400 uppercase tracking-wider block">Your Name</label>
                <div className="relative">
                  <User className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                  <input
                    type="text"
                    required
                    value={authName}
                    onChange={(e) => setAuthName(e.target.value)}
                    placeholder="John Doe"
                    className="w-full bg-slate-950 border border-slate-800 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 rounded-xl py-3 pl-11 pr-4 text-sm text-white placeholder-slate-600 outline-none transition-all"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-black text-indigo-400 uppercase tracking-wider block">Email Address</label>
                <div className="relative">
                  <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                  <input
                    type="email"
                    required
                    value={authEmail}
                    onChange={(e) => setAuthEmail(e.target.value)}
                    placeholder="name@example.com"
                    className="w-full bg-slate-950 border border-slate-800 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 rounded-xl py-3 pl-11 pr-4 text-sm text-white placeholder-slate-600 outline-none transition-all"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-black text-indigo-400 uppercase tracking-wider block">Password</label>
                <div className="relative">
                  <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                  <input
                    type="password"
                    required
                    value={authPassword}
                    onChange={(e) => setAuthPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full bg-slate-950 border border-slate-800 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 rounded-xl py-3 pl-11 pr-4 text-sm text-white placeholder-slate-600 outline-none transition-all"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={authLoading}
                className="w-full bg-gradient-to-r from-indigo-600 via-indigo-500 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white font-extrabold text-sm py-3.5 px-4 rounded-xl transition-all shadow-md shadow-indigo-950/50 hover:shadow-indigo-500/20 flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 mt-2"
              >
                {authLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin text-white" />
                ) : (
                  <>
                    <UserPlus className="w-4 h-4" />
                    <span>Create Account</span>
                  </>
                )}
              </button>

              <div className="text-center pt-4 border-t border-slate-800/80 mt-4">
                <p className="text-xs text-slate-400">
                  Already have an account?{' '}
                  <button
                    type="button"
                    onClick={() => {
                      setAuthMode('login');
                      setAuthEmail('');
                      setAuthPassword('');
                    }}
                    className="text-indigo-400 hover:text-indigo-300 font-extrabold underline hover:no-underline transition-all cursor-pointer"
                  >
                    Sign In
                  </button>
                </p>
              </div>
            </form>
          )}
        </div>
      </div>
    );
  }

  const getGreeting = () => {
    const hours = new Date().getHours();
    if (hours < 12) return 'Good Morning';
    if (hours < 17) return 'Good Afternoon';
    return 'Good Evening';
  };

  const getStrategicAdvice = () => {
    const activeTasks = tasks.filter(t => !t.completed);
    if (activeTasks.length === 0) {
      return "You have no active tasks left. Great job!";
    }

    const now = new Date();
    const oneDayFromNow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const dueWithin24h = activeTasks.filter(t => {
      const d = new Date(t.deadline);
      return d > now && d <= oneDayFromNow;
    });

    const countDue24h = dueWithin24h.length;
    let taskDueMsg = "";
    if (countDue24h > 0) {
      taskDueMsg = `You have ${countDue24h} task${countDue24h > 1 ? 's' : ''} due within 24 hours.`;
    } else {
      taskDueMsg = `You have ${activeTasks.length} active task${activeTasks.length > 1 ? 's' : ''} on your plate.`;
    }

    const sortedTasks = [...activeTasks].sort((a, b) => {
      const riskWeight = { High: 3, Medium: 2, Low: 1 };
      const rA = riskWeight[a.risk] || 1;
      const rB = riskWeight[b.risk] || 1;
      if (rA !== rB) return rB - rA;

      const prioWeight = { Critical: 4, High: 3, Medium: 2, Low: 1 };
      const pA = prioWeight[a.priority] || 2;
      const pB = prioWeight[b.priority] || 2;
      if (pA !== pB) return pB - pA;

      return new Date(a.deadline).getTime() - new Date(b.deadline).getTime();
    });

    const highestRisk = sortedTasks[0];
    let recommendationMsg = aiAnalysis?.recommendation || "Prioritize completing your high risk tasks.";
    if (highestRisk) {
      recommendationMsg = `Complete ${highestRisk.title} first because it has the highest deadline risk.`;
    }

    return `${taskDueMsg}\n\n${recommendationMsg}`;
  };

  return (
    <div className="min-h-screen bg-slate-950 flex overflow-hidden font-sans text-slate-100 border-8 border-slate-900 relative">
      {/* Ambient background glows */}
      <div className="absolute top-0 right-1/4 w-[500px] h-[500px] bg-indigo-600/5 rounded-full blur-3xl pointer-events-none"></div>
      <div className="absolute bottom-10 left-10 w-96 h-96 bg-violet-600/5 rounded-full blur-3xl pointer-events-none"></div>

      {/* Toast Notification */}
      {notification && (
        <div
          id="toast-notification"
          className={`fixed top-6 right-6 z-50 p-4 rounded-xl shadow-2xl border flex items-center gap-3 transition-all duration-300 transform translate-y-0 ${
            notification.type === 'success'
              ? 'bg-slate-900/95 border-emerald-500/30 text-emerald-300 shadow-emerald-950/10'
              : 'bg-slate-900/95 border-rose-500/30 text-rose-300 shadow-rose-950/10'
          }`}
        >
          {notification.type === 'success' ? (
            <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
          ) : (
            <AlertCircle className="w-5 h-5 text-rose-400 shrink-0" />
          )}
          <span className="text-sm font-semibold">{notification.message}</span>
        </div>
      )}

      {/* Sidebar Section */}
      <aside className="w-64 bg-slate-900/40 backdrop-blur-xl border-r border-slate-800/60 flex flex-col shrink-0 relative z-10">
        <div className="p-8 flex-1 flex flex-col">
          {/* Brand Logo */}
          <div className="flex items-center gap-3 mb-10">
            <div className="w-9 h-9 bg-gradient-to-tr from-indigo-500 via-indigo-600 to-violet-600 rounded-xl flex items-center justify-center text-white font-extrabold text-lg shadow-md shadow-indigo-500/20">
              N
            </div>
            <div>
              <h1 className="text-xl font-black tracking-tight bg-gradient-to-r from-white to-slate-200 bg-clip-text text-transparent leading-none">NextMove</h1>
              <span className="text-[9px] text-indigo-400 font-bold uppercase tracking-widest block mt-0.5">AI Task Companion</span>
            </div>
          </div>

          {/* Navigation Links */}
          <nav className="space-y-6">
            <div>
              <p className="text-[10px] uppercase tracking-widest text-slate-500 font-extrabold mb-4">Workspace</p>
              <ul className="space-y-1.5">
                <li>
                  <button
                    onClick={() => setActiveTab('plan')}
                    className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl transition-all cursor-pointer text-left border ${
                      activeTab === 'plan'
                        ? 'text-indigo-400 font-bold bg-indigo-950/40 border-indigo-500/30 shadow-inner'
                        : 'text-slate-400 hover:bg-slate-800/40 hover:text-white border-transparent'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <Calendar className="w-4 h-4 shrink-0" />
                      <span className="text-sm">Daily Action Plan</span>
                    </div>
                    {tasks.filter(t => !t.completed).length > 0 && (
                      <span className="text-xs bg-indigo-950 text-indigo-300 px-2 py-0.5 rounded-md font-extrabold border border-indigo-800/50">
                        {tasks.filter(t => !t.completed).length}
                      </span>
                    )}
                  </button>
                </li>
                <li>
                  <button
                    onClick={() => setActiveTab('tasks')}
                    className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl transition-all cursor-pointer text-left border ${
                      activeTab === 'tasks'
                        ? 'text-indigo-400 font-bold bg-indigo-950/40 border-indigo-500/30 shadow-inner'
                        : 'text-slate-400 hover:bg-slate-800/40 hover:text-white border-transparent'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <Layers className="w-4 h-4 shrink-0" />
                      <span className="text-sm">All Tasks</span>
                    </div>
                  </button>
                </li>
              </ul>
            </div>

            <div>
              <p className="text-[10px] uppercase tracking-widest text-slate-500 font-extrabold mb-4">AI Analytics</p>
              <ul className="space-y-1.5">
                <li>
                  <button
                    onClick={() => setActiveTab('metrics')}
                    className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl transition-all cursor-pointer text-left border ${
                      activeTab === 'metrics'
                        ? 'text-indigo-400 font-bold bg-indigo-950/40 border-indigo-500/30 shadow-inner'
                        : 'text-slate-400 hover:bg-slate-800/40 hover:text-white border-transparent'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <Activity className="w-4 h-4 shrink-0" />
                      <span className="text-sm">Metrics & Progress</span>
                    </div>
                  </button>
                </li>
                <li>
                  <button
                    onClick={() => setActiveTab('insights')}
                    className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl transition-all cursor-pointer text-left border ${
                      activeTab === 'insights'
                        ? 'text-indigo-400 font-bold bg-indigo-950/40 border-indigo-500/30 shadow-inner'
                        : 'text-slate-400 hover:bg-slate-800/40 hover:text-white border-transparent'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <Sparkles className="w-4 h-4 shrink-0" />
                      <span className="text-sm">AI Productivity Lab</span>
                    </div>
                    {aiAnalysis && (
                      <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping"></span>
                    )}
                  </button>
                </li>
              </ul>
            </div>
          </nav>
        </div>

        {/* AI Readiness Sidebar Widget */}
        <div className="p-6 border-t border-slate-800/60 bg-slate-950/30">
          <div className="bg-gradient-to-b from-indigo-950/80 to-slate-900/90 rounded-2xl p-5 text-white shadow-xl border border-indigo-900/40">
            <div className="flex justify-between items-start mb-2">
              <p className="text-[10px] text-indigo-300 font-extrabold uppercase tracking-wider">AI Readiness</p>
              <Sparkles className="w-4 h-4 text-indigo-300" />
            </div>
            <p className="text-lg font-black mb-2">
              {aiAnalysis?.readiness || (totalTasks > 0 ? 'Good' : 'Optimal')}
            </p>
            <div className="h-1.5 w-full bg-slate-900 rounded-full overflow-hidden mb-2">
              <div
                className="h-full bg-gradient-to-r from-indigo-400 to-indigo-300 transition-all duration-1000 animate-pulse"
                style={{
                  width: `${
                    aiAnalysis?.readiness === 'Optimal'
                      ? 100
                      : aiAnalysis?.readiness === 'Good'
                      ? 80
                      : aiAnalysis?.readiness === 'Needs Focus'
                      ? 50
                      : aiAnalysis?.readiness === 'Critical Overload'
                      ? 20
                      : totalTasks > 0
                      ? 80
                      : 100
                  }%`,
                }}
              ></div>
            </div>
            <p className="text-[10px] text-slate-400 leading-relaxed font-semibold">
              {aiAnalysis?.readiness === 'Critical Overload'
                ? 'High priority workload is backing up. Take action today!'
                : 'Tasks parsed into optimal subtasks.'}
            </p>
          </div>
        </div>

        {/* User Profile Footer Widget */}
        <div className="p-4 border-t border-slate-800/80 flex items-center justify-between gap-3 bg-slate-950/50">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-indigo-500 to-violet-500 flex items-center justify-center font-bold text-xs text-white shrink-0 uppercase">
              {currentUser.name.charAt(0)}
            </div>
            <div className="min-w-0">
              <p className="text-xs font-black text-slate-200 truncate leading-none">{currentUser.name}</p>
              <p className="text-[10px] text-slate-500 truncate mt-1">{currentUser.email}</p>
            </div>
          </div>
          <button
            onClick={handleLogout}
            className="p-1.5 text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 rounded-lg transition-all cursor-pointer shrink-0"
            title="Log Out"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </aside>

      {/* Main Content Pane */}
      <main className="flex-1 flex flex-col min-h-0 bg-slate-950/40 backdrop-blur-3xl overflow-y-auto relative z-10">
        <div className="p-8 max-w-6xl w-full mx-auto flex flex-col space-y-8 flex-1">
          
          {/* Header Area */}
          <header className="flex justify-between items-start border-b border-slate-800/60 pb-6 shrink-0">
            <div>
              <div className="flex items-center gap-2 text-indigo-400 font-bold text-xs uppercase tracking-wider mb-1">
                <Clock className="w-3.5 h-3.5 animate-pulse" />
                <span>Active Workspace</span>
              </div>
              <h2 className="text-3xl font-black tracking-tight text-white">
                {activeTab === 'plan' && 'Daily Action Plan'}
                {activeTab === 'tasks' && 'All Action Tasks'}
                {activeTab === 'metrics' && 'Performance Hub'}
                {activeTab === 'insights' && 'AI Productivity Lab'}
              </h2>
              <p className="text-slate-500 text-sm mt-1">
                {activeTab === 'plan' && 'Your personalized daily sequence computed by Gemini AI.'}
                {activeTab === 'tasks' && 'Create tasks and view AI decomposed micro-milestones.'}
                {activeTab === 'metrics' && 'Track task metrics, completion speed, and risk assessments.'}
                {activeTab === 'insights' && 'Tailored, dynamic recommendations for maximum deep work.'}
              </p>
            </div>

            <div className="flex gap-3">
              {/* Trigger analysis button */}
              {tasks.length > 0 && (
                <button
                  onClick={triggerAIAnalysis}
                  disabled={isAnalyzingAI}
                  className="bg-slate-900 border border-slate-800 text-slate-300 hover:bg-slate-800 hover:text-white px-4 py-2.5 rounded-xl font-bold text-sm shadow-md flex items-center gap-2 transition-all cursor-pointer disabled:opacity-60"
                >
                  <RefreshCw className={`w-4 h-4 text-indigo-400 ${isAnalyzingAI ? 'animate-spin' : ''}`} />
                  <span>Sync AI Plan</span>
                </button>
              )}

              <button
                onClick={() => {
                  setActiveTab('tasks');
                  setIsCreatingTask(true);
                  // Scroll to form if needed
                  setTimeout(() => {
                    document.getElementById('task-creation-form')?.scrollIntoView({ behavior: 'smooth' });
                  }, 100);
                }}
                className="bg-indigo-600 text-white px-5 py-2.5 rounded-xl font-bold text-sm shadow-lg shadow-indigo-950 hover:bg-indigo-700 hover:shadow-indigo-500/20 transition-all flex items-center gap-2 cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>Create Task</span>
              </button>
            </div>
          </header>

          {/* Metric Dashboard Bar */}
          <section className="grid grid-cols-1 md:grid-cols-4 gap-6 shrink-0">
            <div className="bg-slate-900/60 border border-slate-800 p-5 rounded-2xl shadow-xl flex flex-col justify-between">
              <div>
                <p className="text-[10px] text-indigo-400 font-extrabold uppercase tracking-widest mb-1">Completion Rate</p>
                <div className="flex items-baseline gap-2">
                  <span className="text-3xl font-black tracking-tight text-white">{completionPercentage}%</span>
                  <span className="text-xs text-indigo-300 font-bold">
                    {completedTasks}/{totalTasks} done
                  </span>
                </div>
              </div>
              <div className="h-1.5 w-full bg-slate-950 rounded-full overflow-hidden mt-3">
                <div className="h-full bg-indigo-500 transition-all duration-500" style={{ width: `${completionPercentage}%` }}></div>
              </div>
            </div>

            <div className="bg-slate-900/60 border border-slate-800 p-5 rounded-2xl shadow-xl flex flex-col justify-between">
              <div>
                <p className="text-[10px] text-indigo-400 font-extrabold uppercase tracking-widest mb-1">Deadline Risk</p>
                <div className="flex items-center gap-2">
                  <span className={`text-3xl font-black tracking-tight ${
                    overallRisk === 'High' ? 'text-rose-500' : overallRisk === 'Medium' ? 'text-orange-400' : 'text-emerald-400'
                  }`}>
                    {overallRisk}
                  </span>
                  <span className={`w-2.5 h-2.5 rounded-full ${
                    overallRisk === 'High' ? 'bg-rose-500 animate-pulse' : overallRisk === 'Medium' ? 'bg-orange-500' : 'bg-emerald-500'
                  }`}></span>
                </div>
              </div>
              <p className="text-[10px] text-slate-400 font-bold mt-3 uppercase tracking-wider">
                {activeHighRiskCount} critical tasks left
              </p>
            </div>

            <div className="bg-slate-900/60 border border-slate-800 p-5 rounded-2xl shadow-xl flex flex-col justify-between">
              <div>
                <p className="text-[10px] text-indigo-400 font-extrabold uppercase tracking-widest mb-1">Action Steps</p>
                <div className="flex items-baseline gap-2">
                  <span className="text-3xl font-black tracking-tight text-white">{totalSubtasks}</span>
                  <span className="text-xs text-slate-400 font-semibold">
                    {completedSubtasks} completed
                  </span>
                </div>
              </div>
              <p className="text-[10px] text-indigo-400 font-bold mt-3 uppercase tracking-wider">
                Decomposed by AI
              </p>
            </div>

            <div className="bg-slate-900/60 border border-slate-800 p-5 rounded-2xl shadow-xl flex flex-col justify-between">
              <div>
                <p className="text-[10px] text-indigo-400 font-extrabold uppercase tracking-widest mb-1">AI Planning Hours Saved</p>
                <span className="text-3xl font-black tracking-tight text-indigo-400 underline decoration-indigo-800 underline-offset-4">
                  {timeSavedHours}h
                </span>
              </div>
              <p className="text-[10px] text-slate-400 font-bold mt-3 uppercase tracking-wider">
                ~20 mins per task chunk
              </p>
            </div>
          </section>

          {/* Tab Content Panels */}
          <div className="flex-1 min-h-0">
            {/* TAB: DAILY PLAN */}
            {activeTab === 'plan' && (
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 h-full items-start">
                
                {/* Daily Schedule Timeline */}
                <div className="lg:col-span-2 space-y-6">
                  <h3 className="text-sm font-extrabold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                    <Calendar className="w-4 h-4 text-indigo-400" />
                    <span>Gemini's Suggested Sequence</span>
                  </h3>

                  {tasks.length === 0 ? (
                    <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-10 text-center shadow-xl">
                      <div className="w-12 h-12 bg-slate-950 rounded-full flex items-center justify-center mx-auto mb-4 text-indigo-400">
                        <Layers className="w-6 h-6" />
                      </div>
                      <h4 className="text-lg font-bold text-white mb-2">No Active Tasks Found</h4>
                      <p className="text-slate-400 text-sm max-w-sm mx-auto mb-6">
                        Add tasks in the "All Tasks" tab to let Gemini AI draft your smart action plan.
                      </p>
                      <button
                        onClick={() => setActiveTab('tasks')}
                        className="bg-indigo-600 text-white px-5 py-2.5 rounded-xl text-xs font-bold hover:bg-indigo-700 hover:shadow-indigo-500/20 transition-all cursor-pointer"
                      >
                        Go to Tasks
                      </button>
                    </div>
                  ) : aiAnalysis?.schedule && aiAnalysis.schedule.length > 0 ? (
                    <div className="space-y-4">
                      {aiAnalysis.schedule.map((item, idx) => {
                        const matchedTask = tasks.find((t) => t.id === item.taskId);
                        if (!matchedTask) return null;

                        return (
                          <div
                            key={`sched-${idx}`}
                            className={`bg-slate-900/50 border p-6 rounded-2xl shadow-xl transition-all duration-300 relative overflow-hidden ${
                              matchedTask.completed ? 'opacity-40 border-slate-900/40' : 'border-slate-800 hover:border-slate-700/80'
                            }`}
                          >
                            <div className="absolute top-0 left-0 bottom-0 w-1.5 bg-indigo-500"></div>
                            
                            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pl-4">
                              <div className="space-y-1">
                                <div className="flex items-center gap-2">
                                  <span className="text-xs font-black text-indigo-300 bg-indigo-950/60 border border-indigo-900/50 px-2.5 py-1 rounded-md">
                                    {item.timeSlot}
                                  </span>
                                  {matchedTask.priority === 'Critical' && (
                                    <span className="text-[10px] font-black text-rose-300 bg-rose-950/60 border border-rose-900/40 px-2 py-0.5 rounded uppercase tracking-wider">
                                      Critical Priority
                                    </span>
                                  )}
                                </div>
                                <h4 className={`text-lg font-black mt-2 text-white ${matchedTask.completed ? 'line-through text-slate-500' : ''}`}>
                                  {matchedTask.title}
                                </h4>
                                <p className="text-slate-300 text-sm leading-relaxed">
                                  <strong>Focus Goal:</strong> {item.focusGoal}
                                </p>
                                <p className="text-slate-400 text-xs italic bg-slate-950/60 p-2.5 rounded-lg border border-slate-800/80 mt-2">
                                  "{item.reason}"
                                </p>
                              </div>

                              <div className="flex md:flex-col items-center md:items-end justify-between gap-2 shrink-0">
                                <span className={`text-[11px] font-bold px-2 py-1 rounded ${
                                  matchedTask.risk === 'High' ? 'text-rose-400 bg-rose-950/50 border border-rose-900/40' : 'text-slate-300 bg-slate-950'
                                }`}>
                                  Risk: {matchedTask.risk}
                                </span>
                                
                                <button
                                  onClick={() => toggleTaskStatus(matchedTask)}
                                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1 cursor-pointer border ${
                                    matchedTask.completed
                                      ? 'bg-slate-950 text-slate-400 border-slate-800 hover:bg-slate-900'
                                      : 'bg-indigo-600 text-white border-indigo-600 hover:bg-indigo-700 hover:shadow-indigo-500/20'
                                  }`}
                                >
                                  {matchedTask.completed ? (
                                    <>
                                      <Check className="w-3.5 h-3.5 animate-pulse" />
                                      <span>Completed</span>
                                    </>
                                  ) : (
                                    <span>Complete Task</span>
                                  )}
                                </button>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="bg-slate-900/40 border border-slate-850 rounded-2xl p-8 text-center shadow-xl">
                      <div className="animate-pulse space-y-4">
                        <div className="h-4 bg-slate-900 rounded w-1/4 mx-auto"></div>
                        <div className="h-10 bg-slate-900/60 rounded"></div>
                        <div className="h-10 bg-slate-900/60 rounded"></div>
                        <div className="h-10 bg-slate-900/60 rounded"></div>
                      </div>
                      <p className="text-slate-400 text-sm mt-4">
                        Computing optimal task timeline sequence using Gemini AI...
                      </p>
                    </div>
                  )}
                </div>

                {/* AI Plan Sidebar Advice */}
                <div className="space-y-6">
                  <h3 className="text-sm font-extrabold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-indigo-400" />
                    <span>AI Plan Insights</span>
                  </h3>

                  <div className="bg-gradient-to-b from-indigo-950/60 to-slate-900/60 border border-indigo-900/40 rounded-2xl p-6 flex flex-col space-y-6 shadow-xl">
                    <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center text-white shadow-md shadow-indigo-500/20">
                      <Zap className="w-5 h-5 animate-bounce" />
                    </div>

                    <div>
                      <h4 className="text-lg font-bold text-white mb-2">
                        {getGreeting()}, {currentUser?.name || 'User'}
                      </h4>
                      <p className="text-slate-300 text-sm leading-relaxed whitespace-pre-line">
                        {getStrategicAdvice()}
                      </p>
                    </div>

                    {aiAnalysis?.focusStrategy && (
                      <div className="border-t border-slate-800 pt-4">
                        <p className="text-[10px] font-bold uppercase tracking-widest text-indigo-400">Core Sprint Method</p>
                        <p className="text-white font-extrabold text-sm mt-1">{aiAnalysis.focusStrategy}</p>
                      </div>
                    )}
                  </div>

                  {/* Interactive pomodoro sprint */}
                  <div className="bg-slate-900/80 text-white rounded-2xl p-6 shadow-xl border border-slate-800">
                    <div className="flex justify-between items-center mb-3">
                      <p className="text-xs font-bold uppercase tracking-widest text-slate-400">Focus Session Helper</p>
                      <Flame className="w-4 h-4 text-orange-400 animate-pulse" />
                    </div>

                    {timerTask ? (
                      <div className="space-y-4">
                        <p className="text-xs font-semibold text-slate-300">Focus Target: <span className="text-white font-black">{timerTask.title}</span></p>
                        <div className="text-3.5xl font-mono font-black tracking-widest text-center py-2 text-indigo-400">
                          {Math.floor(timerSeconds / 60).toString().padStart(2, '0')}:
                          {(timerSeconds % 60).toString().padStart(2, '0')}
                        </div>
                        <div className="flex gap-2">
                          <button
                            onClick={() => setTimerActive(!timerActive)}
                            className="flex-1 py-2 bg-indigo-600 hover:bg-indigo-700 rounded-xl text-xs font-bold transition-all cursor-pointer text-center"
                          >
                            {timerActive ? 'Pause' : 'Start'}
                          </button>
                          <button
                            onClick={() => {
                              setTimerActive(false);
                              setTimerSeconds(25 * 60);
                            }}
                            className="p-2 bg-slate-800 hover:bg-slate-700 rounded-xl text-xs font-bold text-slate-400 transition-all cursor-pointer"
                          >
                            Reset
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div>
                        <p className="text-xs text-slate-300 mb-4 leading-relaxed">
                          Need momentum? Pick an active task below to start a focused 25-minute sprint block.
                        </p>
                        {tasks.filter((t) => !t.completed).length > 0 ? (
                          <div className="space-y-2">
                            {tasks.filter((t) => !t.completed).slice(0, 2).map((task) => (
                              <button
                                key={`timer-opt-${task.id}`}
                                onClick={() => {
                                  setTimerTask(task);
                                  setTimerSeconds(25 * 60);
                                  setTimerActive(true);
                                }}
                                className="w-full text-left p-2.5 bg-slate-800 hover:bg-slate-700 rounded-xl text-xs text-slate-200 font-bold flex justify-between items-center transition-all cursor-pointer"
                              >
                                <span className="truncate max-w-[150px]">{task.title}</span>
                                <ChevronRight className="w-3.5 h-3.5 text-indigo-400" />
                              </button>
                            ))}
                          </div>
                        ) : (
                          <p className="text-xs italic text-slate-500">No active tasks available.</p>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* TAB: ALL TASKS */}
            {activeTab === 'tasks' && (
              <div className="space-y-8">
                
                {/* Expandable/Sticky Task Creator Form */}
                <div id="task-creation-form" className="bg-slate-900/60 border border-slate-800 rounded-2xl p-6 shadow-xl backdrop-blur">
                  <div className="flex items-center justify-between border-b border-slate-800 pb-4 mb-4">
                    <h3 className="text-base font-black text-white flex items-center gap-2">
                      <Plus className="w-4 h-4 text-indigo-400" />
                      <span>Decompose a New Task with Gemini AI</span>
                    </h3>
                    <p className="text-xs text-slate-400 font-bold">
                      Automatically generates micro-steps, priority level & risks.
                    </p>
                  </div>

                  <form onSubmit={handleCreateTask} className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div className="md:col-span-2 space-y-1.5">
                        <label className="text-xs font-extrabold text-indigo-400">Task Title *</label>
                        <input
                          type="text"
                          required
                          value={newTitle}
                          onChange={(e) => setNewTitle(e.target.value)}
                          placeholder="e.g. Refactor Auth Middleware, Set Up Database Migration..."
                          className="w-full px-4 py-2.5 bg-slate-950 rounded-xl border border-slate-800 text-slate-100 placeholder:text-slate-650 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 text-sm font-medium"
                        />
                      </div>

                      <div className="space-y-1.5">
                        <label className="text-xs font-extrabold text-indigo-400">Difficulty Level *</label>
                        <select
                          value={newDifficulty}
                          onChange={(e) => setNewDifficulty(e.target.value as any)}
                          className="w-full px-4 py-2.5 bg-slate-950 rounded-xl border border-slate-800 text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 text-sm font-medium"
                        >
                          <option value="Easy" className="bg-slate-950">Easy (Light workload)</option>
                          <option value="Medium" className="bg-slate-950">Medium (Moderate workload)</option>
                          <option value="Hard" className="bg-slate-950">Hard (Deep intellect needed)</option>
                        </select>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div className="md:col-span-2 space-y-1.5">
                        <label className="text-xs font-extrabold text-indigo-400">Task Description</label>
                        <input
                          type="text"
                          value={newDescription}
                          onChange={(e) => setNewDescription(e.target.value)}
                          placeholder="Provide quick details or context for the AI to understand the task scale..."
                          className="w-full px-4 py-2.5 bg-slate-950 rounded-xl border border-slate-800 text-slate-100 placeholder:text-slate-650 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 text-sm font-medium"
                        />
                      </div>

                      <div className="space-y-1.5">
                        <label className="text-xs font-extrabold text-indigo-400">Deadline Date & Time *</label>
                        <input
                          type="datetime-local"
                          required
                          value={newDeadline}
                          onChange={(e) => setNewDeadline(e.target.value)}
                          className="w-full px-4 py-2.5 bg-slate-950 rounded-xl border border-slate-800 text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 text-sm font-medium"
                        />
                      </div>
                    </div>

                    <div className="flex justify-end pt-2">
                      <button
                        type="submit"
                        disabled={isCreatingTask}
                        className="bg-indigo-600 text-white px-6 py-2.5 rounded-xl font-bold text-sm shadow-lg shadow-indigo-950 hover:bg-indigo-700 hover:shadow-indigo-500/20 transition-all flex items-center gap-2 cursor-pointer disabled:opacity-60"
                      >
                        {isCreatingTask ? (
                          <>
                            <Loader2 className="w-4 h-4 animate-spin" />
                            <span>AI Decomposing...</span>
                          </>
                        ) : (
                          <>
                            <Sparkles className="w-4 h-4" />
                            <span>Analyze & Add Task</span>
                          </>
                        )}
                      </button>
                    </div>
                  </form>
                </div>

                {/* Task Priority Queues */}
                <div className="space-y-6">
                  <h3 className="text-sm font-extrabold text-slate-400 uppercase tracking-widest">Priority Queue ({tasks.length})</h3>

                  {isLoadingTasks ? (
                    <div className="text-center py-10">
                      <Loader2 className="w-8 h-8 animate-spin text-indigo-400 mx-auto mb-2" />
                      <p className="text-slate-400 text-xs">Loading tasks...</p>
                    </div>
                  ) : tasks.length === 0 ? (
                    <div className="bg-slate-900/60 border border-slate-800 p-10 rounded-2xl text-center shadow-xl">
                      <p className="text-slate-400 text-sm font-semibold">Your task list is empty. Get started by decomposing your first task!</p>
                    </div>
                  ) : (
                    <div className="space-y-6">
                      {tasks.map((task) => {
                        const doneCount = task.subtasks.filter((s) => s.completed).length;
                        const totalSteps = task.subtasks.length;
                        const taskProgressPercent = totalSteps > 0 ? Math.round((doneCount / totalSteps) * 100) : 0;

                        return (
                          <div
                            key={task.id}
                            className={`bg-slate-900/60 border rounded-2xl shadow-xl overflow-hidden transition-all duration-300 ${
                              task.completed ? 'opacity-40 border-slate-950' : 'border-slate-800 hover:border-slate-700/60 hover:shadow-indigo-950/20'
                            }`}
                          >
                            {/* Card Header */}
                            <div className="p-6 border-b border-slate-850 bg-slate-900/20">
                              <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
                                <div className="space-y-2">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <span className={`px-2 py-0.5 text-[10px] font-black rounded uppercase tracking-tighter border ${
                                      task.priority === 'Critical'
                                        ? 'bg-rose-950/60 text-rose-300 border-rose-900/40 shadow-sm shadow-rose-950/35'
                                        : task.priority === 'High'
                                        ? 'bg-orange-950/60 text-orange-300 border-orange-900/40'
                                        : task.priority === 'Medium'
                                        ? 'bg-indigo-950/60 text-indigo-300 border-indigo-900/40'
                                        : 'bg-slate-950 text-slate-300 border-slate-800'
                                    }`}>
                                      {task.priority} Priority
                                    </span>

                                    <span className={`px-2 py-0.5 text-[10px] font-black rounded uppercase tracking-tighter border ${
                                      task.difficulty === 'Hard'
                                        ? 'bg-rose-950/60 text-rose-300 border-rose-900/40'
                                        : task.difficulty === 'Medium'
                                        ? 'bg-indigo-950/60 text-indigo-300 border-indigo-900/40'
                                        : 'bg-emerald-950/60 text-emerald-300 border-emerald-900/40'
                                    }`}>
                                      {task.difficulty} Workload
                                    </span>
                                  </div>

                                  <h4 className={`text-xl font-black ${task.completed ? 'line-through text-slate-500' : 'text-white'}`}>
                                    {task.title}
                                  </h4>
                                  {task.description && (
                                    <p className="text-slate-300 text-sm leading-relaxed">{task.description}</p>
                                  )}
                                </div>

                                <div className="text-right md:min-w-[140px] space-y-1">
                                  <div className="flex items-center md:justify-end gap-1.5 text-xs font-bold text-slate-300">
                                    <Clock className="w-3.5 h-3.5 text-indigo-400" />
                                    <span>{getTimeRemaining(task.deadline)}</span>
                                  </div>
                                  <p className="text-[10px] text-slate-450 font-bold">
                                    Deadline: {formatDateNicely(task.deadline)}
                                  </p>
                                  
                                  <div className="inline-flex items-center gap-1.5 px-2 py-0.5 bg-slate-950 rounded border border-slate-800 text-[10px] font-bold text-slate-300 mt-2">
                                    <span>Risk: {task.risk}</span>
                                    <span className={`w-1.5 h-1.5 rounded-full ${task.risk === 'High' ? 'bg-red-500 animate-pulse' : task.risk === 'Medium' ? 'bg-orange-400' : 'bg-emerald-400'}`}></span>
                                  </div>
                                </div>
                              </div>

                              {/* Risk Assessment Block */}
                              <div className="mt-4 p-3.5 bg-slate-950 border border-slate-850/80 rounded-xl text-xs text-slate-300 flex items-start gap-2.5 leading-relaxed">
                                <Info className="w-4 h-4 text-indigo-400 shrink-0 mt-0.5" />
                                <div className="flex-1">
                                  <span className="font-extrabold uppercase text-[9px] tracking-wider text-indigo-400 block mb-0.5">Gemini AI Risk Assessment</span>
                                  <p className="font-medium italic">"{task.riskReason}"</p>
                                </div>
                              </div>

                              {/* AI Rescue Plan Button and Card */}
                              {task.risk === 'High' && !task.completed && (
                                <div className="mt-4">
                                  {!task.rescuePlan ? (
                                    <button
                                      onClick={() => generateRescuePlan(task.id)}
                                      disabled={generatingRescuePlanId === task.id}
                                      className="w-full bg-rose-600 hover:bg-rose-700 text-white py-3 px-4 rounded-xl font-bold text-xs flex items-center justify-center gap-2 transition-all cursor-pointer shadow-lg shadow-rose-950 hover:shadow-rose-500/20 disabled:opacity-60"
                                    >
                                      {generatingRescuePlanId === task.id ? (
                                        <>
                                          <Loader2 className="w-4 h-4 animate-spin text-white" />
                                          <span>Engineering Rescue Plan...</span>
                                        </>
                                      ) : (
                                        <>
                                          <Sparkles className="w-4 h-4 text-white animate-pulse" />
                                          <span className="font-extrabold">🚨 Generate Rescue Plan</span>
                                        </>
                                      )}
                                    </button>
                                  ) : (
                                    <div className="p-5 bg-slate-950 border border-rose-500/20 shadow-xl shadow-rose-950/20 rounded-2xl text-slate-100 relative overflow-hidden">
                                      <div className="absolute top-0 right-0 w-24 h-24 bg-rose-500/5 rounded-full -mr-6 -mt-6"></div>
                                      
                                      <div className="flex justify-between items-center mb-3">
                                        <div className="flex items-center gap-2">
                                          <span className="text-xs font-black text-rose-400 uppercase tracking-wider flex items-center gap-1">
                                            🚨 Rescue Plan
                                          </span>
                                          <span className="text-[9px] bg-rose-950/50 text-rose-300 border border-rose-900/30 font-extrabold px-2 py-0.5 rounded-full">
                                            Last-Minute Life Saver
                                          </span>
                                        </div>

                                        <button
                                          onClick={() => generateRescuePlan(task.id)}
                                          disabled={generatingRescuePlanId === task.id}
                                          className="text-[10px] font-bold text-rose-400 hover:text-rose-300 flex items-center gap-1 underline transition-all cursor-pointer"
                                        >
                                          {generatingRescuePlanId === task.id ? 'Regenerating...' : 'Re-analyze'}
                                        </button>
                                      </div>

                                      <div className="space-y-4">
                                        <div>
                                          <p className="text-[10px] text-rose-400/60 font-extrabold uppercase tracking-widest">Time Remaining</p>
                                          <p className="text-sm font-black text-rose-450">{task.rescuePlan.timeRemaining}</p>
                                        </div>

                                        <div>
                                          <p className="text-[10px] text-rose-400/60 font-extrabold uppercase tracking-widest mb-1.5">Action Priorities</p>
                                          <div className="space-y-1.5">
                                            {task.rescuePlan.priorityActions.map((action, actionIdx) => (
                                              <div key={`rescue-act-${actionIdx}`} className="flex items-start gap-2.5 bg-slate-900 p-2.5 rounded-xl border border-rose-950/40">
                                                <span className="w-5 h-5 rounded-full bg-rose-600 text-white flex items-center justify-center text-xs font-black shrink-0">
                                                  {actionIdx + 1}
                                                </span>
                                                <div className="flex-1 min-w-0">
                                                  <p className="text-xs font-bold text-white truncate">{action.title}</p>
                                                </div>
                                                <span className="text-[10px] font-mono text-rose-400 bg-rose-950/60 px-2 py-0.5 rounded font-black border border-rose-900/30">
                                                  {action.durationMinutes} min
                                                </span>
                                              </div>
                                            ))}
                                          </div>
                                        </div>

                                        {task.rescuePlan.skipActions && task.rescuePlan.skipActions.length > 0 && (
                                          <div>
                                            <p className="text-[10px] text-rose-400/60 font-extrabold uppercase tracking-widest mb-1.5">Items to Skip / Postpone</p>
                                            <div className="flex flex-wrap gap-1.5">
                                              {task.rescuePlan.skipActions.map((skip, skipIdx) => (
                                                <span key={`rescue-skip-${skipIdx}`} className="text-[9px] font-bold text-slate-400 bg-slate-900 border border-slate-800 px-2 py-0.5 rounded-lg flex items-center gap-1">
                                                  <span className="w-1 h-1 bg-slate-600 rounded-full"></span>
                                                  {skip}
                                                </span>
                                              ))}
                                            </div>
                                          </div>
                                        )}

                                        <div className="pt-2 border-t border-slate-800 flex items-center justify-between text-xs font-bold">
                                          <span className="text-slate-400">Estimated Completion Time:</span>
                                          <span className="text-rose-300 font-extrabold bg-rose-950/60 border border-rose-900/40 px-2 py-0.5 rounded-lg">
                                            ~ {Math.round(task.rescuePlan.estimatedMinutes / 60) > 0 
                                              ? `${Math.floor(task.rescuePlan.estimatedMinutes / 60)}h ${task.rescuePlan.estimatedMinutes % 60}m`
                                              : `${task.rescuePlan.estimatedMinutes} mins`}
                                          </span>
                                        </div>
                                      </div>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>

                            {/* Card Body - Subtasks list */}
                            <div className="p-6 bg-slate-900/40 border-b border-slate-850 space-y-3">
                              <div className="flex justify-between items-center mb-1">
                                <span className="text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center gap-1.5">
                                  <CheckSquare className="w-4 h-4 text-indigo-400" />
                                  <span>Decomposed Milestones</span>
                                </span>
                                <span className="text-xs font-extrabold text-indigo-400">
                                  {doneCount} of {totalSteps} tasks done ({taskProgressPercent}%)
                                </span>
                              </div>

                              {/* Progress bar */}
                              <div className="h-1.5 w-full bg-slate-950 rounded-full overflow-hidden mb-4">
                                <div className="h-full bg-indigo-500 transition-all duration-300" style={{ width: `${taskProgressPercent}%` }}></div>
                              </div>

                              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                {task.subtasks.map((sub) => (
                                  <button
                                    key={sub.id}
                                    onClick={() => toggleSubtask(task.id, sub.id)}
                                    className={`flex items-center gap-3 p-3 rounded-xl border text-left transition-all cursor-pointer ${
                                      sub.completed
                                        ? 'bg-slate-950 text-slate-500 border-slate-900/40'
                                        : 'bg-slate-950/80 border-slate-800 text-slate-200 hover:bg-slate-900 hover:border-slate-700'
                                    }`}
                                  >
                                    <div className={`w-5 h-5 rounded-md border flex items-center justify-center shrink-0 transition-all ${
                                      sub.completed
                                        ? 'bg-indigo-600 border-indigo-600 text-white'
                                        : 'border-slate-800 bg-slate-950'
                                    }`}>
                                      {sub.completed && <Check className="w-3.5 h-3.5" />}
                                    </div>
                                    <span className="text-xs font-semibold line-clamp-2">{sub.title}</span>
                                  </button>
                                ))}
                              </div>
                            </div>

                            {/* Card Footer - Controls */}
                            <div className="px-6 py-4 bg-slate-900/20 flex justify-between items-center">
                              <p className="text-[10px] text-slate-400 font-bold">
                                Estimated AI duration: {task.estimatedMinutes} mins
                              </p>

                              <div className="flex gap-2">
                                <button
                                  onClick={() => toggleTaskStatus(task)}
                                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer border ${
                                    task.completed
                                      ? 'bg-indigo-950/50 text-indigo-400 border-indigo-900/30'
                                      : 'bg-slate-950 text-slate-300 border-slate-800 hover:bg-slate-900'
                                  }`}
                                >
                                  {task.completed ? (
                                    <>
                                      <CheckCircle2 className="w-3.5 h-3.5 text-indigo-400" />
                                      <span>Mark Active</span>
                                    </>
                                  ) : (
                                    <>
                                      <Check className="w-3.5 h-3.5" />
                                      <span>Mark Complete</span>
                                    </>
                                  )}
                                </button>

                                <button
                                  onClick={() => deleteTask(task.id)}
                                  className="p-1.5 text-slate-400 hover:text-rose-400 hover:bg-rose-950/30 rounded-lg transition-all cursor-pointer"
                                  title="Delete Task"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* TAB: METRICS */}
            {activeTab === 'metrics' && (
              <div className="space-y-8">
                {/* Visual Dashboard Stats */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                  
                  {/* Progress Wheel Meter / Completion Ratio */}
                  <div className="bg-slate-900/60 border border-slate-800 p-6 rounded-2xl shadow-xl backdrop-blur text-center">
                    <h3 className="text-xs font-extrabold text-indigo-400 uppercase tracking-widest mb-6">Total Momentum</h3>
                    
                    <div className="relative w-36 h-36 mx-auto mb-6 flex items-center justify-center">
                      {/* SVG circle meter */}
                      <svg className="w-full h-full transform -rotate-90">
                        <circle
                          cx="72"
                          cy="72"
                          r="60"
                          stroke="#1e293b"
                          strokeWidth="10"
                          fill="transparent"
                        />
                        <circle
                          cx="72"
                          cy="72"
                          r="60"
                          stroke="#6366f1"
                          strokeWidth="10"
                          fill="transparent"
                          strokeDasharray={376.8}
                          strokeDashoffset={376.8 - (376.8 * completionPercentage) / 100}
                          className="transition-all duration-1000"
                        />
                      </svg>
                      <div className="absolute flex flex-col items-center">
                        <span className="text-3xl font-black tracking-tight text-white">{completionPercentage}%</span>
                        <span className="text-[9px] text-slate-400 font-bold uppercase tracking-wider">Completed</span>
                      </div>
                    </div>

                    <p className="text-xs text-slate-300 leading-relaxed font-semibold">
                      You completed <strong className="text-indigo-400">{completedTasks}</strong> tasks out of <strong className="text-indigo-400">{totalTasks}</strong> total.
                    </p>
                  </div>

                  {/* Task Workload Distribution */}
                  <div className="bg-slate-900/60 border border-slate-800 p-6 rounded-2xl shadow-xl backdrop-blur">
                    <h3 className="text-xs font-extrabold text-indigo-400 uppercase tracking-widest mb-4">Workload Difficulty</h3>
                    <div className="space-y-4 pt-2">
                      {['Hard', 'Medium', 'Easy'].map((diff) => {
                        const count = tasks.filter((t) => t.difficulty === diff).length;
                        const percentage = totalTasks > 0 ? Math.round((count / totalTasks) * 100) : 0;
                        return (
                          <div key={`metrics-diff-${diff}`} className="space-y-1">
                            <div className="flex justify-between text-xs font-bold text-slate-300">
                              <span>{diff} Workloads</span>
                              <span className="text-indigo-400 font-extrabold">{count} tasks ({percentage}%)</span>
                            </div>
                            <div className="h-2 w-full bg-slate-950 rounded-full overflow-hidden">
                              <div
                                className={`h-full ${
                                  diff === 'Hard' ? 'bg-rose-500' : diff === 'Medium' ? 'bg-indigo-500' : 'bg-emerald-500'
                                }`}
                                style={{ width: `${percentage}%` }}
                              ></div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* AI Deadline Risk Indicator */}
                  <div className="bg-slate-900/60 border border-slate-800 p-6 rounded-2xl shadow-xl backdrop-blur flex flex-col justify-between">
                    <div>
                      <h3 className="text-xs font-extrabold text-indigo-400 uppercase tracking-widest mb-4">Risk Levels Overview</h3>
                      <div className="grid grid-cols-3 gap-3 text-center">
                        <div className="p-3 bg-rose-950/30 border border-rose-900/40 rounded-xl">
                          <span className="text-xl font-black text-rose-400 block">
                            {tasks.filter((t) => t.risk === 'High').length}
                          </span>
                          <span className="text-[10px] text-rose-300 font-extrabold uppercase">High</span>
                        </div>
                        <div className="p-3 bg-orange-950/30 border border-orange-900/40 rounded-xl">
                          <span className="text-xl font-black text-orange-450 block">
                            {tasks.filter((t) => t.risk === 'Medium').length}
                          </span>
                          <span className="text-[10px] text-orange-300 font-extrabold uppercase">Medium</span>
                        </div>
                        <div className="p-3 bg-emerald-950/30 border border-emerald-900/40 rounded-xl">
                          <span className="text-xl font-black text-emerald-400 block">
                            {tasks.filter((t) => t.risk === 'Low').length}
                          </span>
                          <span className="text-[10px] text-emerald-300 font-extrabold uppercase">Low</span>
                        </div>
                      </div>
                    </div>

                    <div className="mt-4 p-3.5 bg-slate-950 border border-slate-850 rounded-xl text-xs text-slate-400 leading-relaxed font-medium italic">
                      "Gemini dynamically evaluates active timelines relative to your difficulty presets to calculate risks."
                    </div>
                  </div>
                </div>

                {/* Archive / Completed Queue */}
                <div className="space-y-4">
                  <h3 className="text-sm font-extrabold text-slate-400 uppercase tracking-widest">Completed Queue ({completedTasks})</h3>
                  {tasks.filter((t) => t.completed).length === 0 ? (
                    <div className="bg-slate-900/60 border border-slate-800 p-6 rounded-2xl text-center text-slate-400 text-sm shadow-xl">
                      No tasks completed yet. Complete your task sub-milestones to start filling your archive queue!
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {tasks
                        .filter((t) => t.completed)
                        .map((task) => (
                          <div
                            key={`completed-arch-${task.id}`}
                            className="bg-slate-900/40 border border-slate-850 p-4 rounded-xl flex items-center justify-between gap-4"
                          >
                            <div className="flex items-center gap-3">
                              <div className="w-8 h-8 bg-emerald-950/40 border border-emerald-900/30 rounded-full flex items-center justify-center text-emerald-400">
                                <Check className="w-4 h-4" />
                              </div>
                              <div>
                                <h4 className="text-sm font-extrabold text-slate-300 line-through">{task.title}</h4>
                                <p className="text-[10px] text-slate-500 font-semibold">
                                  Completed at: {task.completedAt ? formatDateNicely(task.completedAt) : 'Just now'}
                                </p>
                              </div>
                            </div>

                            <button
                              onClick={() => toggleTaskStatus(task)}
                              className="text-xs font-bold text-indigo-400 hover:text-indigo-300 transition-all px-3 py-1.5 hover:bg-slate-800 rounded-lg cursor-pointer border border-transparent hover:border-slate-800"
                            >
                              Restore
                            </button>
                          </div>
                        ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* TAB: INSIGHTS / AI PRODUCTIVITY LAB */}
            {activeTab === 'insights' && (
              <div className="space-y-8">
                {/* Big Recommendations banner */}
                <div className="bg-gradient-to-r from-indigo-950 to-slate-900/80 border border-indigo-900/40 text-white p-8 rounded-3xl relative overflow-hidden shadow-xl">
                  <div className="absolute right-0 bottom-0 top-0 w-1/3 opacity-10 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-white via-indigo-950 to-indigo-950"></div>
                  
                  <div className="max-w-2xl space-y-4 relative z-10">
                    <span className="inline-flex items-center gap-1 bg-indigo-500/20 text-indigo-200 px-3 py-1 rounded-full text-xs font-extrabold uppercase tracking-wide">
                      <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
                      <span>Gemini Intelligent Insight</span>
                    </span>

                    <h3 className="text-2xl font-black tracking-tight leading-tight">
                      Productivity Strategy & Optimal Execution
                    </h3>

                    <p className="text-slate-300 text-sm leading-relaxed">
                      {aiAnalysis?.recommendation || 'Based on your pending tasks, Gemini AI computes high-level workload grouping tactics, Pomodoro/sprinting structures, and mental models to accelerate your execution rate.'}
                    </p>

                    {aiAnalysis?.focusStrategy && (
                      <div className="inline-block p-3 bg-white/5 border border-white/10 rounded-xl text-xs font-bold text-indigo-300">
                        🔑 Action Method: {aiAnalysis.focusStrategy}
                      </div>
                    )}
                  </div>
                </div>

                {/* Performance lab modules */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  <div className="bg-slate-900/60 border border-slate-800 p-6 rounded-2xl shadow-xl backdrop-blur space-y-4">
                    <div className="flex items-center gap-2 mb-2">
                      <Zap className="w-5 h-5 text-indigo-400 animate-bounce" />
                      <h4 className="text-base font-black text-white">Task Chunking Strategy</h4>
                    </div>
                    <p className="text-sm text-slate-300 leading-relaxed">
                      Instead of focusing on large deadlines, complete tasks segment-by-segment. Gemini has already decomposed your tasks into clear individual checkboxes.
                    </p>
                    <div className="p-4 bg-slate-950 rounded-xl border border-slate-850/80 flex items-center gap-3">
                      <span className="text-lg font-black text-indigo-400">60%</span>
                      <p className="text-xs text-slate-300 leading-relaxed font-semibold">
                        Breakdowns of critical workloads help complete tasks up to 60% faster.
                      </p>
                    </div>
                  </div>

                  <div className="bg-slate-900/60 border border-slate-800 p-6 rounded-2xl shadow-xl backdrop-blur space-y-4">
                    <div className="flex items-center gap-2 mb-2">
                      <AlertTriangle className="text-orange-400 w-5 h-5 animate-pulse" />
                      <h4 className="text-base font-black text-white">Urgency & Friction Manager</h4>
                    </div>
                    <p className="text-sm text-slate-300 leading-relaxed">
                      High risk tasks can create intellectual friction. We recommend choosing a "Hard" workload task first thing in the morning when mental resources are full.
                    </p>
                    
                    <button
                      onClick={() => {
                        setActiveTab('tasks');
                        setIsCreatingTask(true);
                      }}
                      className="inline-flex items-center gap-1.5 text-xs text-indigo-400 font-extrabold hover:underline cursor-pointer"
                    >
                      <span>Review active queues</span>
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
