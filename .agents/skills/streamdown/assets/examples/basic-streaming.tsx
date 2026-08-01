"use client";

import { useChat } from "@ai-sdk/react";
import { Streamdown } from "streamdown";

export default function ChatPage() {
  const { messages, input, handleInputChange, handleSubmit, isLoading } =
    useChat();

  return (
    <div className="flex h-screen flex-col">
      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        {messages.map((message) => (
          <div
            className={message.role === "user" ? "text-right" : "text-left"}
            key={message.id}
          >
            <div className="inline-block max-w-2xl">
              <Streamdown
                isAnimating={isLoading && message.role === "assistant"}
              >
                {message.content}
              </Streamdown>
            </div>
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
