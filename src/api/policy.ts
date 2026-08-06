import type { RoomPolicy } from './types';

/**
 * 房间治理策略表单实际拥有（并因此有权覆盖/删除）的部分。
 *
 * 服务端 `PATCH /api/v1/rooms/{id}` 的 `policy` 是**整体替换**：提交什么就是新的
 * `rooms.policy_json`。而服务端认识的键多于本前端（`start_lead_ms` 是第一个例子），
 * 重建整个对象提交等于把不认识的键静默抹回缺省——管理员点一次保存就丢配置。
 */
export interface RoomPolicyEdits {
  max_queue: number;
  member_player_volume: boolean;
  /** 电台启停授权（spec §4.7） */
  radio_control: 'controller' | 'requester';
  /** 表单当前列出的角色限额（角色键 → 上限）。 */
  queue_limits: Record<string, number>;
  /** 表单有权编辑的 `queue_limits` 角色键全集（= 角色下拉的选项集合）。 */
  editable_queue_limit_roles: readonly string[];
}

/**
 * 以服务端当前 policy 为基底，只覆盖表单拥有的键，产出可整体提交的新 policy。
 *
 * 「显式清空」与「未编辑」按**键归属**区分，不按值：
 * - 表单拥有的键（`max_queue`、`member_player_volume`，以及
 *   `editable_queue_limit_roles` 里的 `queue_limits` 角色键）一律以表单状态为准。
 *   这些控件在面板打开后始终渲染且始终有值，所以「值为 0 / false / 该角色行被删掉」
 *   都是管理员的显式意图，必须落地（角色行被删 = 从 `queue_limits` 删除该键）。
 * - 表单没有的键（顶层未知键、以及表单不认识的 `queue_limits` 角色键）管理员
 *   连看到的机会都没有，一律从基底原样保留——将来服务端新增 policy 字段自动免疫，
 *   不需要跟着改 UI。
 */
export function mergeRoomPolicy(base: RoomPolicy, edits: RoomPolicyEdits): RoomPolicy {
  const editableRoles = new Set(edits.editable_queue_limit_roles);
  const queueLimits: Record<string, number> = {};

  for (const [role, limit] of Object.entries(base.queue_limits ?? {})) {
    // 表单不认识的角色键（服务端还支持 kind 键、将来可能新增角色）：保留。
    if (!editableRoles.has(role)) {
      queueLimits[role] = limit;
    }
  }
  for (const [role, limit] of Object.entries(edits.queue_limits)) {
    queueLimits[role] = limit;
  }

  return {
    ...base,
    max_queue: edits.max_queue,
    member_player_volume: edits.member_player_volume,
    radio_control: edits.radio_control,
    queue_limits: queueLimits,
  };
}
