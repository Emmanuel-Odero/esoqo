-- Group treasury member-visible timeline (dbx.GroupTimeline): an index
-- to support "every audit_event row for one group, newest first" —
-- audit_event previously had no index touching targetType/targetId at
-- all, so this query would have been a full table scan. Index-only;
-- does not touch the hash chain (row content is unaffected).

-- CreateIndex
CREATE INDEX "audit_event_targetType_targetId_occurredAt_idx"
    ON "audit_event"("targetType", "targetId", "occurredAt");
