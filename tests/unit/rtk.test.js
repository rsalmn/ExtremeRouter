import { describe, it, expect } from "vitest";
import { compressMessages, formatRtkLog } from "../../open-sse/rtk/index.js";
import { gitDiff } from "../../open-sse/rtk/filters/gitDiff.js";
import { gitStatus } from "../../open-sse/rtk/filters/gitStatus.js";
import { gitLog } from "../../open-sse/rtk/filters/gitLog.js";
import { grep } from "../../open-sse/rtk/filters/grep.js";
import { find } from "../../open-sse/rtk/filters/find.js";
import { dedupLog } from "../../open-sse/rtk/filters/dedupLog.js";
import { ls } from "../../open-sse/rtk/filters/ls.js";
import { tree } from "../../open-sse/rtk/filters/tree.js";
import { smartTruncate } from "../../open-sse/rtk/filters/smartTruncate.js";
import { readNumbered } from "../../open-sse/rtk/filters/readNumbered.js";
import { searchList } from "../../open-sse/rtk/filters/searchList.js";
import { autoDetectFilter } from "../../open-sse/rtk/autodetect.js";
import { safeApply } from "../../open-sse/rtk/applyFilter.js";

function makeLongDiff() {
  const lines = ["diff --git a/foo.js b/foo.js", "index abc..def 100644", "--- a/foo.js", "+++ b/foo.js", "@@ -1,3 +1,200 @@"];
  for (let i = 0; i < 200; i++) lines.push(`+added line ${i} ${"x".repeat(20)}`);
  return lines.join("\n");
}

function makeGitStatus() {
  return [
    "On branch main",
    "Your branch is up to date with 'origin/main'.",
    "",
    "Changes not staged for commit:",
    "  (use \"git add <file>...\" to update what will be committed)",
    "\tmodified:   src/a.js",
    "\tmodified:   src/b.js",
    "\tnew file:   src/c.js",
    "\tdeleted:    src/old.js",
    "",
    "Untracked files:",
    "\tnotes.txt",
    "",
    "no changes added to commit"
  ].join("\n");
}

function makeGrepOutput() {
  const lines = [];
  for (let i = 1; i <= 40; i++) lines.push(`src/foo.js:${i}:const x${i} = "some value here with padding text padding text"`);
  for (let i = 1; i <= 10; i++) lines.push(`src/bar.js:${i}:const y${i} = "another value here with padding padding padding"`);
  return lines.join("\n");
}

function makeFindOutput() {
  const lines = [];
  for (let i = 0; i < 30; i++) lines.push(`./src/a/${i}.js`);
  for (let i = 0; i < 20; i++) lines.push(`./src/b/${i}.js`);
  for (let i = 0; i < 5; i++) lines.push(`./top${i}.md`);
  return lines.join("\n");
}

function makeGitLogOneline(count = 60) {
  const lines = [];
  for (let i = 0; i < count; i++) {
    const sha = (Math.random().toString(16) + "0000000000000000000000000000000000000000").slice(2, 42);
    lines.push(`${sha.slice(0, 7)} (HEAD -> main) feat: commit message number ${i} with some detail`);
  }
  return lines.join("\n");
}

function makeGitLogFull(count = 60) {
  const lines = [];
  for (let i = 0; i < count; i++) {
    const sha = (Math.random().toString(16) + "0000000000000000000000000000000000000000").slice(2, 42);
    lines.push(`commit ${sha}`);
    lines.push(`Author: Dev Person <dev@example.com>`);
    lines.push(`Date:   Mon Jul ${8 - (i % 7)} 12:00:00 2026 +0700`);
    lines.push(``);
    lines.push(`    feat: commit ${i} - implement feature X with long description`);
    lines.push(`    `);
    lines.push(`    This is a detailed body line with lots of context about the change.`);
    lines.push(`    Another body line with more detail about edge cases handled.`);
    lines.push(`    Third body line that should be truncated beyond GIT_LOG_BODY_MAX_LINES.`);
    lines.push(`    Fourth body line with even more detail that must NOT appear in output.`);
    lines.push(``);
  }
  return lines.join("\n");
}

