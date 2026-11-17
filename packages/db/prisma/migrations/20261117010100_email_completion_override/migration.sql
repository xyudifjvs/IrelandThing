-- A manual check/uncheck is independent of the immutable email delivery history.
ALTER TABLE "EmailWork" ADD COLUMN "checkedOverride" BOOLEAN;
