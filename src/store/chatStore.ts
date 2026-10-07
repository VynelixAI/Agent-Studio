import { create } from "zustand";
import { workspaceToYaml } from "@/core/yamlCodec";
import { ApiError, api } from "@/lib/api";
import { useStudioStore } from "@/store/studioStore";

export type ChatTurn = {
  role: "user" | "assistant" | "system";
  content: string;
  ts: string;
  runId?: string;
};

interface ChatState {
  open: boolean;
  sessionId: string | null;
  messages: ChatTurn[];
  sending: boolean;
  error: string | null;
  draft: string;
  setDraft: (v: string) => void;
  toggle: () => void;
  setOpen: (open: boolean) => void;
  newSession: () => void;
  send: () => Promise<void>;
}

const sessionKey = (workspaceId: string) => `vynelix-chat-session:${workspaceId}`;

export const useChatStore = create<ChatState>((set, get) => ({
  open: false,
  sessionId: null,
  messages: [],
  sending: false,
  error: null,
  draft: "",
  setDraft: (v) => set({ draft: v }),
  toggle: () => set((s) => ({ open: !s.open, error: null })),
  setOpen: (open) => set({ open }),
  newSession: () => {
    const id = useStudioStore.getState().document.workspace.id;
    try {
      localStorage.removeItem(sessionKey(id));
    } catch {
      /* ignore */
    }
    set({ sessionId: null, messages: [], error: null, draft: "" });
  },
  send: async () => {
    const text = get().draft.trim();
    if (!text || get().sending) return;
    const studio = useStudioStore.getState();
    const document = studio.document;
    const workspaceId = document.workspace.id;
    const pending = studio.pendingSecrets.map((s) => ({
      secretRef: s.secretRef,
      value: s.value,
      label: s.label,
    }));
    const optimistic: ChatTurn = {
      role: "user",
      content: text,
      ts: new Date().toISOString(),
    };
    set({
      sending: true,
      error: null,
      draft: "",
      messages: [...get().messages, optimistic],
    });
    try {
      const res = await api.sendChat(workspaceId, {
        message: text,
        sessionId: get().sessionId ?? undefined,
        document,
        yaml: workspaceToYaml(document),
        secrets: pending,
      });
      try {
        localStorage.setItem(sessionKey(workspaceId), res.sessionId);
      } catch {
        /* ignore */
      }
      set({
        sessionId: res.sessionId,
        messages: res.messages,
        sending: false,
      });
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Chat request failed";
      set({
        sending: false,
        error: message,
        messages: [
          ...get().messages,
          {
            role: "assistant",
            content: `Could not run the flow: ${message}`,
            ts: new Date().toISOString(),
          },
        ],
      });
    }
  },
}));
