import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs/promises';
import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';
import crypto from 'crypto';
import mongoose from 'mongoose';
import { connectDB, User, Task } from './db.ts';

// Load environment variables
dotenv.config();

let useMongo = false;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, 'data', 'tasks.json');
const USERS_PATH = path.join(__dirname, 'data', 'users.json');


// Ensure users database exists
async function ensureUsersDb() {
  try {
    await fs.mkdir(path.dirname(USERS_PATH), { recursive: true });
    await fs.access(USERS_PATH);
  } catch (err) {
    await fs.writeFile(USERS_PATH, JSON.stringify({ users: [] }, null, 2));
  }
}

// Read users
async function readUsers(): Promise<any[]> {
  await ensureUsersDb();
  const data = await fs.readFile(USERS_PATH, 'utf-8');
  const parsed = JSON.parse(data);
  return parsed.users || [];
}

// Write users
async function writeUsers(users: any[]): Promise<void> {
  await ensureUsersDb();
  await fs.writeFile(USERS_PATH, JSON.stringify({ users }, null, 2));
}

// Simple password hashing
function hashPassword(password: string): string {
  return crypto.createHash('sha256').update(password).digest('hex');
}

// Extract userId from Authorization header
function getUserId(req: express.Request): string {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7);
  }
  return 'default-demo-user';
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

// Ensure database file exists
async function ensureDb() {
  try {
    await fs.mkdir(path.dirname(DB_PATH), { recursive: true });
    await fs.access(DB_PATH);
  } catch (err) {
    // Write empty tasks array if file doesn't exist
    await fs.writeFile(DB_PATH, JSON.stringify({ tasks: [] }, null, 2));
  }
}

// Read tasks
async function readTasks(): Promise<any[]> {
  await ensureDb();
  const data = await fs.readFile(DB_PATH, 'utf-8');
  const parsed = JSON.parse(data);
  return parsed.tasks || [];
}

// Write tasks
async function writeTasks(tasks: any[]): Promise<void> {
  await ensureDb();
  await fs.writeFile(DB_PATH, JSON.stringify({ tasks }, null, 2));
}

// Helper to verify task ownership
function hasTaskAccess(task: any, userId: string): boolean {
  return task.userId === userId || (!task.userId && userId === 'default-demo-user');
}

