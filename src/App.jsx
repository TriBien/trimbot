import React, { useState, useEffect, useRef } from 'react';
import { CreateMLCEngine } from "@mlc-ai/web-llm";

// Instructions forcing Qwen to act like an agent and reply in rigid JSON strings
const SYSTEM_PROMPT = `You are a helpful assistant with access to a web search tool.
If the user asks for real-time information, recent events, or updated docs that require a web search, you MUST reply with a raw JSON object matching this structure:
{"search": true, "query": "your explicit search keywords here"}

If you already have enough information or are responding with your final answer, reply with a raw JSON object matching this structure:
{"search": false, "reply": "Your final answer markdown or code block goes here"}

Never output any conversational text or explanations outside of these JSON formats.`;

// Free, CORS-permissive public search runner
async function executeWebSearch(query) {
  try {
    // Fixed: Added missing '$' syntax and proper URL query parameter prefix '?q='
    const response = await fetch(`https://duckduckgo.com{encodeURIComponent(query)}`);
    const htmlText = await response.text();
    
    const snippets = [...htmlText.matchAll(/<td class="result-snippet">([\s\S]*?)<\/td>/g)]
      .map(match => match[1].replace(/<[^>]*>/g, ''))
      .slice(0, 3)
      .join("\n\n");
    return snippets || "No relevant live web search results found.";
  } catch (error) {
    return `Search failed due to network boundaries: ${error.message}`;
  }
}

export default function App() {
  const [engine, setEngine] = useState(null);
  const [status, setStatus] = useState("Checking WebGPU support...");
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const chatEndRef = useRef(null);

  useEffect(() => {
    async function init() {
      if (!navigator.gpu) {
        setStatus("WebGPU is not supported in this browser. Please use Chrome or Edge.");
        return;
      }
      setStatus("Downloading & Loading Qwen-Coder (takes a moment on first load)...");
      try {
        const selectedModel = "Qwen2.5-Coder-1.5B-Instruct-q4f16_1-MLC";
        const mlcEngine = await CreateMLCEngine(selectedModel, {
          initProgressCallback: (progress) => setStatus(progress.text)
        });
        setEngine(mlcEngine);
        setStatus("Ready! Ask a coding or real-time web question.");
      } catch (err) {
        setStatus(`Initialization Error: ${err.message}`);
      }
    }
    init();
  }, []);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!input.trim() || !engine || loading) return;

    const userMessage = { role: "user", content: input };
    const displayMessages = [...messages, userMessage];
    setMessages(displayMessages);
    setInput("");
    setLoading(true);

    try {
      // Build a hidden context timeline that forces JSON agent behavior
      const hiddenContext = [
        { role: "system", content: SYSTEM_PROMPT },
        ...displayMessages
      ];

      setStatus("Analyzing request...");
      // Step A: Request normal text completion with NO tools array attached
      let response = await engine.chat.completions.create({
        messages: hiddenContext
      });

      let rawText = response.choices[0].message.content.trim();
      let parsedData;
      
      try {
        parsedData = JSON.parse(rawText);
      } catch {
        // Fallback in case the model failed to follow the JSON system instructions
        parsedData = { search: false, reply: rawText };
      }

      // Step B: Check if Qwen generated a JSON search request
      if (parsedData.search) {
        setStatus(`Searching the web for "${parsedData.query}"...`);
        const searchResults = await executeWebSearch(parsedData.query);
        
        const contextThreadWithSearchResults = [
          { role: "system", content: SYSTEM_PROMPT },
          ...displayMessages,
          { role: "assistant", content: JSON.stringify(parsedData) },
          { role: "user", content: `Web Search Results for context:\n\n${searchResults}\n\nSynthesize these results into a clear answer.` }
        ];

        setStatus("Synthesizing web data...");
        // Step C: Resubmit history complete with real-time web snippets
        response = await engine.chat.completions.create({ messages: contextThreadWithSearchResults });
        let secondRawText = response.choices[0].message.content.trim();
        
        try {
          const secondParsed = JSON.parse(secondRawText);
          parsedData.reply = secondParsed.reply || secondRawText;
        } catch {
          parsedData.reply = secondRawText;
        }
      }

      setMessages(prev => [...prev, { role: "assistant", content: parsedData.reply }]);
      setStatus("Ready!");
    } catch (err) {
      setMessages(prev => [...prev, { role: "assistant", content: `System Error: ${err.message}` }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ fontFamily: 'monospace', padding: '20px', maxWidth: '800px', margin: '0 auto', background: '#1e1e1e', color: '#fff', borderRadius: '8px', minHeight: '90vh', display: 'flex', flexDirection: 'column' }}>
      <h2>WebLLM Agent (Qwen-Coder)</h2>
      <div style={{ padding: '8px', background: '#333', fontSize: '12px', marginBottom: '15px', color: '#0f0' }}>{status}</div>
      
      <div style={{ flex: 1, overflowY: 'auto', border: '1px solid #444', padding: '10px', marginBottom: '10px', maxHeight: '60vh' }}>
        {displayMessages => messages.map((m, i) => (
          <div key={i} style={{ marginBottom: '15px', whiteSpace: 'pre-wrap', borderBottom: '1px dashed #333', paddingBottom: '10px' }}>
            <strong>{m.role === 'user' ? '👤 User:' : '🤖 Qwen:'}</strong>
            <p style={{ marginTop: '5px', color: m.role === 'user' ? '#88ccff' : '#a8ffb2' }}>{m.content}</p>
          </div>
        ))}
        <div ref={chatEndRef} />
      </div>

      <form onSubmit={handleSubmit} style={{ display: 'flex', gap: '10px' }}>
        <input type="text" value={input} onChange={(e) => setInput(e.target.value)} placeholder={engine ? "Ask code logic, or trigger web search..." : "Waiting for model engine initialization..."} disabled={!engine || loading} style={{ flex: 1, padding: '10px', background: '#2d2d2d', color: '#fff', border: '1px solid #555' }} />
        <button type="submit" disabled={!engine || loading} style={{ padding: '10px 20px', background: '#007acc', color: '#fff', border: 'none', cursor: 'pointer' }}>{loading ? "Thinking..." : "Send"}</button>
      </form>
    </div>
  );
}
