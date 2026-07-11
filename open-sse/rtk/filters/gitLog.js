// JS-native git-log filter for RTK.
//
// Compacts `git log` output into a concise commit summary while preserving
// useful context (hash, author, date, subject). Handles:
//   - `git log --oneline`  (sha + subject per line)
//   - default `git log`    (commit / Author / Date / subject + body)
//   - `git log --graph`    (graph prefixes stripped from commit lines)
//   - merge commits        (preserved, marked)
//   - embedded diff markers in log bodies (dropped — diff has its own filter)
//
// Strategy: single pass, bucket commits. Each commit is reduced to a compact
// one-line entry. When the commit count exceeds GIT_LOG_MAX_COMMITS, the tail
// is truncated with a count marker. Bodies (multi-line commit messages) are
// collapsed to their first non-empty line (the subject); detail lines are
// dropped to keep only the high-signal summary.
//
// Provenance: no Rust upstream in this tree; this is a JS-native implementation
// modeled on the gitDiff/gitStatus filter contract.

import { GIT_LOG_MAX_COMMITS, GIT_LOG_BODY_MAX_LINES } from "../constants.js";

// Regexes for detecting git-log structure.
// Oneline format: "<40-char-or-short sha> (<refs>)? <subject>"
const RE_ONELINE = /^[0-9a-f]{4,40}\b.*\n?/;
// Full format: "commit <sha>" header, followed by Author/Date/Merge lines
const RE_COMMIT_HEADER = /^commit [0-9a-f]{4,40}/;
const RE_AUTHOR = /^Author:\s+(.+)/;
const RE_DATE = /^Date:\s+(.+)/;
const RE_MERGE = /^Merge:\s+/;
// Graph format: "* <sha> ..." or "*   <sha> ..." (with leading graph glyphs)
const RE_GRAPH_COMMIT = /^[*|\/\\ ]*commit [0-9a-f]{4,40}/;
// Lines that look like diff markers (should not appear in log, but sometimes
// `git log -p` embeds them — drop them; diff has its own filter).
const RE_DIFF_MARKER = /^(diff --git |@@ |index |--- |\+\+\+ )/;

export function gitLog(input) {
  if (!input || typeof input !== "string") return input;

  const lines = input.split("\n");
  const result = [];
  let commitsShown = 0;
  let commitsSkipped = 0;

  // Detect mode by inspecting the first non-empty line.
  let i = 0;
  while (i < lines.length && lines[i].trim() === "") i++;
  if (i >= lines.length) return input;

  const firstLine = lines[i];
  // Oneline mode: first line matches "<sha> <subject>" (optionally with a
  // --graph prefix like "* " or "| * "). No "commit"/"Author" prefix.
  const strippedGraph = firstLine.replace(/^[*|\/\\ ]+/, "").trimStart();
  const isOneline = /^[0-9a-f]{4,40}\s/.test(strippedGraph) && !RE_COMMIT_HEADER.test(firstLine);

  if (isOneline) {
    // Oneline format: each line is a commit. Keep the first N, count the rest.
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed === "") continue;
      // Skip pure graph connector lines (|, /, \, *) that --graph adds between commits.
      if (/^[|\/\\ *]+$/.test(trimmed)) continue;

      // Strip graph prefix (* | / \) to get the clean "<sha> <subject>" line.
      const clean = trimmed.replace(/^[*|\/\\ ]+/, "").trim();

      if (commitsShown < GIT_LOG_MAX_COMMITS) {
        result.push(clean);
        commitsShown++;
      } else {
        commitsSkipped++;
      }
    }
  } else {
    // Full format: parse commit blocks (commit / Author / Date / blank / message).
    let inCommit = false;
    let inBody = false;
    let bodyLines = 0;
    let subjectPushed = false;
    let currentHeader = null;

    for (let j = 0; j < lines.length; j++) {
      const line = lines[j];
      const trimmed = line.trimStart();

      // Strip graph prefix for commit detection (--graph mode).
      const isCommit = RE_COMMIT_HEADER.test(trimmed) || RE_GRAPH_COMMIT.test(line);
      const isMerge = RE_MERGE.test(trimmed);

      if (isCommit) {
        // Flush previous commit's truncation marker if body was cut.
        if (inCommit && bodyLines > GIT_LOG_BODY_MAX_LINES) {
          result.push(`    ... (${bodyLines - GIT_LOG_BODY_MAX_LINES} body lines truncated)`);
        }
        // Start new commit block.
        if (commitsShown >= GIT_LOG_MAX_COMMITS) {
          commitsSkipped++;
          inCommit = true;
          inBody = false;
          bodyLines = 0;
          subjectPushed = true; // suppress output
          continue;
        }
        inCommit = true;
        inBody = false;
        bodyLines = 0;
        subjectPushed = false;
        // Extract the sha (strip graph prefix if present).
        const shaMatch = trimmed.match(/commit ([0-9a-f]{4,40})/);
        const sha = shaMatch ? shaMatch[1].slice(0, 12) : "????????";
        currentHeader = { sha, merge: false, author: null, date: null };
        continue;
      }

      if (!inCommit) continue;

      // Merge line — mark the commit as a merge.
      if (isMerge) {
        if (currentHeader) currentHeader.merge = true;
        continue;
      }

      // Author / Date lines.
      const authorMatch = RE_AUTHOR.exec(trimmed);
      if (authorMatch) {
        if (currentHeader) currentHeader.author = authorMatch[1].trim();
        continue;
      }
      const dateMatch = RE_DATE.exec(trimmed);
      if (dateMatch) {
        if (currentHeader) currentHeader.date = dateMatch[1].trim();
        continue;
      }

      // Blank line after Date/Author → body starts.
      if (trimmed === "" && !inBody && currentHeader && !subjectPushed) {
        inBody = true;
        // Push the compact commit header now that we have author + date.
        const tag = currentHeader.merge ? " [merge]" : "";
        const author = currentHeader.author ? ` ${currentHeader.author}` : "";
        const date = currentHeader.date ? ` (${currentHeader.date})` : "";
        result.push(`${currentHeader.sha}${tag}${author}${date}`);
        commitsShown++;
        subjectPushed = true;
        continue;
      }

      // Body lines: keep the first few (subject + key details), drop the rest.
      if (inBody) {
        // Drop diff markers (embedded `git log -p` diff hunks).
        if (RE_DIFF_MARKER.test(trimmed)) continue;
        // Drop pure indentation/separator lines.
        if (trimmed === "") continue;

        if (commitsShown > GIT_LOG_MAX_COMMITS) {
          // Over budget — just count body lines.
          bodyLines++;
          continue;
        }

        if (bodyLines < GIT_LOG_BODY_MAX_LINES) {
          result.push(`    ${trimmed}`);
          bodyLines++;
        }
        // Beyond GIT_LOG_BODY_MAX_LINES, silently skip (marker added on next commit).
      }
    }

    // Flush trailing truncation marker.
    if (inCommit && bodyLines > GIT_LOG_BODY_MAX_LINES) {
      result.push(`    ... (${bodyLines - GIT_LOG_BODY_MAX_LINES} body lines truncated)`);
    }
  }

  // If we didn't recognize any commits, passthrough unchanged.
  if (result.length === 0) return input;

  if (commitsSkipped > 0) {
    result.push(`... (${commitsSkipped} more commits truncated)`);
  }

  return result.join("\n");
}

gitLog.filterName = "git-log";
