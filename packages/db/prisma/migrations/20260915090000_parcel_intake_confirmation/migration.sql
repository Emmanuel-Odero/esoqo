-- Physical custody confirmation, separate from booking itself.
--
-- Booking a parcel — whether a sender fills the form in themselves or
-- a clerk types a walk-in's details in — only ever describes a parcel.
-- Neither act proves anyone at Esoqo (or a partner courier) actually
-- has it in hand yet. Texting the sender and receiver off the back of
-- that submission told both parties a parcel was in the system before
-- a single person had touched it. These two columns are the gate: the
-- sender/receiver SMS wait for a clerk/handler to explicitly confirm
-- custody, timestamp plus a person rather than a boolean, same "who
-- and when" reasoning contentsDeclaredAt already follows on this table.
ALTER TABLE "parcel"
    ADD COLUMN "intakeConfirmedAt" TIMESTAMP(3),
    ADD COLUMN "intakeConfirmedByStaffId" UUID;