function makeGitLogGraph() {
  return [
    "*   0123456 (HEAD -> main) Merge pull request #42",
    "|\\  ",
    "| * 89abcde feat: add git-log filter",
    "| * fedcba1 refactor: cleanup constants",
    "*| 4567890 docs: update README",
    "|/",
    "* aabbccd initial commit",
  ].join("\n");
}

describe("RTK filters", () => {
  it("gitDiff truncates hunks beyond 100 lines and preserves file header", () => {
    const input = makeLongDiff();
    const out = gitDiff(input, 500);
    expect(out).toContain("foo.js");
    expect(out).toContain("lines truncated");
    expect(out.length).toBeLessThan(input.length);
  });

  it("gitStatus groups by kind and produces compact output (Rust format)", () => {
    const input = makeGitStatus();
    const out = gitStatus(input);
    expect(out).toContain("* main");
    expect(out).toMatch(/~ Modified: \d+ files/);
    expect(out).toContain("src/a.js");
    expect(out.length).toBeLessThan(input.length);
  });

  it("grep groups matches by file and caps per-file lines (Rust format)", () => {
    const input = makeGrepOutput();
    const out = grep(input);
    expect(out).toContain("50 matches in 2F:");
    expect(out).toContain("[file] src/foo.js (40):");
    expect(out).toContain("[file] src/bar.js (10):");
    expect(out).toMatch(/\+\d+/); // overflow marker
    expect(out.length).toBeLessThan(input.length);
  });

  it("find groups paths by parent dir, shows basenames (Rust format)", () => {
    const input = makeFindOutput();
    const out = find(input);
    expect(out).toContain("55 files in 3 dirs:");
    expect(out).toContain("./src/a/  (30)");
    expect(out).toContain("./src/b/  (20)");
    expect(out).toContain("./  (5)");
    expect(out.length).toBeLessThan(input.length);
  });

  it("dedupLog collapses consecutive duplicates", () => {
    const input = Array(20).fill("repeated log line A").join("\n") + "\nunique\n" + Array(10).fill("another dup").join("\n");
    const out = dedupLog(input);
    expect(out).toContain("repeated log line A");
    expect(out).toContain("duplicate lines");
    expect(out.length).toBeLessThan(input.length);
  });

  it("gitLog: compacts oneline log and truncates beyond cap", () => {
    const input = makeGitLogOneline(60);
    const out = gitLog(input);
    expect(out).toContain("feat: commit message number 0");
    expect(out).toContain("more commits truncated");
    expect(out.length).toBeLessThan(input.length);
  });

  it("gitLog: preserves commit hash + subject in oneline mode", () => {
    const input = "abc1234 (HEAD -> main) feat: my feature\n";
    const out = gitLog(input);
    expect(out).toContain("abc1234");
    expect(out).toContain("feat: my feature");
  });

  it("gitLog: compacts full-format log, keeps author + date + subject", () => {
    const input = makeGitLogFull(3);
    const out = gitLog(input);
    expect(out).toContain("Dev Person");
    expect(out).toContain("feat: commit 0");
    // body detail lines beyond GIT_LOG_BODY_MAX_LINES (3) should be truncated
    expect(out).not.toContain("Fourth body line with even more detail");
    expect(out.length).toBeLessThan(input.length);
  });

  it("gitLog: truncates long full-format log beyond GIT_LOG_MAX_COMMITS", () => {
    const input = makeGitLogFull(80);
    const out = gitLog(input);
    expect(out).toContain("more commits truncated");
    expect(out.length).toBeLessThan(input.length);
  });

  it("gitLog: handles --graph output, strips connector lines", () => {
    const input = makeGitLogGraph();
    const out = gitLog(input);
    expect(out).toContain("Merge pull request");
    expect(out).toContain("add git-log filter");
    // pure connector lines like "|\\  " should not appear as standalone entries
    expect(out).not.toMatch(/^\|\\\s*$/m);
  });

  it("gitLog: drops embedded diff markers from log bodies", () => {
    const input = [
      "commit aabbccdd1234",
      "Author: Dev <dev@example.com>",
      "Date:   Mon Jul 8 12:00:00 2026 +0700",
      "",
      "    feat: combined log + diff",
      "",
      "diff --git a/x b/x",
      "@@ -1 +1 @@",
      "-old",
      "+new",
    ].join("\n");
    const out = gitLog(input);
    expect(out).toContain("aabbccdd");
    expect(out).toContain("feat: combined log + diff");
    // diff markers should be dropped (diff has its own filter)
    expect(out).not.toContain("diff --git");
    expect(out).not.toContain("@@ -1 +1 @@");
  });

  it("gitLog: passes through non-git-log input unchanged", () => {
    const input = "just some random text\nnot a git log at all\n";
    // No commit-like lines → gitLog returns input unchanged
    const out = gitLog(input);
    expect(out).toBe(input);
  });

  it("gitLog: marks merge commits", () => {
    const input = [
      "commit aabbccdd1234",
      "Merge: fe1dc0a b2e3f4d",
      "Author: Dev <dev@example.com>",
      "Date:   Mon Jul 8 12:00:00 2026 +0700",
      "",
      "    Merge branch feature into main",
    ].join("\n");
    const out = gitLog(input);
    expect(out).toContain("[merge]");
    expect(out).toContain("Merge branch feature into main");
  });
});

