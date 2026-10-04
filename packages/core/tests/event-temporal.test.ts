import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  StrataGate, normalizeEventTemporal, normalizeSnapshot,
  type BlockSummarizer, type EventTemporal, type ExtractionContext,
} from '../src/index.js';
import { SqliteStorage } from '../src/sqlite.js';

const summarizer: BlockSummarizer = async (messages) => ({
  l0Title: messages[0]!.content, l0Tags: [], l1Summary: messages[0]!.content,
  l2Keypoints: [messages[0]!.content], shouldExtract: messages[0]!.content.startsWith('TARGET'),
});
const validTemporal: EventTemporal = {
  mentionedAt: '2026-10-01T08:00:00+08:00', happenedStart: '2026-09-30',
  happenedEnd: '2026-10-01', originalText: 'Yesterday', precision: 'range',
  basis: 'explicit', status: 'occurred', participants: ['用户', '助手'],
  participantNodeIds: ['node_1'], eventType: 'decision', threadId: 'thread_1',
  sameEventId: 'evt_old', beforeEventIds: ['evt_1'], afterEventIds: ['evt_2'],
  supersedesEventIds: ['evt_3'], conflictsWithEventIds: ['evt_4'], relatedEventIds: ['evt_5'],
};
const malformedParticipants = [
  { item: ['用户', '助手'] }, '用户', 123, ['用户', null], ['用户', 123], ['用户', {}], null, Array<string>(1),
].map((participants) => ({ participants }));

