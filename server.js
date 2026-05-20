const express = require('express');
const mongoose = require('mongoose');
const Groq = require('groq-sdk');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

// --- Express Middleware ---
app.use(express.json());
app.use(express.static('public'));

// --- Database Connection ---
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log("Connected to MongoDB successfully."))
  .catch(err => console.error("MongoDB Connection Failure:", err));

// --- Database Schema & Indexing ---
const chatSchema = new mongoose.Schema({
    sessionId: { type: String, required: true, index: true }, // Isolates user conversations
    role: { type: String, required: true, enum: ['user', 'assistant', 'system'] },
    content: { type: String, required: true },
    timestamp: { type: Date, default: Date.now }
});

// Compound index to make history lookups blazing fast
chatSchema.index({ sessionId: 1, timestamp: 1 });
const Message = mongoose.model('Message', chatSchema);

// --- Groq Client Initialization ---
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// --- System Prompts (Optimized for point-to-point, concise answers) ---
const QUESTION_PROMPT = `You are Lisine, a precise business expert. Your goal is to interview the user to build a flawless AI prompt. 
Analyze their inputs and ask exactly ONE deep, investigative question at a time regarding their audience, goals, USPs, or tone. 
Be exceptionally direct, sharp, and point-to-point. Avoid conversational filler or introductory fluff.`;

const GENERATE_FINAL_PROMPT = `Analyze the provided business interview history. Synthesize the findings into a single, high-quality, professional AI system prompt. 
The prompt must be concise, structured, and capture every requirement discussed. Output ONLY the final prompt text. Do not include introductions, explanations, or markdown code blocks.`;

// --- Core API Route ---
app.post('/api/chat', async (req, res) => {
    try {
        // Always pass a sessionId from your frontend (e.g., stored in localStorage or cookie)
        const { message, sessionId = 'default-session' } = req.body;

        if (!message) {
            return res.status(400).json({ error: "Message content is required" });
        }

        // 1. Save User Message to Database
        await Message.create({ sessionId, role: 'user', content: message });

        // 2. Check for Synthesis Trigger
        if (message.toLowerCase().includes('give me prompt back')) {
            // Fetch the exact history for this session ordered chronologically
            const rawHistory = await Message.find({ sessionId }).sort({ timestamp: 1 });
            const historyText = rawHistory.map(m => `${m.role}: ${m.content}`).join('\n');

            const completion = await groq.chat.completions.create({
                messages: [
                    { role: "system", content: GENERATE_FINAL_PROMPT },
                    { role: "user", content: `Interview History:\n${historyText}` }
                ],
                model: "llama3-70b-8192",
                temperature: 0.2, // Lower temperature keeps it tightly focused on instructions
            });

            const finalPrompt = completion.choices[0].message.content.trim();
            
            // Save generation to database history
            await Message.create({ sessionId, role: 'assistant', content: finalPrompt });
            return res.json({ reply: finalPrompt });
        }

        // 3. Normal Interview Flow (Fetch last 20 messages for context window)
        const recentMessages = await Message.find({ sessionId })
            .sort({ timestamp: -1 })
            .limit(20);

        // Map and reverse efficiently in memory to build correct timeline
        const formattedHistory = recentMessages
            .reverse()
            .map(m => ({
                role: m.role,
                content: m.content
            }));

        // Execute LLM completion call
        const chatCompletion = await groq.chat.completions.create({
            messages: [
                { role: "system", content: QUESTION_PROMPT },
                ...formattedHistory
            ],
            model: "llama3-8b-8192",
            temperature: 0.5
        });

        const aiReply = chatCompletion.choices[0].message.content.trim();

        // 4. Save AI Reply to Database
        await Message.create({ sessionId, role: 'assistant', content: aiReply });

        return res.json({ reply: aiReply });

    } catch (error) {
        console.error("API Error:", error);
        return res.status(500).json({ error: "Internal Server Error" });
    }
});

app.listen(port, () => console.log(`Lisine Engine active on port ${port}`));
