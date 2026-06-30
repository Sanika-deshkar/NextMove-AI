import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';

// Load environment variables immediately before any other imports
dotenv.config();

import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { connectDB, User, Task, MONGODB_URI } from './db.ts';

const resetCodes = new Map<string, { code: string; expires: number }>();

const getDirname = () => {
  if (typeof __dirname !== 'undefined') {
    return __dirname;
  }
  const getMetaUrl = new Function('return import.meta.url');
  return path.dirname(fileURLToPath(getMetaUrl()));
};
const currentDirname = getDirname();

// Password hashing helpers using bcryptjs
async function hashPassword(password: string): Promise<string> {
  return await bcrypt.hash(password, 10);
}

async function comparePassword(password: string, hash: string): Promise<boolean> {
  return await bcrypt.compare(password, hash);
}

// Extract userId from Authorization header
function getUserId(req: express.Request): string | null {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7);
  }
  return null;
}

// Initialize Gemini AI client lazily
let aiInstance: GoogleGenAI | null = null;
function getAI(): GoogleGenAI {
  if (!aiInstance) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY environment variable is required for AI features.');
    }
    aiInstance = new GoogleGenAI({ apiKey });
  }
  return aiInstance;
}

// Validate email format
function isValidEmail(email: string): boolean {
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return re.test(email);
}

// Sanitize string to prevent XSS (basic HTML/script tag stripping)
function sanitizeText(input: string): string {
  if (typeof input !== 'string') return '';
  return input.replace(/<[^>]*>/g, '').trim();
}

// Server-side validator for task creation
interface TaskInput {
  title: string;
  description: string;
  deadline: string;
  difficulty: string;
}

function validateTaskInput(data: any): { error?: string; value?: TaskInput } {
  let { title, description, deadline, difficulty } = data;

  if (!title || typeof title !== 'string' || !title.trim()) {
    return { error: 'Title is required and must be a valid non-empty string.' };
  }
  title = sanitizeText(title);
  if (title.length > 200) {
    return { error: 'Title cannot exceed 200 characters.' };
  }

  if (description !== undefined && description !== null) {
    if (typeof description !== 'string') {
      return { error: 'Description must be a string.' };
    }
    description = sanitizeText(description);
    if (description.length > 2000) {
      return { error: 'Description cannot exceed 2000 characters.' };
    }
  } else {
    description = '';
  }

  if (!deadline || typeof deadline !== 'string' || !deadline.trim()) {
    return { error: 'Deadline is required and must be a valid date string.' };
  }
  const parsedDate = Date.parse(deadline);
  if (isNaN(parsedDate)) {
    return { error: 'Deadline must be a valid date format.' };
  }

  const allowedDifficulties = ['Easy', 'Medium', 'Hard'];
  if (!difficulty || typeof difficulty !== 'string' || !allowedDifficulties.includes(difficulty)) {
    return { error: 'Difficulty must be one of: Easy, Medium, Hard.' };
  }

  return {
    value: {
      title,
      description,
      deadline,
      difficulty
    }
  };
}

