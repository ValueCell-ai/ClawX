"use client";

import { useChat } from "@ai-sdk/react";
import { code } from "@streamdown/code";
import { Streamdown } from "streamdown";

export default function ChatWithCaret() {
  const { messages, input, handleInputChange, handleSubmit, isLoading } =
    useChat();

  return (
    <div className="flex h-screen flex-col">
      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        {messages.map((message, index) => (
          <div key={message.id}>
            <Streamdown
              caret="block"
              isAnimating={
                isLoading &&
                index === messages.length - 1 &&
                message.role === "assistant"
              }
              plugins={{ code }}
            >
              {message.content}
            </Streamdown>
          </div>
        ))}
      </div>

      <form className="border-t p-4" onSubmit={handleSubmit}>
        <input
          className="w-full rounded-lg border px-4 py-2"
          disabled={isLoading}
          onChange={handleInputChange}
          placeholder="Ask me anything..."
          value={input}
        />
      </form>
    </div>
  );
}
