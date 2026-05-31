const { GoogleGenAI } = require('@google/genai');
const ai = new GoogleGenAI({ apiKey: process.env.VITE_GEMINI_API_KEY });
ai.models.generateContent({
  model: 'gemini-2.5-flash',
  contents: 'photorealistic image of cat in the moon',
  config: { responseModalities: ["IMAGE"] }
}).then(r => console.log(Object.keys(r), r.candidates[0].content.parts[0])).catch(console.error);
