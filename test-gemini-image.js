const apiKey = process.env.VITE_GEMINI_API_KEY || process.env.GEMINI_API_KEY;
fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    contents: [{ role: "user", parts: [{ text: "photorealistic image of cat in the moon" }] }],
    generationConfig: {
      responseModalities: ["IMAGE"],
      imageConfig: { aspectRatio: "1:1", imageOutputOptions: { mimeType: "image/png" } }
    }
  })
}).then(r => r.json()).then(console.log).catch(console.error);
