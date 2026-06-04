import React, { useState, useEffect, useRef } from 'react';
import { CreateMLCEngine } from "@mlc-ai/web-llm";

// 1. Tool schema to teach Qwen when and how to request a web search
const tools = [{
  type: "function",
  function: {
    name: "web_search",
    description: "Search the live web for real-time information, news, current events, or coding documentation changes.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "The search query (e.g., 'React 19 release features')" }
      },
      required: ["query"]
    }
  }
}];

// 2. Free, CORS-permissive public search runner
async function executeWebSearch(query) {
  try {
    const response = await fetch(`https://duckduckgo.com{encodeURIComponent(query)}`);
    const htmlText = await response.text();
    // Simple regex extraction to pull raw text out of DuckDuckGo's static HTML fallback
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

  // Initialize WebLLM Engine on Mount
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
    const updatedMessages = [...messages, userMessage];
    setMessages(updatedMessages);
    setInput("");
    setLoading(true);

    try {
      // Step A: Send request to Qwen with tool definitions attached
      let response = await engine.chat.completions.create({
        messages: updatedMessages,
        tools: tools,
        tool_choice: "auto"
      });

      let responseMessage = response.choices[0].message;

      // Step B: Check if Qwen decided to execute a web search tool
      if (responseMessage.tool_calls && responseMessage.tool_calls.length > 0) {
        setStatus("Searching the web for live answers...");
        const toolCall = responseMessage.tool_calls[0];
        const { query } = JSON.parse(toolCall.function.arguments);
        
        const searchResults = await executeWebSearch(query);
        
        // Append tool interactions back into context thread history
        const contextThread = [
          ...updatedMessages,
          responseMessage,
          {
            role: "tool",
            name: "web_search",
            tool_call_id: toolCall.id,
            content: `Web Search Results for "${query}":\n\n${searchResults}`
          }
        ];

        setStatus("Synthesizing web data...");
        // Step C: Resubmit history complete with real-time web snippets
        response = await engine.chat.completions.create({ messages: contextThread });
        responseMessage = response.choices[0].message;
      }

      setMessages(prev => [...prev, { role: "assistant", content: responseMessage.content }]);
      setStatus("Ready!");
    } catch (err) {
      setMessages(prev => [...prev, { role: "assistant", content: `System Error: ${err.message}` }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ fontFamily: 'monospace', padding: '20px', maxWidtH: '800px', margin: '0 auto', background: '#1e1e1e', color: '#fff', borderRadius: '8px', minHeight: '90vh', display: 'flex', flexDirection: 'column' }}>
      <h2>WebLLM Agent (Qwen-Coder + Web Search)</h2>
      <div style={{ padding: '8px', background: '#333', fontSize: '12px', marginBottom: '15px', color: '#0f0' }}>{status}</div>
      
      <div style={{ flex: 1, overflowY: 'auto', border: '1px solid #444', padding: '10px', marginBottom: '10px', maxHeight: '60vh' }}>
        {messages.map((m, i) => (
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
