import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { REQUIRED_FLOWS } from './flows.js';

/**
 * The committed flow JSON is the contract between the API and Langflow (flows/README.md).
 * These checks read the files as the editor and the importer do, so a regenerated or
 * hand-edited flow cannot quietly lose a connection or pick up a legacy component.
 */
const dir = new URL('../../../flows/', import.meta.url);

type Output = { name: string; group_outputs?: boolean };
type Node = { id: string; data: { node: { legacy?: boolean; outputs?: Output[] } } };
type Edge = { source: string; target: string; data: { sourceHandle: { name: string } } };
type Flow = { endpoint_name: string; data: { nodes: Node[]; edges: Edge[] } };

const flows = readdirSync(dir)
  .filter((f) => f.endsWith('.json'))
  .map((f) => [f, JSON.parse(readFileSync(new URL(f, dir), 'utf8')) as Flow] as const);

describe('flows/*.json', () => {
  it('has one file per flow the API runs', () => {
    expect(flows.map(([, flow]) => flow.endpoint_name).sort()).toEqual([...REQUIRED_FLOWS].sort());
  });

  describe.each(flows)('%s', (_file, flow) => {
    const wiredOutputs = (id: string) =>
      new Set(flow.data.edges.filter((e) => e.source === id).map((e) => e.data.sourceHandle.name));

    it('wires no output the editor would drop', () => {
      // Langflow renders a component whose outputs are all group_outputs: false as one dropdown
      // handle, pins it to the FIRST output when the flow opens, and removes every edge from
      // another output ("Some connections were removed because they were invalid"). So a node
      // with several such outputs may wire only its first one.
      for (const node of flow.data.nodes) {
        const outputs = node.data.node.outputs ?? [];
        if (outputs.length < 2 || outputs.some((o) => o.group_outputs)) continue;
        const wired = [...wiredOutputs(node.id)];
        expect(wired.length, `${node.id} wires ${wired.join(', ')} from one dropdown handle`).toBeLessThan(2);
        if (wired.length === 1) expect(wired[0]).toBe(outputs[0]!.name);
      }
    });

    it('uses no legacy component', () => {
      const legacy = flow.data.nodes.filter((n) => n.data.node.legacy).map((n) => n.id);
      expect(legacy).toEqual([]);
    });

    it('connects every edge to a node that is in the flow', () => {
      const ids = new Set(flow.data.nodes.map((n) => n.id));
      for (const edge of flow.data.edges) {
        expect(ids).toContain(edge.source);
        expect(ids).toContain(edge.target);
      }
    });
  });
});
