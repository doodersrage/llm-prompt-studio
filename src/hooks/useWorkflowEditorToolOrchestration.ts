'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  useNodesState,
  useEdgesState,
  addEdge,
  type Connection,
  type Edge,
  type Node,
} from '@xyflow/react';
import {
  APP_THEME_CHANGED_EVENT,
  loadAppTheme,
  resolveAppTheme,
  type ResolvedAppTheme,
} from '@/lib/theme-store';
import { useCachedSettings } from '@/hooks/useCachedSettings';
import { usePromptResultActions } from '@/hooks/usePromptResultActions';
import {
  comfyApiWorkflowToReactFlow,
  reactFlowToComfyApiWorkflow,
  updateWorkflowNodeWidget,
  type WorkflowRfNode,
} from '@/lib/workflow-react-flow';
import { parseWorkflowJson } from '@/lib/comfyui-config';
import {
  loadComfyWorkflowFiles,
  saveComfyWorkflowFiles,
  type ComfyWorkflowFile,
} from '@/lib/comfyui-workflow-files';
import { optimizeWorkflowForQueue } from '@/lib/workflow-queue-optimizer';
import { assignWorkflowToInferredModels } from '@/lib/model-workflow-map';
import { loadSettingsCache, saveSharedSettings } from '@/lib/settings-cache';
import { placeholderTokensFromSettings, loadComfyUiSettings } from '@/lib/comfyui-settings';
import { fetchWorkflowPreview } from '@/lib/comfyui-requeue';
import { inferModelsFromWorkflowLabel } from '@/lib/workflow-category-defaults';