describe("autoDetectFilter", () => {
  it("detects git diff", () => {
    expect(autoDetectFilter("diff --git a/x b/x\n@@ -1 +1 @@\n+a").filterName).toBe("git-diff");
  });
  it("detects git status", () => {
    expect(autoDetectFilter("On branch main\n  modified:   x.js\n").filterName).toBe("git-status");
  });
  it("detects git log (oneline format)", () => {
    expect(autoDetectFilter("abc1234 (HEAD -> main) feat: x\ndef5678 docs: y\n").filterName).toBe("git-log");
  });
  it("detects git log (full format)", () => {
    expect(autoDetectFilter("commit aabbccdd1234\nAuthor: Dev <d@e.com>\nDate:   Mon\n\n    msg\n").filterName).toBe("git-log");
  });
  it("does not misdetect single hex-prefixed line as git log (requires >=2)", () => {
    // A single sha-like line should not trigger git-log (needs >=2 commit lines)
    // It falls through to dedup-log or null depending on line count
    const result = autoDetectFilter("abc1234 some lone line\n");
    expect(result?.filterName).not.toBe("git-log");
  });
  it("detects grep", () => {
    expect(autoDetectFilter("a.js:1:hello\nb.js:2:world\nc.js:3:foo").filterName).toBe("grep");
  });
  it("detects find", () => {
    expect(autoDetectFilter("./a/b.js\n./a/c.js\n./a/d.js").filterName).toBe("find");
  });
  it("falls back to dedupLog for generic text", () => {
    const txt = "line1\nline2\nline3\nline4\nline5\nline6\n";
    expect(autoDetectFilter(txt).filterName).toBe("dedup-log");
  });
});

