import { describe, expect, it } from 'vitest';
import { buildGraph } from './buildGraph';
import { graphBounds, layoutGraph, rotateGraph, snapshotPositions, syncSpatialPosition } from './layout';
import * as sphere from './layout';
import { sampleKnowledge } from '../data/sampleKnowledge';

describe('spherical knowledge layout', () => {
  it('gives real knowledge nodes front and back depth without changing their relationships', () => {
    const graph = buildGraph(sampleKnowledge);
    const relationships = JSON.stringify(graph.edges);
    layoutGraph(graph);
    for (const node of graph.nodes) {
      expect(node).toHaveProperty('spatial');
      expect(Number.isFinite(node.x) && Number.isFinite(node.y)).toBe(true);
    }
    const positions = snapshotPositions(graph);
    const depths = [...positions.values()].map((point) => point.spatial?.z ?? 0);
    expect(Math.min(...depths)).toBeLessThan(-200);
    expect(Math.max(...depths)).toBeGreaterThan(200);
    expect(JSON.stringify(graph.edges)).toBe(relationships);
  });

  it('preserves the current layout when importing more knowledge', () => {
    const graph = buildGraph(sampleKnowledge);
    layoutGraph(graph);
    rotateGraph(graph, 0.6, -0.3);
    const positions = snapshotPositions(graph);
    const expanded = buildGraph({ ...sampleKnowledge, topics: [...sampleKnowledge.topics, {
      ...sampleKnowledge.topics[0], id: 'imported-topic', docs: [],
    }] });
    layoutGraph(expanded, { preserve: positions });
    for (const node of graph.nodes) {
      const next = expanded.byId.get(node.id)!;
      expect({ x: next.x, y: next.y }).toEqual({ x: node.x, y: node.y });
      expect(next.spatial).toEqual(node.spatial);
    }
    expect(expanded.byId.get('imported-topic')).toHaveProperty('spatial');
  });

  it('rotates a point into the rear hemisphere with the expected axis direction', () => {
    const graph = buildGraph(sampleKnowledge);
    graph.nodes[0].spatial = { x: 500, y: 0, z: 0 };
    rotateGraph(graph, Math.PI / 2, 0);
    const point = graph.nodes[0];
    expect(point.spatial!.x).toBeCloseTo(0);
    expect(point.spatial!.y).toBeCloseTo(0);
    expect(point.spatial!.z).toBeCloseTo(-500);
    expect(point.x).toBeCloseTo(0);
    expect(point.y).toBeCloseTo(0);
  });

  it('keeps a far-dragged node from flipping through the camera when rotated', () => {
    const graph = buildGraph(sampleKnowledge);
    const node = graph.nodes[0];
    node.spatial = { x: 0, y: 0, z: 0 };
    node.x = 5000;
    node.y = 0;
    syncSpatialPosition(node);
    rotateGraph(graph, -Math.PI / 6, 0);
    expect(node.x).toBeGreaterThan(0);
    expect(Number.isFinite(node.x)).toBe(true);
  });

  it('places some knowledge inside the globe while keeping the main topics on its surface', () => {
    const graph = buildGraph(sampleKnowledge);
    layoutGraph(graph);
    const radius = (node: typeof graph.nodes[number]) => Math.hypot(node.spatial!.x, node.spatial!.y, node.spatial!.z);
    expect(Math.min(...graph.nodes.filter(node => node.kind !== 'topic').map(radius))).toBeLessThan(440);
    for (const topic of graph.nodes.filter(node => node.kind === 'topic')) expect(radius(topic)).toBeCloseTo(500);
  });

  it('fits the full sphere even when a small knowledge base only has one visible topic', () => {
    const graph = buildGraph({ ...sampleKnowledge, topics: [{ ...sampleKnowledge.topics[0], docs: [] }] });
    layoutGraph(graph);
    const bounds = graphBounds(graph);
    expect(bounds.minX).toBeLessThan(-520);
    expect(bounds.maxX).toBeGreaterThan(520);
    expect(bounds.minY).toBeLessThan(-520);
    expect(bounds.maxY).toBeGreaterThan(520);
  });

  it('curves a relationship in 3D while preserving both exact knowledge endpoints', () => {
    expect(sphere.sampleSphereArc).toBeTypeOf('function');
    const a = { x: 500, y: 0, z: 0 };
    const b = { x: 0, y: 0, z: 500 };
    const arc = sphere.sampleSphereArc(a, b);
    expect(arc[0]).toEqual(a);
    expect(arc.at(-1)).toEqual(b);
    expect(arc[Math.floor(arc.length / 2)].x).toBeGreaterThan(280);
    expect(arc[Math.floor(arc.length / 2)].z).toBeGreaterThan(280);
    expect(arc.every(point => Math.hypot(point.x, point.y, point.z) <= 500.001)).toBe(true);
  });

  it('keeps arcs between opposite poles finite and reversible', () => {
    expect(sphere.sampleSphereArc).toBeTypeOf('function');
    const a = { x: 500, y: 0, z: 0 };
    const b = { x: -500, y: 0, z: 0 };
    const forward = sphere.sampleSphereArc(a, b);
    const backward = sphere.sampleSphereArc(b, a).reverse();
    forward.forEach((point, index) => {
      expect(Number.isFinite(point.x + point.y + point.z)).toBe(true);
      expect(point.x).toBeCloseTo(backward[index].x);
      expect(point.y).toBeCloseTo(backward[index].y);
      expect(point.z).toBeCloseTo(backward[index].z);
    });
  });
});
