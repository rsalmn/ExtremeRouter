"use client";

import { useMemo } from "react";
import PropTypes from "prop-types";
import { marked } from "marked";
import { sanitizeHtml } from "@/shared/utils/sanitizeHtml";

// Configure marked once: GFM tables + line breaks. marked is synchronous-safe
// for our usage; parse() returns a string synchronously when async:false.
marked.setOptions({ gfm: true, breaks: true, async: false });

/**
 * Render a chat message's content.
 *
 * - Assistant messages → rendered as markdown (sanitized) so code blocks,
 *   bold, lists, tables display correctly.
 * - User messages → plain text (whitespace-pre-wrap). The user's own input is
 *   not markdown; rendering it would be surprising and offer no benefit.
 * - Error messages → plain text (they come from the gateway and may contain
 *   raw upstream JSON; never render that as HTML).
 *
 * @param {object} props
 * @param {string} props.content
 * @param {"user"|"assistant"|"system"} props.role
 * @param {boolean} [props.error]
 */
export default function MessageContent({ content, role, error = false }) {
  const isMarkdown = !error && role === "assistant";

  const html = useMemo(() => {
    if (!isMarkdown || !content) return "";
    try {
      const parsed = marked.parse(content);
      return sanitizeHtml(typeof parsed === "string" ? parsed : String(parsed));
    } catch {
      // If marked fails (shouldn't happen for normal text), fall back to plain.
      return "";
    }
  }, [content, isMarkdown]);

  if (!isMarkdown || !html) {
    // Plain text path: user input, errors, empty assistant, or markdown failure.
    return <p className="whitespace-pre-wrap break-words">{content}</p>;
  }

  return (
    <div
      className="prose-chat whitespace-pre-wrap break-words"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

MessageContent.propTypes = {
  content: PropTypes.string,
  role: PropTypes.string,
  error: PropTypes.bool,
};
