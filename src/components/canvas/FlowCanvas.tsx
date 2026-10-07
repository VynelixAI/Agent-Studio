import { useCallback, useEffect, useRef } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  addEdge,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type Node,
  type OnSelectionChangeParams,
} from "@xyflow/react";
import { StudioFlowNode } from "@/components/canvas/StudioFlowNode";
import { CanvasOnboarding } from "@/components/canvas/CanvasOnboarding";
import { useAgentStore, type NodeMemory } from "@/store/agentStore";
import { useStudioStore } from "@/store/studioStore";
import { useThemeStore } from "@/store/themeStore";
import type { FlowEdge, FlowNode } from "@/types/workspace";

const nodeTypes = { studio: StudioFlowNode };

function toRfNodes(
  nodes: FlowNode[],
  selectedNodeId: string | null,
  memory: Record<string, NodeMemory>,
): Node[] {
  return nodes.map((n) => ({
    id: n.id,
    type: "studio",
    position: n.position ?? { x: 0, y: 0 },
    selected: n.id === selectedNodeId,
    data: {
      label: n.label ?? n.id,
      type: n.type,
      category: n.category,
      memory: memory[n.id],
    },
  }));
}

function toRfEdges(edges: FlowEdge[], memory: Record<string, NodeMemory>): Edge[] {
  return edges.map((e) => {
    const status = memory[e.source]?.status;
    const stroke =
      status === "success" ? "#34d399" : status === "failed" ? "#fb7185" : undefined;
    return {
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: e.sourceHandle,
      targetHandle: e.targetHandle,
      label: e.label,
      animated: status === "success" || status === "running",
      style: stroke ? { stroke, strokeWidth: 2 } : undefined,
    };
  });
}

