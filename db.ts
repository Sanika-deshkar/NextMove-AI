import mongoose from 'mongoose';

function sanitizeURI(uri: string): string {
  let cleaned = uri.trim();
  // Remove wrapping quotes if present
  if ((cleaned.startsWith('"') && cleaned.endsWith('"')) || (cleaned.startsWith("'") && cleaned.endsWith("'"))) {
    cleaned = cleaned.slice(1, -1).trim();
  }
  
  const lastAt = cleaned.lastIndexOf('@');
  if (lastAt !== -1) {
    const postAt = cleaned.substring(lastAt);
    const hashIndex = postAt.indexOf('#');
    if (hashIndex !== -1) {
      cleaned = cleaned.substring(0, lastAt + hashIndex);
    }
  } else {
    const hashIndex = cleaned.indexOf('#');
    if (hashIndex !== -1) {
      cleaned = cleaned.substring(0, hashIndex);
    }
  }
  return cleaned.trim();
}

function maskURI(uri: string): string {
  try {
    const match = uri.match(/^(mongodb(?:\+srv)?:\/\/[^:]+:)([^@]+)(@.+)$/);
    if (match) {
      return `${match[1]}******${match[3]}`;
    }
    return uri;
  } catch (e) {
    return uri;
  }
}

const rawURI = process.env.MONGODB_URI;
const MONGODB_URI = rawURI ? sanitizeURI(rawURI) : undefined;

export async function connectDB() {
  if (!MONGODB_URI) {
    console.warn('⚠️ MONGODB_URI environment variable is missing. Database operations will fail.');
    return;
  }
  try {
    console.log(`Connecting to MongoDB at: ${maskURI(MONGODB_URI)}`);
    // Disable command buffering so queries fail fast if the connection is down
    mongoose.set('bufferCommands', false);
    await mongoose.connect(MONGODB_URI, {
      serverSelectionTimeoutMS: 5000, // Timeout after 5 seconds instead of 30 seconds
    });
    console.log('✅ Connected to MongoDB successfully.');
  } catch (error) {
    console.error('❌ Failed to connect to MongoDB:', error);
  }
}

// Subtask Schema
const subtaskSchema = new mongoose.Schema({
  id: { type: String, required: true },
  title: { type: String, required: true },
  completed: { type: Boolean, default: false }
}, { _id: false });

// Rescue Plan Schema
const rescuePlanSchema = new mongoose.Schema({
  timeRemaining: { type: String },
  priorityActions: [{
    title: { type: String },
    durationMinutes: { type: Number }
  }],
  skipActions: [{ type: String }],
  estimatedMinutes: { type: Number }
}, { _id: false });

// Task Schema
const taskSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  userId: { type: String, required: true },
  title: { type: String, required: true },
  description: { type: String, default: '' },
  deadline: { type: String, required: true },
  difficulty: { type: String, required: true },
  priority: { type: String, default: 'Medium' },
  risk: { type: String, default: 'Low' },
  riskReason: { type: String, default: '' },
  estimatedMinutes: { type: Number, default: 60 },
  completed: { type: Boolean, default: false },
  completedAt: { type: String, default: null },
  subtasks: { type: [subtaskSchema], default: [] },
  rescuePlan: { type: rescuePlanSchema, default: null },
  createdAt: { type: String, required: true }
}, {
  timestamps: true,
  toJSON: {
    transform: (doc, ret) => {
      const anyRet = ret as any;
      delete anyRet._id;
      delete anyRet.__v;
      return anyRet;
    }
  }
});

// User Schema
const userSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  email: { type: String, required: true, unique: true, lowercase: true },
  passwordHash: { type: String, required: true },
  name: { type: String, required: true }
}, {
  timestamps: true,
  toJSON: {
    transform: (doc, ret) => {
      const anyRet = ret as any;
      delete anyRet._id;
      delete anyRet.__v;
      return anyRet;
    }
  }
});

export const Task: mongoose.Model<any> = mongoose.models.Task || mongoose.model('Task', taskSchema);
export const User: mongoose.Model<any> = mongoose.models.User || mongoose.model('User', userSchema);