// Server-side validator for task updating
function validateTaskUpdateInput(data: any): { error?: string; value?: any } {
  const allowedPriorities = ['Critical', 'High', 'Medium', 'Low'];
  const allowedRisks = ['Low', 'Medium', 'High'];

  const updates: any = {};

  if (data.title !== undefined) {
    if (typeof data.title !== 'string' || !data.title.trim()) {
      return { error: 'Title must be a valid non-empty string.' };
    }
    updates.title = sanitizeText(data.title);
    if (updates.title.length > 200) {
      return { error: 'Title cannot exceed 200 characters.' };
    }
  }

  if (data.description !== undefined) {
    if (typeof data.description !== 'string') {
      return { error: 'Description must be a string.' };
    }
    updates.description = sanitizeText(data.description);
    if (updates.description.length > 2000) {
      return { error: 'Description cannot exceed 2000 characters.' };
    }
  }

  if (data.deadline !== undefined) {
    if (typeof data.deadline !== 'string' || !data.deadline.trim()) {
      return { error: 'Deadline must be a valid string.' };
    }
    const parsedDate = Date.parse(data.deadline);
    if (isNaN(parsedDate)) {
      return { error: 'Deadline must be a valid date format.' };
    }
    updates.deadline = data.deadline;
  }

  if (data.difficulty !== undefined) {
    const allowedDifficulties = ['Easy', 'Medium', 'Hard'];
    if (typeof data.difficulty !== 'string' || !allowedDifficulties.includes(data.difficulty)) {
      return { error: 'Difficulty must be one of: Easy, Medium, Hard.' };
    }
    updates.difficulty = data.difficulty;
  }

  if (data.completed !== undefined) {
    if (typeof data.completed !== 'boolean') {
      return { error: 'Completed must be a boolean.' };
    }
    updates.completed = data.completed;
  }

  if (data.priority !== undefined) {
    if (typeof data.priority !== 'string' || !allowedPriorities.includes(data.priority)) {
      return { error: 'Priority must be one of: Critical, High, Medium, Low.' };
    }
    updates.priority = data.priority;
  }

  if (data.risk !== undefined) {
    if (typeof data.risk !== 'string' || !allowedRisks.includes(data.risk)) {
      return { error: 'Risk must be one of: Low, Medium, High.' };
    }
    updates.risk = data.risk;
  }

  if (data.riskReason !== undefined) {
    if (typeof data.riskReason !== 'string') {
      return { error: 'RiskReason must be a string.' };
    }
    updates.riskReason = sanitizeText(data.riskReason);
  }

  if (data.subtasks !== undefined) {
    if (!Array.isArray(data.subtasks)) {
      return { error: 'Subtasks must be an array.' };
    }
    const sanitizedSubtasks = [];
    for (const sub of data.subtasks) {
      if (!sub || typeof sub !== 'object') {
        return { error: 'Each subtask must be an object.' };
      }
      if (!sub.id || typeof sub.id !== 'string') {
        return { error: 'Each subtask must have a valid string id.' };
      }
      if (!sub.title || typeof sub.title !== 'string' || !sub.title.trim()) {
        return { error: 'Each subtask must have a valid non-empty title.' };
      }
      if (sub.completed !== undefined && typeof sub.completed !== 'boolean') {
        return { error: 'Subtask completed must be a boolean.' };
      }
      sanitizedSubtasks.push({
        id: sub.id,
        title: sanitizeText(sub.title),
        completed: !!sub.completed
      });
    }
    updates.subtasks = sanitizedSubtasks;
  }

  return { value: updates };
}

