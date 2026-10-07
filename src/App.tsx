import { AfterRunOffer } from "@/components/dialogs/AfterRunOffer";
import { FlightCheck } from "@/components/dialogs/FlightCheck";
import { NodeInspectModal } from "@/components/canvas/NodeInspectModal";
import { ChatPanel } from "@/components/chat/ChatPanel";
import { FlowCanvas } from "@/components/canvas/FlowCanvas";
import { BottomPanel } from "@/components/console/BottomPanel";
import { ApplyConfirmModal } from "@/components/dialogs/ApplyConfirmModal";
import { DesktopSetupModal } from "@/components/dialogs/DesktopSetupModal";
import { NotebookEditor } from "@/components/editor/NotebookEditor";
import { PythonEditor } from "@/components/editor/PythonEditor";
import { YamlEditor } from "@/components/editor/YamlEditor";
import { InspectorPanel } from "@/components/inspector/InspectorPanel";
import { LeftSidebar } from "@/components/layout/LeftSidebar";
import { ResizeHandle } from "@/components/layout/ResizeHandle";
import { StudioHeader } from "@/components/layout/StudioHeader";
import { usePanelSize } from "@/hooks/usePanelSize";
import { useAgentStore } from "@/store/agentStore";
import { useChatStore } from "@/store/chatStore";
import { useStudioStore } from "@/store/studioStore";
import { useEffect } from "react";

function RightInspector() {
  const { size: width, handleProps } = usePanelSize({
    storageKey: "as.layout.rightWidth",
    defaultSize: 300,
    min: 220,
    max: 560,
    axis: "x",
    invert: true, // handle on left edge: drag left → wider
  });

  return (
    <aside
      className="relative flex h-full min-h-0 shrink-0 flex-col border-l border-navy-700 bg-navy-900 dark:bg-navy-900/70"
      style={{ width }}
    >
      <ResizeHandle axis="x" edge="left" {...handleProps} />
      <div className="min-h-0 flex-1 overflow-hidden">
        <InspectorPanel />
      </div>
    </aside>
  );
}

export default function App() {
  const view = useStudioStore((s) => s.view);
  const workspaceId = useStudioStore((s) => s.document.workspace.id);
  const isCodeLab = view === "python" || view === "notebook";

  useEffect(() => {
    void useAgentStore.getState().refresh(workspaceId);
  }, [workspaceId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      if (!meta) return;
      const key = e.key.toLowerCase();
      if (key === "j") {
        e.preventDefault();
        useChatStore.getState().toggle();
        useAgentStore.getState().setMode("brain");
      } else if (key === "e" && e.shiftKey) {
        e.preventDefault();
        useStudioStore.getState().setBottomOpen(true);
        useStudioStore.getState().setBottomTab("runs");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="relative flex h-full flex-col">
      <StudioHeader />
      <div className="relative flex min-h-0 flex-1">
        <LeftSidebar />
        <main className="flex min-w-0 flex-1 flex-col">
          <div className="flex min-h-0 flex-1">
            {view === "python" && (
              <div className="min-w-0 flex-1">
                <PythonEditor />
              </div>
            )}
            {view === "notebook" && (
              <div className="min-w-0 flex-1">
                <NotebookEditor />
              </div>
            )}
            {(view === "canvas" || view === "split") && (
              <div
                className={
                  view === "split" ? "min-w-0 flex-[1.2]" : "min-w-0 flex-1"
                }
              >
                <FlowCanvas />
              </div>
            )}
            {(view === "yaml" || view === "split") && (
              <div className="min-w-0 flex-1">
                <YamlEditor />
              </div>
            )}
            {!isCodeLab && <RightInspector />}
          </div>
          <BottomPanel />
        </main>
      </div>
      <ApplyConfirmModal />
      <DesktopSetupModal />
      <FlightCheck />
      <AfterRunOffer />
      <ChatPanel />
      <NodeInspectModal />
    </div>
  );
}
