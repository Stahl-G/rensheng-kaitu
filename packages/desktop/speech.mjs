import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

// A single app-owned session. Starting is the only operation that can request permission.
export function createSpeech(helper) {
  let child;
  let state = { state: "idle", text: "" };
  let buffer = "";
  const available = process.platform === "darwin" && existsSync(helper);
  const close = () => {
    if (child) {
      child.stdin.write("cancel\n");
      child.kill();
      child = undefined;
    }
  };
  return {
    close,
    async request(action, locale) {
      if (action === "status") return { ...state, available };
      if (!available) return { state: "unavailable", text: "", available };
      if (action === "start") {
        if (child) return { state: "error", text: "", available };
        state = { state: "starting", text: "" };
        buffer = "";
        const current = spawn(helper, [locale === "en" ? "en-US" : "zh-CN"], {
          stdio: ["pipe", "pipe", "ignore"],
        });
        child = current;
        current.stdin.on("error", () => {});
        current.stdout.setEncoding("utf8");
        current.stdout.on("data", (chunk) => {
          if (child !== current) return;
          buffer += chunk;
          if (buffer.length > 65536) {
            close();
            state = { state: "error", text: "" };
            return;
          }
          let index = buffer.indexOf("\n");
          while (index >= 0) {
            const line = buffer.slice(0, index);
            buffer = buffer.slice(index + 1);
            try {
              const value = JSON.parse(line);
              if (
                ["recording", "done", "denied", "unavailable", "error", "cancelled", "timeout"].includes(
                  value.state,
                ) &&
                typeof value.text === "string"
              )
                state = { state: value.state, text: value.text };
            } catch {
              state = { state: "error", text: "" };
            }
            index = buffer.indexOf("\n");
          }
        });
        current.on("error", () => {
          if (child === current) {
            child = undefined;
            state = { state: "error", text: "" };
          }
        });
        current.on("close", () => {
          if (child === current) {
            child = undefined;
            if (["starting", "recording", "stopping"].includes(state.state))
              state = { state: "error", text: "" };
          }
        });
        return { ...state, available };
      }
      if (action === "stop" && child && state.state === "recording") {
        state = { ...state, state: "stopping" };
        child.stdin.write("stop\n");
      } else if (action === "cancel" && child) {
        close();
        state = { state: "cancelled", text: "" };
      }
      return { ...state, available };
    },
  };
}
