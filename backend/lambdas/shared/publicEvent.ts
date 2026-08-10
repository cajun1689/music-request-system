import type { EventRecord } from "./types";

export type PublicEventRecord = Omit<
  EventRecord,
  | "pushToken"
  | "autoMatchState"
  | "blockedPushSources"
  | "autoApproveList"
  | "blockList"
  | "organizationId"
  | "createdBy"
  | "accountMode"
> & { accountMode?: "saas" };

export function toPublicEvent(event: EventRecord): PublicEventRecord {
  const {
    pushToken: _pushToken,
    autoMatchState: _autoMatchState,
    blockedPushSources: _blockedPushSources,
    autoApproveList: _autoApproveList,
    blockList: _blockList,
    organizationId: _organizationId,
    createdBy: _createdBy,
    accountMode,
    ...publicFields
  } = event;
  return {
    ...publicFields,
    ...(accountMode === "saas" ? { accountMode } : {}),
  };
}
