const express = require('express');
const mongoose = require('mongoose');
const Groq = require('groq-sdk');
const path = require('path');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

// --- Groq & MongoDB Setup ---
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log("Connected to MongoDB"))
  .catch(err => console.error("MongoDB Connection Error:", err));

// --- Database Schema ---
const chatSchema = new mongoose.Schema({
    role: String, // 'user' or 'assistant'
    content: String,
    timestamp: { type: Date, default: Date.now }
});
const Message = mongoose.model('Message', chatSchema);

app.use(express.json());
app.use(express.static('public'));

// --- System Prompts ---
const QUESTION_PROMPT = "You are Lisine, a business expert. Your goal is to interview the user to help them build a perfect AI prompt. Ask deep, investigative questions about their target audience, business goals, unique selling points, and tone. Ask only ONE question at a time to keep it professional.";

const GENERATE_FINAL_PROMPT = "Based on the following business interview history, synthesize all the information into a single, high-quality, professional AI system prompt. The prompt should be concise yet cover every detail discussed. Output ONLY the final prompt.";

// --- API Routes ---
app.post('/api/chat', async (req, res) => {
    try {
        const { message } = req.body;

        // 1. Save User Message to DB
        const userMsg = new Message({ role: 'user', content: message });
        await userMsg.save();

        // 2. Check if user wants the final prompt
        if (message.toLowerCase().includes('give me prompt back')) {
            const allHistory = await Message.find().sort({ timestamp: 1 });
            const historyText = allHistory.map(m => `${m.role}: ${m.content}`).join('\n');

            const completion = await groq.chat.completions.create({
                messages: [
                    { role: "system", content: GENERATE_FINAL_PROMPT },
                    { role: "user", content: `Here is the business data:\n${historyText}` }
                ],
                model: "llama3-70b-8192",
            });

            const finalPrompt = completion.choices[0].message.content;
            const aiMsg = new Message({ role: 'assistant', content: finalPrompt });
            await aiMsg.save();
            return res.json({ reply: finalPrompt });
        }

        // 3. Normal questioning flow (Retrieve last 25 messages)
        const recentHistory = await Message.find()
            .sort({ timestamp: -1 })
            .limit(25);
        
        // Reverse because we queried them in descending order
        const formattedHistory = recentHistory.reverse().map(m => ({
            role: m.role,
            content: m.content
        }));

        const chatCompletion = await groq.chat.completions.create({
            messages: [
                { role: "system", content: QUESTION_PROMPT },
                ...formattedHistory
            ],
            model: "llama3-8b-8192",
        });

        const aiReply = chatCompletion.choices[0].message.content;
        
        // 4. Save AI Response to DB
        const aiResponse = new Message({ role: 'assistant', content: aiReply });
        await aiResponse.save();

        res.json({ reply: aiReply });

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Server Error" });
    }
});

app.listen(port, () => console.log(`Lisine running on port ${port}`));