describe("RTK filters (extras)", () => {
  it("ls: compact_ls strips perms/owner, keeps name + size", () => {
    const input = [
      "total 48",
      "drwxr-xr-x  2 user staff   64 Jan  1 12:00 .",
      "drwxr-xr-x  2 user staff   64 Jan  1 12:00 ..",
      "drwxr-xr-x  2 user staff   64 Jan  1 12:00 src",
      "-rw-r--r--  1 user staff 1234 Jan  1 12:00 Cargo.toml",
      "-rw-r--r--  1 user staff 5678 Jan  1 12:00 README.md"
    ].join("\n");
    const out = ls(input);
    expect(out).toContain("src/");
    expect(out).toContain("Cargo.toml");
    expect(out).toContain("1.2K");
    expect(out).toContain("5.5K");
    expect(out).not.toContain("drwx");
    expect(out).toContain("Summary: 2 files, 1 dirs");
  });

  it("ls: filters noise dirs", () => {
    const input = [
      "total 8",
      "drwxr-xr-x  2 user staff 64 Jan  1 12:00 node_modules",
      "drwxr-xr-x  2 user staff 64 Jan  1 12:00 .git",
      "drwxr-xr-x  2 user staff 64 Jan  1 12:00 src",
      "-rw-r--r--  1 user staff 100 Jan  1 12:00 main.js"
    ].join("\n");
    const out = ls(input);
    expect(out).not.toContain("node_modules");
    expect(out).not.toContain(".git");
    expect(out).toContain("src/");
    expect(out).toContain("main.js");
  });

  it("tree: removes summary, keeps structure", () => {
    const input = ".\n├── src\n│   └── main.rs\n└── Cargo.toml\n\n2 directories, 3 files\n";
    const out = tree(input);
    expect(out).not.toContain("directories");
    expect(out).toContain("├──");
    expect(out).toContain("main.rs");
  });

  it("smartTruncate: keeps head+tail, drops middle", () => {
    const input = Array.from({ length: 400 }, (_, i) => `line ${i}`).join("\n");
    const out = smartTruncate(input);
    expect(out).toContain("line 0");
    expect(out).toContain("line 399");
    expect(out).toContain("lines truncated");
    expect(out.length).toBeLessThan(input.length);
  });

  it("smartTruncate: passes through small input", () => {
    const input = Array.from({ length: 10 }, (_, i) => `line ${i}`).join("\n");
    expect(smartTruncate(input)).toBe(input);
  });

  it("readNumbered: compacts very long line-numbered dump", () => {
    const lines = [];
    for (let i = 1; i <= 400; i++) lines.push(`  ${i}|content ${i}`);
    const input = lines.join("\n");
    const out = readNumbered(input);
    expect(out).toContain("1|content 1");
    expect(out).toContain("400|content 400");
    expect(out).toContain("lines truncated");
    expect(out.length).toBeLessThan(input.length);
  });

  it("searchList: groups Cursor Glob output by parent dir", () => {
    const paths = [];
    for (let i = 0; i < 30; i++) paths.push(`- src/a/f${i}.js`);
    for (let i = 0; i < 10; i++) paths.push(`- src/b/g${i}.js`);
    const input = [
      "Result of search in '/Users/x' (total 40 files):",
      ...paths
    ].join("\n");
    const out = searchList(input);
    expect(out).toContain("Result of search in");
    expect(out).toContain("40 files in 2 dirs:");
    expect(out).toContain("src/a/ (30):");
    expect(out).toContain("src/b/ (10):");
    expect(out).toMatch(/\+\d+/);
    expect(out.length).toBeLessThan(input.length);
  });
});

describe("autoDetectFilter (extras)", () => {
  it("detects tree via box-drawing glyphs", () => {
    expect(autoDetectFilter(".\n├── src\n│   └── main.rs\n└── Cargo.toml\n").filterName).toBe("tree");
  });
  it("detects ls via total + perms rows", () => {
    const input = [
      "total 48",
      "drwxr-xr-x  2 user staff   64 Jan  1 12:00 src",
      "-rw-r--r--  1 user staff 1234 Jan  1 12:00 main.js",
      "-rw-r--r--  1 user staff 5678 Jan  1 12:00 README.md"
    ].join("\n");
    expect(autoDetectFilter(input).filterName).toBe("ls");
  });
  it("detects Cursor search list", () => {
    const input = "Result of search in '/x' (total 3 files):\n- a/b.js\n- a/c.js\n- a/d.js";
    expect(autoDetectFilter(input).filterName).toBe("search-list");
  });
});

describe("safeApply", () => {
  it("returns input if filter throws", () => {
    const out = safeApply(() => { throw new Error("boom"); }, "hello");
    expect(out).toBe("hello");
  });
  it("returns input if filter returns non-string", () => {
    const out = safeApply(() => 42, "hello");
    expect(out).toBe("hello");
  });
});

describe("compressMessages (disabled)", () => {
  it("returns null when disabled", () => {
    const body = { messages: [{ role: "tool", tool_call_id: "x", content: makeLongDiff() }] };
    expect(compressMessages(body, false)).toBeNull();
  });
});

