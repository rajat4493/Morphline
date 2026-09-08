"use client";

import { useMemo } from "react";
import ReactFlow, {
  Background,
  Controls,
  Edge,
  Handle,
  MarkerType,
  Node,
  Position,
  ReactFlowProvider,
} from "reactflow";
import dagre from "dagre";
import "reactflow/dist/style.css";
import { FlowGraph as FlowGraphData } from "@/lib/api";

const CATEGORY_LEGEND: { category: string; color: string; label: string }[] = [
  { category: "DETERMINISTIC", color: "#2563eb", label: "Deterministic RPA step" },
  { category: "REASONING", color: "#7c3aed", label: "Reasoning / potential agent step" },
  { category: "API_TOOL", color: "#16a34a", label: "API / deterministic tool" },
  { category: "HUMAN_APPROVAL", color: "#ea580c", label: "Human approval" },
  { category: "RISK", color: "#dc2626", label: "Risk / blocker" },
  { category: "UNKNOWN", color: "#6b7280", label: "Unknown / unresolved" },
];

function StepNode({ data }: { data: FlowGraphData["nodes"][number]["data"] }) {
  return (
    <div
      className="rounded-md border bg-white px-3 py-2 shadow-sm min-w-[180px] max-w-[220px]"
      style={{ borderColor: data.color, borderLeftWidth: 4 }}
    >
      <Handle type="target" position={Position.Top} className="!bg-slate-400" />
      <div className="text-[10px] uppercase tracking-wide text-subtle">{data.workflow}</div>
      <div className="text-sm font-medium text-ink leading-tight mt-0.5">{data.label}</div>
      <div className="text-[11px] text-subtle mt-0.5">{data.activityType}</div>
      {data.confidence === "UNKNOWN" && (
        <div className="text-[10px] text-amber-600 mt-1 font-medium">UNCONFIRMED</div>
      )}
      <Handle type="source" position={Position.Bottom} className="!bg-slate-400" />
    </div>
  );
}

const nodeTypes = { processStep: StepNode };

function layout(nodes: FlowGraphData["nodes"], edges: FlowGraphData["edges"]) {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: "TB", nodesep: 40, ranksep: 70 });

  nodes.forEach((n) => g.setNode(n.id, { width: 220, height: 70 }));
  edges.forEach((e) => g.setEdge(e.source, e.target));
  dagre.layout(g);

  return nodes.map((n) => {
    const pos = g.node(n.id);
    return { ...n, position: { x: pos?.x ?? 0, y: pos?.y ?? 0 } };
  });
}

export function FlowGraph({ data, onSelectNode }: { data: FlowGraphData; onSelectNode: (nodeId: string | null) => void }) {
  const { nodes, edges } = useMemo(() => {
    const laidOut = layout(data.nodes, data.edges);
    const rfNodes: Node[] = laidOut.map((n) => ({
      id: n.id,
      type: "processStep",
      position: n.position,
      data: n.data,
    }));
    const rfEdges: Edge[] = data.edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      animated: e.type === "invoke",
      style: {
        stroke: e.type === "invoke" ? "#7c3aed" : e.type === "containment" ? "#cbd5e1" : "#94a3b8",
        strokeDasharray: e.type === "containment" ? "4 3" : undefined,
      },
      markerEnd: { type: MarkerType.ArrowClosed, color: "#94a3b8" },
    }));
    return { nodes: rfNodes, edges: rfEdges };
  }, [data]);

  return (
    <div className="rounded-lg border border-line bg-white">
      <div className="h-[560px]">
        <ReactFlowProvider>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            fitView
            onNodeClick={(_, node) => onSelectNode(node.id)}
            onPaneClick={() => onSelectNode(null)}
          >
            <Background gap={16} color="#e2e8f0" />
            <Controls showInteractive={false} />
          </ReactFlow>
        </ReactFlowProvider>
      </div>
      <div className="flex flex-wrap gap-4 border-t border-line px-4 py-2.5">
        {CATEGORY_LEGEND.map((l) => (
          <div key={l.category} className="flex items-center gap-1.5 text-xs text-subtle">
            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: l.color }} />
            {l.label}
          </div>
        ))}
      </div>
    </div>
  );
}
