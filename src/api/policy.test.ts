import { describe, expect, it } from 'vitest';
import { mergeRoomPolicy } from './policy';
import type { RoomPolicy } from './types';

const EDITABLE_ROLES = ['guest', 'requester', 'room_admin', 'media_admin'] as const;

describe('mergeRoomPolicy', () => {
  it('keeps policy fields the panel does not know about', () => {
    const base: RoomPolicy = {
      max_queue: 20,
      member_player_volume: true,
      radio_control: 'controller',
      start_lead_ms: 900,
      // 将来服务端新增的任何字段走同一条路径，不需要改 UI。
      some_future_knob: { nested: ['value'] },
    };

    const merged = mergeRoomPolicy(base, {
      max_queue: 30,
      member_player_volume: false,
      radio_control: 'controller',
      queue_limits: { guest: 3 },
      editable_queue_limit_roles: EDITABLE_ROLES,
    });

    expect(merged).toEqual({
      max_queue: 30,
      member_player_volume: false,
      radio_control: 'controller',
      queue_limits: { guest: 3 },
      start_lead_ms: 900,
      some_future_knob: { nested: ['value'] },
    });
  });

  it('writes owned fields even when cleared to zero, false, or empty', () => {
    const base: RoomPolicy = {
      max_queue: 20,
      member_player_volume: true,
      radio_control: 'controller',
      queue_limits: { guest: 3, requester: 10 },
      start_lead_ms: 0,
    };

    const merged = mergeRoomPolicy(base, {
      max_queue: 0,
      member_player_volume: false,
      radio_control: 'controller',
      queue_limits: {},
      editable_queue_limit_roles: EDITABLE_ROLES,
    });

    expect(merged).toEqual({
      max_queue: 0,
      member_player_volume: false,
      radio_control: 'controller',
      queue_limits: {},
      start_lead_ms: 0,
    });
  });

  it('preserves queue_limits keys outside the editable role set', () => {
    const base: RoomPolicy = {
      queue_limits: { guest: 3, requester: 10, oidc: 50, future_role: 7 },
    };

    const merged = mergeRoomPolicy(base, {
      max_queue: 0,
      member_player_volume: false,
      radio_control: 'controller',
      // requester 行被管理员删掉 → 显式删除；guest 行被改成 5。
      queue_limits: { guest: 5 },
      editable_queue_limit_roles: EDITABLE_ROLES,
    });

    expect(merged.queue_limits).toEqual({ guest: 5, oidc: 50, future_role: 7 });
  });

  it('does not mutate the server base', () => {
    const base: RoomPolicy = { max_queue: 20, queue_limits: { guest: 3 }, start_lead_ms: 600 };
    const snapshot = structuredClone(base);

    mergeRoomPolicy(base, {
      max_queue: 5,
      member_player_volume: true,
      radio_control: 'controller',
      queue_limits: { requester: 1 },
      editable_queue_limit_roles: EDITABLE_ROLES,
    });

    expect(base).toEqual(snapshot);
  });
});