describe("compressMessages (enabled)", () => {
  it("compresses OpenAI tool message (string content)", () => {
    const big = makeLongDiff();
    const body = { messages: [{ role: "tool", tool_call_id: "call_1", content: big }] };
    const stats = compressMessages(body, true);
    expect(stats.hits.length).toBeGreaterThan(0);
    expect(body.messages[0].content.length).toBeLessThan(big.length);
    expect(stats.bytesBefore).toBeGreaterThan(stats.bytesAfter);
  });

  it("compresses Claude string-form tool_result", () => {
    const big = makeLongDiff();
    const body = {
      messages: [{
        role: "user",
        content: [{ type: "tool_result", tool_use_id: "toolu_1", content: big }]
      }]
    };
    const stats = compressMessages(body, true);
    expect(stats.hits.length).toBeGreaterThan(0);
    expect(body.messages[0].content[0].content.length).toBeLessThan(big.length);
  });

  it("compresses Claude array-form tool_result text parts", () => {
    const big = makeLongDiff();
    const body = {
      messages: [{
        role: "user",
        content: [{
          type: "tool_result",
          tool_use_id: "toolu_1",
          content: [{ type: "text", text: big }, { type: "text", text: "unchanged short" }]
        }]
      }]
    };
    const stats = compressMessages(body, true);
    expect(stats.hits.length).toBeGreaterThan(0);
    expect(body.messages[0].content[0].content[0].text.length).toBeLessThan(big.length);
    // short part unchanged
    expect(body.messages[0].content[0].content[1].text).toBe("unchanged short");
  });

  it("skips is_error tool_result", () => {
    const big = makeLongDiff();
    const body = {
      messages: [{
        role: "user",
        content: [{ type: "tool_result", tool_use_id: "toolu_1", content: big, is_error: true }]
      }]
    };
    const stats = compressMessages(body, true);
    expect(stats.hits.length).toBe(0);
    expect(body.messages[0].content[0].content).toBe(big);
  });

  it("skips below MIN_COMPRESS_SIZE (<500 bytes)", () => {
    const small = "diff --git a/x b/x\n@@ -1 +1 @@\n+a";
    const body = { messages: [{ role: "tool", tool_call_id: "x", content: small }] };
    const stats = compressMessages(body, true);
    expect(stats.hits.length).toBe(0);
    expect(body.messages[0].content).toBe(small);
  });

  it("never produces empty content (R14 guard)", () => {
    const input = "a".repeat(1000);
    const body = { messages: [{ role: "tool", tool_call_id: "x", content: input }] };
    compressMessages(body, true);
    expect(body.messages[0].content.length).toBeGreaterThan(0);
  });

  it("skips when body has no messages", () => {
    expect(compressMessages({}, true)).toBeNull();
    expect(compressMessages({ messages: null }, true)).toBeNull();
  });

  it("handles mix of messages without crashing", () => {
    const body = {
      messages: [
        { role: "system", content: "you are" },
        { role: "user", content: "hi" },
        { role: "assistant", content: null, tool_calls: [{ id: "c1", function: { name: "x", arguments: "{}" } }] },
        { role: "tool", tool_call_id: "c1", content: makeGrepOutput() },
        { role: "user", content: [{ type: "text", text: "next" }] }
      ]
    };
    const stats = compressMessages(body, true);
    expect(stats).not.toBeNull();
    expect(stats.hits.length).toBeGreaterThan(0);
  });

  it("compresses git log tool output via autodetect", () => {
    const big = makeGitLogOneline(60);
    const body = { messages: [{ role: "tool", tool_call_id: "x", content: big }] };
    const stats = compressMessages(body, true);
    expect(stats.hits.length).toBeGreaterThan(0);
    expect(stats.hits[0].filter).toBe("git-log");
    expect(body.messages[0].content.length).toBeLessThan(big.length);
  });

  it("compresses full-format git log via autodetect", () => {
    const big = makeGitLogFull(40);
    const body = { messages: [{ role: "tool", tool_call_id: "x", content: big }] };
    const stats = compressMessages(body, true);
    expect(stats.hits.length).toBeGreaterThan(0);
    expect(stats.hits[0].filter).toBe("git-log");
    expect(body.messages[0].content.length).toBeLessThan(big.length);
  });
});

describe("formatRtkLog", () => {
  it("returns null when no hits", () => {
    expect(formatRtkLog({ bytesBefore: 0, bytesAfter: 0, hits: [] })).toBeNull();
  });
  it("formats savings line with percentage", () => {
    const line = formatRtkLog({ bytesBefore: 1000, bytesAfter: 400, hits: [{ filter: "git-diff" }] });
    expect(line).toContain("saved 600B");
    expect(line).toContain("60.0%");
    expect(line).toContain("git-diff");
  });
});
