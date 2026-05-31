const fetch = require('node-fetch'); // we can use global fetch in Node 18+
const apiKey = process.env.VITE_GEMINI_API_KEY;
fetch(`https://generativelanguage.googleapis.com/v1/publishers/google/models/gemini-2.5-flash-image:streamGenerateContent?key=${apiKey}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    contents: [{ role: "user", parts: [{ text: "photorealistic image of cat in the moon" }] }],
    generationConfig: {
      responseModalities: ["IMAGE"],
      imageConfig: { aspectRatio: "1:1", imageOutputOptions: { mimeType: "image/png" } }
    }
  })
}).then(async r => {
  console.log(r.status);
  console.log(await r.text());
}).catch(console.error);
