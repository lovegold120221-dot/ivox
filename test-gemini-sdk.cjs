const { GoogleGenAI } = require('@google/genai');
const ai = new GoogleGenAI({ apiKey: process.env.VITE_GEMINI_API_KEY });
ai.models.generateContent({
  model: 'gemini-2.5-flash-image',
  contents: 'photorealistic image of cat in the moon',
  config: { 
    responseModalities: ["IMAGE"],
    imageConfig: { aspectRatio: "1:1", imageOutputOptions: { mimeType: "image/png" } }
  }
}).then(r => console.log(Object.keys(r))).catch(console.error);