export function useWorkflowEditorToolOrchestration() {
  const { shared, updateShared } = useCachedSettings('format', {
    mode: 'positive',
    smartFormat: true,
    draft: '',
  });
  const actions = usePromptResultActions({
    tool: 'workflow-editor',
    model: shared.model,
  });
  const [library, setLibrary] = useState<ComfyWorkflowFile[]>(() =>
    typeof window === 'undefined' ? [] : loadComfyWorkflowFiles()
  );
  const [selectedId, setSelectedId] = useState<string>('');
  const [rawJson, setRawJsonState] = useState('');
  const rawJsonRef = useRef('');
  const setRawJson = useCallback((value: string) => {
    rawJsonRef.current = value;
    setRawJsonState(value);
  }, []);
  const [status, setStatus] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [flowTheme, setFlowTheme] = useState<ResolvedAppTheme>('dark');

  useEffect(() => {
    const sync = () => setFlowTheme(resolveAppTheme(loadAppTheme()));
    sync();
    window.addEventListener(APP_THEME_CHANGED_EVENT, sync);
    return () => window.removeEventListener(APP_THEME_CHANGED_EVENT, sync);
  }, []);

  const loadWorkflowObject = useCallback(
    (workflow: Record<string, unknown>, label: string) => {
      const { nodes: nextNodes, edges: nextEdges } = comfyApiWorkflowToReactFlow(workflow);
      setNodes(nextNodes as Node[]);
      setEdges(nextEdges as Edge[]);
      const pretty = JSON.stringify(workflow, null, 2);
      setRawJson(pretty);
      setStatus(`Loaded ${label} · ${nextNodes.length} nodes`);
      setSelectedNodeId(null);
    },
    [setEdges, setNodes, setRawJson]
  );

  const onLoadLibrary = useCallback(() => {
    const file = library.find(entry => entry.id === selectedId);
    if (!file?.workflowJson?.trim()) {
      setStatus('Pick a library workflow with JSON.');
      return;
    }
    try {
      const parsed = parseWorkflowJson(file.workflowJson);
      if (!parsed) {
        setStatus('Workflow JSON parsed to empty.');
        return;
      }
      loadWorkflowObject(parsed, file.name);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Parse failed.');
    }
  }, [library, loadWorkflowObject, selectedId]);

  const onLoadJson = useCallback(() => {
    try {
      // Prefer the live textarea value over React state — Playwright (and fast paste+click)
      // can fire Parse before the controlled onChange commit lands, which used to surface
      // "JSON parsed to empty." despite the textarea already holding a valid graph.
      const live =
        typeof document !== 'undefined'
          ? (
              document.querySelector(
                '[data-testid="workflow-editor-json"]'
              ) as HTMLTextAreaElement | null
            )?.value
          : undefined;
      const source = live ?? rawJsonRef.current;
      if (live != null && live !== rawJsonRef.current) {
        setRawJson(live);
      }
      const parsed = parseWorkflowJson(source);
      if (!parsed) {
        setStatus('JSON parsed to empty.');
        return;
      }
      loadWorkflowObject(parsed, 'pasted JSON');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Parse failed.');
    }
  }, [loadWorkflowObject, setRawJson]);

  const onConnect = useCallback(
    (connection: Connection) => {
      setEdges(eds => addEdge(connection, eds));
    },
    [setEdges]
  );

  const selectedRf = useMemo(() => {
    if (!selectedNodeId) {
      return null;
    }
    return (nodes as WorkflowRfNode[]).find(node => node.id === selectedNodeId) ?? null;
  }, [nodes, selectedNodeId]);

  const buildWorkflowFromGraph = useCallback(() => {
    return reactFlowToComfyApiWorkflow(
      nodes as WorkflowRfNode[],
      edges as import('@/lib/workflow-react-flow').WorkflowRfEdge[]
    );
  }, [edges, nodes]);

  const onSaveLibrary = useCallback(() => {
    const workflow = buildWorkflowFromGraph();
    const json = JSON.stringify(workflow, null, 2);
    const existing = loadComfyWorkflowFiles();
    const name = selectedId
      ? (existing.find(entry => entry.id === selectedId)?.name ?? 'Edited workflow')
      : 'Edited workflow';
    const id = selectedId || `wf-editor-${Date.now().toString(36)}`;
    const now = Date.now();
    const nextFile: ComfyWorkflowFile = {
      id,
      name,
      workflowJson: json,
      createdAt: existing.find(entry => entry.id === id)?.createdAt ?? now,
    };
    const next = [nextFile, ...existing.filter(entry => entry.id !== id)];
    saveComfyWorkflowFiles(next);
    setLibrary(next);
    setRawJson(json);
    setSelectedId(id);
    setStatus(`Saved “${name}” to workflow library.`);
    return nextFile;
  }, [buildWorkflowFromGraph, selectedId, setRawJson]);

  const onOptimize = useCallback(() => {
    if (nodes.length === 0) {
      setStatus('Load a workflow first.');
      return;
    }
    setBusyAction('optimize');
    try {
      const workflow = buildWorkflowFromGraph();
      const tokens = placeholderTokensFromSettings(loadComfyUiSettings());
      const optimized = optimizeWorkflowForQueue({
        workflow,
        tokens,
        model: shared.model,
        qualityProfile: shared.queueQualityProfile,
      });
      loadWorkflowObject(optimized.workflow, 'optimized graph');
      const changeNotes = optimized.changes
        .filter(change => change.kind !== 'audit')
        .slice(0, 2)
        .map(change => change.message);
      setStatus(
        changeNotes.length > 0
          ? `Optimized for ${shared.model} · ${changeNotes.join(' · ')}.`
          : `Optimized for ${shared.model} · ${optimized.changes.length} note(s).`
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Optimize failed.');
    } finally {
      setBusyAction(null);
    }
  }, [
    buildWorkflowFromGraph,
    loadWorkflowObject,
    nodes.length,
    shared.model,
    shared.queueQualityProfile,
  ]);

  const onSetActive = useCallback(() => {
    const saved = onSaveLibrary();
    if (!saved) {
      return;
    }
    const inferred = inferModelsFromWorkflowLabel({
      name: saved.name,
      filename: `${saved.name}.json`,
    });
    const models = inferred.length > 0 ? inferred : [shared.model];
    const cache = loadSettingsCache();
    const nextMap = assignWorkflowToInferredModels(
      saved.id,
      models,
      cache.shared.modelWorkflowMap,
      true
    );
    saveSharedSettings(
      {
        ...cache.shared,
        modelWorkflowMap: nextMap,
        selectedWorkflowFileId: saved.id,
      },
      { notify: false }
    );
    updateShared({ modelWorkflowMap: nextMap, selectedWorkflowFileId: saved.id });
    setStatus(`Active workflow set for ${models.join(', ')}.`);
  }, [onSaveLibrary, shared.model, updateShared]);

  const onDryRun = useCallback(async () => {
    if (nodes.length === 0) {
      setStatus('Load a workflow first.');
      return;
    }
    setBusyAction('dry-run');
    setStatus('Dry-run preview…');
    try {
      const saved = onSaveLibrary();
      const workflow = buildWorkflowFromGraph();
      const positive = Object.values(workflow).find(node => {
        const n = node as { class_type?: string; inputs?: { text?: string } };
        return (
          n.class_type === 'CLIPTextEncode' &&
          typeof n.inputs?.text === 'string' &&
          n.inputs.text.trim()
        );
      }) as { inputs?: { text?: string } } | undefined;
      const prompt = positive?.inputs?.text?.trim() || 'workflow editor dry-run';
      const preview = await fetchWorkflowPreview({
        prompt,
        model: shared.model,
        comfy: {
          ...loadComfyUiSettings(),
          workflowJson: JSON.stringify(workflow),
          workflowFileId: saved?.id,
        },
      });
      if (preview.error) {
        setStatus(preview.error);
        return;
      }
      const issues = preview.preflightIssues?.length
        ? ` · ${preview.preflightIssues.length} preflight issue(s)`
        : '';
      setStatus(`Dry-run ok · source ${preview.workflowSource ?? 'editor'}${issues}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Dry-run failed.');
    } finally {
      setBusyAction(null);
    }
  }, [buildWorkflowFromGraph, nodes.length, onSaveLibrary, shared.model]);

  const onQueue = useCallback(async () => {
    const workflow = buildWorkflowFromGraph();
    const positive = Object.values(workflow).find(node => {
      const n = node as { class_type?: string; inputs?: { text?: string } };
      return (
        n.class_type === 'CLIPTextEncode' &&
        typeof n.inputs?.text === 'string' &&
        n.inputs.text.trim()
      );
    }) as { inputs?: { text?: string } } | undefined;
    const prompt = positive?.inputs?.text?.trim() || 'workflow editor queue';
    setStatus('Queueing from editor…');
    onSaveLibrary();
    await actions.sendComfyUi(prompt);
    setStatus(actions.comfyUiStatus ?? 'Queued.');
  }, [actions, buildWorkflowFromGraph, onSaveLibrary]);

  const updateNodeWidget = useCallback(
    (nodeId: string, key: string, value: unknown) => {
      setNodes(
        current =>
          updateWorkflowNodeWidget(
            current as WorkflowRfNode[],
            nodeId,
            key,
            value as string | number | boolean
          ) as Node[]
      );
    },
    [setNodes]
  );

  return {
    actions,
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
  };
}