describe('EventTemporal runtime boundaries', () => {
  it.each(malformedParticipants)('drops malformed participants %j without changing other fields', ({ participants }) => {
    const result = normalizeEventTemporal({ ...validTemporal, participants });
    const { participants: _participants, ...rest } = validTemporal;
    expect(result).toEqual(rest);
  });

  it.each([null, undefined, 'temporal', 123, []].map((temporal) => ({ temporal })))('handles non-object temporal %j', ({ temporal }) => {
    expect(normalizeEventTemporal(temporal)).toEqual({});
  });

  it('preserves valid values and array order without mutating or aliasing the input', () => {
    const input = structuredClone(validTemporal);
    const result = normalizeEventTemporal(input);
    expect(result).toEqual(validTemporal);
    result.participants!.push('new');
    expect(input).toEqual(validTemporal);
    expect(normalizeEventTemporal({ participants: [] })).toEqual({ participants: [] });
  });

  it('drops malformed sibling string and reference-array fields', () => {
    const malformed = Object.fromEntries(Object.keys(validTemporal).map((field) => [field, { item: ['invalid'] }]));
    expect(normalizeEventTemporal(malformed)).toEqual({});
    for (const field of ['participantNodeIds', 'beforeEventIds', 'afterEventIds', 'supersedesEventIds',
      'conflictsWithEventIds', 'relatedEventIds']) {
      expect(normalizeEventTemporal({ [field]: ['valid', 123] })).toEqual({});
    }
  });

  it('normalizes direct writes and both snapshot Event pools without losing the Event', async () => {
    const memory = StrataGate.inMemory({ blockTurnSize: 1, summarizer });
    const block = (await memory.appendTurn({ user: 'SQLite decision', assistant: 'Recorded' })).sealedBlock!;
    const event = await memory.addEvent({
      title: 'SQLite decision', summary: 'Use SQLite.', sourceBlockId: block.id,
      sourceMessageIds: [block.l5Raw[0]!.id],
      temporal: { participants: { item: ['用户', '助手'] }, supersedesEventIds: 123, eventType: {} } as unknown as EventTemporal,
    });
    expect(event.temporal).toEqual({ eventType: 'other' });
    const snapshot = memory.exportSnapshot();
    snapshot.events[0]!.temporal = { ...validTemporal, participants: { item: ['用户', '助手'] } } as unknown as EventTemporal;
    snapshot.agentEvents.push({ ...structuredClone(snapshot.events[0]!), id: 'agent_dirty' });
    const normalized = normalizeSnapshot(snapshot);
    for (const restored of [...normalized.events, ...normalized.agentEvents]) {
      expect(restored.temporal).not.toHaveProperty('participants');
      expect(restored.temporal).toMatchObject({ originalText: 'Yesterday', beforeEventIds: ['evt_1'] });
      expect(restored.summary).toBe(event.summary);
      expect(restored.sourceMessageIds).toEqual(event.sourceMessageIds);
    }
    expect(snapshot.events[0]!.temporal.participants).toEqual({ item: ['用户', '助手'] });
  });

  it.each(malformedParticipants)('search degrades safely after runtime participants mutation %j', async ({ participants }) => {
    const memory = StrataGate.inMemory({ blockTurnSize: 1, summarizer });
    const block = (await memory.appendTurn({ user: 'SQLite decision', assistant: 'Recorded' })).sealedBlock!;
    const add = (title: string, temporal: EventTemporal) => memory.addEvent({
      title, summary: 'SQLite decision', sourceBlockId: block.id, sourceMessageIds: [block.l5Raw[0]!.id], temporal,
    });
    const dirty = await add('Historical SQLite decision', {});
    const healthy = await add('Current SQLite decision', { participants: ['用户', '助手'], eventType: 'decision' });
    const baseline = (await memory.searchEvents('SQLite', { trackRetrieval: false })).map(({ event }) => event.id);
    dirty.temporal.participants = participants as unknown as string[];
    expect((await memory.searchEvents('SQLite', { trackRetrieval: false })).map(({ event }) => event.id)).toEqual(baseline);
    expect((await memory.searchEvents('', { participants: ['用户'], agentMemoryWeight: 0 })).map(({ event }) => event.id)).toEqual([healthy.id]);
    expect(memory.listEvents().find(({ id }) => id === healthy.id)!.weight.lastRetrievedAt).not.toBeNull();
    // The consumer guard repairs fields while preserving the Event identity.
    expect(memory.listEvents()[0]).toBe(dirty);
    expect(dirty.temporal).not.toHaveProperty('participants');
  });

  it('search tolerates malformed temporal strings and a null temporal object', async () => {
    const memory = StrataGate.inMemory({ blockTurnSize: 1, summarizer });
    const block = (await memory.appendTurn({ user: 'SQLite decision', assistant: 'Recorded' })).sealedBlock!;
    const event = await memory.addEvent({
      title: 'SQLite decision', summary: 'Use SQLite.', sourceBlockId: block.id, sourceMessageIds: [block.l5Raw[0]!.id],
    });
    event.temporal = { happenedStart: {}, mentionedAt: 123, originalText: {}, eventType: [] } as unknown as EventTemporal;
    expect((await memory.searchEvents('SQLite', { temporalIntent: 'latest', eventType: 'decision' }))[0]!.event.id).toBe(event.id);
    event.temporal = null as unknown as EventTemporal;
    expect((await memory.searchEvents('SQLite'))[0]!.event.id).toBe(event.id);
    expect(event.temporal).toEqual({});
  });

  it.each(['events', 'agent_events'] as const)('loads dirty SQLite %s and continues extraction/timeline', async (table) => {
    const directory = await mkdtemp(join(tmpdir(), 'stratagate-temporal-'));
    const filename = join(directory, 'memory.db');
    const namespace = 'issue-102';
    let memory: StrataGate | undefined;
    let storage: SqliteStorage | undefined;
    let timeline: ExtractionContext['timeline'] = [];
    const options = {
      database: filename, namespace, blockTurnSize: 1, summarizer,
      extractor: async (context: ExtractionContext) => {
        timeline = context.timeline;
        return { shouldExtract: true, reason: 'durable decision', events: [{
          title: 'Next SQLite decision', summary: 'SQLite decision confirmed.',
          sourceBlockId: context.target.id, sourceMessageIds: [context.target.l5Raw[0]!.id],
          temporal: { participants: ['用户', '助手'], eventType: 'decision' },
        }] };
      },
    };
    try {
      memory = await StrataGate.open(options);
      const block = (await memory.appendTurn({ user: 'SQLite decision', assistant: 'Recorded' })).sealedBlock!;
      const healthy = await memory.addEvent({
        title: 'Healthy SQLite decision', summary: 'Use SQLite.', sourceBlockId: block.id,
        sourceMessageIds: [block.l5Raw[0]!.id], temporal: { participants: ['用户', '助手'], eventType: 'decision' },
      });
      const dirtyId = table === 'events'
        ? (await memory.addEvent({ title: 'Historical SQLite decision', summary: 'Keep this Event.',
          sourceBlockId: block.id, sourceMessageIds: [block.l5Raw[0]!.id] })).id
        : (await memory.recordAgentEvent({ content: '用户偏好 pnpm 作为包管理器。', category: 'preference' })).eventId!;
      await memory.close();
      memory = undefined;
      const db = new DatabaseSync(filename);
      try {
        db.prepare(`UPDATE ${table} SET temporal_json = ? WHERE namespace = ? AND id = ?`).run(
          JSON.stringify({ eventType: 'decision', participants: { item: ['用户', '助手'] }, originalText: 'Yesterday' }),
          namespace, dirtyId,
        );
      } finally { db.close(); }
      // Verify the SQLite read boundary itself, before StrataGate normalizes a snapshot.
      storage = new SqliteStorage({ filename });
      const loaded = (await storage.load(namespace))!.snapshot;
      const restored = (table === 'events' ? loaded.events : loaded.agentEvents).find(({ id }) => id === dirtyId)!;
      expect(restored.temporal).toEqual({ eventType: 'decision', originalText: 'Yesterday' });
      await storage.close();
      storage = undefined;
      memory = await StrataGate.open(options);
      expect((await memory.searchEvents('SQLite')).some(({ event }) => event.id === healthy.id)).toBe(true);
      expect((await memory.searchEvents('', { participants: ['用户'], agentMemoryWeight: 0 })).map(({ event }) => event.id)).toEqual([healthy.id]);
      expect((await memory.searchEvents('Yesterday')).some(({ event }) => event.id === dirtyId)).toBe(true);
      const result = await memory.appendTurn({ user: 'TARGET SQLite decision follow-up', assistant: 'Confirmed' });
      expect(result.extractedEvents).toHaveLength(1);
      expect(result.extractedEvents[0]!.temporal.participants).toEqual(['用户', '助手']);
      expect(memory.listExtractionJobs().at(-1)).toMatchObject({ status: 'succeeded', attempts: 1, lastError: null });
      expect(timeline.some(({ id }) => id === healthy.id)).toBe(true);
      if (table === 'events') {
        expect(timeline.find(({ id }) => id === dirtyId)!.temporal).toEqual({ eventType: 'decision', originalText: 'Yesterday' });
      }
      expect([...memory.listEvents(), ...memory.listAgentEvents()].some(({ id }) => id === dirtyId)).toBe(true);
    } finally {
      await storage?.close();
      await memory?.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
