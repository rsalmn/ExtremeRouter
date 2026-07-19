"use client";

import PropTypes from "prop-types";
import { useEffect, useRef } from "react";
import { EmptyState } from "@/shared/components";
import MessageContent from "./MessageContent";

export default function ChatArea({ messages, onSend, streaming }) {
  const scrollRef = useRef(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  if (messages.length === 0) {
    return (
      <div className="flex min-h-[300px] flex-1 items-center justify-center">
        <EmptyState
          icon="science"
          title="Start a conversation"
          description="Pick a model above, type a message below, and press Enter. Switch to Compare mode to test multiple models side-by-side."
        />
      </div>
    );
  }

  return (
    <div
      ref={scrollRef}
      className="custom-scrollbar flex max-h-[60vh] min-h-[200px] flex-1 flex-col gap-3 overflow-y-auto rounded-brand border border-border-subtle bg-panel p-4"
    >
      {messages.map((msg) => (
        <MessageBubble key={msg.id} msg={msg} />
      ))}
    </div>
  );
}

function MessageBubble({ msg }) {
  const isUser = msg.role === "user";
  const isError = msg.error;

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm ${
          isUser
            ? "bg-primary text-white"
            : isError
              ? "bg-danger/10 text-danger border border-danger/20"
              : "bg-surface-2 text-text-main"
        }`}
      >
        {msg.model && !isUser && (
          <div className="mb-1 text-[10px] font-medium text-text-muted">
            {msg.model}
          </div>
        )}
        {msg.reasoning && (
          <details className="mb-1.5 rounded bg-black/5 px-2 py-1 dark:bg-white/5">
            <summary className="cursor-pointer text-[10px] font-medium text-text-muted">
              Reasoning
            </summary>
            <p className="mt-1 whitespace-pre-wrap break-words text-xs italic text-text-muted">
              {msg.reasoning}
            </p>
          </details>
        )}
        {isUser && msg.attachments && msg.attachments.length > 0 && (
          <div className="mb-1.5 flex flex-wrap gap-1.5">
            {msg.attachments.map((att) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={att.id}
                src={att.dataUrl}
                alt={att.name}
                className="h-20 w-20 rounded-lg border border-white/20 object-cover"
              />
            ))}
          </div>
        )}
        <div className="break-words">
          <MessageContent content={msg.content} role={msg.role} error={isError} />
          {msg.streaming && (
            <span className="ml-0.5 inline-block size-3 animate-pulse rounded-full bg-primary/50 align-middle" />
          )}
        </div>
      </div>
    </div>
  );
}

ChatArea.propTypes = {
  messages: PropTypes.arrayOf(
    PropTypes.shape({
      id: PropTypes.string,
      role: PropTypes.string,
      content: PropTypes.string,
      reasoning: PropTypes.string,
      model: PropTypes.string,
      streaming: PropTypes.bool,
      error: PropTypes.bool,
      attachments: PropTypes.array,
    })
  ),
  onSend: PropTypes.func,
  streaming: PropTypes.bool,
};
