const express = require('express');
const Groq = require('groq-sdk');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

// --- Express Middleware ---
app.use(express.json());
app.use(express.static('public'));

// --- Groq Client Initialization ---
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// --- In-Memory Session Storage ---
// This temporary storage acts as a local cache to track conversation histories per user
const chatHistories = new Map();

// --- System Prompts (Point-to-Point, Concise) ---
const QUESTION_PROMPT = `You are Lisine, a precise business expert. Your goal is to interview the user to build a flawless AI prompt. 
Analyze their inputs and ask exactly ONE deep, investigative question at a time regarding their audience, goals, USPs, or tone. 
Be exceptionally direct, sharp, and point-to-point. Avoid conversational filler or introductory fluff.`;

const GENERATE_FINAL_PROMPT = `Analyze the provided business interview history. Synthesize the findings into a single, high-quality, professional AI system prompt. 
The prompt must be concise, structured, and capture every requirement discussed. Output ONLY the final prompt text. Do not include introductions, explanations, or markdown code blocks.`;

// --- Core API Route ---
app.post('/api/chat', async (req, res) => {
    try {
        const { message, sessionId = 'default-session' } = req.body;

        if (!message) {
            return res.status(400).json({ error: "Message content is required" });
        }

        // Initialize history array for this session if it doesn't exist yet
        if (!chatHistories.has(sessionId)) {
            chatHistories.set(sessionId, []);
        }

        const sessionHistory = chatHistories.get(sessionId);

        // 1. Save User Message to RAM history array
        sessionHistory.push({ role: 'user', content: message });

        // 2. Check for Synthesis Trigger
        if (message.toLowerCase().includes('give me prompt back')) {
            const historyText = sessionHistory.map(m => `${m.role}: ${m.content}`).join('\n');

            const completion = await groq.chat.completions.create({
                messages: [
                    { role: "system", content: GENERATE_FINAL_PROMPT },
                    { role: "user", content: `Interview History:\n${historyText}` }
                ],
                model: "llama3-70b-8192",
                temperature: 0.2,
            });

            const finalPrompt = completion.choices[0].message.content.trim();
            
            // Save generation to history
            sessionHistory.push({ role: 'assistant', content: finalPrompt });
            return res.json({ reply: finalPrompt });
        }

        // 3. Normal Interview Flow (Limit history window context to last 20 elements)
        const recentMessages = sessionHistory.slice(-20);

        // Execute LLM completion call
        const chatCompletion = await groq.chat.completions.create({
            messages: [
                { role: "system", content: QUESTION_PROMPT },
                ...recentMessages
            ],
            model: "llama3-8b-8192",
            temperature: 0.5
        });

        const aiReply = chatCompletion.choices[0].message.content.trim();

        // 4. Save AI Reply to RAM history array
        sessionHistory.push({ role: 'assistant', content: aiReply });

        return res.json({ reply: aiReply });

    } catch (error) {
        console.error("API Error:", error);
        return res.status(500).json({ error: "Internal Server Error" });
    }
});

app.listen(port, () => console.log(`Lisine Engine active on port ${port}`));