async function startServer() {
  // Connect to MongoDB
  await connectDB();
  useMongo = !!process.env.MONGODB_URI && mongoose.connection.readyState === 1;
  if (!!process.env.MONGODB_URI && !useMongo) {
    console.warn('⚠️ MongoDB URI was provided but connection failed. Falling back to local JSON file storage.');
  } else if (useMongo) {
    console.log('🚀 MongoDB is fully active and being used for persistent storage.');
  }

  const app = express();
  app.use(express.json());

  // Auth API: Sign up
  app.post('/api/auth/signup', async (req, res) => {
    const { email, password, name } = req.body;
    if (!email || !password || !name) {
      return res.status(400).json({ error: 'Email, password, and name are required.' });
    }

    try {
      if (useMongo) {
        const existingUser = await User.findOne({ email: email.toLowerCase() });
        if (existingUser) {
          return res.status(400).json({ error: 'A user with this email already exists.' });
        }

        const id = 'user_' + Math.random().toString(36).substring(2, 11);
        const passwordHash = hashPassword(password);
        
        const newUser = new User({ id, email: email.toLowerCase(), passwordHash, name });
        await newUser.save();

        return res.status(201).json({
          user: { id, email: newUser.email, name },
          token: id
        });
      }

      const users = await readUsers();
      if (users.find(u => u.email.toLowerCase() === email.toLowerCase())) {
        return res.status(400).json({ error: 'A user with this email already exists.' });
      }

      const id = 'user_' + Math.random().toString(36).substring(2, 11);
      const passwordHash = hashPassword(password);
      
      const newUser = { id, email: email.toLowerCase(), passwordHash, name };
      users.push(newUser);
      await writeUsers(users);

      res.status(201).json({
        user: { id, email: newUser.email, name },
        token: id
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Auth API: Log in
  app.post('/api/auth/login', async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }

    try {
      if (useMongo) {
        const user = await User.findOne({ email: email.toLowerCase() });
        if (!user) {
          return res.status(401).json({ error: 'Invalid email or password.' });
        }

        const passwordHash = hashPassword(password);
        if (user.passwordHash !== passwordHash) {
          return res.status(401).json({ error: 'Invalid email or password.' });
        }

        return res.json({
          user: { id: user.id, email: user.email, name: user.name },
          token: user.id
        });
      }

      const users = await readUsers();
      const user = users.find(u => u.email.toLowerCase() === email.toLowerCase());
      if (!user) {
        return res.status(401).json({ error: 'Invalid email or password.' });
      }

      const passwordHash = hashPassword(password);
      if (user.passwordHash !== passwordHash) {
        return res.status(401).json({ error: 'Invalid email or password.' });
      }

      res.json({
        user: { id: user.id, email: user.email, name: user.name },
        token: user.id
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Auth API: Get current user
  app.get('/api/auth/me', async (req, res) => {
    const userId = getUserId(req);
    if (!userId || userId === 'default-demo-user') {
      return res.status(401).json({ error: 'Unauthorized.' });
    }

    try {
      if (useMongo) {
        const user = await User.findOne({ id: userId });
        if (!user) {
          return res.status(404).json({ error: 'User not found.' });
        }

        return res.json({
          user: { id: user.id, email: user.email, name: user.name }
        });
      }

      const users = await readUsers();
      const user = users.find(u => u.id === userId);
      if (!user) {
        return res.status(404).json({ error: 'User not found.' });
      }

      res.json({
        user: { id: user.id, email: user.email, name: user.name }
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // API: Get all tasks
  app.get('/api/tasks', async (req, res) => {
    try {
      const userId = getUserId(req);

      if (useMongo) {
        let userTasks = await Task.find({ userId });

        if (userTasks.length === 0) {
          const now = new Date();
          const seedTasks = [
            {
              id: `task-seed-1-${userId}`,
              userId,
              title: "Faculty Appraisal",
              description: "Draft achievements, list key research publications, align goals with department objectives, and complete the self-appraisal form for the annual faculty review process.",
              deadline: new Date(now.getTime() + 2 * 60 * 60 * 1000).toISOString().substring(0, 16), // Due in 2 hours
              difficulty: "Hard",
              priority: "Critical",
              risk: "High",
              riskReason: "The annual appraisal is due in less than 24 hours. Because of the high difficulty and tight deadline, it has the absolute highest risk level. Focus on this task first.",
              estimatedMinutes: 120,
              completed: false,
              completedAt: null,
              subtasks: [
                { id: `sub-seed-1-1-${userId}`, title: "Draft teaching achievements and research key metrics", completed: false },
                { id: `sub-seed-1-2-${userId}`, title: "Align teaching objectives with department curriculum guidelines", completed: false },
                { id: `sub-seed-1-3-${userId}`, title: "Submit appraisal and goals review form in the faculty portal", completed: false }
              ],
              createdAt: now.toISOString()
            },
            {
              id: `task-seed-2-${userId}`,
              userId,
              title: "Syllabus Update",
              description: "Revise undergraduate course syllabus, review and select textbooks, and compile course reading list for Next Semester.",
              deadline: new Date(now.getTime() + 6 * 60 * 60 * 1000).toISOString().substring(0, 16), // Due in 6 hours
              difficulty: "Medium",
              priority: "High",
              risk: "Medium",
              riskReason: "Due in 6 hours. While not as high risk as the Faculty Appraisal, the medium difficulty requires focused time blocking to complete today.",
              estimatedMinutes: 90,
              completed: false,
              completedAt: null,
              subtasks: [
                { id: `sub-seed-2-1-${userId}`, title: "Update course calendar dates and weekly schedule topics", completed: false },
                { id: `sub-seed-2-2-${userId}`, title: "Verify course textbook and reading material availability", completed: false }
              ],
              createdAt: now.toISOString()
            },
            {
              id: `task-seed-3-${userId}`,
              userId,
              title: "Academic Expense Reports",
              description: "Compile travel receipts, log academic travel allowances, and file reports for the recent research conference.",
              deadline: new Date(now.getTime() + 18 * 60 * 60 * 1000).toISOString().substring(0, 16), // Due in 18 hours
              difficulty: "Easy",
              priority: "Medium",
              risk: "Low",
              riskReason: "Low difficulty administrative task. Due tomorrow morning, providing a comfortable buffer.",
              estimatedMinutes: 45,
              completed: false,
              completedAt: null,
              subtasks: [
                { id: `sub-seed-3-1-${userId}`, title: "Scan conference travel receipts and flight boarding passes", completed: false },
                { id: `sub-seed-3-2-${userId}`, title: "Fill out expense ledger spreadsheet and log travel reimbursements", completed: false }
              ],
              createdAt: now.toISOString()
            }
          ];

          await Task.insertMany(seedTasks);
          userTasks = await Task.find({ userId });
        }

        return res.json(userTasks);
      }

      const tasks = await readTasks();
      let userTasks = tasks.filter(t => hasTaskAccess(t, userId));

      // Seed 3 highly realistic tasks if the user doesn't have any, matching the active workspace context
      if (userTasks.length === 0) {
        const now = new Date();
        const seedTasks = [
          {
            id: `task-seed-1-${userId}`,
            userId,
            title: "Faculty Appraisal",
            description: "Draft achievements, list key research publications, align goals with department objectives, and complete the self-appraisal form for the annual faculty review process.",
            deadline: new Date(now.getTime() + 2 * 60 * 60 * 1000).toISOString().substring(0, 16), // Due in 2 hours
            difficulty: "Hard",
            priority: "Critical",
            risk: "High",
            riskReason: "The annual appraisal is due in less than 24 hours. Because of the high difficulty and tight deadline, it has the absolute highest risk level. Focus on this task first.",
            estimatedMinutes: 120,
            completed: false,
            completedAt: null,
            subtasks: [
              { id: `sub-seed-1-1-${userId}`, title: "Draft teaching achievements and research key metrics", completed: false },
              { id: `sub-seed-1-2-${userId}`, title: "Align teaching objectives with department curriculum guidelines", completed: false },
              { id: `sub-seed-1-3-${userId}`, title: "Submit appraisal and goals review form in the faculty portal", completed: false }
            ],
            createdAt: now.toISOString()
          },
          {
            id: `task-seed-2-${userId}`,
            userId,
            title: "Syllabus Update",
            description: "Revise undergraduate course syllabus, review and select textbooks, and compile course reading list for Next Semester.",
            deadline: new Date(now.getTime() + 6 * 60 * 60 * 1000).toISOString().substring(0, 16), // Due in 6 hours
            difficulty: "Medium",
            priority: "High",
            risk: "Medium",
            riskReason: "Due in 6 hours. While not as high risk as the Faculty Appraisal, the medium difficulty requires focused time blocking to complete today.",
            estimatedMinutes: 90,
            completed: false,
            completedAt: null,
            subtasks: [
              { id: `sub-seed-2-1-${userId}`, title: "Update course calendar dates and weekly schedule topics", completed: false },
              { id: `sub-seed-2-2-${userId}`, title: "Verify course textbook and reading material availability", completed: false }
            ],
            createdAt: now.toISOString()
          },
          {
            id: `task-seed-3-${userId}`,
            userId,
            title: "Academic Expense Reports",
            description: "Compile travel receipts, log academic travel allowances, and file reports for the recent research conference.",
            deadline: new Date(now.getTime() + 18 * 60 * 60 * 1000).toISOString().substring(0, 16), // Due in 18 hours
            difficulty: "Easy",
            priority: "Medium",
            risk: "Low",
            riskReason: "Low difficulty administrative task. Due tomorrow morning, providing a comfortable buffer.",
            estimatedMinutes: 45,
            completed: false,
            completedAt: null,
            subtasks: [
              { id: `sub-seed-3-1-${userId}`, title: "Scan conference travel receipts and flight boarding passes", completed: false },
              { id: `sub-seed-3-2-${userId}`, title: "Fill out expense ledger spreadsheet and log travel reimbursements", completed: false }
            ],
            createdAt: now.toISOString()
          }
        ];

        tasks.push(...seedTasks);
        await writeTasks(tasks);
        userTasks = seedTasks;
      }

      res.json(userTasks);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // API: Create new task (with Gemini AI decomposing and predicting metrics)
  app.post('/api/tasks', async (req, res) => {
    const { title, description, deadline, difficulty } = req.body;

    if (!title || !deadline || !difficulty) {
      return res.status(400).json({ error: 'Title, deadline, and difficulty are required.' });
    }

    try {
      const currentIsoTime = new Date().toISOString();
      const userId = getUserId(req);

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
              title: s.title,
              completed: false
            })),
            priority: result.priority || 'Medium',
            risk: result.risk || 'Low',
            riskReason: result.riskReason || 'No details provided.',
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

      if (useMongo) {
        const dbTask = new Task(newTask);
        await dbTask.save();
        return res.status(201).json(dbTask);
      }

      const tasks = await readTasks();
      tasks.push(newTask);
      await writeTasks(tasks);

      res.status(201).json(newTask);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // API: Update task details
  app.put('/api/tasks/:id', async (req, res) => {
    const { id } = req.params;
    const { title, description, deadline, difficulty, completed, subtasks, priority, risk, riskReason } = req.body;

    try {
      const userId = getUserId(req);

      if (useMongo) {
        const task = await Task.findOne({ id, userId });
        if (!task) {
          return res.status(404).json({ error: 'Task not found.' });
        }

        const updatedCompleted = completed !== undefined ? completed : task.completed;

        task.title = title !== undefined ? title : task.title;
        task.description = description !== undefined ? description : task.description;
        task.deadline = deadline !== undefined ? deadline : task.deadline;
        task.difficulty = difficulty !== undefined ? difficulty : task.difficulty;
        task.completed = updatedCompleted;
        task.completedAt = updatedCompleted && !task.completed ? new Date().toISOString() : (updatedCompleted ? task.completedAt : null);
        task.subtasks = subtasks !== undefined ? subtasks : task.subtasks;
        task.priority = priority !== undefined ? priority : task.priority;
        task.risk = risk !== undefined ? risk : task.risk;
        task.riskReason = riskReason !== undefined ? riskReason : task.riskReason;

        task.markModified('subtasks');
        await task.save();
        return res.json(task);
      }

      const tasks = await readTasks();
      const taskIndex = tasks.findIndex(t => t.id === id && hasTaskAccess(t, userId));

      if (taskIndex === -1) {
        return res.status(404).json({ error: 'Task not found.' });
      }

      const existing = tasks[taskIndex];
      const updatedCompleted = completed !== undefined ? completed : existing.completed;

      tasks[taskIndex] = {
        ...existing,
        title: title !== undefined ? title : existing.title,
        description: description !== undefined ? description : existing.description,
        deadline: deadline !== undefined ? deadline : existing.deadline,
        difficulty: difficulty !== undefined ? difficulty : existing.difficulty,
        completed: updatedCompleted,
        completedAt: updatedCompleted && !existing.completed ? new Date().toISOString() : (updatedCompleted ? existing.completedAt : null),
        subtasks: subtasks !== undefined ? subtasks : existing.subtasks,
        priority: priority !== undefined ? priority : existing.priority,
        risk: risk !== undefined ? risk : existing.risk,
        riskReason: riskReason !== undefined ? riskReason : existing.riskReason,
      };

      await writeTasks(tasks);
      res.json(tasks[taskIndex]);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // API: Toggle a single subtask
  app.patch('/api/tasks/:id/subtasks/:subtaskId', async (req, res) => {
    const { id, subtaskId } = req.params;

    try {
      const userId = getUserId(req);

      if (useMongo) {
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
      }

      const tasks = await readTasks();
      const task = tasks.find(t => t.id === id && hasTaskAccess(t, userId));

      if (!task) {
        return res.status(404).json({ error: 'Task not found.' });
      }

      const subtask = task.subtasks.find((s: any) => s.id === subtaskId);
      if (!subtask) {
        return res.status(404).json({ error: 'Subtask not found.' });
      }

      subtask.completed = !subtask.completed;

      // Automatically recalculate task completion if all subtasks are finished (optional but delightful!)
      const allDone = task.subtasks.length > 0 && task.subtasks.every((s: any) => s.completed);
      if (allDone && !task.completed) {
        task.completed = true;
        task.completedAt = new Date().toISOString();
      } else if (!allDone && task.completed) {
        task.completed = false;
        task.completedAt = null;
      }

      await writeTasks(tasks);
      res.json(task);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // API: Delete task
  app.delete('/api/tasks/:id', async (req, res) => {
    const { id } = req.params;

    try {
      const userId = getUserId(req);

      if (useMongo) {
        const result = await Task.deleteOne({ id, userId });
        if (result.deletedCount === 0) {
          return res.status(404).json({ error: 'Task not found.' });
        }
        return res.json({ success: true });
      }

      const tasks = await readTasks();
      const taskIndex = tasks.findIndex(t => t.id === id && hasTaskAccess(t, userId));

      if (taskIndex === -1) {
        return res.status(404).json({ error: 'Task not found.' });
      }

      tasks.splice(taskIndex, 1);
      await writeTasks(tasks);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // API: Generate Rescue Plan for a high-risk task
  app.post('/api/tasks/:id/rescue-plan', async (req, res) => {
    const { id } = req.params;

    try {
      const userId = getUserId(req);

      let task;
      if (useMongo) {
        task = await Task.findOne({ id, userId });
      } else {
        const tasks = await readTasks();
        task = tasks.find(t => t.id === id && hasTaskAccess(t, userId));
      }

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
          rescuePlan = JSON.parse(response.text);
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
      if (useMongo) {
        task.rescuePlan = rescuePlan;
        task.markModified('rescuePlan');
        await task.save();
      } else {
        task.rescuePlan = rescuePlan;
        const tasks = await readTasks();
        const idx = tasks.findIndex(t => t.id === id);
        if (idx !== -1) {
          tasks[idx] = task;
          await writeTasks(tasks);
        }
      }

      res.json(rescuePlan);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // API: Get Dynamic Action Plan & Recommendations
  app.post('/api/ai/analyze', async (req, res) => {
    try {
      const userId = getUserId(req);
      const currentIsoTime = new Date().toISOString();

      let pendingTasks;
      if (useMongo) {
        pendingTasks = await Task.find({ completed: false, userId });
      } else {
        const tasks = await readTasks();
        pendingTasks = tasks.filter(t => !t.completed && hasTaskAccess(t, userId));
      }

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
          aiResult = JSON.parse(response.text);
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

      res.json(aiResult);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Serve Vite in dev mode, or static files in production
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, 'dist')));
    app.get('*', (req, res) => {
      res.sendFile(path.join(__dirname, 'dist', 'index.html'));
    });
  }

  const port = 3000;
  app.listen(port, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${port}`);
  });
}

startServer();
