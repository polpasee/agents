import { describe, it, expect, beforeEach } from "vitest";
import {
  dispatchHookEvent,
  hookNodeId,
  encodeProjectDir,
} from "../hook-ingest";
import { agents, agentLastModified, agentFilePaths } from "../agent-state";
import { viewers } from "../sse-broadcast";
import type { SSEClient } from "../sse-broadcast";
import { EXTERNAL_AGENT_ID_PREFIX } from "../config";

function makeClient(): SSEClient & { received: string[] } {
  const received: string[] = [];
  return {
    received,
    send(data: string) {
      received.push(data);
    },
  };
}

beforeEach(() => {
  agents.clear();
  agentLastModified.clear();
  agentFilePaths.clear();
  viewers.clear();
});

describe("hookNodeId / encodeProjectDir", () => {
  it("strips the agent- prefix for subagents and falls back to session id", () => {
    expect(hookNodeId("agent-abc", "sess-1")).toBe("abc");
    expect(hookNodeId(undefined, "sess-1")).toBe("sess-1");
  });
  it("dash-encodes a cwd into the projects-dir label form", () => {
    expect(encodeProjectDir("/Users/x/proj")).toBe("-Users-x-proj");
  });
});

describe("dispatchHookEvent lifecycle", () => {
  it("SessionStart registers a running main keyed by session id", () => {
    dispatchHookEvent(
      {
        hook_event_name: "SessionStart",
        session_id: "sess-1",
        cwd: "/Users/x/proj",
        model: "claude-sonnet-5",
      },
      1000,
    );
    const main = agents.get("sess-1");
    expect(main).toBeDefined();
    expect(main?.agentType).toBe("main");
    expect(main?.status).toBe("running");
    expect(main?.model).toBe("claude-sonnet-5");
    expect(agentLastModified.get("sess-1")).toBe(1000);
  });

  it("SubagentStart registers a subagent parented to the session", () => {
    dispatchHookEvent(
      { hook_event_name: "SessionStart", session_id: "sess-1", cwd: "/p" },
      1000,
    );
    dispatchHookEvent(
      {
        hook_event_name: "SubagentStart",
        session_id: "sess-1",
        agent_id: "agent-sub9",
        agent_type: "Explore",
      },
      1100,
    );
    const sub = agents.get("sub9");
    expect(sub).toBeDefined();
    expect(sub?.parentId).toBe("sess-1");
    expect(sub?.displayType).toBe("Explore");
    expect(sub?.agentType).toBe("explore");
  });

  it("PreToolUse registers an unseen subagent on first sight and heartbeats", () => {
    dispatchHookEvent(
      {
        hook_event_name: "PreToolUse",
        session_id: "sess-1",
        agent_id: "agent-lazy",
        agent_type: "Plan",
        tool_name: "Read",
      },
      1200,
    );
    const sub = agents.get("lazy");
    expect(sub?.status).toBe("running");
    expect(agentLastModified.get("lazy")).toBe(1200);
  });

  it("SubagentStop marks completed with duration+summary and broadcasts agent:complete", () => {
    dispatchHookEvent(
      { hook_event_name: "SessionStart", session_id: "sess-1", cwd: "/p" },
      1000,
    );
    dispatchHookEvent(
      {
        hook_event_name: "SubagentStart",
        session_id: "sess-1",
        agent_id: "agent-s1",
        agent_type: "Explore",
      },
      1100,
    );
    const client = makeClient();
    viewers.add(client);
    dispatchHookEvent(
      {
        hook_event_name: "SubagentStop",
        session_id: "sess-1",
        agent_id: "agent-s1",
        last_assistant_message: "done",
      },
      1600,
    );
    const sub = agents.get("s1");
    expect(sub?.status).toBe("completed");
    expect(sub?.duration).toBe(500);
    expect(sub?.summary).toBe("done");
    expect(client.received.some((m) => m.includes("agent:complete"))).toBe(true);
  });

  it("Stop marks a main idle (not completed)", () => {
    dispatchHookEvent(
      { hook_event_name: "SessionStart", session_id: "sess-1", cwd: "/p" },
      1000,
    );
    dispatchHookEvent(
      { hook_event_name: "Stop", session_id: "sess-1" },
      1500,
    );
    expect(agents.get("sess-1")?.status).toBe("idle");
  });

  it("SessionEnd marks a main completed", () => {
    dispatchHookEvent(
      { hook_event_name: "SessionStart", session_id: "sess-1", cwd: "/p" },
      1000,
    );
    dispatchHookEvent(
      { hook_event_name: "SessionEnd", session_id: "sess-1" },
      2000,
    );
    const main = agents.get("sess-1");
    expect(main?.status).toBe("completed");
    expect(main?.duration).toBe(1000);
  });

  it("Notification agent_needs_input → waiting, agent_completed → completed", () => {
    dispatchHookEvent(
      { hook_event_name: "SessionStart", session_id: "sess-1", cwd: "/p" },
      1000,
    );
    dispatchHookEvent(
      {
        hook_event_name: "Notification",
        session_id: "sess-1",
        notification_type: "agent_needs_input",
      },
      1100,
    );
    expect(agents.get("sess-1")?.status).toBe("waiting");
    dispatchHookEvent(
      {
        hook_event_name: "Notification",
        session_id: "sess-1",
        notification_type: "agent_completed",
      },
      1200,
    );
    expect(agents.get("sess-1")?.status).toBe("completed");
  });

  it("registers a Codex hollow node on a Bash codex call and completes it", () => {
    dispatchHookEvent(
      { hook_event_name: "SessionStart", session_id: "sess-1", cwd: "/p" },
      1000,
    );
    dispatchHookEvent(
      {
        hook_event_name: "PreToolUse",
        session_id: "sess-1",
        tool_name: "Bash",
        tool_use_id: "toolu_x",
        tool_input: { command: "codex exec 'do thing'" },
      },
      1100,
    );
    const codexId = EXTERNAL_AGENT_ID_PREFIX + "toolu_x";
    expect(agents.get(codexId)?.displayType).toBe("Codex");
    expect(agents.get(codexId)?.status).toBe("running");
    dispatchHookEvent(
      {
        hook_event_name: "PostToolUse",
        session_id: "sess-1",
        tool_name: "Bash",
        tool_use_id: "toolu_x",
        tool_input: { command: "codex exec 'do thing'" },
      },
      1400,
    );
    expect(agents.get(codexId)?.status).toBe("idle");
  });

  it("UserPromptSubmit registers a main on first sight and heartbeats a known one", () => {
    dispatchHookEvent(
      { hook_event_name: "UserPromptSubmit", session_id: "sess-1", cwd: "/p" },
      1000,
    );
    expect(agents.get("sess-1")?.agentType).toBe("main");
    dispatchHookEvent(
      { hook_event_name: "UserPromptSubmit", session_id: "sess-1" },
      1500,
    );
    expect(agents.get("sess-1")?.status).toBe("running");
    expect(agentLastModified.get("sess-1")).toBe(1500);
  });

  it("a repeated SessionStart heartbeats the existing node without re-registering", () => {
    dispatchHookEvent(
      { hook_event_name: "SessionStart", session_id: "sess-1", cwd: "/p" },
      1000,
    );
    dispatchHookEvent(
      { hook_event_name: "SessionStart", session_id: "sess-1", cwd: "/p" },
      1800,
    );
    expect(agents.size).toBe(1);
    expect(agentLastModified.get("sess-1")).toBe(1800);
  });

  it("ignores an unknown hook event without throwing or registering", () => {
    expect(() =>
      dispatchHookEvent(
        { hook_event_name: "SomethingElse", session_id: "sess-1" },
        1000,
      ),
    ).not.toThrow();
    expect(agents.size).toBe(0);
  });
});