async function startServer() {
  // Connect to MongoDB (strictly required now, but handle failure gracefully to prevent container crash)
  try {
    await connectDB();
    console.log('🚀 MongoDB is fully active and being used for persistent storage.');
  } catch (error: any) {
    console.error('⚠️ Could not connect to MongoDB on startup:', error.message);
    console.log('⚠️ Server is starting anyway so Cloud Run can launch, but database queries will fail until connected.');
  }

  const app = express();
  app.use(express.json());

  // Auth API: Sign up
  app.post('/api/auth/signup', async (req, res) => {
    let { email, password, name } = req.body;

    if (!email || typeof email !== 'string' || !email.trim()) {
      return res.status(400).json({ error: 'Email is required.' });
    }
    if (!password || typeof password !== 'string' || password.length < 6) {
      return res.status(400).json({ error: 'Password is required and must be at least 6 characters.' });
    }
    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'Name is required.' });
    }

    email = email.trim().toLowerCase();
    password = password.trim();
    name = sanitizeText(name);

    if (!isValidEmail(email)) {
      return res.status(400).json({ error: 'Please enter a valid email address.' });
    }
    if (name.length > 100) {
      return res.status(400).json({ error: 'Name cannot exceed 100 characters.' });
    }

    console.log(`[Signup Attempt] Registering user: ${email}`);

    try {
      const existingUser = await User.findOne({ email });
      if (existingUser) {
        console.warn(`[Signup Attempt] Registration failed: email ${email} already exists.`);
        return res.status(400).json({ error: 'A user with this email already exists.' });
      }

      const id = 'user_' + Math.random().toString(36).substring(2, 11);
      const passwordHash = await hashPassword(password);

      console.log(`[Signup Attempt] Generated bcrypt hash for ${email}`);

      const newUser = new User({ id, email, passwordHash, name });
      await newUser.save();

      console.log(`[Signup Attempt] User ${email} registered successfully in MongoDB.`);

      return res.status(201).json({
        user: { id, email: newUser.email, name },
        token: id
      });
    } catch (error: any) {
      console.error(`[Signup Attempt] Error:`, error);
      res.status(500).json({ error: error.message });
    }
  });

  // Auth API: Log in
  app.post('/api/auth/login', async (req, res) => {
    let { email, password } = req.body;

    if (!email || typeof email !== 'string' || !email.trim()) {
      return res.status(400).json({ error: 'Email is required.' });
    }
    if (!password || typeof password !== 'string') {
      return res.status(400).json({ error: 'Password is required.' });
    }

    email = email.trim().toLowerCase();
    password = password.trim();

    if (!isValidEmail(email)) {
      return res.status(400).json({ error: 'Please enter a valid email address.' });
    }

    console.log(`[Login Attempt] Login request for: ${email}`);

    try {
      const user = await User.findOne({ email });
      if (!user) {
        console.warn(`[Login Attempt] No such user found in MongoDB for: ${email}`);
        return res.status(401).json({ error: 'Invalid email or password.' });
      }

      const isMatch = await comparePassword(password, user.passwordHash);
      if (!isMatch) {
        console.warn(`[Login Attempt] Password hash mismatch for user: ${email}`);
        return res.status(401).json({ error: 'Invalid email or password.' });
      }

      console.log(`[Login Attempt] User ${email} authenticated successfully in MongoDB.`);

      return res.json({
        user: { id: user.id, email: user.email, name: user.name },
        token: user.id
      });
    } catch (error: any) {
      console.error(`[Login Attempt] Error:`, error);
      res.status(500).json({ error: error.message });
    }
  });

  // Auth API: Direct Reset Password without OTP
  app.post('/api/auth/reset-password', async (req, res) => {
    let { email, newPassword } = req.body;

    if (!email || typeof email !== 'string' || !email.trim()) {
      return res.status(400).json({ error: 'Email is required.' });
    }
    if (!newPassword || typeof newPassword !== 'string' || newPassword.length < 6) {
      return res.status(400).json({ error: 'New password must be at least 6 characters.' });
    }

    email = email.trim().toLowerCase();
    newPassword = newPassword.trim();

    if (!isValidEmail(email)) {
      return res.status(400).json({ error: 'Please enter a valid email address.' });
    }

    console.log(`[Password Reset Attempt] Resetting password for: ${email}`);

    try {
      const passwordHash = await hashPassword(newPassword);
      console.log(`[Password Reset Attempt] New password hash generated.`);

      let user = await User.findOne({ email });
      if (!user) {
        console.log(`[Password Reset Attempt] No existing user found in MongoDB. Creating a new user: ${email}`);
        const id = 'user_' + Math.random().toString(36).substring(2, 11);
        user = new User({ id, email, passwordHash, name: email.split('@')[0] });
      } else {
        console.log(`[Password Reset Attempt] Found user in MongoDB. Updating passwordHash.`);
        user.passwordHash = passwordHash;
      }
      await user.save();
      console.log(`[Password Reset Attempt] User saved successfully in MongoDB.`);

      return res.json({
        success: true,
        message: 'Your password has been successfully updated!'
      });
    } catch (error: any) {
      console.error(`[Password Reset Attempt] Error:`, error);
      res.status(500).json({ error: error.message });
    }
  });

  // Auth API: Get current user
  app.get('/api/auth/me', async (req, res) => {
    const userId = getUserId(req);
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized. Invalid or missing token.' });
    }

    try {
      const user = await User.findOne({ id: userId });
      if (!user) {
        return res.status(404).json({ error: 'User not found.' });
      }

      return res.json({
        user: { id: user.id, email: user.email, name: user.name }
      });
    } catch (error: any) {
      console.error(`[/api/auth/me] Error:`, error);
      res.status(500).json({ error: error.message });
    }
  });

  // API: Get all tasks
  app.get('/api/tasks', async (req, res) => {
    try {
      const userId = getUserId(req);
      if (!userId) {
        return res.status(401).json({ error: 'Unauthorized. Invalid or missing token.' });
      }

      const userTasks = await Task.find({ userId });
      return res.json(userTasks);
    } catch (error: any) {
      console.error('[/api/tasks] GET error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // API: Create new task (with Gemini AI decomposing and predicting metrics)
  app.post('/api/tasks', async (req, res) => {
    const userId = getUserId(req);
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized. Invalid or missing token.' });
    }

    const validation = validateTaskInput(req.body);
    if (validation.error) {
      return res.status(400).json({ error: validation.error });
    }

    const { title, description, deadline, difficulty } = validation.value!;

    try {
      const currentIsoTime = new Date().toISOString();

      let aiDetails = {
        subtasks: [] as { id: string; title: string; completed: boolean }[],
        priority: 'Medium' as 'Critical' | 'High' | 'Medium' | 'Low',
        risk: 'Low' as 'Low' | 'Medium' | 'High',
        riskReason: 'No critical risk identified.',
        estimatedMinutes: 60,
      };

      try {
        const ai = getAI();
        const prompt = `
          Analyze this task and break it down for a user:
          Current Date/Time: ${currentIsoTime}
          Task Title: "${title}"
          Task Description: "${description || 'No description provided.'}"
          Difficulty Level: "${difficulty}" (Easy, Medium, Hard)
          Task Deadline: "${deadline}"

          Instructions:
          1. Decompose the task into 3-6 actionable, bite-sized subtasks. Keep each subtask specific and clear (no vague words like "do design").
          2. Calculate the priority ('Critical', 'High', 'Medium', 'Low') based on the complexity, difficulty, and time remaining until the deadline.
          3. Predict the deadline risk ('Low', 'Medium', 'High') and write a highly constructive risk assessment reason. Mention how the difficulty and remaining hours affect this risk.
          4. Estimate the total completion duration in minutes.
        `;

        const response = await ai.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: prompt,
          config: {
            responseMimeType: 'application/json',
            responseSchema: {
              type: 'OBJECT',
              properties: {
                subtasks: {
                  type: 'ARRAY',
                  items: {
                    type: 'OBJECT',
                    properties: {
                      title: { type: 'STRING' }
                    },
                    required: ['title']
                  }
                },
                priority: {
                  type: 'STRING',
                  enum: ['Critical', 'High', 'Medium', 'Low']
                },
                risk: {
                  type: 'STRING',
                  enum: ['Low', 'Medium', 'High']
                },
                riskReason: { type: 'STRING' },
                estimatedMinutes: { type: 'INTEGER' }
              },
              required: ['subtasks', 'priority', 'risk', 'riskReason', 'estimatedMinutes']
            }
          }
        });

        if (response.text) {
          const result = JSON.parse(response.text);
          aiDetails = {
            subtasks: (result.subtasks || []).map((s: any, idx: number) => ({
              id: `sub-${Date.now()}-${idx}`,
              title: sanitizeText(s.title),
              completed: false
            })),
            priority: result.priority || 'Medium',
            risk: result.risk || 'Low',
            riskReason: sanitizeText(result.riskReason) || 'No details provided.',
            estimatedMinutes: result.estimatedMinutes || 60
          };
        }
      } catch (aiError: any) {
        console.error('Gemini API Error, falling back to rules:', aiError.message);
        // Fallback rule-based generation if API Key is missing or error occurs
        const fallbackSubtasks = [
          { id: `sub-${Date.now()}-1`, title: 'Initial draft and setup', completed: false },
          { id: `sub-${Date.now()}-2`, title: 'Core implementation and development', completed: false },
          { id: `sub-${Date.now()}-3`, title: 'Final testing and adjustments', completed: false }
        ];
        aiDetails = {
          subtasks: fallbackSubtasks,
          priority: difficulty === 'Hard' ? 'High' : 'Medium',
          risk: 'Medium',
          riskReason: 'AI generation is currently in fallback mode. Please check your GEMINI_API_KEY.',
          estimatedMinutes: difficulty === 'Hard' ? 180 : 90
        };
      }

      const newTask = {
        id: `task-${Date.now()}`,
        userId,
        title,
        description: description || '',
        deadline,
        difficulty,
        priority: aiDetails.priority,
        risk: aiDetails.risk,
        riskReason: aiDetails.riskReason,
        estimatedMinutes: aiDetails.estimatedMinutes,
        completed: false,
        completedAt: null,
        subtasks: aiDetails.subtasks,
        createdAt: currentIsoTime,
      };

      const dbTask = new Task(newTask);
      await dbTask.save();
      return res.status(201).json(dbTask);
    } catch (error: any) {
      console.error('[/api/tasks] POST error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // API: Update task details
  app.put('/api/tasks/:id', async (req, res) => {
    const { id } = req.params;
    const userId = getUserId(req);
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized. Invalid or missing token.' });
    }

    const validation = validateTaskUpdateInput(req.body);
    if (validation.error) {
      return res.status(400).json({ error: validation.error });
    }

    const updates = validation.value!;

    try {
      const task = await Task.findOne({ id, userId });
      if (!task) {
        return res.status(404).json({ error: 'Task not found.' });
      }

      if (updates.completed !== undefined) {
        const updatedCompleted = updates.completed;
        task.completedAt = updatedCompleted && !task.completed ? new Date().toISOString() : (updatedCompleted ? task.completedAt : null);
        task.completed = updatedCompleted;
      }

      for (const key of Object.keys(updates)) {
        if (key !== 'completed') {
          (task as any)[key] = updates[key];
        }
      }

      if (updates.subtasks !== undefined) {
        task.markModified('subtasks');
      }

      await task.save();
      return res.json(task);
    } catch (error: any) {
      console.error('[/api/tasks/:id] PUT error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // API: Toggle a single subtask
  app.patch('/api/tasks/:id/subtasks/:subtaskId', async (req, res) => {
    const { id, subtaskId } = req.params;

    try {
      const userId = getUserId(req);
      if (!userId) {
        return res.status(401).json({ error: 'Unauthorized. Invalid or missing token.' });
      }

      const task = await Task.findOne({ id, userId });
      if (!task) {
        return res.status(404).json({ error: 'Task not found.' });
      }

      const subtask = task.subtasks.find((s: any) => s.id === subtaskId);
      if (!subtask) {
        return res.status(404).json({ error: 'Subtask not found.' });
      }

      subtask.completed = !subtask.completed;

      const allDone = task.subtasks.length > 0 && task.subtasks.every((s: any) => s.completed);
      if (allDone && !task.completed) {
        task.completed = true;
        task.completedAt = new Date().toISOString();
      } else if (!allDone && task.completed) {
        task.completed = false;
        task.completedAt = null;
      }

      task.markModified('subtasks');
      await task.save();
      return res.json(task);
    } catch (error: any) {
      console.error('[/api/tasks/:id/subtasks/:subtaskId] PATCH error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // API: Delete task
  app.delete('/api/tasks/:id', async (req, res) => {
    const { id } = req.params;

    try {
      const userId = getUserId(req);
      if (!userId) {
        return res.status(401).json({ error: 'Unauthorized. Invalid or missing token.' });
      }

      const result = await Task.deleteOne({ id, userId });
      if (result.deletedCount === 0) {
        return res.status(404).json({ error: 'Task not found.' });
      }
      return res.json({ success: true });
    } catch (error: any) {
      console.error('[/api/tasks/:id] DELETE error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // API: Generate Rescue Plan for a high-risk task
  app.post('/api/tasks/:id/rescue-plan', async (req, res) => {
    const { id } = req.params;

    try {
      const userId = getUserId(req);
      if (!userId) {
        return res.status(401).json({ error: 'Unauthorized. Invalid or missing token.' });
      }

      const task = await Task.findOne({ id, userId });
      if (!task) {
        return res.status(404).json({ error: 'Task not found.' });
      }

      const currentIsoTime = new Date().toISOString();
      let rescuePlan = {
        timeRemaining: "Overdue or near deadline",
        priorityActions: [
          { title: "Complete critical core integration", durationMinutes: 45 },
          { title: "Run quick functional testing", durationMinutes: 30 }
        ],
        skipActions: [
          "Comprehensive document update",
          "Code refactoring"
        ],
        estimatedMinutes: 75
      };

      try {
        const ai = getAI();
        const prompt = `
          Analyze this high-risk task and draft a dynamic "Deadline Rescue Plan" (Last-Minute Life Saver).
          The goal is to help the user complete the most critical work before the deadline and skip non-essential elements.

          Current Time: ${currentIsoTime}
          Task Title: "${task.title}"
          Task Description: "${task.description || 'No description'}"
          Task Deadline: "${task.deadline}"
          Difficulty: "${task.difficulty}"
          Pending Subtasks: ${JSON.stringify(task.subtasks.filter((s: any) => !s.completed))}

          Draft the rescue plan containing:
          1. Human-friendly time remaining string (e.g., "6 hours", "45 minutes").
          2. A prioritized list of actions to focus on (from the pending subtasks or critical next steps), including individual duration estimates in minutes.
          3. A list of non-essential things to explicitly SKIP (e.g., "Refactoring", "Documentation", "Writing exhaustive tests", "Polishing optional styles").
          4. Overall estimated minimum time in minutes to complete this rescue action sequence.

          Return a JSON object matching this structure:
          {
            "timeRemaining": "6 hours",
            "priorityActions": [
              { "title": "Priority action step...", "durationMinutes": 45 }
            ],
            "skipActions": [
              "Non-essential item to skip..."
            ],
            "estimatedMinutes": 75
          }
        `;

        const response = await ai.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: prompt,
          config: {
            responseMimeType: 'application/json',
            responseSchema: {
              type: 'OBJECT',
              properties: {
                timeRemaining: { type: 'STRING' },
                priorityActions: {
                  type: 'ARRAY',
                  items: {
                    type: 'OBJECT',
                    properties: {
                      title: { type: 'STRING' },
                      durationMinutes: { type: 'INTEGER' }
                    },
                    required: ['title', 'durationMinutes']
                  }
                },
                skipActions: {
                  type: 'ARRAY',
                  items: { type: 'STRING' }
                },
                estimatedMinutes: { type: 'INTEGER' }
              },
              required: ['timeRemaining', 'priorityActions', 'skipActions', 'estimatedMinutes']
            }
          }
        });

        if (response.text) {
          const parsed = JSON.parse(response.text);
          rescuePlan = {
            timeRemaining: sanitizeText(parsed.timeRemaining) || "Near deadline",
            priorityActions: (parsed.priorityActions || []).map((p: any) => ({
              title: sanitizeText(p.title),
              durationMinutes: Number(p.durationMinutes) || 15
            })),
            skipActions: (parsed.skipActions || []).map((s: any) => sanitizeText(s)),
            estimatedMinutes: Number(parsed.estimatedMinutes) || 30
          };
        }
      } catch (aiError: any) {
        console.error('Gemini API Rescue Plan Error:', aiError.message);
        // Fallback Rescue Plan
        const pending = task.subtasks.filter((s: any) => !s.completed);
        rescuePlan = {
          timeRemaining: "Overdue or near deadline",
          priorityActions: pending.length > 0 
            ? pending.map((s: any) => ({ title: s.title, durationMinutes: 30 }))
            : [{ title: "Focus on task core implementation", durationMinutes: 45 }],
          skipActions: ["Extensive documentation", "Refactoring", "Secondary testing"],
          estimatedMinutes: pending.length * 30 || 45
        };
      }

      // Save rescue plan to the task so it persists
      task.rescuePlan = rescuePlan;
      task.markModified('rescuePlan');
      await task.save();

      return res.json(rescuePlan);
    } catch (error: any) {
      console.error('[/api/tasks/:id/rescue-plan] POST error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // API: Get Dynamic Action Plan & Recommendations
  app.post('/api/ai/analyze', async (req, res) => {
    try {
      const userId = getUserId(req);
      if (!userId) {
        return res.status(401).json({ error: 'Unauthorized. Invalid or missing token.' });
      }

      const currentIsoTime = new Date().toISOString();
      const pendingTasks = await Task.find({ completed: false, userId });

      if (pendingTasks.length === 0) {
        return res.json({
          recommendation: "You have no pending tasks! Add a task to unlock customized AI recommendations.",
          schedule: [],
          focusStrategy: "No action needed. Enjoy your free time!",
          readiness: "Optimal"
        });
      }

      let aiResult = {
        recommendation: "Focus on organizing your task deadlines. Start with tasks that have high difficulty to clear intellectual bottlenecks.",
        focusStrategy: "Break your active tasks into dedicated 45-minute sprint blocks.",
        schedule: [] as { taskId: string; timeSlot: string; focusGoal: string; reason: string }[],
        readiness: "Good"
      };

      try {
        const ai = getAI();
        const taskSummary = pendingTasks.map(t => ({
          id: t.id,
          title: t.title,
          difficulty: t.difficulty,
          deadline: t.deadline,
          priority: t.priority,
          risk: t.risk,
          subtasksCount: t.subtasks.length
        }));

        const prompt = `
          Analyze the user's current pending tasks and generate:
          1. A dynamic, personalized Productivity Recommendation (e.g., strategic advice on how to batch or split work, psychological momentum tips).
          2. An overall Focus Strategy title/brief description.
          3. A Daily Action Schedule of up to 4 sequential time slots (e.g., "09:00 AM - 10:30 AM") mapped to specific tasks, stating a focusGoal and a reason.
          4. An AI Readiness rating ('Optimal', 'Good', 'Needs Focus', 'Critical Overload') based on total task weight and risks.

          Current Time: ${currentIsoTime}
          Pending Tasks: ${JSON.stringify(taskSummary)}

          Return a JSON object exactly matching this structure:
          {
            "recommendation": "The productivity strategy block...",
            "focusStrategy": "A specific sprint technique or batching method...",
            "readiness": "Optimal" | "Good" | "Needs Focus" | "Critical Overload",
            "schedule": [
              {
                "taskId": "the task id that matches one of the pending tasks",
                "timeSlot": "09:00 AM - 10:30 AM",
                "focusGoal": "Specify 1-2 subtasks to complete in this slot",
                "reason": "Why this task should be completed in this slot."
              }
            ]
          }
        `;

        const response = await ai.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: prompt,
          config: {
            responseMimeType: 'application/json',
            responseSchema: {
              type: 'OBJECT',
              properties: {
                recommendation: { type: 'STRING' },
                focusStrategy: { type: 'STRING' },
                readiness: {
                  type: 'STRING',
                  enum: ['Optimal', 'Good', 'Needs Focus', 'Critical Overload']
                },
                schedule: {
                  type: 'ARRAY',
                  items: {
                    type: 'OBJECT',
                    properties: {
                      taskId: { type: 'STRING' },
                      timeSlot: { type: 'STRING' },
                      focusGoal: { type: 'STRING' },
                      reason: { type: 'STRING' }
                    },
                    required: ['taskId', 'timeSlot', 'focusGoal', 'reason']
                  }
                }
              },
              required: ['recommendation', 'focusStrategy', 'readiness', 'schedule']
            }
          }
        });

        if (response.text) {
          const parsed = JSON.parse(response.text);
          aiResult = {
            recommendation: sanitizeText(parsed.recommendation),
            focusStrategy: sanitizeText(parsed.focusStrategy),
            readiness: parsed.readiness || "Good",
            schedule: (parsed.schedule || []).map((s: any) => ({
              taskId: sanitizeText(s.taskId),
              timeSlot: sanitizeText(s.timeSlot),
              focusGoal: sanitizeText(s.focusGoal),
              reason: sanitizeText(s.reason)
            }))
          };
        }
      } catch (aiError: any) {
        console.error('Gemini AI recommendations failed:', aiError.message);
        // Fallback recommendations
        aiResult = {
          recommendation: "Fallback Mode: Prioritize completing your 'Critical' and 'High' priority tasks first. Make sure to take small 5-minute breaks after completing each task block.",
          focusStrategy: "Standard Time Blocking (50/10 rule)",
          readiness: pendingTasks.some(t => t.risk === 'High') ? 'Needs Focus' : 'Good',
          schedule: pendingTasks.slice(0, 3).map((t, idx) => {
            const times = ["09:00 AM - 10:30 AM", "11:00 AM - 12:30 PM", "02:00 PM - 03:30 PM"];
            return {
              taskId: t.id,
              timeSlot: times[idx] || "04:00 PM - 05:00 PM",
              focusGoal: `Complete the first subtasks of ${t.title}`,
              reason: `To maintain momentum on your ${t.difficulty} task before the deadline.`
            };
          })
        };
      }

      return res.json(aiResult);
    } catch (error: any) {
      console.error('[/api/ai/analyze] POST error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Serve Vite in dev mode, or static files in production
  const getDistPath = () => {
    if (currentDirname.endsWith('dist') || currentDirname.endsWith('dist/')) {
      return currentDirname;
    }
    return path.join(currentDirname, 'dist');
  };
  const distPath = getDistPath();

  const isProd = process.env.NODE_ENV === 'production' || fs.existsSync(path.join(distPath, 'index.html'));

  if (!isProd) {
    console.log('⚡ Starting Vite in development middleware mode...');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    console.log('🚀 Serving static files in production mode from:', distPath);
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
  app.listen(port, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${port}`);
  });
}

startServer();
