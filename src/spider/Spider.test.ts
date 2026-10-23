import { describe, expect, it } from 'vitest';
import { Spider } from './Spider';
import { buildGraph } from '../graph/buildGraph';
import { sampleKnowledge } from '../data/sampleKnowledge';

function reachingSpider(x: number, y: number) {
  const node = { ...buildGraph(sampleKnowledge).nodes[0], id: 'touch-target', x, y };
  const spider = new Spider(100);
  spider.setNodes([node]);
  spider.heading = 0;
  const leg = spider.legs[0];
  leg.swing = { startedAt: 0, duration: 0.3, from: { x: 30, y: -30 }, toNodeId: node.id, liftScreen: 14, releasedAnchor: null };
  return { spider, leg, node };
}

describe('elastic tentacle contacts', () => {
  it('can attach moderately beyond its normal reach and keep the tip on the knowledge point', () => {
    const { spider, leg, node } = reachingSpider(135, -20);
    for (let frame = 0; frame < 60; frame++) spider.tick(1 / 120);
    expect(leg.anchorId).toBe(node.id);
    expect(spider.getFootWorld(leg)).toEqual({ x: node.x, y: node.y });
    expect(leg.extension).toBeGreaterThan(1.1);
  });

  it('emits a single contact for each physical landing, including support tentacles', () => {
    const { spider, leg, node } = reachingSpider(80, -40);
    for (let frame = 0; frame < 120; frame++) spider.tick(1 / 120);
    const contacts = spider.consumeEvents().filter(event => event.type === 'contact');
    expect(contacts).toEqual([{ type: 'contact', nodeId: node.id, legId: leg.spec.id }]);
    expect(leg.contactNodeId).toBe(node.id);
    expect(leg.contactAt).toBeGreaterThanOrEqual(0.3);
    expect(leg.contactAt).toBeLessThan(0.32);
  });

  it('never shows a landing on a node removed during the reach', () => {
    const { spider, leg } = reachingSpider(80, -40);
    spider.tick(0.15);
    spider.setNodes([]);
    spider.tick(0.3);
    expect(leg.anchorId).toBeNull();
    expect(spider.consumeEvents().filter(event => event.type === 'contact')).toEqual([]);
  });
});
