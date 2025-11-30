"use client";

import { useState } from "react";
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism';

export default function CodePage() {
  const [code, setCode] = useState("");
  const [showInput, setShowInput] = useState(true);

  const handleSubmit = () => {
    if (code.trim()) {
      setShowInput(false);
    }
  };

  const handleEdit = () => {
    setShowInput(true);
  };

  return (
    <div className="min-h-screen bg-bg1 p-[100px]">
      {showInput && (
        <div className="fixed top-6 right-6 z-50">
          <div className="border-all-dashed-medium bg-white w-[500px]">
            <div className="p-4">
              <textarea
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="Paste your code here..."
                className="w-full h-[400px] p-3 font-berkeley-mono text-xs bg-white border-none resize-none focus:outline-none text-sand-1500"
              />
              <button
                onClick={handleSubmit}
                className="mt-3 w-full px-4 py-2 bg-sand-1500 text-white font-berkeley-mono text-xs hover:bg-sand-1400 transition-colors"
              >
                Show Code
              </button>
            </div>
          </div>
        </div>
      )}

      {!showInput && code && (
        <>
          <button
            onClick={handleEdit}
            className="fixed top-6 right-6 z-50 px-4 py-2 bg-white text-sand-1500 font-berkeley-mono text-xs hover:bg-sand-100 transition-colors"
          >
            Edit Code
          </button>
          
          <div className="max-w-5xl mx-auto">
            <div className="relative bg-gray-50 p-6">
              {/* Dashed crosshair lines forming a box around the code */}
              <svg 
                className="absolute pointer-events-none"
                style={{
                  left: '0%',
                  top: '0%',
                  transform: 'translate(-50%, -50%)',
                  width: '1000%',
                  height: '1000%'
                }}
              >
                {/* Horizontal line */}
                <line 
                  x1="0" 
                  y1="50%" 
                  x2="100%" 
                  y2="50%" 
                  className="stroke-border-low"
                  strokeWidth="1"
                  strokeDasharray="7 7"
                />
                {/* Vertical line */}
                <line 
                  x1="50%" 
                  y1="0" 
                  x2="50%" 
                  y2="100%" 
                  className="stroke-border-low"
                  strokeWidth="1"
                  strokeDasharray="7 7"
                />
              </svg>
              <svg 
                className="absolute pointer-events-none"
                style={{
                  left: '100%',
                  top: '100%',
                  transform: 'translate(-50%, -50%)',
                  width: '1000%',
                  height: '1000%'
                }}
              >
                {/* Horizontal line */}
                <line 
                  x1="0" 
                  y1="50%" 
                  x2="100%" 
                  y2="50%" 
                  className="stroke-border-low"
                  strokeWidth="1"
                  strokeDasharray="7 7"
                />
                {/* Vertical line */}
                <line 
                  x1="50%" 
                  y1="0" 
                  x2="50%" 
                  y2="100%" 
                  className="stroke-border-low"
                  strokeWidth="1"
                  strokeDasharray="7 7"
                />
              </svg>
              
              <SyntaxHighlighter
                language="typescript"
                style={oneLight}
                customStyle={{
                  margin: 0,
                  borderRadius: '0.5rem',
                  fontSize: '0.75rem',
                  lineHeight: '1.25rem',
                }}
                showLineNumbers
              >
                {code}
              </SyntaxHighlighter>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

