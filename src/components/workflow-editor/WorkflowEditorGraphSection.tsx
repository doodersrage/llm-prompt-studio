'use client';

import { ReactFlow, Background, Controls, MiniMap } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import ComfyNodeCard from '@/components/workflow-editor/ComfyNodeCard';
import { Button, PrimaryButton } from '@/components/ui/Button';
import { FieldLabel, TextArea, TextInput } from '@/components/ui/Field';
import { ToolSection } from '@/components/ui/ToolPageShell';
import { listEditableWidgets } from '@/lib/workflow-react-flow';
import type { useWorkflowEditorToolOrchestration } from '@/hooks/useWorkflowEditorToolOrchestration';

const nodeTypes = { comfy: ComfyNodeCard };

type ViewModel = ReturnType<typeof useWorkflowEditorToolOrchestration>;

type Props = Pick<
  ViewModel,
  | 'library'
  | 'selectedId'
  | 'setSelectedId'
  | 'rawJson'
  | 'setRawJson'
  | 'status'
  | 'busyAction'
  | 'selectedNodeId'
  | 'setSelectedNodeId'
  | 'nodes'
  | 'edges'
  | 'onNodesChange'
  | 'onEdgesChange'
  | 'onConnect'
  | 'flowTheme'
  | 'selectedRf'
  | 'onLoadLibrary'
  | 'onLoadJson'
  | 'onSaveLibrary'
  | 'onOptimize'
  | 'onSetActive'
  | 'onDryRun'
  | 'onQueue'
  | 'updateNodeWidget'
>;

export default function WorkflowEditorGraphSection({
  library,
  selectedId,
  setSelectedId,
  rawJson,
  setRawJson,
  status,
  busyAction,
  selectedNodeId,
  setSelectedNodeId,
  nodes,
  edges,
  onNodesChange,
  onEdgesChange,
  onConnect,
  flowTheme,
  selectedRf,
  onLoadLibrary,
  onLoadJson,
  onSaveLibrary,
  onOptimize,
  onSetActive,
  onDryRun,
  onQueue,
  updateNodeWidget,
}: Props) {
  return (
    <>
      <ToolSection title="Source">
        <div className="flex flex-wrap gap-2">
          <select
            className="ui-input min-h-10 min-w-[220px]"
            value={selectedId}
            onChange={event => setSelectedId(event.target.value)}
            aria-label="Library workflow"
          >
            <option value="">Library workflow…</option>
            {library.map(file => (
              <option key={file.id} value={file.id}>
                {file.name}
              </option>
            ))}
          </select>
          <Button type="button" variant="secondary" onClick={onLoadLibrary}>
            Open
          </Button>
          <Button type="button" variant="secondary" onClick={onLoadJson}>
            Parse JSON
          </Button>
          <Button type="button" variant="secondary" onClick={onSaveLibrary}>
            Save to library
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={onOptimize}
            disabled={nodes.length === 0 || busyAction === 'optimize'}
          >
            Optimize
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={onSetActive}
            disabled={nodes.length === 0}
          >
            Set active
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => void onDryRun()}
            disabled={nodes.length === 0 || busyAction === 'dry-run'}
          >
            Dry-run
          </Button>
          <PrimaryButton
            type="button"
            onClick={() => void onQueue()}
            disabled={nodes.length === 0}
            data-testid="workflow-editor-queue"
          >
            Queue
          </PrimaryButton>
        </div>
        <FieldLabel>Workflow JSON</FieldLabel>
        <TextArea
          rows={4}
          value={rawJson}
          onChange={event => setRawJson(event.target.value)}
          className="font-mono text-xs"
          placeholder="Paste Comfy API-format workflow JSON…"
          data-testid="workflow-editor-json"
        />
        {status ? (
          <p className="text-xs text-[var(--text-muted)]" data-testid="workflow-editor-status">
            {status}
          </p>
        ) : null}
      </ToolSection>

      <ToolSection title="Graph">
        <div className="ui-workflow-canvas h-[480px]">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            nodeTypes={nodeTypes}
            onNodeClick={(_, node) => setSelectedNodeId(node.id)}
            fitView
            colorMode={flowTheme}
          >
            <Background
              gap={18}
              color={flowTheme === 'light' ? 'rgb(15 23 42 / 0.12)' : 'rgb(255 255 255 / 0.08)'}
            />
            <Controls className="!overflow-hidden !rounded-xl !border ![border-color:var(--border-subtle)] ![background:var(--bg-elevated)]" />
            <MiniMap
              pannable
              zoomable
              className="!overflow-hidden !rounded-xl !border ![border-color:var(--border-subtle)]"
              maskColor={flowTheme === 'light' ? 'rgb(243 244 248 / 0.7)' : 'rgb(12 12 16 / 0.7)'}
              nodeColor={() => 'var(--accent)'}
            />
          </ReactFlow>
        </div>
      </ToolSection>

      {selectedRf ? (
        <ToolSection title={`Edit · ${selectedRf.data.title}`}>
          <div className="grid gap-3 sm:grid-cols-2">
            {listEditableWidgets(selectedRf.data.inputs).map(widget => (
              <label key={widget.key} className="space-y-1 text-xs text-[var(--text-muted)]">
                {widget.key}
                <TextInput
                  value={String(widget.value)}
                  onChange={event => {
                    const raw = event.target.value;
                    const asNum = Number(raw);
                    const nextValue =
                      typeof widget.value === 'number' && Number.isFinite(asNum)
                        ? asNum
                        : typeof widget.value === 'boolean'
                          ? raw === 'true'
                          : raw;
                    updateNodeWidget(selectedRf.id, widget.key, nextValue);
                  }}
                />
              </label>
            ))}
          </div>
        </ToolSection>
      ) : null}
    </>
  );
}
