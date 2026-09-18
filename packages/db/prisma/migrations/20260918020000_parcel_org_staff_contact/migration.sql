-- Contact people on a courier company's roster. Multiple staff rows may be
-- flagged; the operator register/detail prefer a flagged contact over the
-- legacy parcel_org.contactPerson string, which stays only as a fallback.
ALTER TABLE "parcel_org_staff"
    ADD COLUMN "isContact" BOOLEAN NOT NULL DEFAULT false;