export function FlowCanvas() {
  const document = useStudioStore((s) => s.document);
  const selectedNodeId = useStudioStore((s) => s.selectedNodeId);
  const setNodesDoc = useStudioStore((s) => s.setNodes);
  const setEdgesDoc = useStudioStore((s) => s.setEdges);
  const selectNode = useStudioStore((s) => s.selectNode);
  const addNode = useStudioStore((s) => s.addNode);
  const removeNode = useStudioStore((s) => s.removeNode);
  const theme = useThemeStore((s) => s.theme);
  const isDark = theme === "dark";
  const rfDots = isDark ? "#1e293b" : "#cbd5e1";
  const rfMask = isDark ? "rgba(5,7,13,0.72)" : "rgba(255,255,255,0.92)";
  const edgeAccent = isDark ? "#22d3ee" : "#06b6d4";

  const docKey = useStudioStore((s) => s.document.workspace.id);
  const syncingFrom = useStudioStore((s) => s.syncingFrom);
  const yamlRevision = useStudioStore((s) =>
    s.syncingFrom === "yaml"
      ? s.yamlText.length + s.document.flow.nodes.map((n) => n.id).join()
      : 0,
  );

  const memory = useAgentStore((s) => s.memory);
  const [nodes, setNodes, onNodesChange] = useNodesState(
    toRfNodes(document.flow.nodes, selectedNodeId, memory),
  );
  const [edges, setEdges, onEdgesChange] = useEdgesState(
    toRfEdges(document.flow.edges, memory),
  );

  /** Ignore empty selection events while we re-sync RF nodes from the store */
  const syncGuardRef = useRef(0);

  useEffect(() => {
    syncGuardRef.current += 1;
    const guard = syncGuardRef.current;
    const sel = useStudioStore.getState().selectedNodeId;
    setNodes(toRfNodes(document.flow.nodes, sel, memory));
    setEdges(toRfEdges(document.flow.edges, memory));
    // React Flow may emit onSelectionChange([]) during replace — hold the guard briefly
    const t = window.setTimeout(() => {
      if (syncGuardRef.current === guard) syncGuardRef.current = 0;
    }, 50);
    return () => window.clearTimeout(t);
  }, [
    docKey,
    yamlRevision,
    syncingFrom,
    document.flow.nodes,
    document.flow.edges,
    memory,
    setNodes,
    setEdges,
  ]);

  useEffect(() => {
    setNodes((ns) =>
      ns.map((n) => ({
        ...n,
        selected: n.id === selectedNodeId,
      })),
    );
  }, [selectedNodeId, setNodes]);

  const persistGraph = useCallback(
    (nextNodes: Node[], nextEdges: Edge[]) => {
      const flowNodes: FlowNode[] = nextNodes.map((n) => {
        const existing = document.flow.nodes.find((x) => x.id === n.id);
        return {
          id: n.id,
          category: (existing?.category ??
            (n.data as { category: string }).category) as FlowNode["category"],
          type: existing?.type ?? (n.data as { type: string }).type,
          label: existing?.label ?? (n.data as { label: string }).label,
          connector: existing?.connector,
          inputs: existing?.inputs,
          outputs: existing?.outputs,
          config: existing?.config,
          position: n.position,
        };
      });
      const flowEdges: FlowEdge[] = nextEdges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        sourceHandle: e.sourceHandle ?? undefined,
        targetHandle: e.targetHandle ?? undefined,
        label: typeof e.label === "string" ? e.label : undefined,
      }));
      setNodesDoc(flowNodes);
      setEdgesDoc(flowEdges);
    },
    [document.flow.nodes, setNodesDoc, setEdgesDoc],
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      setEdges((eds) => {
        const next = addEdge(
          {
            ...connection,
            id: `e_${connection.source}_${connection.target}_${eds.length}`,
            animated: true,
          },
          eds,
        );
        persistGraph(nodes, next);
        return next;
      });
    },
    [nodes, persistGraph, setEdges],
  );

  const onNodeDragStop = useCallback(() => {
    persistGraph(nodes, edges);
  }, [nodes, edges, persistGraph]);

  const onNodesDelete = useCallback(
    (deleted: Node[]) => {
      for (const node of deleted) removeNode(node.id);
    },
    [removeNode],
  );

  const onEdgesDelete = useCallback(
    (deleted: Edge[]) => {
      const deletedIds = new Set(deleted.map((edge) => edge.id));
      setEdgesDoc(
        useStudioStore
          .getState()
          .document.flow.edges.filter((edge) => !deletedIds.has(edge.id)),
      );
    },
    [setEdgesDoc],
  );

  const onSelectionChange = useCallback(
    ({ nodes: selected }: OnSelectionChangeParams) => {
      // Config edits re-sync RF nodes and briefly report no selection — keep inspector open
      if (syncGuardRef.current > 0 && selected.length === 0) {
        return;
      }
      const nextId = selected[0]?.id ?? null;
      const current = useStudioStore.getState().selectedNodeId;
      if (nextId === current) return;
      selectNode(nextId);
    },
    [selectNode],
  );

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const type = e.dataTransfer.getData("application/vynelix-node");
      if (!type) return;
      const bounds = (e.target as HTMLElement)
        .closest(".react-flow")
        ?.getBoundingClientRect();
      if (!bounds) return;
      addNode(type, {
        x: e.clientX - bounds.left - 80,
        y: e.clientY - bounds.top - 30,
      });
    },
    [addNode],
  );

  return (
    <div className="relative h-full w-full" onDragOver={onDragOver} onDrop={onDrop}>
      <CanvasOnboarding />
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeDragStop={onNodeDragStop}
        onNodesDelete={onNodesDelete}
        onEdgesDelete={onEdgesDelete}
        onSelectionChange={onSelectionChange}
        nodeTypes={nodeTypes}
        fitView
        proOptions={{ hideAttribution: true }}
        colorMode={isDark ? "dark" : "light"}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={20}
          size={1}
          color={rfDots}
        />
        <Controls showInteractive={false} />
        <MiniMap
          nodeColor={() => edgeAccent}
          maskColor={rfMask}
          pannable
          zoomable
        />
      </ReactFlow>
    </div>
  );
}
